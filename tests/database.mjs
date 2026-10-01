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

/* ------------------------------------------------------------------ */
/* globals (must exist before the bundle is imported)                  */
/* ------------------------------------------------------------------ */

const zoteroStub = {
  DataDirectory: { dir: "" },
  debug: () => {},
  logError: (e) => console.log(`   [zotero.logError] ${e?.message ?? e}`),
};

globalThis.ChromeUtils = {
  importESModule: (spec) => {
    if (!spec.includes("Sqlite.sys.mjs"))
      throw new Error(`unexpected import: ${spec}`);
    return {
      Sqlite: {
        openConnection: async ({ path: file }) => new Connection(file),
      },
    };
  },
};
globalThis.PathUtils = { join: (...parts) => path.join(...parts) };
globalThis.Zotero = zoteroStub;

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
  path.join(os.tmpdir(), "zettel-knowledge-base-verify-"),
);
const entry = path.join(workspace, "entry.ts");
const bundle = path.join(workspace, "bundle.mjs");

await writeFile(
  entry,
  // Absolute paths so esbuild does not need the entry to sit in the project.
  `export * as db from ${JSON.stringify(path.join(ROOT, "src/modules/db.ts"))};\n` +
    `export * as zettel from ${JSON.stringify(path.join(ROOT, "src/modules/zettel.ts"))};\n` +
    `export * as graph from ${JSON.stringify(path.join(ROOT, "src/modules/graph.ts"))};\n`,
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
const { db, zettel, graph } = await import(pathToFileURL(bundle).href);

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
  "created_at",
  "updated_at",
];

async function initialize(label, dataDir, prepare) {
  console.log(`\n=== ${label} ===`);
  await mkdir(dataDir, { recursive: true });
  if (prepare)
    await prepare(path.join(dataDir, "zettel-knowledge-base.sqlite"));

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

  const schema = await readSchema(
    path.join(dataDir, "zettel-knowledge-base.sqlite"),
  );
  check("schemaVersion is 3", schema.version === "3", `got ${schema.version}`);
  const missing = REQUIRED.filter((c) => !schema.columns.includes(c));
  check(
    "all required columns present",
    missing.length === 0,
    missing.join(", "),
  );
  check(
    "all 6 indexes present",
    schema.indexes.length === 6,
    `got ${schema.indexes.length}`,
  );
  return schema;
}

/* ---- case 1: empty database ---- */
const fresh = await initialize("fresh database", path.join(workspace, "fresh"));
if (fresh)
  check("fresh database has no rows", fresh.rows === 0, `got ${fresh.rows}`);
await db.closeDB();

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

  const betaId = await zettel.saveZettel({ title: "Beta", body: "plain" });
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
    "creating a target resolves earlier links and preserves aliases",
    forwardLink?.targetId === laterId && forwardLink?.display === "显示别名",
  );
  check(
    "resolved forward reference appears in backlinks and counts",
    (await zettel.getBacklinks(laterId))[0]?.sourceId === forwardId &&
      (await zettel.getZettel(laterId))?.incoming === 1 &&
      !(await zettel.getUnresolvedRefs()).some((r) => r.ref === "Later"),
  );
  const markdownCard = await zettel.saveZettel({
    title: "Markdown card",
    body: `[Stable label](zkb://zettel/${laterId})\n\n\`[[Not a card]]\``,
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
