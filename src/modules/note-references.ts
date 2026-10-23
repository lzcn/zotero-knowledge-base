import { getAll, getDatabaseGeneration, getDatabaseRevision } from "./db";
import { creatorYear, getCitationKey } from "./zotero";
import { getIdentityRevision, getSourceRevision } from "./events";
import type { CardReference } from "./markdown";

let references: ReturnType<typeof loadNoteReferences> | undefined;
let referenceVersion = "";
let targets: Promise<Map<string, CardReference>> | undefined;
let targetVersion = "";
let cachedTargets = new Map<string, CardReference>();
let invalidation = 0;
export function invalidateNoteReferences(): void {
  invalidation++;
}
function version() {
  return `${getDatabaseGeneration()}:${getIdentityRevision()}:${invalidation}`;
}
export function getNoteReferences() {
  const key = `${getDatabaseGeneration()}:${getSourceRevision()}:${invalidation}`;
  if (!references || referenceVersion !== key) {
    referenceVersion = key;
    references = loadNoteReferences().catch((error) => {
      if (referenceVersion === key) references = undefined;
      throw error;
    });
  }
  return references;
}

/** Public references are aliases; internal IDs remain the database keys. */
async function loadNoteReferences() {
  const rows = await getAll<{
    id: string;
    item_key: string | null;
    library_id: number | null;
  }>("SELECT id, item_key, library_id FROM zettels WHERE kind = 'literature'");
  const sources = await Promise.all(
    rows.map(async (row) => {
      if (!row.item_key || row.library_id == null) return null;
      const itemID = Zotero.Items.getIDFromLibraryAndKey(
        row.library_id,
        row.item_key,
      );
      if (!itemID) return null;
      const item = await Zotero.Items.getAsync(itemID);
      if (!item || item.isInTrash() || !item.isRegularItem()) return null;
      return { id: row.id, item };
    }),
  );
  const loaded = sources.filter((source) => source != null);
  if (loaded.length)
    await Zotero.Items.loadDataTypes(
      [...new Set(loaded.map((source) => source.item))],
      ["itemData", "creators"],
    );
  const candidates = loaded.map(({ id, item }) => {
    const key = getCitationKey(item).trim();
    return {
      id,
      alias: key && !/[\s[\]|]/.test(key) ? `@${key}` : null,
      citationKey: key,
      label: creatorYear(item),
      sourceTitle: String(item.getField("title", false, true) || ""),
    };
  });
  const aliases = await getAll<{ key: string; card_id: string }>(
    "SELECT key, card_id FROM note_keys UNION SELECT id AS key, id AS card_id FROM zettels",
  );
  const current = await getAll<{ id: string; custom_key: string }>(
    "SELECT id, custom_key FROM zettels WHERE custom_key IS NOT NULL",
  );
  const byAlias = new Map<string, string | null>(
    aliases.map((row) => [row.key, row.card_id]),
  );
  const reserved = new Set(byAlias.keys());
  for (const candidate of candidates) {
    if (!candidate.alias) continue;
    const key = candidate.citationKey;
    if (!reserved.has(key))
      byAlias.set(
        key,
        byAlias.has(key) && byAlias.get(key) !== candidate.id
          ? null
          : candidate.id,
      );
    byAlias.set(
      candidate.alias,
      byAlias.has(candidate.alias) &&
        byAlias.get(candidate.alias) !== candidate.id
        ? null
        : candidate.id,
    );
  }
  const byID = new Map<string, string>(
    current.map((row) => [row.id, row.custom_key]),
  );
  const defaults = new Map<string, string>();
  for (const candidate of candidates)
    if (
      candidate.alias &&
      byAlias.get(candidate.citationKey) === candidate.id &&
      !byID.has(candidate.id)
    ) {
      byID.set(candidate.id, candidate.citationKey);
      defaults.set(candidate.id, candidate.citationKey);
    }
  const literature = new Map(
    candidates.map((candidate) => [
      candidate.id,
      {
        citationKey: candidate.citationKey,
        label: candidate.label,
        sourceTitle: candidate.sourceTitle,
      },
    ]),
  );
  return { byID, byAlias, literature, defaults };
}

