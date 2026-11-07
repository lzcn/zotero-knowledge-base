#!/usr/bin/env node
/**
 * Execute the actual data modules against temporary SQLite databases.
 * The mozStorage stub exposes columns only through getResultByName(), so
 * treating database rows as plain JavaScript objects fails these tests.
 * Covers current-schema creation/reopening, CRUD, links, backlinks and graphs.
 * An optional snapshot argument is copied; the supplied file is never changed.
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ */
/* assertion bookkeeping                                               */
/* ------------------------------------------------------------------ */

const failures = [];
let checks = 0;

function check(label, ok, detail = "") {
  checks++;
  if (!ok) failures.push(label);
  console.log(
    `   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
  );
}

/* ------------------------------------------------------------------ */
/* mozStorage emulation                                                */
/* ------------------------------------------------------------------ */

/**
 * Mirrors mozIStorageRow: values are reachable only via the accessor methods,
 * so `row.someColumn` is undefined exactly as it is inside Zotero.
 */
class Row {
  #names;
  #values;
  constructor(names, values) {
    this.#names = names;
    this.#values = values;
  }
  get numEntries() {
    return this.#values.length;
  }
  getResultByIndex(index) {
    return this.#values[index];
  }
  getResultByName(name) {
    const index = this.#names.indexOf(name);
    if (index === -1) throw new Error(`no such column: ${name}`);
    return this.#values[index];
  }
}

class Connection {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
  }
  async execute(sql, params = null) {
    // Match Gecko Sqlite.sys.mjs: LIKE patterns must use bound parameters.
    if (/\bLIKE\b\s(?![@:?])/i.test(sql))
      throw new Error("Please enter a LIKE clause with bindings");
    if (failStatement?.(sql))
      throw new Error("Injected Knowledge Base commit failure");
    executedStatements.push(sql);
    const bound = Array.isArray(params)
      ? params
      : params
        ? Object.values(params)
        : [];
    const stmt = this.db.prepare(sql);
    const names = stmt.columns().map((column) => column.name);
    // DDL and non-SELECT statements report no columns; mozStorage resolves
    // those to an empty array.
    if (names.length === 0) {
      stmt.run(...bound);
      return [];
    }
    return stmt.all(...bound).map(
      (record) =>
        new Row(
          names,
          names.map((n) => record[n]),
        ),
    );
  }
  async executeTransaction(fn) {
    this.db.exec("BEGIN");
    try {
      const out = await fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async close() {
    this.db.close();
  }
}
const executedStatements = [];
let failStatement;

/* ------------------------------------------------------------------ */
/* host bindings (must exist before the bundle is imported)                  */
/* ------------------------------------------------------------------ */

const sourceFixtures = new Map(
  [
    [1, "ITEMKEY1"],
    [1, "READING1"],
    [2, "READING1"],
  ].map(([libraryID, key], i) => [
    `${libraryID}/${key}`,
    {
      id: 100 + i,
      key,
      libraryID,
      isRegularItem: () => true,
      isInTrash: () => false,
      getField: () => "",
    },
  ]),
);
const zoteroStub = {
  ItemFields: { getID: () => false },
  DataDirectory: { dir: "" },
  Items: {
    getIDFromLibraryAndKey: (library, key) =>
      sourceFixtures.get(`${library}/${key}`)?.id || false,
    getAsync: async (id) =>
      [...sourceFixtures.values()].find((item) => item.id === id),
    getByLibraryAndKeyAsync: async () => false,
    loadDataTypes: async () => {},
  },
  Tags: { getColors: () => new Map() },
  Prefs: { get: () => undefined },
  debug: () => {},
  logError: (e) => console.log(`   [zotero.logError] ${e?.message ?? e}`),
};
const shutdownBlockers = new Set();

globalThis.ChromeUtils = {
  importESModule: (spec) => {
    if (!spec.includes("Sqlite.sys.mjs"))
      throw new Error(`unexpected import: ${spec}`);
    return {
      Sqlite: {
        openConnection: async ({ path: file }) => new Connection(file),
        shutdown: {
          addBlocker: (_name, blocker) => shutdownBlockers.add(blocker),
          removeBlocker: (blocker) => shutdownBlockers.delete(blocker),
        },
      },
    };
  },
};
globalThis.PathUtils = { join: (...parts) => path.join(...parts) };
globalThis.Zotero = zoteroStub;
globalThis.IOUtils = { exists: async () => false };

/* ------------------------------------------------------------------ */
/* current schema fixture                                             */
/* ------------------------------------------------------------------ */

/**
 * A populated database using the complete current schema.
 */
function createCurrentDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE zettels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      title_folded TEXT NOT NULL DEFAULT '',
      note_type TEXT NOT NULL DEFAULT 'entity' CHECK(note_type IN ('literature','zettel','thinking','entity')),
      source_note INTEGER NOT NULL DEFAULT 0 CHECK(source_note IN (0,1) AND (source_note=0 OR (item_key IS NOT NULL AND library_id IS NOT NULL))),
      custom_key TEXT,
      body TEXT NOT NULL DEFAULT '',
      item_key TEXT,
      library_id INTEGER,
      annotation_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE links (
      source_id TEXT NOT NULL,
      target_id TEXT,
      ref TEXT NOT NULL,
      ref_folded TEXT NOT NULL DEFAULT '',
      UNIQUE(source_id, ref)
    );
    CREATE TABLE tags (
      zettel_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      UNIQUE(zettel_id, tag)
    );
    CREATE INDEX idx_links_target ON links(target_id);
    CREATE INDEX idx_links_source ON links(source_id);
    CREATE INDEX idx_zettels_title ON zettels(title);
    CREATE INDEX idx_zettels_updated ON zettels(updated_at);
    CREATE INDEX idx_zettels_item ON zettels(item_key);
  `);
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schemaVersion', '14')",
  ).run();
  const insert = db.prepare(
    "INSERT INTO zettels (id, title, body, item_key, library_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "20260101010101",
    "existing one",
    "body one",
    "SOURCEITEM",
    1,
    1,
    1,
  );
  insert.run(
    "20260101010102",
    "existing two",
    "body two with [[existing one]]",
    "SOURCEITEM",
    1,
    2,
    2,
  );
  insert.run("20260101010103", "", "", null, null, 3, 3);
  db.exec(`
    UPDATE zettels SET title_folded = lower(title);
    CREATE TABLE card_parents (card_id TEXT PRIMARY KEY, parent_id TEXT, CHECK(card_id <> parent_id));
    INSERT INTO card_parents SELECT id, NULL FROM zettels;
  `);
  // The link index the app writes on save. Opening does not rebuild it, so
  // the fixture must carry it for the backlink assertions to be meaningful.
  db.prepare(
    "INSERT INTO links (source_id, target_id, ref, ref_folded) VALUES ('20260101010102', '20260101010101', 'existing one', 'existing one')",
  ).run();
  db.close();
}

/* ------------------------------------------------------------------ */
/* driver                                                              */
/* ------------------------------------------------------------------ */

const workspace = await mkdtemp(
  path.join(os.tmpdir(), "knowledge-base-verify-"),
);
const entry = path.join(workspace, "entry.ts");
const bundle = path.join(workspace, "bundle.mjs");

await writeFile(
  entry,
  `export * as drafts from ${JSON.stringify(path.join(ROOT, "src/modules/editor-drafts.ts"))};\n` +
    `export * as events from ${JSON.stringify(path.join(ROOT, "src/modules/events.ts"))};\n` +
    `export * as nativeNotes from ${JSON.stringify(path.join(ROOT, "src/modules/native-notes.ts"))};\n` +
    `export * as operations from ${JSON.stringify(path.join(ROOT, "src/modules/note-operations.ts"))};\n` +
    `export * as noteTags from ${JSON.stringify(path.join(ROOT, "src/modules/note-tags.ts"))};\n` +
    // Absolute paths so esbuild does not need the entry to sit in the project.
    `export * as noteSort from ${JSON.stringify(path.join(ROOT, "src/modules/note-sort.ts"))};\n` +
    `export * as db from ${JSON.stringify(path.join(ROOT, "src/modules/db.ts"))};\n` +
    `export * as zettel from ${JSON.stringify(path.join(ROOT, "src/modules/zettel.ts"))};\n` +
    `export * as noteRefs from ${JSON.stringify(path.join(ROOT, "src/modules/note-references.ts"))};\n` +
    `export * as graph from ${JSON.stringify(path.join(ROOT, "src/modules/graph.ts"))};\n` +
    `export * as hierarchy from ${JSON.stringify(path.join(ROOT, "src/modules/hierarchy.ts"))};\n`,
);
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: bundle,
  logLevel: "warning",
});

// One bundle, one module instance: both modules must share the same
// connection object for the flow checks to mean anything.
const {
  db,
  zettel,
  graph,
  hierarchy,
  drafts,
  noteRefs,
  events,
  nativeNotes,
  operations,
  noteSort,
  noteTags,
} = await import(pathToFileURL(bundle).href);

async function readSchema(file) {
  const inspect = new DatabaseSync(file);
  const out = {
    version: inspect
      .prepare("SELECT value FROM meta WHERE key = 'schemaVersion'")
      .get()?.value,
    columns: inspect
      .prepare("PRAGMA table_info(zettels)")
      .all()
      .map((r) => r.name),
    indexes: inspect
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
      )
      .all()
      .map((r) => r.name),
    rows: inspect.prepare("SELECT COUNT(*) AS n FROM zettels").get().n,
  };
  inspect.close();
  return out;
}

const REQUIRED = [
  "id",
  "title",
  "title_folded",
  "body",
  "item_key",
  "library_id",
  "annotation_key",
  "source_note",
  "note_type",
  "custom_key",
  "created_at",
  "updated_at",
];

async function initialize(label, dataDir, prepare) {
  console.log(`\n=== ${label} ===`);
  await mkdir(dataDir, { recursive: true });
  if (prepare) await prepare(path.join(dataDir, "knowledge-base.sqlite"));

  zoteroStub.DataDirectory.dir = dataDir;
  try {
    await db.initDB();
    console.log("   initDB() resolved");
  } catch (e) {
    console.log(`   initDB() THREW: ${e?.message}`);
    console.log(db.getSchemaTrace());
    check("initDB succeeded", false);
    return null;
  }

  const schema = await readSchema(path.join(dataDir, "knowledge-base.sqlite"));
  check(
    "schemaVersion is 14",
    schema.version === "14",
    `got ${schema.version}`,
  );
  const missing = REQUIRED.filter((c) => !schema.columns.includes(c));
  check(
    "all required columns present",
    missing.length === 0,
    missing.join(", "),
  );
  check(
    "all 13 indexes present",
    schema.indexes.length === 13,
    `got ${schema.indexes.length}`,
  );
  return schema;
}

/* ---- case 1: empty database ---- */
const fresh = await initialize("fresh database", path.join(workspace, "fresh"));
if (fresh)
  check("fresh database has no rows", fresh.rows === 0, `got ${fresh.rows}`);
check("database registers a shutdown blocker", shutdownBlockers.size === 1);
await Promise.all([...shutdownBlockers].map((blocker) => blocker()));
check(
  "application shutdown closes and releases its connection",
  shutdownBlockers.size === 0,
);
let closed = false;
try {
  await db.getAll("SELECT * FROM zettels");
} catch {
  closed = true;
}
check("closed connection rejects new queries", closed);
const reopened = await initialize(
  "reopen after shutdown",
  path.join(workspace, "fresh"),
);
check("shutdown preserves the SQLite file", reopened?.rows === 0);
await Promise.all([db.closeDB(), db.closeDB()]);
check("duplicate close removes the blocker once", shutdownBlockers.size === 0);
await db.initDB();
let finishWrite;
let writeStarted;
const writing = new Promise((resolve) => {
  writeStarted = resolve;
});
const pendingWrite = db.transaction(async () => {
  await db.exec("INSERT INTO meta(key,value) VALUES('shutdown-test','before')");
  writeStarted();
  await new Promise((resolve) => {
    finishWrite = resolve;
  });
  await db.exec("UPDATE meta SET value='committed' WHERE key='shutdown-test'");
});
await writing;
const draining = Promise.all([...shutdownBlockers].map((blocker) => blocker()));
await new Promise((resolve) => setImmediate(resolve));
let newWriteRejected = false;
try {
  await db.transaction(async () => {});
} catch {
  newWriteRejected = true;
}
finishWrite();
await Promise.all([pendingWrite, draining]);
const savedWrite = new DatabaseSync(
  path.join(workspace, "fresh/knowledge-base.sqlite"),
);
check(
  "shutdown commits the current transaction and rejects new writes",
  newWriteRejected &&
    savedWrite.prepare("SELECT value FROM meta WHERE key='shutdown-test'").get()
      .value === "committed",
);
savedWrite.close();

/* ---- case 2: current development database ---- */
const currentSchema = await initialize(
  "current development database",
  path.join(workspace, "existing"),
  createCurrentDatabase,
);
if (currentSchema) {
  check(
    "existing rows preserved",
    currentSchema.rows === 3,
    `got ${currentSchema.rows}`,
  );
}

