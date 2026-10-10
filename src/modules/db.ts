/**
 * Independent SQLite storage layer for the zettel knowledge base.
 *
 * The database lives at <Zotero data dir>/knowledge-base.sqlite and is completely
 * isolated from zotero.sqlite. We use the platform mozStorage wrapper
 * (Sqlite.sys.mjs) - the same approach Better BibTeX uses for its own DB.
 *
 * NOTE: mozStorage's execute() only runs the FIRST statement of a string,
 * so schema statements must be executed one by one.
 */

const DB_FILENAME = "knowledge-base.sqlite";
const SCHEMA_VERSION = 11;

export type NoteKind = "literature" | "zettel" | "thinking";

export interface ZettelRow {
  kind: NoteKind;
  custom_key: string | null;
  id: string;
  title: string;
  body: string;
  item_key: string | null;
  library_id: number | null;
  /** key of the Zotero annotation this card was created from, if any */
  annotation_key: string | null;
  created_at: number;
  updated_at: number;
}

export interface LinkRow {
  source_id: string;
  target_id: string | null;
  ref: string;
}

const SCHEMA_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS unavailable_notes (card_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('missing', 'trashed')))`,
  `CREATE TABLE IF NOT EXISTS note_save_operations (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS note_keys (key TEXT PRIMARY KEY, card_id TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS card_notes (card_id TEXT PRIMARY KEY, note_key TEXT NOT NULL, library_id INTEGER NOT NULL, original_body TEXT NOT NULL, UNIQUE(note_key, library_id))`,
  `CREATE TABLE IF NOT EXISTS editor_drafts (id TEXT PRIMARY KEY, body TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS card_parents (card_id TEXT PRIMARY KEY, parent_id TEXT, CHECK(card_id <> parent_id))`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS zettels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    title_folded TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    item_key TEXT,
    library_id INTEGER,
    annotation_key TEXT,
    custom_key TEXT,
    kind TEXT NOT NULL DEFAULT 'zettel' CHECK(kind IN ('literature', 'zettel', 'thinking') AND (kind <> 'literature' OR (item_key IS NOT NULL AND library_id IS NOT NULL))),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL,
    target_id TEXT,
    ref TEXT NOT NULL,
    ref_folded TEXT NOT NULL DEFAULT '',
    UNIQUE(source_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    zettel_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    UNIQUE(zettel_id, tag)
  )`,
];

/**
 * Create indexes after the current schema tables.
 */
const SCHEMA_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_card_parents_parent ON card_parents(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_title ON zettels(title)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_title_folded ON zettels(title_folded)`,
  `CREATE INDEX IF NOT EXISTS idx_links_unresolved_ref ON links(ref_folded) WHERE target_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_updated ON zettels(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_item ON zettels(item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_annotation ON zettels(annotation_key)`,
];

interface StorageRow {
  getResultByName(name: string): unknown;
}
interface SqliteConnection {
  execute(sql: string, params?: unknown[]): Promise<StorageRow[]>;
  executeTransaction<T>(callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
interface SqliteModule {
  Sqlite: {
    openConnection(options: { path: string }): Promise<SqliteConnection>;
    shutdown: {
      addBlocker(name: string, blocker: () => Promise<void>): void;
      removeBlocker(blocker: () => Promise<void>): void;
    };
  };
}

let _conn: SqliteConnection | null = null;
let _schemaReady = false;
let _initializing: Promise<void> | undefined;
let _shutdownClient: SqliteModule["Sqlite"]["shutdown"] | undefined;
let _closing: Promise<void> | undefined;
const _transactions = new Set<Promise<unknown>>();
let generation = 0;
let revision = 0;
export const getDatabaseGeneration = () => generation;
export const getDatabaseRevision = () => revision;

async function shutdownDatabase(): Promise<void> {
  try {
    await _initializing;
  } finally {
    await closeDB();
  }
}

function getSqlite(): SqliteModule {
  return ChromeUtils.importESModule(
    "resource://gre/modules/Sqlite.sys.mjs",
  ) as SqliteModule;
}

export async function initDB(): Promise<void> {
  if (_initializing) return _initializing;
  _initializing = initializeDB();
  try {
    await _initializing;
  } finally {
    _initializing = undefined;
  }
}

async function initializeDB(): Promise<void> {
  // Retry initialization if an earlier attempt did not finish.
  if (_conn && _schemaReady) return;

  if (!_conn) {
    const { Sqlite } = getSqlite();
    const path = PathUtils.join(Zotero.DataDirectory.dir, DB_FILENAME);
    _conn = await Sqlite.openConnection({ path });
    generation++;
    revision++;
    // Sqlite waits for every connection to close; it does not close ours for us.
    _shutdownClient = Sqlite.shutdown;
    _shutdownClient.addBlocker(
      "Knowledge Base: close database",
      shutdownDatabase,
    );
    // WAL is a performance optimisation only. Zotero wraps this same pragma in
    // try/catch in xpcom/db.js, and so must we: letting it abort the run would
    // leave the database permanently stuck on its old schema. Written without
    // a trailing semicolon, matching Zotero's usage - these are prepared as
    // single async statements, not executed as a script.
    try {
      await _conn.execute(`PRAGMA journal_mode = WAL`);
      trace("ok   PRAGMA journal_mode = WAL");
    } catch (e) {
      trace(
        `FAIL PRAGMA journal_mode = WAL -> ${describeError(e)} (non-fatal)`,
      );
      Zotero.logError(
        new Error(
          `Knowledge Base: PRAGMA journal_mode=WAL failed (continuing): ${describeError(e)}`,
        ),
      );
    }
  }

  schemaTrace.length = 0;
  await conn().executeTransaction(ensureSchema);
  _schemaReady = true;
}

async function ensureSchema(): Promise<void> {
  for (const sql of SCHEMA_TABLES) {
    await runSchemaStatement(sql);
  }
  const columns = await getAll<{ name: string }>("PRAGMA table_info(zettels)");
  if (!columns.some((column) => column.name === "kind"))
    await exec(
      "ALTER TABLE zettels ADD COLUMN kind TEXT NOT NULL DEFAULT 'zettel' CHECK(kind IN ('literature', 'zettel', 'thinking') AND (kind <> 'literature' OR (item_key IS NOT NULL AND library_id IS NOT NULL)))",
    );
  if (!columns.some((column) => column.name === "custom_key"))
    await exec("ALTER TABLE zettels ADD COLUMN custom_key TEXT");
  if (!columns.some((column) => column.name === "title_folded"))
    await exec(
      "ALTER TABLE zettels ADD COLUMN title_folded TEXT NOT NULL DEFAULT ''",
    );
  const linkColumns = await getAll<{ name: string }>(
    "PRAGMA table_info(links)",
  );
  if (!linkColumns.some((column) => column.name === "ref_folded"))
    await exec(
      "ALTER TABLE links ADD COLUMN ref_folded TEXT NOT NULL DEFAULT ''",
    );
  // JavaScript case folding preserves the existing Unicode title matching behavior.
  for (const row of await getAll<{ id: string; title: string }>(
    "SELECT id, title FROM zettels WHERE title_folded = '' AND title <> ''",
  ))
    await exec("UPDATE zettels SET title_folded = ? WHERE id = ?", [
      row.title.toLowerCase(),
      row.id,
    ]);
  for (const row of await getAll<{ source_id: string; ref: string }>(
    "SELECT source_id, ref FROM links WHERE ref_folded = ''",
  ))
    await exec(
      "UPDATE links SET ref_folded = ? WHERE source_id = ? AND ref = ?",
      [row.ref.toLowerCase(), row.source_id, row.ref],
    );
  const mappings = await getAll<{ name: string }>(
    "PRAGMA table_info(card_notes)",
  );
  if (!mappings.some((column) => column.name === "external"))
    await exec(
      "ALTER TABLE card_notes ADD COLUMN external INTEGER NOT NULL DEFAULT 0",
    );
  await exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_literature_source ON zettels(library_id, item_key) WHERE kind = 'literature'",
  );
  for (const sql of SCHEMA_INDEXES) {
    await runSchemaStatement(sql, true);
  }
  await exec(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)`,
    [String(SCHEMA_VERSION)],
  );

  await exec(
    `INSERT OR IGNORE INTO card_parents (card_id, parent_id) SELECT id, NULL FROM zettels`,
  );
  await ensureSearchIndex();
  await assertSchema();
}

async function ensureSearchIndex(): Promise<void> {
  const existing = await getAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('search_terms', 'search_documents', 'search_dirty')",
  );
  // Gecko's SQLite lacks the FTS modules. Keep this rebuildable index in ordinary tables.
  await exec(
    "CREATE TABLE IF NOT EXISTS search_documents (card_id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, custom_key TEXT NOT NULL)",
  );
  await exec(
    "CREATE TABLE IF NOT EXISTS search_terms (term TEXT NOT NULL, card_id TEXT NOT NULL, PRIMARY KEY(term, card_id)) WITHOUT ROWID",
  );
  await exec(
    "CREATE INDEX IF NOT EXISTS idx_search_card ON search_terms(card_id)",
  );
  await exec(
    "CREATE TABLE IF NOT EXISTS search_dirty (card_id TEXT PRIMARY KEY)",
  );
  await exec(`CREATE TRIGGER IF NOT EXISTS zettel_search_insert AFTER INSERT ON zettels BEGIN
    INSERT OR IGNORE INTO search_dirty(card_id) VALUES (new.id); END`);
  await exec(`CREATE TRIGGER IF NOT EXISTS zettel_search_delete AFTER DELETE ON zettels BEGIN
    DELETE FROM search_terms WHERE card_id = old.id;
    DELETE FROM search_documents WHERE card_id = old.id;
    DELETE FROM search_dirty WHERE card_id = old.id; END`);
  await exec(`CREATE TRIGGER IF NOT EXISTS zettel_search_update AFTER UPDATE OF title, body, custom_key ON zettels
    WHEN old.title <> new.title OR old.body <> new.body OR old.custom_key IS NOT new.custom_key BEGIN
    INSERT OR IGNORE INTO search_dirty(card_id) VALUES (new.id); END`);
  if (existing.length !== 3)
    await exec(
      "INSERT OR IGNORE INTO search_dirty(card_id) SELECT id FROM zettels",
    );
}

/** Columns `zettels` must have in the current schema. */
const REQUIRED_COLUMNS = [
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

/** Verify the current schema before exposing the database. */
async function assertSchema(): Promise<void> {
  const row = await getOne<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'schemaVersion'`,
  );
  const actual = row?.value ?? "none";
  if (actual !== String(SCHEMA_VERSION)) {
    throw new Error(
      `Knowledge Base: schema version mismatch after initialization, expected ${SCHEMA_VERSION} but found ${actual}`,
    );
  }

  const cols = await getAll<{ name: string }>(`PRAGMA table_info(zettels)`);
  const names = cols.map((c) => c.name).filter(Boolean);
  const missing = REQUIRED_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) {
    throw new Error(
      `Knowledge Base: zettels is missing required column(s) after initialization: ` +
        `${missing.join(", ")} (found: ${names.join(", ") || "none"})`,
    );
  }
}

/**
 * Renders any thrown value, including the XPCOM exceptions mozStorage raises.
 *
 * Those are not instances of Error, so `error.message` must be read off the
 * object rather than relying on `instanceof`. Getting this wrong is what made
 * the first round of diagnostics useless: the stack was captured but the
 * actual message was dropped.
 */
export function describeError(e: unknown): string {
  if (e && typeof e === "object") {
    const ex = e as { name?: string; message?: string; result?: number };
    if (ex.message) {
      const code =
        typeof ex.result === "number"
          ? ` (0x${(ex.result >>> 0).toString(16)})`
          : "";
      return `${ex.name ?? "Exception"}: ${ex.message}${code}`;
    }
  }
  try {
    return String(e);
  } catch {
    return "(unprintable error)";
  }
}

/** Ordered log of every schema statement attempted, for post-mortem reads. */
const schemaTrace: string[] = [];

function trace(line: string): void {
  schemaTrace.push(line);
}

/** Human-readable trace of the schema statements attempted this session. */
export function getSchemaTrace(): string {
  return schemaTrace.length
    ? schemaTrace.map((l) => `  ${l}`).join("\n")
    : "  (no schema statements were attempted)";
}

/**
 * Runs one DDL statement, reporting which statement failed when it does.
 *
 * `optional` marks statements whose absence degrades performance rather than
 * correctness (indexes). Those are recorded and skipped instead of aborting
 * the schema initialization, so a single failed index cannot hold the schema back.
 */
async function runSchemaStatement(
  sql: string,
  optional = false,
): Promise<void> {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  try {
    await conn().execute(sql);
    trace(`ok   ${oneLine}`);
  } catch (e) {
    const why = describeError(e);
    if (optional) {
      trace(`FAIL ${oneLine} -> ${why} (non-fatal)`);
      return;
    }
    trace(`FAIL ${oneLine} -> ${why}`);
    throw new Error(
      `Knowledge Base: schema statement failed\n  statement: ${oneLine}\n  error: ${why}`,
    );
  }
}

/**
 * Best-effort snapshot of the database as it actually is.
 *
 * Called after a failed initDB (the connection is open even when initialization
 * aborts), so the log shows which statements took effect. Never throws.
 */
export async function collectDBDiagnostics(): Promise<string> {
  if (!_conn) return "  (no open connection)";
  const out: string[] = [];
  const add = async (label: string, fn: () => Promise<string>) => {
    try {
      out.push(`  ${label}: ${await fn()}`);
    } catch (e) {
      out.push(`  ${label}: <failed: ${describeError(e)}>`);
    }
  };

  await add("journal_mode", async () => {
    const rows = await getAll<{ journal_mode: string }>(`PRAGMA journal_mode`);
    return rows?.[0]?.journal_mode ?? "?";
  });
  await add("schemaVersion", async () => {
    const row = await getOne<{ value: string }>(
      `SELECT value FROM meta WHERE key = 'schemaVersion'`,
    );
    return row?.value ?? "none";
  });
  await add("zettels columns", async () => {
    const cols = await getAll<{ name: string }>(`PRAGMA table_info(zettels)`);
    return cols.map((c) => c.name).join(", ") || "(none)";
  });
  await add("indexes", async () => {
    const rows = await getAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`,
    );
    return rows.map((r) => r.name).join(", ") || "(none)";
  });
  return out.join("\n");
}