/** Shared O(1) lookup after one batched read; labels do not define note identity. */
export function getNoteLinkTargets(): Promise<Map<string, CardReference>> {
  const key = `${version()}:${getDatabaseRevision()}`;
  if (!targets || targetVersion !== key) {
    targetVersion = key;
    targets = (async () => {
      const [rows, { byAlias, byID, literature }, previous] = await Promise.all(
        [
          getAll<{
            id: string;
            title: string;
            custom_key: string | null;
            note_key: string | null;
            note_library_id: number | null;
          }>(
            "SELECT z.id, z.title, z.custom_key, n.note_key, n.library_id AS note_library_id FROM zettels z LEFT JOIN card_notes n ON n.card_id = z.id",
          ),
          getNoteReferences(),
          getAll<{ ref: string; target_id: string }>(
            "SELECT DISTINCT ref, target_id FROM links WHERE target_id IS NOT NULL",
          ),
        ],
      );
      const result = new Map<string, CardReference>();
      const titles = new Map<string, CardReference | null>();
      const libraries = Zotero.Libraries.getAll();
      for (const row of rows) {
        const library =
          row.note_library_id == null ||
          row.note_library_id === Zotero.Libraries.userLibraryID
            ? null
            : libraries.find((lib) => lib.libraryID === row.note_library_id);
        const scope =
          row.note_library_id === Zotero.Libraries.userLibraryID
            ? "library"
            : library?.libraryType === "group"
              ? `groups/${library.libraryTypeID}`
              : null;
        const literatureEntry = literature.get(row.id);
        const target: CardReference = {
          id: row.id,
          title: row.title,
          label:
            row.custom_key ||
            literatureEntry?.label ||
            literatureEntry?.citationKey ||
            row.id,
          sourceTitle: literatureEntry?.sourceTitle || undefined,
          reference: byID.get(row.id) || row.id,
          href:
            row.note_key && scope
              ? `zotero://select/${scope}/items/${row.note_key}`
              : undefined,
        };
        result.set(row.id, target);
        if (target.href) result.set(target.href, target);
        const title = row.title.toLowerCase();
        titles.set(title, titles.has(title) ? null : target);
      }
      for (const [alias, id] of byAlias)
        if (id && result.has(id)) result.set(alias, result.get(id)!);
      for (const [title, target] of titles)
        if (target && !result.has(title)) result.set(title, target);
      const historical = new Map<string, string | null>();
      for (const row of previous)
        historical.set(
          row.ref,
          historical.has(row.ref) && historical.get(row.ref) !== row.target_id
            ? null
            : row.target_id,
        );
      for (const [ref, id] of historical)
        if (
          id &&
          !result.has(ref) &&
          !byAlias.has(ref) &&
          !titles.has(ref.toLowerCase()) &&
          result.has(id)
        )
          result.set(ref, result.get(id)!);
      if (`${version()}:${getDatabaseRevision()}` !== key)
        return getNoteLinkTargets();
      cachedTargets = result;
      return result;
    })().catch((error) => {
      if (targetVersion === key) targets = undefined;
      throw error;
    });
  }
  return targets;
}
export function getCachedNoteTarget(ref: string): CardReference | undefined {
  return (
    cachedTargets.get(ref) ||
    (!ref.startsWith("@") ? cachedTargets.get(ref.toLowerCase()) : undefined)
  );
}

export async function withNoteReferences<T extends { id: string }>(notes: T[]) {
  if (!notes.length) return [];
  const { byID } = await getNoteReferences();
  return notes.map((note) => ({
    ...note,
    id: note.id,
    reference: byID.get(note.id) || note.id,
  }));
}
