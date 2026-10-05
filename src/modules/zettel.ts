/**
 * Zettel data model: timestamp IDs, [[wiki-link]] parsing, CRUD, backlinks.
 */

import {
  exec,
  getAll,
  getOne,
  transaction,
  type NoteKind,
  type ZettelRow,
} from "./db";
import { saveParent, removeParent } from "./hierarchy";
import { parseCardLinks } from "./markdown";
import { notifyDataChange } from "./events";
import { cleanupImagesAfterChange } from "./assets";
import { getNoteReferences } from "./note-references";

export interface Zettel extends ZettelRow {
  reference?: string;
  outgoing: number;
  incoming: number;
}

export interface ParsedLink {
  /** raw text inside [[...]], e.g. "20260909120000" or "A card title" */
  ref: string;
  /** display text after "|", defaults to ref */
  display: string;
}

export interface ResolvedLink extends ParsedLink {
  /** target zettel id when resolvable, null for unresolved refs */
  targetId: string | null;
  reference?: string;
}

/* ------------------------------------------------------------------ */
/* ID generation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Zettel ID: local timestamp "YYYYMMDDHHMMSS", e.g. 20260909122345.
 * If two cards are created within the same second, a numeric suffix
 * is appended: 20260909122345-2.
 */
export function newZettelID(existing: Set<string>): string {
  const base = formatTimestamp(new Date());
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function formatTimestamp(d: Date): string {
  const p = (x: number, w = 2) => String(x).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export function isZettelID(s: string): boolean {
  return /^\d{14}(-\d+)?$/.test(s);
}

/* ------------------------------------------------------------------ */
/* Link parsing                                                         */
/* ------------------------------------------------------------------ */

export function parseLinks(body: string): ParsedLink[] {
  return parseCardLinks(body);
}

export async function resolveRefs(
  refs: string[],
  shouldStop = () => false,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!refs.length || shouldStop()) return map;
  const placeholders = refs.map(() => "?").join(",");
  // Native note hyperlinks retain their user-written labels and URLs.
  for (const ref of refs) {
    const match =
      /^zotero:\/\/(?:note\/(u|\d+)\/|select\/(?:items\/|library\/items\/|groups\/(\d+)\/items\/))([A-Z0-9]{8})(?:[/?#].*)?$/i.exec(
        ref,
      );
    if (!match) continue;
    const groupID = match[2] || (match[1] !== "u" ? match[1] : null);
    const libraryID = groupID
      ? Zotero.Libraries.getAll().find(
          (lib) =>
            lib.libraryType === "group" &&
            lib.libraryTypeID === Number(groupID),
        )?.libraryID
      : Zotero.Libraries.userLibraryID;
    if (!libraryID) continue;
    const note = await getOne<{ card_id: string }>(
      "SELECT card_id FROM card_notes WHERE library_id = ? AND note_key = ?",
      [libraryID, match[3]],
    );
    if (note) map.set(ref, note.card_id);
  }
  // by id
  const byId = await getAll<{ id: string; title: string }>(
    `SELECT id, title FROM zettels WHERE id IN (${placeholders})`,
    refs,
  );
  if (shouldStop()) return map;
  for (const r of byId) map.set(r.id, r.id);
  const aliases = await getAll<{ key: string; card_id: string }>(
    `SELECT key, card_id FROM note_keys WHERE key IN (${placeholders})`,
    refs,
  );
  for (const alias of aliases)
    if (!map.has(alias.key)) map.set(alias.key, alias.card_id);
  if (refs.some((ref) => ref.startsWith("@"))) {
    const { byAlias } = await getNoteReferences();
    if (shouldStop()) return map;
    for (const ref of refs) {
      const id = byAlias.get(ref);
      if (id && !map.has(ref)) map.set(ref, id);
      // An indexed link retains its target when its source's citation key changes.
      if (!map.has(ref) && !byAlias.has(ref) && ref.startsWith("@")) {
        const previous = await getAll<{ id: string }>(
          "SELECT DISTINCT z.id FROM links l JOIN zettels z ON z.id = l.target_id WHERE l.ref = ? AND z.kind = 'literature'",
          [ref],
        );
        if (shouldStop()) return map;
        if (previous.length === 1) map.set(ref, previous[0].id);
      }
    }
  }
  // by exact title
  const byTitle = await getAll<{ id: string; title: string }>(
    `SELECT id, title FROM zettels WHERE title IN (${placeholders})`,
    refs,
  );
  if (shouldStop()) return map;
  for (const r of byTitle)
    if (!r.title.startsWith("@") && !map.has(r.title)) map.set(r.title, r.id);
  // by title, case-insensitive fallback
  const lower = new Map<string, string>();
  const all = await getAll<{ id: string; title: string }>(
    `SELECT id, title FROM zettels`,
  );
  if (shouldStop()) return map;
  for (const r of all) if (r.title) lower.set(r.title.toLowerCase(), r.id);
  for (const ref of refs) {
    if (!ref.startsWith("@") && !map.has(ref)) {
      const hit = lower.get(ref.toLowerCase());
      if (hit) map.set(ref, hit);
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Copies a database row into a plain Zettel.
 *
 * Deliberately field-by-field rather than `{ ...row }`: query rows are Proxy
 * wrappers around mozStorage rows (see db.ts) and carry no enumerable own
 * properties, so spreading one silently yields `{}`. Listing the fields also
 * keeps the mapping type-checked.
 */
function rowToZettel(row: ZettelRow, outgoing = 0, incoming = 0): Zettel {
  return {
    kind: row.kind,
    custom_key: row.custom_key,
    id: row.id,
    title: row.title,
    body: row.body,
    item_key: row.item_key,
    library_id: row.library_id,
    annotation_key: row.annotation_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    outgoing,
    incoming,
  };
}

export async function getZettel(id: string): Promise<Zettel | null> {
  const row = await getOne<ZettelRow>(`SELECT * FROM zettels WHERE id = ?`, [
    id,
  ]);
  if (!row) return null;
  const counts = await getOne<{ outgoing: number; incoming: number }>(
    `SELECT
       (SELECT COUNT(*) FROM links WHERE source_id = ? AND target_id IS NOT NULL) AS outgoing,
       (SELECT COUNT(*) FROM links WHERE target_id = ?) AS incoming`,
    [id, id],
  );
  return rowToZettel(row, counts?.outgoing ?? 0, counts?.incoming ?? 0);
}

export async function listZettels(
  query = "",
  entriesOnly = false,
  kind?: NoteKind,
): Promise<Zettel[]> {
  if (kind && !["literature", "zettel", "thinking"].includes(kind))
    throw new Error("Invalid note type");
  const entryFilter =
    (kind ? `kind = '${kind}' AND ` : "") +
    (entriesOnly
      ? "id IN (SELECT card_id FROM card_parents WHERE parent_id IS NULL)"
      : "1 = 1");
  const q = query.trim();
  let rows: ZettelRow[];
  if (q) {
    const like = `%${q}%`;
    rows = await getAll<ZettelRow>(
      `SELECT * FROM zettels
       WHERE (${entryFilter}) AND (title LIKE ? OR body LIKE ? OR id LIKE ?)
       ORDER BY updated_at DESC LIMIT 500`,
      [like, like, like],
    );
  } else {
    rows = await getAll<ZettelRow>(
      `SELECT * FROM zettels WHERE ${entryFilter} ORDER BY updated_at DESC LIMIT 500`,
    );
  }
  const counts = await getAll<{
    source_id: string;
    outgoing: number;
    incoming: number;
  }>(
    `SELECT source_id,
       SUM(CASE WHEN target_id IS NOT NULL THEN 1 ELSE 0 END) AS outgoing,
       0 AS incoming
     FROM links GROUP BY source_id`,
  );
  const incoming = await getAll<{ target_id: string; incoming: number }>(
    `SELECT target_id, COUNT(*) AS incoming FROM links
     WHERE target_id IS NOT NULL GROUP BY target_id`,
  );
  const outMap = new Map(counts.map((c) => [c.source_id, c.outgoing]));
  const inMap = new Map(
    incoming.map((c) => [c.target_id as string, c.incoming]),
  );
  return rows.map((r) =>
    rowToZettel(r, outMap.get(r.id) ?? 0, inMap.get(r.id) ?? 0),
  );
}

/** All zettels whose source is the given Zotero item, newest first. */
export async function listByItem(
  itemKey: string,
  libraryID?: number,
): Promise<Zettel[]> {
  const rows = await getAll<ZettelRow>(
    `SELECT * FROM zettels WHERE item_key = ?${libraryID === undefined ? "" : " AND library_id = ?"} ORDER BY updated_at DESC`,
    libraryID === undefined ? [itemKey] : [itemKey, libraryID],
  );
  return rows.map((r) => rowToZettel(r));
}

export async function listUnsourcedNotes(libraryID: number): Promise<Zettel[]> {
  const rows = await getAll<ZettelRow>(
    `SELECT z.* FROM zettels z JOIN card_notes n ON n.card_id = z.id
     WHERE z.item_key IS NULL AND n.library_id = ? ORDER BY z.updated_at DESC`,
    [libraryID],
  );
  return rows.map((row) => rowToZettel(row));
}

export async function countByItem(itemKey: string): Promise<number> {
  const row = await getOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM zettels WHERE item_key = ?`,
    [itemKey],
  );
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Annotation provenance                                                */
/* ------------------------------------------------------------------ */

/** Newest card created from the given Zotero annotation, if any. */
export async function getZettelByAnnotationKey(
  annotationKey: string,
): Promise<Zettel | null> {
  const row = await getOne<ZettelRow>(
    `SELECT * FROM zettels WHERE annotation_key = ?
     ORDER BY created_at DESC LIMIT 1`,
    [annotationKey],
  );
  return row ? rowToZettel(row) : null;
}

/** Card count per annotation key, for the given keys only. */
export async function countByAnnotationKeys(
  keys: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!keys.length) return map;
  const placeholders = keys.map(() => "?").join(",");
  const rows = await getAll<{ annotation_key: string; n: number }>(
    `SELECT annotation_key, COUNT(*) AS n FROM zettels
     WHERE annotation_key IN (${placeholders})
     GROUP BY annotation_key`,
    keys,
  );
  for (const r of rows) map.set(r.annotation_key, r.n);
  return map;
}

/* ------------------------------------------------------------------ */
/* In-memory count indexes                                             */
/*                                                                     */
/* The item tree column provider and the reader menu handlers are all  */
/* synchronous entry points - Zotero's Reader._dispatchEvent does not  */
/* await handlers, and an appending handler must call append() in the  */
/* same tick. So counts are mirrored into memory instead of queried.   */
/* ------------------------------------------------------------------ */

/** Zotero item key -> number of cards sourced from it. */
const itemCounts = new Map<string, number>();

/** Annotation key -> number of cards created from it. */
const annotationCounts = new Map<string, number>();

export async function rebuildCounts(shouldStop = () => false): Promise<void> {
  if (shouldStop()) return;
  await resolveUnresolvedLinks(shouldStop);
  if (shouldStop()) return;
  const items = await getAll<{ item_key: string; n: number }>(
    `SELECT item_key, COUNT(*) AS n FROM zettels
     WHERE item_key IS NOT NULL GROUP BY item_key`,
  );
  if (shouldStop()) return;
  itemCounts.clear();
  for (const r of items) itemCounts.set(r.item_key, r.n);

  const annotations = await getAll<{ annotation_key: string; n: number }>(
    `SELECT annotation_key, COUNT(*) AS n FROM zettels
     WHERE annotation_key IS NOT NULL GROUP BY annotation_key`,
  );
  if (shouldStop()) return;
  annotationCounts.clear();
  for (const r of annotations) annotationCounts.set(r.annotation_key, r.n);
}

export function getItemCountSync(itemKey: string): number {
  return itemCounts.get(itemKey) ?? 0;
}

export function getAnnotationCountSync(annotationKey: string): number {
  return annotationCounts.get(annotationKey) ?? 0;
}

export async function refreshItemCount(itemKey: string | null): Promise<void> {
  if (!itemKey) return;
  itemCounts.set(itemKey, await countByItem(itemKey));
}

async function refreshAnnotationCount(
  annotationKey: string | null,
): Promise<void> {
  if (!annotationKey) return;
  const row = await getOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM zettels WHERE annotation_key = ?`,
    [annotationKey],
  );
  annotationCounts.set(annotationKey, row?.n ?? 0);
}

/**
 * Create or update a zettel. Re-indexes its [[links]] afterwards.
 * Returns the final zettel id.
 *
 * `annotationKey` links the card back to the Zotero annotation it was created
 * from; it is used for de-duplication and for the "has card" indicators.
 * On update, omitting it preserves the stored value.
 */
export interface SaveCardInput {
  kind?: NoteKind;
  customKey?: string | null;
  id?: string;
  title: string;
  body: string;
  itemKey?: string | null;
  libraryID?: number | null;
  annotationKey?: string | null;
  parentId?: string | null;
  expectedUpdatedAt?: number | null;
  draftId?: string;
  draftRevision?: number;
}

export async function saveZettel(input: SaveCardInput): Promise<string> {
  return (await saveEditorCard(input)).id;
}

export async function saveEditorCard(
  input: SaveCardInput,
  beforeCommit?: () => Promise<void>,
): Promise<{ id: string; updatedAt: number }> {
  let now = Date.now();
  const title = input.title.trim();
  const body = input.body;

  const result = await transaction(async () => {
    let id: string;
    let previousItemKey: string | null = null;
    let effectiveAnnotationKey: string | null = input.annotationKey ?? null;
    const previous = input.id ? await getZettel(input.id) : null;
    if (
      input.expectedUpdatedAt !== undefined &&
      (previous?.updated_at ?? null) !== input.expectedUpdatedAt
    ) {
      throw new Error("CARD_CONFLICT");
    }
    const kind = input.kind ?? previous?.kind ?? "zettel";
    const customKey =
      kind === "thinking"
        ? (input.customKey === undefined
            ? previous?.custom_key
            : input.customKey
          )?.trim() || null
        : null;
    if (customKey && (/[\s[\]|]/.test(customKey) || customKey.startsWith("@")))
      throw new Error("NOTE_KEY_INVALID");
    if (customKey) {
      const reserved = await getOne<{ card_id: string }>(
        "SELECT card_id FROM note_keys WHERE key = ?",
        [customKey],
      );
      const identity = await getOne<{ id: string }>(
        "SELECT id FROM zettels WHERE id = ?",
        [customKey],
      );
      if (
        (reserved && reserved.card_id !== input.id) ||
        (identity && identity.id !== input.id)
      )
        throw new Error("NOTE_KEY_EXISTS");
    }
    if (!["literature", "zettel", "thinking"].includes(kind))
      throw new Error("Invalid note type");
    if (kind === "literature") {
      if (!input.itemKey || !input.libraryID)
        throw new Error("LITERATURE_SOURCE_REQUIRED");
      const existing = await getOne<{ id: string }>(
        "SELECT id FROM zettels WHERE kind = 'literature' AND item_key = ? AND library_id = ?",
        [input.itemKey, input.libraryID],
      );
      if (existing && existing.id !== input.id)
        throw new Error("LITERATURE_EXISTS");
    }
    if (previous) now = Math.max(now, previous.updated_at + 1);
    if (input.id && previous) {
      id = input.id;
      const old = await getOne<{
        item_key: string | null;
        annotation_key: string | null;
      }>(`SELECT item_key, annotation_key FROM zettels WHERE id = ?`, [id]);
      previousItemKey = old?.item_key ?? null;
      effectiveAnnotationKey =
        input.annotationKey === undefined
          ? (old?.annotation_key ?? null)
          : input.annotationKey;
      await exec(
        `UPDATE zettels
         SET title = ?, body = ?, item_key = ?, library_id = ?,
             annotation_key = ?, kind = ?, custom_key = ?, updated_at = ?
         WHERE id = ?`,
        [
          title,
          body,
          input.itemKey ?? null,
          input.libraryID ?? null,
          effectiveAnnotationKey,
          kind,
          customKey,
          now,
          id,
        ],
      );
    } else {
      const allIds = await getAll<{ id: string }>(
        `SELECT id FROM zettels UNION SELECT key AS id FROM note_keys`,
      );
      id =
        input.id && !allIds.some((r) => r.id === input.id)
          ? input.id
          : newZettelID(new Set(allIds.map((r) => r.id)));
      await exec(
        `INSERT INTO zettels (id, title, body, item_key, library_id, annotation_key, kind, custom_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          title,
          body,
          input.itemKey ?? null,
          input.libraryID ?? null,
          effectiveAnnotationKey,
          kind,
          customKey,
          now,
          now,
        ],
      );
    }
    if (customKey && customKey !== id)
      await exec(
        "INSERT OR IGNORE INTO note_keys (key, card_id) VALUES (?, ?)",
        [customKey, id],
      );
    await saveParent(id, input.parentId);
    await reindexLinks(id, body);
    await resolveUnresolvedLinks();
    await beforeCommit?.();
    if (input.draftId && input.draftRevision !== undefined)
      await exec("DELETE FROM editor_drafts WHERE id = ? AND revision <= ?", [
        input.draftId,
        input.draftRevision,
      ]);
    return { id, previousItemKey, effectiveAnnotationKey };
  });

  await refreshItemCount(input.itemKey ?? null);
  if (result.previousItemKey && result.previousItemKey !== input.itemKey) {
    await refreshItemCount(result.previousItemKey);
  }
  await refreshAnnotationCount(result.effectiveAnnotationKey);
  notifyDataChange();
  // The note is committed; housekeeping must not hold up save feedback.
  void cleanupImagesAfterChange();
  return { id: result.id, updatedAt: now };
}

export async function deleteZettel(id: string): Promise<void> {
  const row = await getOne<{
    item_key: string | null;
    annotation_key: string | null;
  }>(`SELECT item_key, annotation_key FROM zettels WHERE id = ?`, [id]);
  await transaction(async () => {
    await exec("DELETE FROM note_keys WHERE card_id = ?", [id]);
    await removeParent(id);
    await exec(`DELETE FROM links WHERE source_id = ?`, [id]);
    await exec(`UPDATE links SET target_id = NULL WHERE target_id = ?`, [id]);
    await exec(`DELETE FROM tags WHERE zettel_id = ?`, [id]);
    await exec(`DELETE FROM zettels WHERE id = ?`, [id]);
    await resolveUnresolvedLinks();
  });
  await refreshItemCount(row?.item_key ?? null);
  await refreshAnnotationCount(row?.annotation_key ?? null);
  notifyDataChange();
  await cleanupImagesAfterChange();
}

async function reindexLinks(zettelId: string, body: string): Promise<void> {
  await exec(`DELETE FROM links WHERE source_id = ?`, [zettelId]);
  const parsed = parseLinks(body);
  if (!parsed.length) return;
  const resolved = await resolveRefs(parsed.map((p) => p.ref));
  for (const p of parsed) {
    await exec(
      `INSERT OR IGNORE INTO links (source_id, target_id, ref) VALUES (?, ?, ?)`,
      [zettelId, resolved.get(p.ref) ?? null, p.ref],
    );
  }
}

/** Resolve forward references when their target is created later. */
export async function resolveUnresolvedLinks(
  shouldStop = () => false,
): Promise<void> {
  if (shouldStop()) return;
  const rows = await getAll<{ ref: string }>(
    `SELECT DISTINCT ref FROM links WHERE target_id IS NULL`,
  );
  if (shouldStop()) return;
  const resolved = await resolveRefs(
    rows.map((r) => r.ref),
    shouldStop,
  );
  for (const [ref, id] of resolved) {
    if (shouldStop()) return;
    await exec(
      `UPDATE links SET target_id = ? WHERE ref = ? AND target_id IS NULL`,
      [id, ref],
    );
  }
}

/* ------------------------------------------------------------------ */
/* Links & backlinks                                                    */
/* ------------------------------------------------------------------ */

export async function getOutgoing(id: string): Promise<ResolvedLink[]> {
  const zettel = await getZettel(id);
  const displays = new Map(
    parseLinks(zettel?.body ?? "").map((link) => [link.ref, link.display]),
  );
  const rows = await getAll<{
    ref: string;
    target_id: string | null;
    title: string;
  }>(
    `SELECT l.ref, l.target_id, t.title
     FROM links l LEFT JOIN zettels t ON t.id = l.target_id
     WHERE l.source_id = ? AND (l.target_id IS NOT NULL OR substr(l.ref, 1, 9) <> 'zotero://') ORDER BY l.ref`,
    [id],
  );
  return rows.map((r) => ({
    ref: r.ref,
    display: r.title || displays.get(r.ref) || r.ref,
    targetId: r.target_id,
  }));
}

export interface Backlink {
  sourceId: string;
  reference?: string;
  sourceTitle: string;
  ref: string;
}

export async function getBacklinks(id: string): Promise<Backlink[]> {
  const rows = await getAll<Backlink>(
    `SELECT l.source_id AS sourceId, z.title AS sourceTitle, l.ref
     FROM links l JOIN zettels z ON z.id = l.source_id
     WHERE l.target_id = ? ORDER BY z.updated_at DESC`,
    [id],
  );
  // Mapped explicitly rather than returned as-is: query rows are Proxy
  // wrappers (see db.ts) and must not leak out of the data layer.
  return rows.map((r) => ({
    sourceId: r.sourceId,
    sourceTitle: r.sourceTitle,
    ref: r.ref,
  }));
}

/** Zettels referenced by [[ref]] but not yet created (click → create). */
export async function getUnresolvedRefs(): Promise<
  { ref: string; count: number }[]
> {
  const rows = await getAll<{ ref: string; count: number }>(
    `SELECT ref, COUNT(*) AS count FROM links
     WHERE target_id IS NULL AND substr(ref, 1, 9) <> 'zotero://' GROUP BY ref ORDER BY count DESC, ref LIMIT 100`,
  );
  return rows.map((r) => ({ ref: r.ref, count: r.count }));
}
