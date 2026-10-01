/**
 * Independent SQLite storage layer for the zettel knowledge base.
 *
 * The database lives at <Zotero data dir>/zettel-knowledge-base.sqlite and is completely
 * isolated from zotero.sqlite. We use the platform mozStorage wrapper
 * (Sqlite.sys.mjs) - the same approach Better BibTeX uses for its own DB.
 *
 * NOTE: mozStorage's execute() only runs the FIRST statement of a string,
 * so schema statements must be executed one by one.
 */

const DB_FILENAME = "zettel-knowledge-base.sqlite";
const SCHEMA_VERSION = 3;

export interface ZettelRow {
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
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS zettels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    item_key TEXT,
    library_id INTEGER,
    annotation_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL,
    target_id TEXT,
    ref TEXT NOT NULL,
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
  `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_title ON zettels(title)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_updated ON zettels(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_item ON zettels(item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_zettels_annotation ON zettels(annotation_key)`,
];

type SqliteConnection = any;

let _conn: SqliteConnection | null = null;
let _schemaReady = false;

function getSqlite(): Record<string, any> {
  return ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
}

export async function initDB(): Promise<void> {
  // Not just `if (_conn) return`: a failed migration must be retryable within
  // the same session, otherwise the connection would stay open while the
  // schema silently remains stale.
  if (_conn && _schemaReady) return;

  if (!_conn) {
    const { Sqlite } = getSqlite();
    const path = PathUtils.join(Zotero.DataDirectory.dir, DB_FILENAME);
    _conn = await Sqlite.openConnection({ path });
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
          `Zettel Knowledge Base: PRAGMA journal_mode=WAL failed (continuing): ${describeError(e)}`,
        ),
      );
    }
  }

  await ensureSchema();
  _schemaReady = true;
}

async function ensureSchema(): Promise<void> {
  for (const sql of SCHEMA_TABLES) {
    await runSchemaStatement(sql);
  }
  for (const sql of SCHEMA_INDEXES) {
    await runSchemaStatement(sql, true);
  }
  await exec(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)`,
    [String(SCHEMA_VERSION)],
  );

  await assertSchema();
}

/** Columns `zettels` must have once the migration has run. */
const REQUIRED_COLUMNS = [
  "id",
  "title",
  "body",
  "item_key",
  "library_id",
  "annotation_key",
  "created_at",
  "updated_at",
];

/**
 * Reads the schema back and fails loudly if it is not what we just tried to
 * build.
 *
 * The previous v1 database went unnoticed for several sessions precisely
 * because nothing verified the result: the statements "ran", the version was
 * never written, and the failure surfaced only as unrelated errors much later.
 */
async function assertSchema(): Promise<void> {
  const row = await getOne<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'schemaVersion'`,
  );
  const actual = row?.value ?? "none";
  if (actual !== String(SCHEMA_VERSION)) {
    throw new Error(
      `Zettel Knowledge Base: schema version mismatch after initialization, expected ${SCHEMA_VERSION} but found ${actual}`,
    );
  }

  const cols = await getAll<{ name: string }>(`PRAGMA table_info(zettels)`);
  const names = cols.map((c) => c.name).filter(Boolean);
  const missing = REQUIRED_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) {
    throw new Error(
      `Zettel Knowledge Base: zettels is missing required column(s) after initialization: ` +
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
 * the whole migration, so a single failed index cannot hold the schema back.
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
      `Zettel Knowledge Base: schema statement failed\n  statement: ${oneLine}\n  error: ${why}`,
    );
  }
}

/**
 * Best-effort snapshot of the database as it actually is.
 *
 * Called after a failed initDB (the connection is open even when the migration
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
  if (_conn) {
    await _conn.close();
    _conn = null;
  }
}

function conn(): SqliteConnection {
  if (!_conn)
    throw new Error(
      "Zettel Knowledge Base: database is not ready. Reopen this window after startup.",
    );
  return _conn;
}

export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await conn().execute(sql, params);
}

/**
 * Makes a mozStorage row readable by column name.
 *
 * `Connection.execute()` resolves to raw `mozIStorageRow` objects, NOT plain
 * objects: they expose values only through `getResultByName()` /
 * `getResultByIndex()`. Reading `row.title` therefore yields `undefined`
 * silently, which is how every schema check "passed" while the database stayed
 * on its old version, and why `PRAGMA table_info()` appeared to return rows
 * with no column names at all. Zotero wraps rows the same way in its own
 * `xpcom/db.js` (`queryAsync`).
 */
function wrapRow(row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const target = row as { getResultByName?: (name: string) => unknown };
  if (typeof target.getResultByName !== "function") return row;
  const read = target.getResultByName.bind(target);

  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(t, prop, receiver);
      // A row must never look thenable, or awaiting it would try to call it.
      if (prop === "then") return undefined;
      try {
        return read(prop);
      } catch {
        // Not a result column: fall back for XPCOM members and toString.
        return Reflect.get(t, prop, receiver);
      }
    },
    has(t, prop) {
      if (typeof prop !== "string") return Reflect.has(t, prop);
      try {
        read(prop);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export async function getAll<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await conn().execute(sql, params);
  return (rows as unknown[]).map(wrapRow) as T[];
}

export async function getOne<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await getAll<T>(sql, params);
  return rows[0];
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return conn().executeTransaction(fn);
}
