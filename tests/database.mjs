#!/usr/bin/env node
/**
 * Execute the actual data modules against temporary SQLite databases.
 * The mozStorage stub exposes columns only through getResultByName(), so
 * treating database rows as plain JavaScript objects fails these tests.
 * Covers current-schema creation/reopening, CRUD, links, backlinks and graphs.
 * An optional snapshot argument is copied; the supplied file is never changed.
 */
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
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
    if (failStatement?.(sql)) throw new Error("Injected KB commit failure");
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

const zoteroStub = {
  DataDirectory: { dir: "" },
  Items: {
    getByLibraryAndKeyAsync: async () => false,
    loadDataTypes: async () => {},
  },
  Tags: { getColors: () => new Map() },
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
    "INSERT INTO meta (key, value) VALUES ('schemaVersion', '3')",
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
  // The link index the app writes on save. Opening does not rebuild it, so
  // the fixture must carry it for the backlink assertions to be meaningful.
  db.prepare(
    "INSERT INTO links (source_id, target_id, ref) VALUES ('20260101010102', '20260101010101', 'existing one')",
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
    // Absolute paths so esbuild does not need the entry to sit in the project.
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
  "kind",
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
    "schemaVersion is 11",
    schema.version === "11",
    `got ${schema.version}`,
  );
  const missing = REQUIRED.filter((c) => !schema.columns.includes(c));
  check(
    "all required columns present",
    missing.length === 0,
    missing.join(", "),
  );
  check(
    "all 11 indexes present",
    schema.indexes.length === 11,
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
  for (const id of searchFixtures)
    await db.exec("UPDATE zettels SET updated_at = 42 WHERE id = ?", [id]);
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
  zoteroStub.Items = {
    ...originalItems,
    getByLibraryAndKeyAsync: async (_library, key) =>
      key === auditNote.key ? auditNote : false,
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
    !(
      await zettel.searchZettels("", {
        availability: "active",
        cardIDs: searchFixtures.slice(1, 3),
      })
    ).items.length &&
      (
        await zettel.searchZettels("", {
          availability: "deleted",
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
    "Existing content is indexed during schema migration",
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
      (row) => row.id === longNoteID && row.body.length === 2048,
    ) && (await zettel.getZettel(longNoteID)).body.length > 20000,
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
    interrupted = String(error).includes("Injected KB commit failure");
  }
  failStatement = undefined;
  check(
    "A failure after the native commit rolls back KB metadata while retaining its intent and draft",
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
    "Recovery never overwrites newer KB metadata",
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

  const migrated = await db.getOne(
    "SELECT title_folded FROM zettels WHERE id = ?",
    ["20260101010101"],
  );
  const migratedLink = await db.getOne(
    "SELECT ref_folded FROM links WHERE source_id = ?",
    ["20260101010102"],
  );
  check(
    "Schema migration backfills title and link lookup keys without changing existing content",
    migrated.title_folded === "existing one" &&
      migratedLink.ref_folded === "existing one",
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
    kind: "thinking",
    title: "Project",
    body: "Ideas",
    customKey: "ProjectPlan",
  });
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
    kind: "thinking",
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
        kind: "thinking",
        title: "Invalid",
        body: "",
        customKey: key,
      });
    } catch (error) {
      rejected = /NOTE_KEY_/.test(String(error));
    }
    check("Invalid or occupied Thinking key is rejected: " + key, rejected);
  }
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
    kind: "literature",
    title: "Reading",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  let duplicateRejected = false;
  try {
    await zettel.saveZettel({
      kind: "literature",
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
      kind: "literature",
      title: "No source",
      body: "",
    });
  } catch (error) {
    noSourceRejected = error.message === "LITERATURE_SOURCE_REQUIRED";
  }
  check("Literature Notes require a source", noSourceRejected);
  const anotherLibrary = await zettel.saveZettel({
    kind: "literature",
    title: "Group reading",
    body: "",
    itemKey: "READING1",
    libraryID: 2,
  });
  const thought = await zettel.saveZettel({
    kind: "thinking",
    title: "Survey",
    body: "[[Reading]]",
  });
  const firstCard = await zettel.saveZettel({
    kind: "zettel",
    title: "First claim",
    body: "",
    itemKey: "READING1",
    libraryID: 1,
  });
  const secondCard = await zettel.saveZettel({
    kind: "zettel",
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
    (await zettel.getZettel(thought)).kind === "thinking" &&
      (await zettel.getOutgoing(thought))[0].targetId === literature,
  );
  check(
    "Type filters search their own notes",
    (await zettel.listZettels("Survey", false, "thinking")).some(
      (row) => row.id === thought,
    ) && !(await zettel.listZettels("Survey", false, "literature")).length,
  );
  await zettel.saveZettel({ id: thought, title: "Survey edited", body: "" });
  check(
    "Editing through older callers retains note type",
    (await zettel.getZettel(thought)).kind === "thinking",
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
        field === "extra" ? `Citation Key: ${keys.get(id) || ""}` : "",
    }),
    loadDataTypes: async () => {},
  };
  check(
    "Literature references use source keys while Zettels keep their unique IDs",
    (
      await noteRefs.withNoteReferences([
        { id: literature },
        { id: firstCard },
        { id: secondCard },
      ])
    )
      .map((row) => row.reference)
      .join("|") === `@Study2026|${firstCard}|${secondCard}`,
  );
  check(
    "Citation-key wiki links resolve independently of note titles",
    (await zettel.resolveRefs(["@Study2026", "@Group2026"])).get(
      "@Study2026",
    ) === literature,
  );
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
  check(
    "Changing a citation key preserves the internal ID and indexed links",
    (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
      "@Renamed2026" &&
      (await zettel.resolveRefs(["@Study2026"])).get("@Study2026") ===
        literature &&
      (await zettel.getOutgoing(thought))[0].targetId === literature,
  );
  keys.set(2, "Renamed2026");
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
  check(
    "Missing and unsafe citation keys keep a usable internal reference",
    (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
      literature &&
      (await zettel.resolveRefs([literature])).get(literature) === literature,
  );
  keys.set(1, "Renamed2026");
  sourceDeleted = true;
  check(
    "Trashed sources fall back without changing or deleting managed notes",
    (await noteRefs.withNoteReferences([{ id: literature }]))[0].reference ===
      literature && (await zettel.getZettel(literature)).kind === "literature",
  );
  zoteroStub.Items = priorItems;
  zoteroStub.ItemFields = priorFields;
  zoteroStub.Libraries = { userLibraryID: 1, getAll: () => [] };
  await db.exec(
    "INSERT INTO card_notes (card_id, note_key, library_id, original_body, external) VALUES (?, 'NOTE0001', 1, '', 1)",
    [literature],
  );
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
  check(
    "Entry points select only cards without parents before the list limit",
    (await zettel.listZettels("Outline", true))
      .map((card) => card.id)
      .join() === rootId,
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
      (await zettel.listZettels("Outline", true)).length === 2,
  );
  await zettel.saveZettel({ title: "Pending", body: "[[Future concept]]" });
  const allGraph = await graph.getGraphData();
  check(
    "graph includes actual direction, provenance and unresolved references",
    allGraph.edges.some(
      (edge) =>
        edge.source === markdownCard &&
        edge.target === laterId &&
        edge.kind === "link",
    ) &&
      allGraph.nodes.some(
        (node) => node.kind === "source" && node.itemKey === "ITEMKEY1",
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
      nativeTaggedNode.color === "#3478f6",
  );
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
