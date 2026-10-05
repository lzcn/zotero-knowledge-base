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
  platform: "neutral",
  outfile: bundle,
  logLevel: "warning",
});

// One bundle, one module instance: both modules must share the same
// connection object for the flow checks to mean anything.
const { db, zettel, graph, hierarchy, drafts, noteRefs } = await import(
  pathToFileURL(bundle).href
);

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
  check("schemaVersion is 8", schema.version === "8", `got ${schema.version}`);
  const missing = REQUIRED.filter((c) => !schema.columns.includes(c));
  check(
    "all required columns present",
    missing.length === 0,
    missing.join(", "),
  );
  check(
    "all 8 indexes present",
    schema.indexes.length === 8,
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