export async function closeDB(): Promise<void> {
  if (_closing) return _closing;
  const connection = _conn;
  if (!connection) return;
  _closing = (async () => {
    await Promise.allSettled([..._transactions]);
    await connection.close();
    _conn = null;
    generation++;
    revision++;
    _schemaReady = false;
    _shutdownClient?.removeBlocker(shutdownDatabase);
    _shutdownClient = undefined;
  })();
  try {
    await _closing;
  } finally {
    _closing = undefined;
  }
}

function conn(): SqliteConnection {
  if (!_conn || (_closing && !_transactions.size))
    throw new Error(
      "Knowledge Base: database is not ready. Reopen this window after startup.",
    );
  return _conn;
}

export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await conn().execute(sql, params);
  revision++;
}

/** Map mozStorage column accessors to typed query results. */
function wrapRow(row: StorageRow): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then" || typeof property !== "string")
          return undefined;
        return row.getResultByName(property);
      },
    },
  );
}

export async function getAll<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await conn().execute(sql, params);
  return rows.map(wrapRow) as T[];
}

export async function getOne<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await getAll<T>(sql, params);
  return rows[0];
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (_closing) throw new Error("Knowledge Base: database is closing.");
  const operation = conn().executeTransaction(fn);
  _transactions.add(operation);
  try {
    return await operation;
  } catch (error) {
    // Reference caches can contain identities read before a failed write rolls back.
    generation++;
    throw error;
  } finally {
    // A rolled-back write must invalidate snapshots read inside the transaction.
    revision++;
    _transactions.delete(operation);
  }
}