/* ---- case 3: data-layer flows, on the current development database ---- */
if (currentSchema) {
  console.log("\n=== data-layer flows ===");
  await db.initDB();
  const beforeCancellation = executedStatements.length;
  let cancellationChecks = 0;
  await zettel.rebuildCounts(() => ++cancellationChecks > 2);
  check(
    "cancelled indexing finishes its current read without scheduling more SQL",
    executedStatements.length === beforeCancellation + 1,
  );
  await zettel.rebuildCounts();

  const listed = await zettel.listZettels();
  check(
    "listZettels reads the existing rows",
    listed.length === 3,
    `got ${listed.length}`,
  );
  check(
    "row fields are readable (id/title/updated_at)",
    listed.every(
      (r) =>
        typeof r.id === "string" &&
        r.id.length > 0 &&
        typeof r.title === "string" &&
        typeof r.updated_at === "number",
    ),
  );
  check(
    "rowToZettel keeps existing titles",
    listed.some((r) => r.title === "existing one"),
    JSON.stringify(listed.map((r) => r.title)),
  );
  check(
    "existing [[link]] is indexed and resolved",
    (await zettel.getBacklinks("20260101010101")).some(
      (b) =>
        b.sourceId === "20260101010102" && b.sourceTitle === "existing two",
    ),
  );

  const searchFixtures = [];
  for (let n = 0; n < 7; n++)
    searchFixtures.push(
      await zettel.saveZettel({
        title: n === 0 ? "SearchNeedle" : `Search fixture ${n}`,
        body:
          n === 0
            ? ""
            : 'SearchNeedle 中文检索示例 literal_100% quote" OR syntax',
      }),
    );
  for (const [index, key] of [
    [0, "zz-ID"],
    [1, "aa-ID"],
  ]) {
    const card = await zettel.getZettel(searchFixtures[index]);
    await zettel.saveZettel({ ...card, customKey: key });
  }
  for (const id of searchFixtures)
    await db.exec("UPDATE zettels SET updated_at = 42 WHERE id = ?", [id]);
  for (const sort of [
    "updated-desc",
    "updated-asc",
    "created-desc",
    "created-asc",
    "title-asc",
    "title-desc",
    "id-asc",
    "id-desc",
  ]) {
    const all = await zettel.searchZettels("SearchNeedle", {
      sort,
      limit: 100,
    });
    const expected = [...all.items].sort((a, b) =>
      noteSort.compareNoteSummaries(a, b, sort),
    );
    let part = await zettel.searchZettels("SearchNeedle", { sort, limit: 2 });
    const ids = part.items.map((row) => row.id);
    while (part.cursor) {
      part = await zettel.searchZettels("SearchNeedle", {
        sort,
        limit: 2,
        cursor: part.cursor,
      });
      ids.push(...part.items.map((row) => row.id));
    }
    check(
      "Sorted pagination retains relevance and every note exactly once: " +
        sort,
      JSON.stringify(ids) === JSON.stringify(expected.map((row) => row.id)) &&
        new Set(ids).size === searchFixtures.length,
    );
  }
  const sortedFirst = await zettel.searchZettels("SearchNeedle", {
    sort: "title-asc",
    limit: 2,
  });
  let wrongSortRejected = false;
  try {
    await zettel.searchZettels("SearchNeedle", {
      sort: "updated-desc",
      limit: 2,
      cursor: sortedFirst.cursor,
    });
  } catch {
    wrongSortRejected = true;
  }
  check(
    "A cursor cannot be reused after changing note sort",
    wrongSortRejected,
  );
  let page = await zettel.searchZettels("SearchNeedle", { limit: 2 });
  const paged = page.items.map((row) => row.id);
  check(
    "Full-text search ranks title matches before body matches",
    paged[0] === searchFixtures[0],
  );
  while (page.cursor) {
    page = await zettel.searchZettels("SearchNeedle", {
      limit: 2,
      cursor: page.cursor,
    });
    paged.push(...page.items.map((row) => row.id));
  }
  check(
    "Keyset pagination retains all results without duplicates when timestamps tie",
    new Set(paged).size === 7 && paged.length === 7,
  );
  check(
    "Chinese two-character substrings and query operators stay literal",
    (await zettel.listZettels("检索")).length === 6 &&
      (await zettel.listZettels('quote" OR syntax')).length === 6,
  );
  check(
    "Percent and underscore are literal search characters",
    (await zettel.listZettels("literal_100%")).length === 6 &&
      (await zettel.listZettels("%")).length === 6,
  );
  const lookupSQL = executedStatements.length;
  await zettel.listZettels("中文检索");
  check(
    "Indexed substring queries avoid body LIKE scans and whole-graph counts",
    !executedStatements
      .slice(lookupSQL)
      .some((sql) => /body LIKE|FROM links GROUP BY/.test(sql)),
  );
  await zettel.saveZettel({
    id: searchFixtures[1],
    title: "Changed search fixture",
    body: "Replacement phrase",
  });
  check(
    "Dirty search rows update before the next query without stale matches",
    (await zettel.listZettels("SearchNeedle")).length === 6 &&
      (await zettel.listZettels("Replacement phrase")).length === 1,
  );
  const originalItems = zoteroStub.Items;
  const originalNativeDB = zoteroStub.DB;
  const auditDOM = new JSDOM("<body></body>");
  zoteroStub.getMainWindow = () => auditDOM.window;
  zoteroStub.Promise = { delay: async () => {} };
  zoteroStub.DB = {
    valueQueryAsync: async (_sql, [_library, key]) =>
      key === "CACHEMISSNOTE" ? 5678 : false,
  };
  let trashed = true;
  const auditNote = {
    id: 1234,
    key: "AUDITNOTE",
    libraryID: 1,
    isNote: () => true,
    isInTrash: () => trashed,
    getNote: () =>
      '<div data-schema-version="9"><h1>Changed search fixture</h1><p>Replacement phrase</p></div>',
  };
  let auditNoteReads = 0;
  let auditNoteLoads = 0;
  const originalLoadDataTypes = originalItems.loadDataTypes;
  zoteroStub.Items = {
    ...originalItems,
    loadDataTypes: async (...args) => {
      auditNoteLoads++;
      return originalLoadDataTypes(...args);
    },
    getByLibraryAndKeyAsync: async (_library, key) => {
      if (key !== auditNote.key) return false;
      auditNoteReads++;
      return auditNote;
    },
  };
  for (const [index, key] of [
    [1, "AUDITNOTE"],
    [2, "ERASEDNOTE"],
    [3, "CACHEMISSNOTE"],
  ])
    await db.exec(
      "INSERT INTO card_notes(card_id, note_key, library_id, original_body) VALUES (?, ?, 1, '')",
      [searchFixtures[index], key],
    );
  const auditFirst = nativeNotes.auditNativeNotes();
  const auditCoalesced = nativeNotes.auditNativeNotes();
  check(
    "Concurrent availability audits share one operation",
    auditFirst === auditCoalesced,
  );
  await auditFirst;
  check(
    "Concurrent workbench audits perform one scan rather than scheduling a duplicate",
    auditNoteReads === 1,
  );
  const beforeRescan = auditNoteReads;
  const rescan = nativeNotes.auditNativeNotes();
  check(
    "Availability changes can request a fresh pass during an active audit",
    nativeNotes.auditNativeNotes(true) === rescan,
  );
  await rescan;
  check(
    "Requested availability rescans run after the current pass",
    auditNoteReads === beforeRescan + 2,
  );
  check(
    "Trash retains the original mapping while confirmed permanent deletion removes its card and mapping",
    (
      await db.getOne("SELECT state FROM unavailable_notes WHERE card_id = ?", [
        searchFixtures[1],
      ])
    ).state === "trashed" &&
      !(await zettel.getZettel(searchFixtures[2])) &&
      !(await db.getOne("SELECT * FROM card_notes WHERE card_id = ?", [
        searchFixtures[2],
      ])) &&
      !!(await db.getOne("SELECT * FROM card_notes WHERE card_id = ?", [
        searchFixtures[1],
      ])),
  );
  check(
    "An Items cache miss does not remove an original still present in the Zotero database",
    !!(await zettel.getZettel(searchFixtures[3])) &&
      !!(await db.getOne("SELECT * FROM card_notes WHERE card_id = ?", [
        searchFixtures[3],
      ])),
  );
  await db.closeDB();
  await db.initDB();
  check(
    "Reopening the database retains Trash mappings and card identities",
    (
      await db.getOne("SELECT note_key FROM card_notes WHERE card_id = ?", [
        searchFixtures[1],
      ])
    ).note_key === "AUDITNOTE" &&
      (
        await db.getOne(
          "SELECT state FROM unavailable_notes WHERE card_id = ?",
          [searchFixtures[1]],
        )
      ).state === "trashed",
  );
  check(
    "Active searches exclude deleted notes while the deleted filter includes their cached records",
    !(await zettel.searchZettels("", { cardIDs: searchFixtures.slice(1, 3) }))
      .items.length &&
      !(
        await zettel.searchZettels("", {
          availability: "active",
          cardIDs: searchFixtures.slice(1, 3),
        })
      ).items.length &&
      (
        await zettel.searchZettels("", {
          availability: "trash",
          cardIDs: searchFixtures.slice(1, 3),
        })
      ).items.length === 1 &&
      !(await graph.getGraphData()).nodes.some((node) =>
        searchFixtures.slice(1, 3).includes(node.id),
      ),
  );
  trashed = false;
  await nativeNotes.auditNativeNotes();
  check(
    "Restored originals reenter the active list with the same card identity",
    (
      await zettel.searchZettels("", {
        availability: "active",
        cardIDs: [searchFixtures[1]],
      })
    ).items[0]?.id === searchFixtures[1] &&
      !(await db.getOne(
        "SELECT state FROM unavailable_notes WHERE card_id = ?",
        [searchFixtures[1]],
      )),
  );
  const unchangedAuditStart = executedStatements.length;
  await nativeNotes.auditNativeNotes();
  check(
    "Repeated audits avoid card and availability writes for unchanged notes",
    !executedStatements
      .slice(unchangedAuditStart)
      .some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)),
  );
  check(
    "Repeated audits reuse their mapping snapshot and skip unchanged note projections",
    !executedStatements
      .slice(unchangedAuditStart)
      .some(
        (sql) =>
          sql.startsWith("SELECT * FROM card_notes WHERE note_key") ||
          sql.startsWith("SELECT state FROM unavailable_notes WHERE card_id"),
      ),
  );
  const beforeStateLoads = auditNoteLoads;
  auditNote.dateModified = "2026-01-02T03:04:05Z";
  await nativeNotes.auditNativeNotes();
  const stateLoads = auditNoteLoads;
  await nativeNotes.auditNativeNotes();
  const noteState = await db.getOne(
    "SELECT modified FROM note_states WHERE note_key = ? AND library_id = 1",
    [auditNote.key],
  );
  check(
    "Unchanged native notes skip body loads after their timestamp is stored",
    stateLoads > beforeStateLoads &&
      auditNoteLoads === stateLoads &&
      noteState?.modified === auditNote.dateModified,
  );
  for (const id of searchFixtures.slice(1, 4))
    await db.exec("DELETE FROM card_notes WHERE card_id = ?", [id]);
  zoteroStub.Items = originalItems;
  zoteroStub.DB = originalNativeDB;
  auditDOM.window.close();
  for (const id of searchFixtures) await zettel.deleteZettel(id);
  check(
    "Deleting cards removes their full-text index entries",
    !(await zettel.listZettels("SearchNeedle")).length,
  );
  check(
    "Missing search cache is rebuilt for existing content",
    (await zettel.listZettels("existing one")).length >= 1,
  );

  const longNoteID = await zettel.saveZettel({
    title: "Long summary fixture",
    body: "x".repeat(20000) + "Body search beyond prefix",
  });
  const summaryPage = await zettel.searchZettels("Body search beyond prefix", {
    summary: true,
  });
  check(
    "List summaries cap transferred text while full-text search and selected-note retrieval retain the entire body",
    summaryPage.items.some(
      (row) =>
        row.id === longNoteID &&
        row.body.length <= 2048 &&
        row.body.includes("Body search beyond prefix"),
    ) && (await zettel.getZettel(longNoteID)).body.length > 20000,
  );
  check(
    "Keyword searches combine non-adjacent terms, while quotes keep phrases literal",
    (await zettel.searchZettels("prefix Body", { summary: true })).items.some(
      (row) => row.id === longNoteID,
    ) &&
      !(await zettel.searchZettels('"prefix Body"')).items.some(
        (row) => row.id === longNoteID,
      ),
  );
  check(
    "Changed-note summaries obey both ID scope and full-text filters",
    (
      await zettel.searchZettels("Body search beyond prefix", {
        summary: true,
        cardIDs: [longNoteID],
      })
    ).items.length === 1 &&
      (
        await zettel.searchZettels("not matching fixture", {
          summary: true,
          cardIDs: [longNoteID],
        })
      ).items.length === 0 &&
      (await zettel.searchZettels("", { summary: true, cardIDs: [] })).items
        .length === 0,
  );
  await zettel.deleteZettel(longNoteID);
  const journalDOM = new JSDOM("<!doctype html><body></body>");
  const oldHost = { ...zoteroStub };
  const oldItems = zoteroStub.Items;
  let nativeWrites = 0;
  const journalNote = {
    id: 7001,
    key: "JOURNAL1",
    libraryID: 1,
    html: "<h1>Journal fixture</h1><p>Before interruption</p>",
    isNote: () => true,
    isEditable: () => true,
    isInTrash: () => false,
    getNote() {
      return this.html;
    },
    setNote(html) {
      const changed = html !== this.html;
      this.html = html;
      return changed;
    },
    async save() {
      nativeWrites++;
    },
  };
  zoteroStub.getMainWindow = () => journalDOM.window;
  zoteroStub.Items = {
    ...oldItems,
    getAsync: async (id) => (id === journalNote.id ? journalNote : null),
    getByLibraryAndKeyAsync: async (library, key) =>
      library === 1 && key === journalNote.key ? journalNote : null,
  };
  zoteroStub.DB = {
    executeTransaction: async (fn) => {
      const original = journalNote.html;
      try {
        return await fn();
      } catch (error) {
        journalNote.html = original;
        throw error;
      }
    },
  };
  const journalID = await zettel.saveZettel({
    title: "Journal fixture",
    body: "Before interruption",
  });
  await db.exec(
    "INSERT INTO card_notes(card_id, note_key, library_id, original_body, external) VALUES (?, ?, 1, ?, 1)",
    [journalID, journalNote.key, "Before interruption"],
  );
  const journalInput = () => ({
    id: journalID,
    title: "Journal fixture",
    body: "After interruption",
    sourceMode: true,
    sourceDocument: "# Journal fixture\n\nAfter interruption",
    noteID: journalNote.id,
    expectedNoteHTML: journalNote.html,
  });
  failStatement = (sql) => /DELETE FROM note_save_operations/.test(sql);
  let interrupted = false;
  try {
    await nativeNotes.saveNativeCard(journalInput());
  } catch (error) {
    interrupted = String(error).includes(
      "Injected Knowledge Base commit failure",
    );
  }
  failStatement = undefined;
  check(
    "A failure after the native commit rolls back Knowledge Base metadata while retaining its intent and draft",
    interrupted &&
      journalNote.html.includes("After interruption") &&
      (await zettel.getZettel(journalID)).body === "Before interruption" &&
      (await operations.listNoteOperations()).length === 1 &&
      (await drafts.listEditorDrafts()).length === 1,
  );
  const writesBeforeRecovery = nativeWrites;
  await db.closeDB();
  await db.initDB();
  await nativeNotes.recoverNativeSaves();
  await nativeNotes.recoverNativeSaves();
  check(
    "Restart reconciliation is idempotent and commits the card, mapping and draft without rewriting native content",
    (await zettel.getZettel(journalID)).body === "After interruption" &&
      !(await operations.listNoteOperations()).length &&
      !(await drafts.listEditorDrafts()).length &&
      nativeWrites === writesBeforeRecovery,
  );
  const protectedInput = {
    ...journalInput(),
    body: "Pending content",
    sourceDocument: "# Journal fixture\n\nPending content",
  };
  const intended = "<h1>Journal fixture</h1><p>Pending content</p>";
  const protectedOperation = await operations.prepareNoteOperation(
    protectedInput,
    journalNote,
    intended,
    (await zettel.getZettel(journalID)).updated_at,
  );
  journalNote.html = "<h1>Journal fixture</h1><p>Later external edit</p>";
  await nativeNotes.recoverNativeSaves();
  check(
    "Recovery retains an intervening native edit and the pending draft",
    journalNote.html.includes("Later external edit") &&
      (await operations.listNoteOperations()).length === 1 &&
      (await zettel.getZettel(journalID)).body === "After interruption",
  );
  journalNote.html = intended;
  await zettel.saveZettel({
    id: journalID,
    title: "Changed metadata",
    body: "Newer card content",
  });
  await nativeNotes.recoverNativeSaves();
  check(
    "Recovery never overwrites newer Knowledge Base metadata",
    (await zettel.getZettel(journalID)).title === "Changed metadata" &&
      (await operations.listNoteOperations()).length === 1,
  );
  await operations.abandonNoteOperation(protectedOperation);
  await drafts.discardEditorDraft(protectedOperation.input.draftId);
  const beforeCancelled = journalNote.html;
  let cancelled = false;
  try {
    await nativeNotes.saveNativeCard({
      ...journalInput(),
      isCurrent: () => false,
    });
  } catch (error) {
    cancelled = String(error).includes("NOTE_SESSION_CLOSED");
  }
  check(
    "Cancellation before the native write retires only the intent and retains the draft",
    cancelled &&
      journalNote.html === beforeCancelled &&
      !(await operations.listNoteOperations()).length &&
      (await drafts.listEditorDrafts()).length === 1,
  );
  for (const draft of await drafts.listEditorDrafts())
    await drafts.discardEditorDraft(draft.draftId);
  const newOperation = await operations.prepareNoteOperation(
    {
      ...journalInput(),
      id: undefined,
      draftId: "new-note-intent",
      draftRevision: 1,
    },
    journalNote,
    journalNote.html,
    null,
  );
  check(
    "A reserved new card identity never makes an uncommitted recovery draft point at a missing card",
    !(await drafts.getEditorDraft("new-note-intent")).id &&
      newOperation.input.id,
  );
  await drafts.saveEditorDraft({
    ...newOperation.input,
    id: undefined,
    draftRevision: 2,
    body: "Newer typing retained",
    sourceDocument: "# Journal fixture\n\nNewer typing retained",
  });
  await zettel.saveEditorCard(
    {
      id: newOperation.input.id,
      title: newOperation.input.title,
      body: newOperation.input.body,
    },
    () => operations.completeNoteOperation(newOperation),
  );
  const newerDraft = await drafts.getEditorDraft("new-note-intent");
  check(
    "Completing an older save preserves newer typing and rebases its new card identity and version",
    newerDraft.body === "Newer typing retained" &&
      newerDraft.id === newOperation.input.id &&
      newerDraft.expectedUpdatedAt ===
        (await zettel.getZettel(newOperation.input.id)).updated_at &&
      newerDraft.expectedNoteHTML === newOperation.intendedHTML,
  );
  await drafts.discardEditorDraft("new-note-intent");
  await zettel.deleteZettel(newOperation.input.id);
  await db.exec("DELETE FROM card_notes WHERE card_id = ?", [journalID]);
  await zettel.deleteZettel(journalID);
  for (const key of Object.keys(zoteroStub))
    if (!(key in oldHost)) delete zoteroStub[key];
  Object.assign(zoteroStub, oldHost);
  zoteroStub.Items = oldItems;
  journalDOM.window.close();

  const storedTitle = await db.getOne(
    "SELECT title_folded FROM zettels WHERE id = ?",
    ["20260101010101"],
  );
  const storedLink = await db.getOne(
    "SELECT ref_folded FROM links WHERE source_id = ?",
    ["20260101010102"],
  );
  check(
    "Opening the current schema preserves title and link lookup keys",
    storedTitle.title_folded === "existing one" &&
      storedLink.ref_folded === "existing one",
  );

  const duplicateA = await zettel.saveZettel({ title: "Twin", body: "" });
  const duplicateB = await zettel.saveZettel({ title: "Twin", body: "" });
  const unicodeTarget = await zettel.saveZettel({ title: "École", body: "" });
  const indexSource = await zettel.saveZettel({
    title: "Index fixture",
    body: "[[Twin]] [[ÉCOLE]] [[Pending target]]",
  });
  const lookupStart = executedStatements.length;
  const matches = await zettel.resolveRefs(["Twin", "ÉCOLE", duplicateA]);
  check(
    "Duplicate titles stay unresolved while IDs and Unicode case folding remain deterministic",
    !matches.has("Twin") &&
      matches.get("ÉCOLE") === unicodeTarget &&
      matches.get(duplicateA) === duplicateA,
  );
  check(
    "Reference lookup does not scan all titles",
    !executedStatements
      .slice(lookupStart)
      .some((sql) => /SELECT id, title FROM zettels\s*$/.test(sql)),
  );
  const changes = [];
  const unsubscribeChanges = events.onDataChange((change) =>
    changes.push(change),
  );
  const incrementalStart = executedStatements.length;
  await zettel.saveZettel({
    id: indexSource,
    title: "Index fixture",
    body: "Changed prose [[Twin]] [[ÉCOLE|new label]] [[Pending target]]",
  });
  const incrementalSQL = executedStatements.slice(incrementalStart);
  check(
    "Prose and link-label edits preserve existing link rows instead of rewriting the index",
    !incrementalSQL.some((sql) =>
      /^(DELETE FROM links|INSERT(?: OR IGNORE)? INTO links)/.test(sql.trim()),
    ),
  );
  check(
    "Content-only changes announce their own card and skip topology notifications",
    changes.at(-1).cardIDs.join() === indexSource &&
      changes.at(-1).fields.join() === "content",
  );
  const unchangedIndex = await zettel.getZettel(indexSource);
  const eventCount = changes.length;
  await zettel.saveZettel({
    id: indexSource,
    title: unchangedIndex.title,
    body: unchangedIndex.body,
  });
  check(
    "An unchanged card retains its version and emits no refresh event",
    (await zettel.getZettel(indexSource)).updated_at ===
      unchangedIndex.updated_at && changes.length === eventCount,
  );
  const forwardTarget = await zettel.saveZettel({
    title: "Pending target",
    body: "",
  });
  check(
    "Target creation resolves only matching forward links and includes affected readers in its event",
    (await zettel.getOutgoing(indexSource)).some(
      (link) =>
        link.ref === "Pending target" && link.targetId === forwardTarget,
    ) &&
      changes.at(-1).cardIDs.includes(indexSource) &&
      changes.at(-1).fields.includes("links"),
  );
  unsubscribeChanges();
  for (const id of [
    indexSource,
    duplicateA,
    duplicateB,
    unicodeTarget,
    forwardTarget,
  ])
    await zettel.deleteZettel(id);

  let releaseCleanup;
  let cleanupStarted;
  const cleanupGate = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const started = new Promise((resolve) => {
    cleanupStarted = resolve;
  });
  const previousExists = IOUtils.exists;
  IOUtils.exists = () => {
    cleanupStarted();
    return cleanupGate;
  };
  const savingWithSlowCleanup = zettel.saveZettel({
    title: "Beta",
    body: "plain",
  });
  await started;
  let saveTimeout;
  const betaId = await Promise.race([
    savingWithSlowCleanup,
    new Promise((resolve) => {
      saveTimeout = setTimeout(() => resolve(null), 500);
    }),
  ]);
  clearTimeout(saveTimeout);
  releaseCleanup(false);
  IOUtils.exists = previousExists;
  check(
    "Committed saves finish while image housekeeping is still blocked",
    typeof betaId === "string",
  );
  await savingWithSlowCleanup;
  const thinkingKeyId = await zettel.saveZettel({
    initialTags: ["Thinking Note"],
    title: "Project",
    body: "Ideas",
    customKey: "ProjectPlan",
  });
  check(
    "Timestamp collisions advance seconds across day boundaries without suffixes",
    zettel.newZettelID(
      new Set(["20261031235959", "20261101000000"]),
      new Date(2026, 9, 31, 23, 59, 59),
    ) === "20261101000001" && !zettel.isZettelID("20261031235959-2"),
  );
  check(
    "Thinking notes store editable keys separately from automatic IDs",
    (await zettel.getZettel(thinkingKeyId)).custom_key === "ProjectPlan" &&
      thinkingKeyId !== "ProjectPlan",
  );
  check(
    "Thinking keys resolve as ordinary card links",
    (await zettel.resolveRefs(["ProjectPlan"])).get("ProjectPlan") ===
      thinkingKeyId,
  );
  await zettel.saveZettel({
    id: thinkingKeyId,
    initialTags: ["Thinking Note"],
    title: "Project",
    body: "Ideas",
    customKey: "RevisedPlan",
  });
  check(
    "Changing a Thinking key preserves the ID and old links",
    (await zettel.resolveRefs(["ProjectPlan", "RevisedPlan"])).get(
      "ProjectPlan",
    ) === thinkingKeyId &&
      (await zettel.getZettel(thinkingKeyId)).custom_key === "RevisedPlan",
  );
  for (const key of ["RevisedPlan", betaId, "invalid key", "@Citation"]) {
    let rejected = false;
    try {
      await zettel.saveZettel({
        initialTags: ["Thinking Note"],
        title: "Invalid",
        body: "",
        customKey: key,
      });
    } catch (error) {
      rejected = /NOTE_KEY_/.test(String(error));
    }
    check("Invalid or occupied Thinking key is rejected: " + key, rejected);
  }
  check(
    "Key preflight permits own aliases and rejects another note's reserved aliases",
    (await zettel.checkNoteKey("RevisedPlan", thinkingKeyId)) === null &&
      (await zettel.checkNoteKey("RevisedPlan", betaId)) === "exists" &&
      (await zettel.checkNoteKey("bad key", betaId)) === "invalid",
  );
  const availableID = await zettel.getAvailableNoteID();
  check(
    "A suggested ID is an unreserved plain timestamp",
    /^\d{14}$/.test(availableID) &&
      (await zettel.checkNoteKey(availableID)) === null,
  );
  await zettel.saveZettel({
    id: thinkingKeyId,
    title: "Project renamed",
    body: "Ideas",
  });
  check(
    "Native content refresh preserves a Thinking key",
    (await zettel.getZettel(thinkingKeyId)).custom_key === "RevisedPlan",
  );
  await zettel.deleteZettel(thinkingKeyId);
  check(
    "Deleting a note releases its Thinking aliases",
    !(await zettel.resolveRefs(["RevisedPlan"])).has("RevisedPlan"),
  );
  const rowsBeforeInvalidSource = (await zettel.listZettels()).length;
  sourceFixtures.set("1/NOTESRC1", {
    id: 199,
    isRegularItem: () => false,
    isInTrash: () => false,
  });
  for (const itemKey of ["NOTESRC1", "MISSING1", "https://example.com"])
    await assert.rejects(
      zettel.saveZettel({
        title: "Invalid source",
        body: "Must not be written.",
        itemKey,
        libraryID: 1,
      }),
      /SOURCE_ITEM_REQUIRED/,
    );
  sourceFixtures.delete("1/NOTESRC1");
  check(
    "Source accepts only existing Zotero items and rejects notes, missing items and URLs before writes",
    (await zettel.listZettels()).length === rowsBeforeInvalidSource,
  );
  const alphaId = await zettel.saveZettel({
    title: "Alpha",
    body: "links to [[Beta]]",
    itemKey: "ITEMKEY1",
    libraryID: 1,
    annotationKey: "ANNKEY1",
  });
  check(
    "saveZettel returned an id",
    typeof alphaId === "string" && alphaId.length > 0,
    alphaId,
  );

  const read = await zettel.getZettel(alphaId);
  check(
    "getZettel round-trips the fields",
    read?.title === "Alpha" &&
      read?.body === "links to [[Beta]]" &&
      read?.annotation_key === "ANNKEY1" &&
      read?.item_key === "ITEMKEY1",
  );

  const titles = await zettel.getZettelTitles([alphaId, betaId, "missing"]);
  check(
    "Relation titles load in one batch and omit missing cards",
    titles.get(alphaId) === "Alpha" &&
      titles.get(betaId) === "Beta" &&
      !titles.has("missing"),
  );

  const largeTitles = await zettel.getZettelTitles([
    ...Array.from({ length: 501 }, (_, index) => `missing-title-${index}`),
    alphaId,
    betaId,
    alphaId,
  ]);
  check(
    "Relation title batches preserve targets beyond 500 IDs",
    largeTitles.get(alphaId) === "Alpha" &&
      largeTitles.get(betaId) === "Beta" &&
      largeTitles.size === 2,
  );

  const outgoing = await zettel.getOutgoing(alphaId);
  check(
    "getOutgoing resolves [[Beta]]",
    outgoing.length === 1 &&
      outgoing[0].targetId === betaId &&
      outgoing[0].display === "Beta",
    JSON.stringify(outgoing),
  );

  await zettel.rebuildCounts();
  check(
    "getItemCountSync reflects the item",
    zettel.getItemCountSync("ITEMKEY1") === 1,
    `got ${zettel.getItemCountSync("ITEMKEY1")}`,
  );
  check(
    "getAnnotationCountSync reflects the annotation",
    zettel.getAnnotationCountSync("ANNKEY1") === 1,
    `got ${zettel.getAnnotationCountSync("ANNKEY1")}`,
  );
  check(
    "getZettelByAnnotationKey finds the card",
    (await zettel.getZettelByAnnotationKey("ANNKEY1"))?.id === alphaId,
  );
  check(
    "listByItem finds the card",
    (await zettel.listByItem("ITEMKEY1")).length === 1,
  );

  await zettel.deleteZettel(betaId);
  check(
    "deleteZettel removes exactly one card",
    (await zettel.listZettels()).length === 4,
    `got ${(await zettel.listZettels()).length}`,
  );
  check(
    "deleting a target preserves its unresolved reference",
    (await zettel.getUnresolvedRefs()).some((r) => r.ref === "Beta"),
  );
  const replacementId = await zettel.saveZettel({ title: "Beta", body: "" });
  check(
    "recreating a target reconnects existing backlinks",
    (await zettel.getBacklinks(replacementId)).some(
      (r) => r.sourceId === alphaId,
    ),
  );
  const forwardId = await zettel.saveZettel({
    title: "Forward reference",
    body: "[[Later|显示别名]]",
  });
  check(
    "forward reference is initially unresolved",
    (await zettel.getOutgoing(forwardId))[0]?.targetId === null,
  );
  const laterId = await zettel.saveZettel({ title: "Later", body: "" });
  const forwardLink = (await zettel.getOutgoing(forwardId))[0];
  check(
    "creating a target resolves earlier links and shows its current title",
    forwardLink?.targetId === laterId && forwardLink?.display === "Later",
  );
  check(
    "resolved forward reference appears in backlinks and counts",
    (await zettel.getBacklinks(laterId))[0]?.sourceId === forwardId &&
      (await zettel.getZettel(laterId))?.incoming === 1 &&
      !(await zettel.getUnresolvedRefs()).some((r) => r.ref === "Later"),
  );
  const markdownCard = await zettel.saveZettel({
    title: "Markdown card",
    body: `[Stable label](knowledge-base://card/${laterId})\n\n\`[[Not a card]]\``,
  });
  await zettel.saveZettel({ id: laterId, title: "Renamed target", body: "" });
  check(
    "standard Markdown card links survive target renames",
    (await zettel.getOutgoing(markdownCard))[0]?.targetId === laterId,
  );
  check(
    "code examples do not create phantom graph references",
    !(await zettel.getUnresolvedRefs()).some((ref) => ref.ref === "Not a card"),
  );
  const literature = await zettel.saveZettel({
    sourceNote: true,
    title: "Reading",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  let duplicateRejected = false;
  try {
    await zettel.saveZettel({
      sourceNote: true,
      title: "Duplicate",
      body: "",
      itemKey: "READING1",
      libraryID: 1,
    });
  } catch (error) {
    duplicateRejected = error.message === "LITERATURE_EXISTS";
  }
  check("A source has only one Literature Note", duplicateRejected);
  let noSourceRejected = false;
  try {
    await zettel.saveZettel({
      sourceNote: true,
      title: "No source",
      body: "",
    });
  } catch (error) {
    noSourceRejected = error.message === "LITERATURE_SOURCE_REQUIRED";
  }
  check("Literature Notes require a source", noSourceRejected);
  const anotherLibrary = await zettel.saveZettel({
    sourceNote: true,
    title: "Group reading",
    body: "",
    itemKey: "READING1",
    libraryID: 2,
  });
  const thought = await zettel.saveZettel({
    initialTags: ["Thinking Note"],
    title: "Survey",
    body: "[[Reading]]",
  });
  const firstCard = await zettel.saveZettel({
    title: "First claim",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  const secondCard = await zettel.saveZettel({
    title: "Second claim",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  check(
    "One item supports multiple Zettels alongside its Literature Note",
    (await zettel.listByItem("READING1", 1)).length === 3,
  );
  check(
    "Thinking Notes need no source and link across types",
    !(await zettel.getZettel(thought)).source_note &&
      (await zettel.getOutgoing(thought))[0].targetId === literature,
  );
  check(
    "Ordinary tags filter notes without a type",
    (await zettel.searchZettels("Survey", { tag: "Thinking Note" })).items.some(
      (row) => row.id === thought,
    ) &&
      !(await zettel.searchZettels("Survey", { tag: "Other tag" })).items
        .length,
  );
  await zettel.saveZettel({
    id: firstCard,
    title: "First claim",
    body: "",
    parentId: thought,
  });
  check(
    "Category tags do not classify children through inheritance",
    (
      await zettel.searchZettels("First claim", { tag: "Thinking Note" })
    ).items.some((row) => row.id === firstCard) &&
      !(
        await zettel.searchZettels("First claim", {
          tag: "Thinking Note",
          ownTagsOnly: true,
        })
      ).items.length &&
      (
        await zettel.searchZettels("Survey", {
          tag: "Thinking Note",
          ownTagsOnly: true,
        })
      ).items.some((row) => row.id === thought),
  );
  await zettel.saveZettel({
    id: firstCard,
    title: "First claim",
    body: "",
    parentId: null,
  });
  await zettel.saveZettel({ id: thought, title: "Survey edited", body: "" });
  check(
    "Editing content preserves ordinary tags",
    (await zettel.searchZettels("Survey", { tag: "Thinking Note" })).items.some(
      (row) => row.id === thought,
    ),
  );
  const priorItems = zoteroStub.Items;
  const priorFields = zoteroStub.ItemFields;
  const keys = new Map([
    [1, "Study2026"],
    [2, "Group2026"],
  ]);
  let sourceDeleted = false;
  zoteroStub.ItemFields = { getID: () => false };
  zoteroStub.Items = {
    getIDFromLibraryAndKey: (lib, key) => (key === "READING1" ? lib : null),
    getAsync: async (id) => ({
      id,
      isInTrash: () => sourceDeleted,
      isRegularItem: () => true,
      getField: (field) =>
        field === "extra"
          ? `Citation Key: ${keys.get(id) || ""}`
          : field === "firstCreator"
            ? "Smith et al."
            : field === "date"
              ? "2026-10-08"
              : field === "title"
                ? "A full paper title"
                : "",
    }),
    loadDataTypes: async () => {},
  };
  noteRefs.invalidateNoteReferences();
  const referencesRead = executedStatements.length;
  await Promise.all(
    Array.from({ length: 12 }, () => noteRefs.getNoteReferences()),
  );
  check(
    "Concurrent reference lookups share one metadata scan",
    executedStatements
      .slice(referencesRead)
      .filter((sql) =>
        sql.includes("SELECT id, item_key, library_id FROM zettels"),
      ).length === 1,
  );
  const referencesCached = executedStatements.length;
  events.notifyDataChange({ fields: ["content"] });
  await noteRefs.getNoteReferences();
  check(
    "Body-only notifications retain the reference cache",
    executedStatements.length === referencesCached,
  );
  check(
    "Literature link labels share source metadata and use author-year independently of the key",
    (await noteRefs.getNoteReferences()).literature.get(literature)?.label ===
      "Smith et al. 2026",
  );
  const titleOnlyRead = executedStatements.length;
  await zettel.saveZettel({ id: thought, title: "Survey renamed", body: "" });
  await noteRefs.getNoteReferences();
  check(
    "Title-only edits do not rescan source metadata or note aliases",
    !executedStatements
      .slice(titleOnlyRead)
      .some((sql) =>
        sql.includes("SELECT id, item_key, library_id FROM zettels"),
      ),
  );
  check(
    "Literature defaults to its citekey while Zettels retain timestamp IDs",
    (
      await noteRefs.withNoteReferences([
        { id: literature },
        { id: firstCard },
        { id: secondCard },
      ])
    )
      .map((row) => row.reference)
      .join("|") === `Study2026|${firstCard}|${secondCard}`,
  );
  check(
    "Citation-key wiki links resolve independently of note titles",
    (await zettel.resolveRefs(["@Study2026", "@Group2026"])).get(
      "@Study2026",
    ) === literature,
  );
  check(
    "A plain Literature citekey is a reserved Note ID",
    (await zettel.resolveRefs(["Study2026"])).get("Study2026") === literature &&
      (await zettel.checkNoteKey("Study2026", thought)) === "exists" &&
      (await zettel.checkNoteKey("Study2026", literature)) === null,
  );
  check(
    "Searching a default Literature ID supports exact and literal substring matches",
    (await zettel.searchZettels("Study2026")).items[0]?.id === literature &&
      (await zettel.searchZettels("udy202")).items.some(
        (row) => row.id === literature,
      ),
  );
  for (const sort of ["id-asc", "id-desc"]) {
    const all = await zettel.searchZettels("", {
      sourceNote: true,
      sort,
      limit: 100,
    });
    const expected = (await noteRefs.withNoteReferences(all.items)).sort(
      (a, b) => noteSort.compareNoteSummaries(a, b, sort),
    );
    let page = await zettel.searchZettels("", {
      sourceNote: true,
      sort,
      limit: 1,
    });
    const ids = page.items.map((row) => row.id);
    while (page.cursor) {
      page = await zettel.searchZettels("", {
        sourceNote: true,
        sort,
        limit: 1,
        cursor: page.cursor,
      });
      ids.push(...page.items.map((row) => row.id));
    }
    check(
      "Literature ID pagination uses current citekeys: " + sort,
      JSON.stringify(ids) === JSON.stringify(expected.map((row) => row.id)),
    );
  }
  await zettel.saveZettel({
    id: thought,
    title: "Survey edited",
    body: "[[@Study2026]] [@Study2026]",
  });
  check(
    "Literature wiki links create one backlink, distinct from item citations",
    (await zettel.getOutgoing(thought)).length === 1 &&
      (await zettel.getOutgoing(thought))[0].targetId === literature &&
      (await zettel.getBacklinks(literature))[0].sourceId === thought,
  );
  keys.set(1, "Renamed2026");
  events.notifyDataChange({ fields: ["source", "identity"] });
  check(
    "Changing a citation key preserves the internal ID and indexed links",
    (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
      "Renamed2026" &&
      (await zettel.resolveRefs(["@Study2026"])).get("@Study2026") ===
        literature &&
      (await zettel.getOutgoing(thought))[0].targetId === literature,
  );
  keys.set(2, "Renamed2026");
  events.notifyDataChange({ fields: ["source", "identity"] });
  await zettel.saveZettel({
    id: firstCard,
    title: "@Renamed2026",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  check(
    "Duplicate keys fall back to unique IDs and cannot resolve through titles",
    (
      await noteRefs.withNoteReferences([
        { id: literature },
        { id: anotherLibrary },
      ])
    ).every((row) => row.reference === row.id) &&
      !(await zettel.resolveRefs(["@Renamed2026"])).has("@Renamed2026"),
  );
  keys.set(2, "Group2026");
  keys.set(1, "invalid key");
  events.notifyDataChange({ fields: ["source", "identity"] });
  check(
    "Missing and unsafe citation keys keep a usable internal reference",
    (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
      literature &&
      (await zettel.resolveRefs([literature])).get(literature) === literature,
  );
  keys.set(1, "Renamed2026");
  sourceDeleted = true;
  events.notifyDataChange({ fields: ["availability"] });
  check(
    "Trashed sources fall back without changing or deleting managed notes",
    (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
      literature && (await zettel.getZettel(literature)).source_note === 1,
  );
  zoteroStub.Items = priorItems;
  zoteroStub.ItemFields = priorFields;
  zoteroStub.Libraries = { userLibraryID: 1, getAll: () => [] };
  await db.exec(
    "INSERT INTO card_notes (card_id, note_key, library_id, original_body, external) VALUES (?, 'NOTE0001', 1, '', 1)",
    [literature],
  );
  const linksDOM = new JSDOM("<!doctype html><body></body>");
  const priorWindow = zoteroStub.getMainWindow;
  zoteroStub.getMainWindow = () => linksDOM.window;
  const stableURL = "zotero://select/library/items/NOTE0001";
  const oldHTML = `<div data-schema-version="9"><p><a href="knowledge-base://card/${literature}">Survey</a> <a href="knowledge-base://card/${literature}">My words</a></p><pre class="math">$$x^2$$</pre></div>`;
  const legacyHTML = await nativeNotes.normalizeNoteLinks(
    oldHTML.replace(
      ">Survey</a>",
      `>${(await zettel.getZettel(literature)).title}</a>`,
    ),
  );
  check(
    "Legacy note links become native URLs without changing formulas or explicit aliases",
    legacyHTML.includes(`href="${stableURL}" title="[[${literature}]]"`) &&
      legacyHTML.includes(`title="[[${literature}|My words]]"`) &&
      legacyHTML.includes('class="math">$$x^2$$'),
  );
  await zettel.saveZettel({
    id: literature,
    sourceNote: true,
    title: "Renamed literature",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  const renamedHTML = await nativeNotes.normalizeNoteLinks(legacyHTML);
  check(
    "Title changes leave default key labels, native targets and custom labels unchanged",
    renamedHTML.includes(
      `href="${stableURL}" title="[[${literature}]]">${literature}</a>`,
    ) &&
      renamedHTML.includes(`title="[[${literature}|My words]]">My words</a>`),
  );
  const beforeRollback = (await noteRefs.getNoteLinkTargets()).get(
    literature,
  ).title;
  const priorLabels = new Map([
    [stableURL + "\n[[" + literature + "]]", new Set([literature])],
  ]);
  const nativeRenamedLabel = await nativeNotes.normalizeNoteLinks(
    renamedHTML.replace(`>${literature}</a>`, ">My native wording</a>"),
    priorLabels,
  );
  check(
    "Editing default link text in the native editor creates an alias instead of reverting the edit",
    nativeRenamedLabel.includes(
      `title="[[${literature}|My native wording]]">My native wording</a>`,
    ),
  );
  try {
    await db.transaction(async () => {
      await db.exec("UPDATE zettels SET title='Rolled back' WHERE id=?", [
        literature,
      ]);
      await noteRefs.getNoteLinkTargets();
      throw new Error("test rollback");
    });
  } catch (error) {
    if (error.message !== "test rollback") throw error;
  }
  check(
    "A rolled-back transaction cannot leave a stale link label cache",
    (await noteRefs.getNoteLinkTargets()).get(literature).title ===
      beforeRollback,
  );
  try {
    await db.transaction(async () => {
      await db.exec(
        "INSERT INTO note_keys(key,card_id) VALUES('RollbackAlias',?)",
        [thought],
      );
      noteRefs.invalidateNoteReferences();
      await noteRefs.getNoteReferences();
      throw new Error("test alias rollback");
    });
  } catch (error) {
    if (error.message !== "test alias rollback") throw error;
  }
  check(
    "Rolling back an alias change invalidates the reference cache without a body-edit scan",
    !(await noteRefs.getNoteReferences()).byAlias.has("RollbackAlias"),
  );
  const syncedOriginal =
    '<div data-schema-version="9"><p><a href="zotero://select/library/items/SYNC0001" title="[[other-profile-id]]">Synced target</a></p></div>';
  const syncedHTML = await nativeNotes.markdownDocumentHTML(
    nativeNotes.getMarkdownDocument(syncedOriginal) + "\n\nEdited here",
    syncedOriginal,
  );
  check(
    "Markdown saves retain native targets from another profile without a local card mapping",
    syncedHTML.includes('href="zotero://select/library/items/SYNC0001"') &&
      syncedHTML.includes('title="[[other-profile-id]]"') &&
      syncedHTML.includes(">Synced target</a>"),
  );
  const changedURL = await nativeNotes.normalizeNoteLinks(
    renamedHTML.replaceAll(stableURL, "zotero://select/library/items/SYNC0001"),
  );
  check(
    "Changing a native link URL is not redirected back by stale wiki metadata",
    changedURL.includes('href="zotero://select/library/items/SYNC0001"') &&
      !changedURL.includes('title="[['),
  );
  const literatureBeforeID = await zettel.getZettel(literature);
  const changeLiteratureID = (customKey) =>
    zettel.saveZettel({
      id: literature,
      title: literatureBeforeID.title,
      body: literatureBeforeID.body,
      sourceNote: true,
      itemKey: literatureBeforeID.item_key,
      libraryID: literatureBeforeID.library_id,
      customKey,
    });
  await changeLiteratureID("ReadingNote2026");
  const changedIDHTML = await nativeNotes.normalizeNoteLinks(renamedHTML);
  check(
    "A Literature Note ID updates default link text and Markdown references while retaining native URLs and custom labels",
    changedIDHTML.includes(
      `href="${stableURL}" title="[[ReadingNote2026]]">ReadingNote2026</a>`,
    ) &&
      changedIDHTML.includes(
        'title="[[ReadingNote2026|My words]]">My words</a>',
      ) &&
      nativeNotes
        .getMarkdownDocument(changedIDHTML)
        .includes("[[ReadingNote2026]]") &&
      (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
        "ReadingNote2026",
  );
  await changeLiteratureID("ReadingRevised2026");
  const previousIDHTML = await nativeNotes.normalizeNoteLinks(changedIDHTML);
  check(
    "Repeated ID edits preserve historical links and update the same note without changing its content",
    previousIDHTML.includes(
      'title="[[ReadingRevised2026]]">ReadingRevised2026</a>',
    ) &&
      (
        await zettel.resolveRefs([
          "ReadingNote2026",
          "ReadingRevised2026",
          literature,
        ])
      ).size === 3 &&
      (await zettel.getZettel(literature)).body === literatureBeforeID.body,
  );
  await changeLiteratureID(null);
  zoteroStub.getMainWindow = priorWindow;
  linksDOM.window.close();
  await zettel.saveZettel({
    id: thought,
    title: "Survey edited",
    body: "[My own label](zotero://note/u/NOTE0001/)",
  });
  check(
    "Existing native note links connect across types without rewriting labels",
    (await zettel.getOutgoing(thought))[0]?.targetId === literature &&
      (await zettel.getZettel(thought)).body.includes("My own label"),
  );
  await zettel.saveZettel({
    id: thought,
    title: "Survey edited",
    body: "[Unmanaged item](zotero://select/items/UNMANAGE)",
  });
  check(
    "Unmanaged Zotero items are not offered as missing cards",
    !(await zettel.getUnresolvedRefs()).some((row) =>
      row.ref.includes("UNMANAGE"),
    ) &&
      !(await graph.getGraphData()).nodes.some((row) =>
        row.id.includes("UNMANAGE"),
      ),
  );
  const issueTarget = await zettel.saveZettel({
    title: "Deleted target",
    body: "",
  });
  const issueSource = await zettel.saveZettel({
    title: "Referring note",
    body: `[[${issueTarget}]] [[Never created]]`,
  });
  await db.exec(
    "INSERT INTO unavailable_notes(card_id,state) VALUES(?,'trashed')",
    [issueTarget],
  );
  const issueRefs = await zettel.getUnresolvedRefs();
  check(
    "Unavailable links distinguish native Trash targets from unresolved references",
    issueRefs.some(
      (r) =>
        r.ref === issueTarget &&
        r.state === "trashed" &&
        r.title === "Deleted target",
    ) &&
      issueRefs.some(
        (r) => r.ref === "Never created" && r.state === "unresolved",
      ),
  );
  check(
    "Link diagnostics identify the active referring note",
    (await zettel.getUnresolvedSources(issueTarget))[0].id === issueSource,
  );
  await db.exec(
    "INSERT INTO unavailable_notes(card_id,state) VALUES(?,'trashed')",
    [issueSource],
  );
  check(
    "Trashed referring notes do not create active link warnings",
    !(await zettel.getUnresolvedRefs()).some(
      (r) => r.ref === issueTarget || r.ref === "Never created",
    ) && !(await zettel.getUnresolvedSources(issueTarget)).length,
  );
  await db.exec("DELETE FROM unavailable_notes WHERE card_id IN (?,?)", [
    issueSource,
    issueTarget,
  ]);
  check(
    "Restoring the original target removes its warning and preserves the link identity",
    !(await zettel.getUnresolvedRefs()).some((r) => r.ref === issueTarget) &&
      (await zettel.getOutgoing(issueSource)).find((r) => r.ref === issueTarget)
        .targetId === issueTarget,
  );
  await zettel.deleteZettel(issueTarget);
  check(
    "Permanently missing targets retain a repairable reference rather than creating a replacement",
    (await zettel.getUnresolvedRefs()).some(
      (r) => r.ref === issueTarget && r.state === "unresolved",
    ) && !(await zettel.getZettel(issueTarget)),
  );
  await zettel.deleteZettel(issueSource);
  await db.exec("DELETE FROM card_notes WHERE card_id = ?", [literature]);
  for (const id of [literature, anotherLibrary, thought, firstCard, secondCard])
    await zettel.deleteZettel(id);
  const rootId = await zettel.saveZettel({ title: "Outline root", body: "" });
  const branchId = await zettel.saveZettel({
    title: "Outline branch",
    body: "",
    parentId: rootId,
  });
  const leafId = await zettel.saveZettel({
    title: "Outline leaf",
    body: `[[${rootId}]]`,
    parentId: branchId,
  });
  check(
    "Parent assignment derives children without changing reference counts",
    (await hierarchy.getFamily(branchId)).parent?.id === rootId &&
      (await hierarchy.getFamily(branchId)).children[0]?.id === leafId &&
      (await zettel.getZettel(branchId)).outgoing === 0 &&
      (await zettel.getZettel(rootId)).incoming === 1,
  );
  const outline = await hierarchy.getZettelOutline();
  check(
    "Zettel outline includes roots and exact parent identities without note bodies",
    JSON.stringify(outline.find((row) => row.id === branchId)) ===
      JSON.stringify({
        id: branchId,
        title: "Outline branch",
        parent: { id: rootId, title: "Outline root" },
      }) && outline.find((row) => row.id === rootId)?.parent === null,
  );
  await zettel.saveZettel({
    id: branchId,
    title: "Outline branch",
    body: "",
    customKey: "OutlineBranch",
  });
  const renamedOutline = await hierarchy.getZettelOutline();
  check(
    "An edited Zettel ID is searchable as a parent and exported consistently without changing hierarchy identity",
    (await hierarchy.getParentCandidates(leafId, "OutlineBranch"))[0]?.id ===
      branchId &&
      renamedOutline.some((row) => row.id === "OutlineBranch") &&
      renamedOutline.find((row) => row.id === leafId)?.parent?.id ===
        "OutlineBranch" &&
      (await hierarchy.getFamily(leafId)).parent?.id === branchId,
  );
  await zettel.saveZettel({
    id: branchId,
    title: "Outline branch",
    body: "",
    customKey: null,
  });
  await db.exec(
    "INSERT INTO unavailable_notes(card_id,state) VALUES(?,'trashed')",
    [branchId],
  );
  const trashOutline = await hierarchy.getZettelOutline();
  check(
    "Zettel outline excludes trashed notes but retains an unavailable parent's identity",
    !trashOutline.some((row) => row.id === branchId) &&
      trashOutline.find((row) => row.id === leafId)?.parent?.id === branchId &&
      trashOutline.find((row) => row.id === leafId)?.parent?.unavailable ===
        true,
  );
  await db.exec("DELETE FROM unavailable_notes WHERE card_id = ?", [branchId]);
  await db.exec("INSERT OR IGNORE INTO tags(zettel_id, tag) VALUES (?, ?)", [
    rootId,
    "Thinking Note",
  ]);
  const mixedOutline = await hierarchy.getZettelOutline();
  check(
    "Note outline includes notes regardless of tags and retains parent identities",
    mixedOutline.some((row) => row.id === rootId) &&
      mixedOutline.find((row) => row.id === branchId)?.parent?.id === rootId,
  );
  check(
    "The note list includes parents and children without an entry point filter",
    (await zettel.listZettels("Outline")).length === 3,
  );
  let cycleRejected = false;
  try {
    await zettel.saveZettel({
      id: rootId,
      title: "Should roll back",
      body: "",
      parentId: leafId,
    });
  } catch {
    cycleRejected = true;
  }
  check(
    "Cycles reject the entire card edit transaction",
    cycleRejected &&
      (await zettel.getZettel(rootId)).title === "Outline root" &&
      !(await hierarchy.getFamily(rootId)).parent,
  );
  let selfRejected = false;
  try {
    await zettel.saveZettel({
      id: leafId,
      title: "Outline leaf",
      body: "",
      parentId: leafId,
    });
  } catch {
    selfRejected = true;
  }
  check(
    "Self parent is rejected and descendants cannot be offered as parents",
    selfRejected &&
      !(await hierarchy.getParentCandidates(rootId)).some((card) =>
        [rootId, branchId, leafId].includes(card.id),
      ),
  );
  const tree = graph.filterGraph(await graph.getGraphData(), {
    relationMode: "hierarchy",
    centerId: branchId,
    depth: 1,
  });
  check(
    "Hierarchy graph is independent from bidirectional links",
    tree.edges.length === 2 &&
      tree.edges.every((edge) => edge.kind === "parent"),
  );
  await zettel.deleteZettel(branchId);
  check(
    "Deleting a parent moves its children one level up",
    (await hierarchy.getFamily(leafId)).parent?.id === rootId,
  );
  await zettel.saveZettel({
    id: leafId,
    title: "Outline leaf",
    body: "",
    parentId: null,
  });
  check(
    "Clearing parent makes a card an entry point",
    !(await hierarchy.getFamily(leafId)).parent &&
      (await zettel.listZettels("Outline")).length === 2,
  );
  await zettel.saveZettel({ title: "Pending", body: "[[Future concept]]" });
  const allGraph = await graph.getGraphData();
  check(
    "note graphs include direction, types and unresolved references without Source nodes",
    allGraph.edges.some(
      (edge) =>
        edge.source === markdownCard &&
        edge.target === laterId &&
        edge.kind === "link",
    ) &&
      allGraph.nodes.some(
        (node) =>
          node.kind === "card" &&
          node.itemKey === "ITEMKEY1" &&
          node.noteType === "entity",
      ) &&
      allGraph.nodes.some(
        (node) => node.kind === "unresolved" && node.title === "Future concept",
      ),
  );
  const taggedID = await zettel.saveZettel({
    title: "Tags",
    body: "#tag-a #中文 `#ignored`",
  });
  const taggedNode = (await graph.getGraphData()).nodes.find(
    (node) => node.id === taggedID,
  );
  check(
    "Hashtags remain body text and do not supply graph tags or colors",
    !taggedNode.tags.length &&
      taggedNode.color === undefined &&
      (await db.getAll("SELECT tag FROM tags WHERE zettel_id = ?", [taggedID]))
        .length === 0,
  );
  const previousTagItems = zoteroStub.Items;
  const previousTagColors = zoteroStub.Tags;
  let noteTags = ["中文 标签", "Machine learning"];
  zoteroStub.Items = {
    getByLibraryAndKeyAsync: async (_library, key) =>
      key === "TAGNOTE"
        ? {
            isNote: () => true,
            isInTrash: () => false,
            getTags: () => noteTags.map((tag) => ({ tag })),
          }
        : false,
    loadDataTypes: async () => {},
  };
  zoteroStub.Tags = {
    getColors: () => new Map([["Machine learning", { color: "#3478f6" }]]),
  };
  await db.exec(
    "INSERT INTO card_notes (card_id, note_key, library_id, original_body) VALUES (?, 'TAGNOTE', 1, '')",
    [taggedID],
  );
  const nativeTaggedNode = (await graph.getGraphData()).nodes.find(
    (node) => node.id === taggedID,
  );
  check(
    "Native multiword tags supply graph colors without text parsing",
    nativeTaggedNode.tags.join(",") === "中文 标签,Machine learning" &&
      /^#[0-9a-f]{6}$/.test(nativeTaggedNode.color),
  );
  const ownLookup = zoteroStub.Items.getByLibraryAndKeyAsync;
  zoteroStub.Items.getByLibraryAndKeyAsync = async (library, key) =>
    key === "PAPERTAG"
      ? {
          isRegularItem: () => true,
          isInTrash: () => false,
          getTags: () => [{ tag: "Paper topic" }],
        }
      : ownLookup(library, key);
  zoteroStub.Tags.getColors = () =>
    new Map([
      ["Machine learning", { color: "#3478f6", position: 0 }],
      ["Paper topic", { color: "#30a46c", position: 9 }],
    ]);
  await db.exec(
    "UPDATE zettels SET item_key='PAPERTAG', library_id=1 WHERE id=?",
    [taggedID],
  );
  const sourceColored = (await graph.getGraphData()).nodes.find(
    (node) => node.id === taggedID,
  );
  check(
    "Paper tags participate in internal graph coloring",
    /^#[0-9a-f]{6}$/.test(sourceColored.color) &&
      sourceColored.tags.includes("Paper topic"),
  );
  await db.exec("UPDATE zettels SET item_key=NULL WHERE id=?", [taggedID]);
  zoteroStub.Items.getByLibraryAndKeyAsync = ownLookup;
  await zettel.saveZettel({ id: taggedID, title: "Tags", body: "#tag-b" });
  noteTags = ["Renamed native tag"];
  const changedTags = (await graph.getGraphData()).nodes.find(
    (node) => node.id === taggedID,
  );
  check(
    "Native tag changes replace graph tags; hashtag edits do not create an index",
    changedTags.tags.join() === "Renamed native tag" &&
      (await db.getAll("SELECT tag FROM tags WHERE zettel_id = ?", [taggedID]))
        .length === 0,
  );
  noteTags = [];
  const untaggedNode = (await graph.getGraphData()).nodes.find(
    (node) => node.id === taggedID,
  );
  check(
    "Removing native tags clears graph color even when hashtags remain",
    !untaggedNode.tags.length && untaggedNode.color === undefined,
  );
  await db.exec("DELETE FROM card_notes WHERE card_id = ?", [taggedID]);
  zoteroStub.Items = previousTagItems;
  zoteroStub.Tags = previousTagColors;
  await zettel.deleteZettel(taggedID);
  const original = await zettel.getZettel(leafId);
  const draft = {
    id: leafId,
    title: "Recovered",
    body: "unsaved words",
    expectedUpdatedAt: original.updated_at,
    draftId: "recovery-test",
    draftRevision: 1,
  };
  await drafts.saveEditorDraft(draft);
  await db.closeDB();
  await db.initDB();
  check(
    "Recovery drafts survive database reopening",
    (await drafts.getEditorDraft(draft.draftId)).body === "unsaved words",
  );
  await zettel.saveZettel({
    id: leafId,
    title: "Elsewhere",
    body: "Do not overwrite",
  });
  let conflict = false;
  try {
    await zettel.saveEditorCard(draft);
  } catch (error) {
    conflict = error.message === "CARD_CONFLICT";
  }
  check(
    "A stale editor cannot overwrite a newer card",
    conflict && (await zettel.getZettel(leafId)).body === "Do not overwrite",
  );
  check(
    "Conflict retains the recovery draft",
    !!(await drafts.getEditorDraft(draft.draftId)),
  );
  const latest = await zettel.getZettel(leafId);
  await zettel.saveEditorCard({
    ...draft,
    expectedUpdatedAt: latest.updated_at,
  });
  check(
    "Card save removes only its committed draft atomically",
    !(await drafts.getEditorDraft(draft.draftId)) &&
      (await zettel.getZettel(leafId)).body === "unsaved words",
  );
  const newer = { ...draft, draftRevision: 3, body: "newer draft" };
  await drafts.saveEditorDraft(newer);
  await drafts.saveEditorDraft({ ...draft, draftRevision: 2 });
  check(
    "Late draft writes cannot replace a newer draft",
    (await drafts.getEditorDraft(draft.draftId)).body === "newer draft",
  );
  await drafts.discardEditorDraft(draft.draftId, 2);
  check(
    "Acknowledging an older native save retains a newer draft",
    (await drafts.getEditorDraft(draft.draftId)).body === "newer draft",
  );
  await drafts.discardEditorDraft(draft.draftId, 3);
  check(
    "Acknowledging the current draft revision removes it",
    !(await drafts.getEditorDraft(draft.draftId)),
  );
  await drafts.saveEditorDraft(newer);
  const nativeDocumentDraft = {
    ...draft,
    nativeDocument: true,
    draftId: "native-document:1:TESTNOTE",
    draftRevision: 1,
  };
  await drafts.saveEditorDraft(nativeDocumentDraft);
  await db.closeDB();
  await db.initDB();
  check(
    "Native Markdown drafts survive restart without appearing as card recovery drafts",
    (await drafts.getEditorDraft(nativeDocumentDraft.draftId)).nativeDocument &&
      !(await drafts.listEditorDrafts()).some(
        (row) => row.draftId === nativeDocumentDraft.draftId,
      ),
  );
  await drafts.discardEditorDraft(nativeDocumentDraft.draftId);
  await zettel.deleteZettel(leafId);
  conflict = false;
  try {
    await zettel.saveEditorCard({
      ...newer,
      expectedUpdatedAt: latest.updated_at,
    });
  } catch (error) {
    conflict = error.message === "CARD_CONFLICT";
  }
  check(
    "A stale editor cannot resurrect a deleted card",
    conflict && !(await zettel.getZettel(leafId)),
  );
  await db.transaction(async () => {
    for (let i = 0; i < 505; i++)
      await db.exec(
        "INSERT INTO zettels (id,title,body,created_at,updated_at) VALUES (?,?,'',0,0)",
        [`isolated-${i}`, `Isolated ${i}`],
      );
  });
  check(
    "full graph includes isolated cards beyond the list's 500-card limit",
    (await graph.getGraphData()).nodes.filter((node) =>
      node.id.startsWith("isolated-"),
    ).length === 505,
  );
  check(
    "Zettel outline copies all notes beyond the browser's page limit, including notes without parent rows",
    (await hierarchy.getZettelOutline()).filter((row) =>
      row.id.startsWith("isolated-"),
    ).length === 505,
  );
  const coldStarted = performance.now();
  const lookupTargets = await noteRefs.getNoteLinkTargets();
  const coldLookupMs = performance.now() - coldStarted;
  const warmRead = executedStatements.length;
  const warmStarted = performance.now();
  for (let i = 0; i < 10000; i++)
    (await noteRefs.getNoteLinkTargets()).get("isolated-" + (i % 505));
  const warmLookupMs = performance.now() - warmStarted;
  check(
    "Ten thousand reference lookups share one index without additional database reads",
    executedStatements.length === warmRead && lookupTargets.has("isolated-504"),
  );
  console.log(
    "   Reference lookup timing: " +
      JSON.stringify({
        targets: lookupTargets.size,
        coldMs: coldLookupMs,
        warm10000Ms: warmLookupMs,
      }),
  );
  await db.closeDB();
  await db.initDB();
  check(
    "reopening an existing database preserves cards and links",
    (await zettel.getOutgoing(forwardId))[0]?.targetId === laterId,
  );
  await zettel.listZettels("Isolated");
  await db.exec("DROP TABLE search_documents");
  await db.closeDB();
  await db.initDB();
  check(
    "Missing rebuildable search tables are restored and existing cards are reindexed",
    (await zettel.listZettels("Isolated")).length === 500,
  );
  await db.closeDB();
}

// Adopt only the installed schema; source roles and all original user data stay intact.
const conversionDir = path.join(workspace, "tag-to-types");
await mkdir(conversionDir);
const conversionFile = path.join(conversionDir, "knowledge-base.sqlite");
createCurrentDatabase(conversionFile);
const legacy = new DatabaseSync(conversionFile);
legacy.exec(`
  ALTER TABLE zettels DROP COLUMN note_type;
  UPDATE meta SET value='12' WHERE key='schemaVersion';
  UPDATE zettels SET source_note=1 WHERE id='20260101010101';
  UPDATE zettels SET custom_key='KeepAlias' WHERE id='20260101010102';
  UPDATE card_parents SET parent_id='20260101010101' WHERE card_id='20260101010102';
  INSERT INTO tags VALUES ('20260101010102','Existing tag'),('20260101010102','Thinking Note');
  CREATE TABLE card_notes (card_id TEXT PRIMARY KEY, note_key TEXT NOT NULL, library_id INTEGER NOT NULL, original_body TEXT NOT NULL, external INTEGER NOT NULL DEFAULT 0, UNIQUE(note_key, library_id));
  INSERT INTO card_notes VALUES ('20260101010101','OLDNOTE1',1,'body one',0);
  CREATE TABLE note_keys (key TEXT PRIMARY KEY, card_id TEXT NOT NULL);
  INSERT INTO note_keys VALUES ('OldAlias','20260101010102');
  CREATE TABLE editor_drafts (id TEXT PRIMARY KEY, body TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE note_save_operations (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
`);
const draftBefore = {
  draftId: "legacy-draft",
  draftRevision: 7,
  title: "未完成",
  body: "保留 **原文** [[OldAlias]]",
  initialTags: ["Thinking Note"],
  sourceDocument: "# 未完成\n\n保留 **原文** [[OldAlias]]",
};
legacy
  .prepare("INSERT INTO editor_drafts VALUES (?,?,?,?,?)")
  .run(
    draftBefore.draftId,
    draftBefore.body,
    JSON.stringify(draftBefore),
    7,
    123,
  );
const journalBefore = {
  id: "1:OLDNOTE1",
  noteKey: "OLDNOTE1",
  libraryID: 1,
  expectedHTML: "<p>Old</p>",
  intendedHTML: "<p>Intended</p>",
  expectedVersion: 1,
  input: {
    ...draftBefore,
    id: "reserved-note",
    sourceNote: true,
    initialTags: ["Literature Note"],
    itemKey: "SOURCEITEM",
    libraryID: 1,
  },
};
legacy
  .prepare("INSERT INTO note_save_operations VALUES (?,?,?,?)")
  .run(journalBefore.id, "reserved-note", JSON.stringify(journalBefore), 123);
const rowsBefore = legacy.prepare("SELECT * FROM zettels ORDER BY id").all();
legacy.close();
const priorConversionItems = zoteroStub.Items;
let nativeTagWrites = 0;
zoteroStub.Items = {
  ...priorConversionItems,
  getByLibraryAndKeyAsync: async () => ({
    isNote: () => true,
    getTags: () => [{ tag: "Literature Note" }, { tag: "Dataset" }],
    addTag: () => nativeTagWrites++,
    saveTx: async () => nativeTagWrites++,
  }),
};
zoteroStub.DataDirectory.dir = conversionDir;
failStatement = (sql) => sql.startsWith("UPDATE zettels SET note_type");
let conversionFailed = false;
try {
  await db.initDB();
} catch {
  conversionFailed = true;
}
failStatement = undefined;
await db.closeDB();
const rolledBack = new DatabaseSync(conversionFile);
check(
  "Failed type adoption rolls back schema and leaves tags and original rows intact",
  conversionFailed &&
    rolledBack.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()
      .value === "12" &&
    !rolledBack
      .prepare("PRAGMA table_info(zettels)")
      .all()
      .some((row) => row.name === "note_type") &&
    rolledBack.prepare("SELECT COUNT(*) AS n FROM tags").get().n === 2,
);
rolledBack.close();
await db.initDB();
const convertedSchema = await readSchema(conversionFile);
const converted = await db.getAll("SELECT * FROM zettels ORDER BY id");
check(
  "Type adoption preserves every original note field and source role",
  convertedSchema.version === "14" &&
    converted.every((row, i) =>
      Object.keys(rowsBefore[i]).every(
        (key) => row[key] === rowsBefore[i][key],
      ),
    ) &&
    converted[0].note_type === "literature" &&
    converted[1].note_type === "thinking" &&
    converted[2].note_type === "entity",
);
check(
  "Type adoption reads own tags without writing native notes or adding classification tags",
  nativeTagWrites === 0 && (await db.getAll("SELECT * FROM tags")).length === 2,
);
check(
  "Type adoption retains links, parents, mappings and old aliases",
  (await zettel.getOutgoing("20260101010102"))[0].targetId ===
    "20260101010101" &&
    (await hierarchy.getFamily("20260101010102")).parent.id ===
      "20260101010101" &&
    (await db.getOne("SELECT card_id FROM note_keys WHERE key='OldAlias'"))
      .card_id === "20260101010102" &&
    (
      await db.getOne(
        "SELECT note_key FROM card_notes WHERE card_id='20260101010101'",
      )
    ).note_key === "OLDNOTE1",
);
const convertedDraft = await drafts.getEditorDraft("legacy-draft");
const convertedJournal = (await operations.listNoteOperations())[0];
check(
  "Unsaved drafts and interrupted saves retain their complete content and receive a type",
  convertedDraft.body === draftBefore.body &&
    convertedDraft.sourceDocument === draftBefore.sourceDocument &&
    convertedDraft.draftRevision === 7 &&
    convertedDraft.noteType === "thinking" &&
    convertedJournal.expectedHTML === journalBefore.expectedHTML &&
    convertedJournal.intendedHTML === journalBefore.intendedHTML &&
    convertedJournal.input.sourceNote &&
    convertedJournal.input.noteType === "literature",
);
zoteroStub.Items = priorConversionItems;
const unclassified = await zettel.saveZettel({
  title: "Unclassified",
  body: "No default class",
});
check(
  "New notes default to Entity and acquire no default tags",
  (await zettel.getZettel(unclassified)).note_type === "entity" &&
    !(await noteTags.getOwnNoteTags(null, unclassified)).length,
);
const entityID = await zettel.saveZettel({
  noteType: "entity",
  title: "LEVIR dataset",
  body: "Dataset record [[OldAlias]]",
  parentId: "20260101010102",
  customKey: "LEVIR",
});
check(
  "Entity is stored as metadata without a classification tag",
  (await zettel.getZettel(entityID)).note_type === "entity" &&
    !(await noteTags.getOwnNoteTags(null, entityID)).length,
);
const typeBefore = await zettel.getZettel(entityID);
await zettel.saveZettel({
  id: entityID,
  noteType: "zettel",
  title: typeBefore.title,
  body: typeBefore.body,
  customKey: typeBefore.custom_key,
  expectedUpdatedAt: typeBefore.updated_at,
});
check(
  "Changing a type preserves content, references, links and hierarchy",
  (await zettel.getZettel(entityID)).note_type === "zettel" &&
    (await zettel.getZettel(entityID)).body === typeBefore.body &&
    (await zettel.getZettel(entityID)).reference === typeBefore.reference &&
    (await hierarchy.getFamily(entityID)).parent.id === "20260101010102" &&
    (await zettel.getOutgoing(entityID))[0].targetId === "20260101010102",
);
const staleType = await zettel.getZettel(entityID);
await zettel.saveZettel({
  id: entityID,
  noteType: "entity",
  title: staleType.title,
  body: staleType.body,
});
let conflictRejected = false;
try {
  await zettel.saveZettel({
    id: entityID,
    noteType: "thinking",
    title: "Stale",
    body: "Overwrite",
    expectedUpdatedAt: staleType.updated_at,
  });
} catch {
  conflictRejected = true;
}
check(
  "Returning to Entity and optimistic conflicts preserve the current note",
  (await zettel.getZettel(entityID)).note_type === "entity" &&
    conflictRejected &&
    (await zettel.getZettel(entityID)).body === typeBefore.body,
);
const readingBefore = await zettel.getZettel("20260101010101");
await zettel.saveZettel({
  id: readingBefore.id,
  noteType: "entity",
  title: readingBefore.title,
  body: readingBefore.body,
  itemKey: readingBefore.item_key,
  libraryID: readingBefore.library_id,
});
check(
  "Classification is independent from a paper's unique source-note role",
  (await zettel.getZettel(readingBefore.id)).note_type === "entity" &&
    (await zettel.getZettel(readingBefore.id)).source_note === 1 &&
    (await zettel.countByItem(readingBefore.item_key)) === 2,
);
let badType = false;
try {
  await zettel.saveZettel({
    id: entityID,
    noteType: "unknown",
    title: "Lost",
    body: "Lost",
  });
} catch {
  badType = true;
}
check(
  "Unsupported note types are rejected without changing content",
  badType && (await zettel.getZettel(entityID)).body === typeBefore.body,
);
const typePage = await zettel.searchZettels("", { noteType: "entity" });
check(
  "Type filters use metadata rather than existing topic or legacy classification tags",
  JSON.stringify(typePage.items.map((note) => note.id).sort()) ===
    JSON.stringify(
      ["20260101010103", unclassified, entityID, readingBefore.id].sort(),
    ) &&
    typePage.items.every((note) => note.note_type === "entity") &&
    !(await zettel.searchZettels("", { noteType: "literature" })).items.length,
);
await db.closeDB();
await db.initDB();
check(
  "Chosen types persist after reopening without resurrecting old classifications",
  (await zettel.getZettel(entityID)).note_type === "entity" &&
    (await zettel.getZettel(readingBefore.id)).note_type === "entity" &&
    (await zettel.getZettel("20260101010102")).note_type === "thinking",
);
await db.closeDB();

// Replace the previous default without touching original note content or identities.
const ordinaryDir = path.join(workspace, "note-to-entity");
await mkdir(ordinaryDir);
const ordinaryFile = path.join(ordinaryDir, "knowledge-base.sqlite");
createCurrentDatabase(ordinaryFile);
zoteroStub.DataDirectory.dir = ordinaryDir;
await db.initDB();
await db.closeDB();
const ordinary = new DatabaseSync(ordinaryFile);
ordinary.exec(`
  DROP INDEX IF EXISTS idx_zettels_type_updated;
  DROP INDEX IF EXISTS idx_zettels_type_title;
  ALTER TABLE zettels DROP COLUMN note_type;
  ALTER TABLE zettels ADD COLUMN note_type TEXT NOT NULL DEFAULT 'note' CHECK(note_type IN ('note','literature','zettel','thinking','entity'));
  UPDATE zettels SET note_type='thinking' WHERE id='20260101010102';
  UPDATE meta SET value='13' WHERE key='schemaVersion';
`);
const ordinaryRows = ordinary
  .prepare("SELECT * FROM zettels ORDER BY id")
  .all();
const ordinaryDraft = { ...draftBefore, noteType: "note" };
const ordinaryJournal = {
  ...journalBefore,
  input: { ...journalBefore.input, noteType: "note" },
};
ordinary
  .prepare("INSERT INTO editor_drafts VALUES (?,?,?,?,?)")
  .run(
    ordinaryDraft.draftId,
    ordinaryDraft.body,
    JSON.stringify(ordinaryDraft),
    7,
    123,
  );
ordinary
  .prepare("INSERT INTO note_save_operations VALUES (?,?,?,?)")
  .run(
    ordinaryJournal.id,
    "reserved-note",
    JSON.stringify(ordinaryJournal),
    123,
  );
ordinary.close();
failStatement = (sql) => sql.startsWith("UPDATE zettels SET note_type");
let ordinaryFailed = false;
try {
  await db.initDB();
} catch {
  ordinaryFailed = true;
}
failStatement = undefined;
await db.closeDB();
const ordinaryRollback = new DatabaseSync(ordinaryFile);
check(
  "Failed default-type replacement restores the entire previous schema and pending drafts",
  ordinaryFailed &&
    ordinaryRollback
      .prepare("SELECT value FROM meta WHERE key='schemaVersion'")
      .get().value === "13" &&
    ordinaryRollback.prepare("SELECT note_type FROM zettels ORDER BY id").get()
      .note_type === "note" &&
    JSON.parse(
      ordinaryRollback.prepare("SELECT data FROM editor_drafts").get().data,
    ).noteType === "note",
);
ordinaryRollback.close();
await db.initDB();
const entityRows = await db.getAll("SELECT * FROM zettels ORDER BY id");
check(
  "Existing Note metadata becomes Entity while every other field and classification is retained",
  (await readSchema(ordinaryFile)).version === "14" &&
    entityRows.map((row) => row.note_type).join() ===
      "entity,thinking,entity" &&
    entityRows.every((row, i) =>
      Object.keys(ordinaryRows[i]).every(
        (key) => key === "note_type" || row[key] === ordinaryRows[i][key],
      ),
    ) &&
    (await zettel.getOutgoing("20260101010102"))[0].targetId ===
      "20260101010101",
);
check(
  "Pending Note drafts and interrupted saves become Entity without changing their contents or revisions",
  (await drafts.getEditorDraft(ordinaryDraft.draftId)).noteType === "entity" &&
    (await drafts.getEditorDraft(ordinaryDraft.draftId)).sourceDocument ===
      ordinaryDraft.sourceDocument &&
    (await drafts.getEditorDraft(ordinaryDraft.draftId)).draftRevision === 7 &&
    (await operations.listNoteOperations())[0].input.noteType === "entity" &&
    (await operations.listNoteOperations())[0].intendedHTML ===
      ordinaryJournal.intendedHTML,
);
let removedTypeRejected = false;
try {
  await db.exec(
    "UPDATE zettels SET note_type='note' WHERE id='20260101010101'",
  );
} catch {
  removedTypeRejected = true;
}
check("The current schema rejects the removed Note type", removedTypeRejected);
const originalTagPrefs = zoteroStub.Prefs;
let exclusions = "Status, GraphNeuralNetworks，#Co-Attention";
const exclusionObservers = new Map();
zoteroStub.Prefs = {
  get: (key) =>
    key === "extensions.zotero.similar-works.excludedTags"
      ? exclusions
      : undefined,
  registerObserver: (key, callback) => {
    exclusionObservers.set(key, callback);
    return key;
  },
  unregisterObserver: (key) => exclusionObservers.delete(key),
};
const visibleCard = await zettel.saveZettel({
  title: "Visible labels",
  body: "Keep all original tags.",
  initialTags: ["Status", "#Graph Neural Networks", "co_attention", "PyTorch"],
});
check(
  "One comma-separated exclusion policy hides note tags and name variants without deleting originals",
  JSON.stringify(await noteTags.getEffectiveNoteTags(null, visibleCard)) ===
    '["PyTorch"]' &&
    (await noteTags.getOwnNoteTags(null, visibleCard)).length === 4 &&
    (await graph.getGraphData()).nodes
      .find((node) => node.id === visibleCard)
      .tags.join() === "PyTorch",
);
await noteTags.getGraphTags();
const beforeVisibleRefresh = executedStatements.length;
exclusions = "";
check(
  "Unexcluding a tag restores display vocabulary from the existing tag index without new database reads",
  (await noteTags.getGraphTags()).includes("Status") &&
    executedStatements.length === beforeVisibleRefresh,
);
let visibilityChange;
const stopVisibility = events.onDataChange((change) => {
  visibilityChange = change;
});
const rawTagRevision = events.getTagRevision(),
  rawSourceRevision = events.getSourceRevision();
noteTags.initTagExclusions();
noteTags.initTagExclusions();
exclusionObservers.get("extensions.zotero.similar-works.excludedTags")();
await Promise.resolve();
check(
  "Exclusion changes refresh visibility without invalidating source or stored tag data",
  exclusionObservers.size === 1 &&
    visibilityChange.fields.join() === "tag-visibility" &&
    events.getTagRevision() === rawTagRevision &&
    events.getSourceRevision() === rawSourceRevision,
);
noteTags.stopTagExclusions();
noteTags.stopTagExclusions();
stopVisibility();
check(
  "Tag exclusion observers are released without duplicate registrations",
  exclusionObservers.size === 0,
);
zoteroStub.Prefs = originalTagPrefs;
await db.closeDB();

// Discovery links originals in place, including read-only notes and duplicate titles.
const discoveryDir = path.join(workspace, "native-discovery");
await mkdir(discoveryDir);
const discoveryHost = { ...zoteroStub };
const discoveryDOM = new JSDOM("<!doctype html><body></body>");
zoteroStub.DataDirectory = { dir: discoveryDir };
zoteroStub.getMainWindow = () => discoveryDOM.window;
zoteroStub.Prefs = { get: () => undefined };
zoteroStub.Promise = { delay: async () => {} };
zoteroStub.ItemTypes = { getID: () => 1 };
zoteroStub.Libraries = {
  userLibraryID: 1,
  getAll: () => [{ libraryID: 1, libraryType: "user" }],
};
let discoveryWrites = 0;
const discoveryItems = new Map();
const discoveryParent = {
  id: 9001,
  key: "PARENT01",
  libraryID: 1,
  isNote: () => false,
  isRegularItem: () => true,
  isInTrash: () => false,
  getField: () => "",
  getCreators: () => [],
};
discoveryItems.set(9001, discoveryParent);
for (const id of [9101, 9102, 9103])
  discoveryItems.set(id, {
    id,
    key: `NOTE${id}`,
    libraryID: 1,
    parentItemID: id === 9101 ? 9001 : false,
    isNote: () => true,
    isRegularItem: () => false,
    isInTrash: () => false,
    isEditable: () => false,
    getField: (field) =>
      field === "dateAdded" ? "2020-01-01 00:00:00" : "2021-01-01 00:00:00",
    getNote: () =>
      "<div data-schema-version='9'><h1>Identical title</h1><p>Identical original <strong>HTML</strong>.</p>" +
      (id === 9101
        ? '<p><a href="zotero://note/u/NOTE9102">Next</a></p>'
        : "") +
      "</div>",
    setNote: () => discoveryWrites++,
    saveTx: async () => discoveryWrites++,
  });
zoteroStub.Items = {
  getAsync: async (id) => discoveryItems.get(id),
  getIDFromLibraryAndKey: (libraryID, key) =>
    [...discoveryItems.values()].find(
      (item) => item.libraryID === libraryID && item.key === key,
    )?.id || false,
  getByLibraryAndKeyAsync: async (libraryID, key) =>
    [...discoveryItems.values()].find(
      (item) => item.key === key && item.libraryID === libraryID,
    ),
  loadDataTypes: async () => {},
};
zoteroStub.DB = {
  queryAsync: async (_sql, params) =>
    [...discoveryItems.values()]
      .filter((item) => item.isNote() && item.id > params[1])
      .map((item) => ({
        itemID: item.id,
        key: item.key,
        libraryID: item.libraryID,
      })),
};
await db.initDB();
const adopted = await Promise.all([
  nativeNotes.ensureManagedNote(9101),
  nativeNotes.ensureManagedNote(9101),
]);
check(
  "Concurrent discovery creates exactly one mapping per original note",
  adopted[0] === adopted[1] &&
    (await db.getAll("SELECT * FROM card_notes")).length === 1,
);
await nativeNotes.discoverNativeNotes();
const discovered = await zettel.listZettels();
check(
  "Automatic discovery includes every original with identical content without copying or merging them",
  discovered.length === 3 &&
    new Set(discovered.map((note) => note.id)).size === 3 &&
    (await db.getAll("SELECT * FROM card_notes WHERE external=1")).length === 3,
);
check(
  "Discovery defaults to Note and preserves read-only native HTML and placement without writes",
  discoveryWrites === 0 &&
    discovered.every((note) => note.note_type === "entity") &&
    discoveryItems.get(9101).parentItemID === 9001 &&
    (await zettel.getZettel(adopted[0])).item_key === "PARENT01" &&
    (await db.getAll("SELECT * FROM tags")).length === 0,
);
await nativeNotes.discoverNativeNotes();
check(
  "Repeated discovery reuses mappings without creating more notes",
  (await zettel.listZettels()).length === 3 && discoveryWrites === 0,
);
check(
  "Discovery retains original dates and resolves forward native-note links after the target appears",
  discovered.every(
    (note) =>
      note.created_at === Date.UTC(2020, 0, 1) &&
      note.updated_at === Date.UTC(2021, 0, 1),
  ) &&
    (await zettel.getOutgoing(adopted[0]))[0]?.targetId ===
      (await nativeNotes.ensureManagedNote(9102)),
);
discoveryItems.set(9104, {
  ...discoveryItems.get(9103),
  id: 9104,
  key: "NOTE9104",
});
await drafts.saveEditorDraft({
  draftId: "uncommitted-native",
  draftRevision: 1,
  title: "Draft",
  body: "Keep unsaved content",
  noteID: 9104,
});
await nativeNotes.discoverNativeNotes();
check(
  "Discovery leaves a retained unsaved editor draft in control of its original native note",
  (await nativeNotes.ensureManagedNote(9104)) === null &&
    (await zettel.listZettels()).length === 3 &&
    (await drafts.getEditorDraft("uncommitted-native")).body ===
      "Keep unsaved content",
);
await drafts.discardEditorDraft("uncommitted-native");
await nativeNotes.discoverNativeNotes();
check(
  "A released draft's native note can subsequently be discovered once",
  !!(await nativeNotes.ensureManagedNote(9104)) &&
    (await zettel.listZettels()).length === 4 &&
    discoveryWrites === 0,
);
await db.closeDB();
Object.assign(zoteroStub, discoveryHost);
discoveryDOM.window.close();

// Trash operations target managed originals and recheck their state at write time.
const trashDir = path.join(workspace, "trash");
await mkdir(trashDir);
zoteroStub.DataDirectory.dir = trashDir;
await db.initDB();
const trashOriginalItems = zoteroStub.Items;
const trashOriginalLibraries = zoteroStub.Libraries;
const trashOriginalDB = zoteroStub.DB;
const trashOriginalPromise = zoteroStub.Promise;
const trashItems = new Map();
const erasedTrashIDs = [];
let eraseFailure = false;
let trashNativeTransaction = false;
for (const [index, id] of [
  "trash-a",
  "trash-b",
  "trash-readonly",
  "trash-active",
].entries()) {
  await zettel.saveZettel({ id, title: id, body: "Original body" });
  const note = {
    id: 7000 + index,
    key: `TRASH00${index}`,
    libraryID: id === "trash-readonly" ? 2 : 1,
    deleted: id !== "trash-active",
    isNote: () => true,
    isInTrash() {
      return this.deleted;
    },
    async erase() {
      if (!trashNativeTransaction)
        throw new Error("Erase requires a transaction");
      if (eraseFailure) throw new Error("Injected native erase failure");
      trashItems.delete(this.key);
      erasedTrashIDs.push(this.id);
    },
  };
  trashItems.set(note.key, note);
  await db.exec(
    "INSERT INTO card_notes(card_id,note_key,library_id,original_body) VALUES(?,?,?,'Original body')",
    [id, note.key, note.libraryID],
  );
  if (note.deleted)
    await db.exec(
      "INSERT INTO unavailable_notes(card_id,state) VALUES(?,'trashed')",
      [id],
    );
}
await zettel.saveZettel({
  id: "trash-referrer",
  title: "Keep me",
  body: "[[trash-a]]",
});
await zettel.saveZettel({
  id: "trash-unmapped",
  title: "No original",
  body: "Keep me",
});
await db.exec(
  "INSERT INTO editor_drafts(id,body,data,revision,updated_at) VALUES('owned','Draft',?,1,1),('unrelated','Keep','{}',1,1)",
  [JSON.stringify({ id: "trash-a", noteID: 7000 })],
);
await db.exec(
  "INSERT INTO note_save_operations(id,card_id,data,created_at) VALUES('owned-op','trash-a','{}',1)",
);
zoteroStub.Libraries = { get: (id) => ({ editable: id === 1 }) };
zoteroStub.Promise = { delay: async () => {} };
zoteroStub.DB = {
  executeTransaction: async (callback) => {
    if (trashNativeTransaction) throw new Error("Nested native transaction");
    trashNativeTransaction = true;
    try {
      return await callback();
    } finally {
      trashNativeTransaction = false;
    }
  },
};
zoteroStub.Items = {
  ...trashOriginalItems,
  getByLibraryAndKeyAsync: async (_library, key) =>
    trashItems.get(key) || false,
  erase: async () => {
    throw new Error("Use note.erase inside the native transaction");
  },
};
check(
  "Knowledge Base Trash lists only managed trashed originals with per-library editability",
  JSON.stringify(
    (await nativeNotes.getTrashNotes()).map(({ id, editable }) => [
      id,
      editable,
    ]),
  ) ===
    JSON.stringify([
      ["trash-a", true],
      ["trash-b", true],
      ["trash-readonly", false],
    ]),
);
const ignoredTrash = await nativeNotes.permanentlyDeleteNotes([
  "trash-active",
  "trash-readonly",
  "trash-unmapped",
  "unknown",
]);
check(
  "Permanent deletion skips active, read-only, unmapped and unknown notes",
  ignoredTrash.deleted === 0 &&
    ignoredTrash.skipped === 4 &&
    erasedTrashIDs.length === 0 &&
    !!(await zettel.getZettel("trash-active")),
);
trashItems.get("TRASH001").deleted = false;
const restoredRace = await nativeNotes.permanentlyDeleteNotes(["trash-b"]);
check(
  "Restoration after confirmation prevents permanent deletion",
  restoredRace.skipped === 1 &&
    erasedTrashIDs.length === 0 &&
    !!(await zettel.getZettel("trash-b")),
);
trashItems.get("TRASH001").deleted = true;
let cancelTrash = false;
const cancelledTrash = await nativeNotes.permanentlyDeleteNotes(
  ["trash-a", "trash-a", "trash-b"],
  () => cancelTrash,
  () => {
    cancelTrash = true;
  },
);
check(
  "A cancelled batch deduplicates IDs and stops before the next original",
  cancelledTrash.deleted === 1 &&
    cancelledTrash.cancelled &&
    erasedTrashIDs.join() === "7000" &&
    !!(await zettel.getZettel("trash-b")),
);
check(
  "Permanent deletion removes its projection, mapping, recovery draft and pending save only",
  !(await zettel.getZettel("trash-a")) &&
    !(await db.getOne("SELECT * FROM card_notes WHERE card_id='trash-a'")) &&
    !(await db.getOne("SELECT * FROM editor_drafts WHERE id='owned'")) &&
    !(await db.getOne(
      "SELECT * FROM note_save_operations WHERE id='owned-op'",
    )) &&
    !!(await db.getOne("SELECT * FROM editor_drafts WHERE id='unrelated'")) &&
    !!(await zettel.getZettel("trash-unmapped")),
);
check(
  "Referring notes survive permanent deletion with an unresolved reference",
  !!(await zettel.getZettel("trash-referrer")) &&
    (await zettel.getOutgoing("trash-referrer"))[0]?.targetId === null,
);
eraseFailure = true;
let nativeEraseRejected = false;
try {
  await nativeNotes.permanentlyDeleteNotes(["trash-b"]);
} catch {
  nativeEraseRejected = true;
}
check(
  "A failed native erase leaves the original and Knowledge Base projection available for retry",
  nativeEraseRejected &&
    trashItems.has("TRASH001") &&
    !!(await zettel.getZettel("trash-b")),
);
eraseFailure = false;
const retriedTrash = await nativeNotes.permanentlyDeleteNotes(["trash-b"]);
check(
  "The operation queue recovers after native erase failure",
  retriedTrash.deleted === 1 && !(await zettel.getZettel("trash-b")),
);
let invalidTrashRejected = false;
try {
  await nativeNotes.permanentlyDeleteNotes([null]);
} catch {
  invalidTrashRejected = true;
}
check(
  "Invalid destructive-operation inputs are rejected before writes",
  invalidTrashRejected && erasedTrashIDs.length === 2,
);
zoteroStub.Items = trashOriginalItems;
zoteroStub.Libraries = trashOriginalLibraries;
zoteroStub.DB = trashOriginalDB;
zoteroStub.Promise = trashOriginalPromise;
await db.closeDB();

// An unsupported schema is rejected without rewriting its data.
const invalidDir = path.join(workspace, "unsupported-schema");
await mkdir(invalidDir);
const invalidFile = path.join(invalidDir, "knowledge-base.sqlite");
const invalid = new DatabaseSync(invalidFile);
invalid.exec(
  "CREATE TABLE zettels (id TEXT PRIMARY KEY, title TEXT); INSERT INTO zettels VALUES ('keep', 'Untouched')",
);
invalid.close();
zoteroStub.DataDirectory.dir = invalidDir;
let schemaRejected = false;
try {
  await db.initDB();
} catch {
  schemaRejected = true;
}
await db.closeDB();
const preserved = new DatabaseSync(invalidFile);
check(
  "unsupported schema is rejected without rewriting rows",
  schemaRejected &&
    preserved.prepare("SELECT title FROM zettels WHERE id='keep'").get()
      .title === "Untouched",
);
check(
  "failed initialization rolls back schema changes",
  preserved
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='meta'")
    .get().n === 0,
);
preserved.close();

// Optional consistent snapshot: always reopen a disposable copy, never the
// user's database. Compare every original field to detect data loss.
if (process.argv[2]) {
  const snapshot = new DatabaseSync(process.argv[2], { readOnly: true });
  const original = snapshot.prepare("SELECT * FROM zettels ORDER BY id").all();
  snapshot.close();
  const schema = await initialize(
    "provided database snapshot (disposable copy)",
    path.join(workspace, "snapshot"),
    (file) => copyFile(process.argv[2], file),
  );
  if (schema) {
    const reopened = await db.getAll("SELECT * FROM zettels ORDER BY id");
    check(
      "snapshot reopening preserves every original card field",
      reopened.length === original.length &&
        original.every((row, i) =>
          Object.keys(row).every((key) => row[key] === reopened[i][key]),
        ),
    );
  }
  await db.closeDB();
}

await rm(workspace, { recursive: true, force: true });

console.log(
  `\n${failures.length ? "FAILED" : "OK"} - ${checks - failures.length}/${checks} checks passed` +
    (failures.length ? `\n  failed: ${failures.join(" | ")}` : ""),
);
process.exitCode = failures.length ? 1 : 0;
