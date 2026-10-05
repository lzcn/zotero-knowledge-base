import { getAll } from "./db";
import { getCitationKey } from "./zotero";

/** Public references are aliases; internal IDs remain the database keys. */
export async function getNoteReferences() {
  const rows = await getAll<{
    id: string;
    item_key: string | null;
    library_id: number | null;
  }>("SELECT id, item_key, library_id FROM zettels WHERE kind = 'literature'");
  const candidates = await Promise.all(
    rows.map(async (row) => {
      if (!row.item_key || row.library_id == null) return null;
      const itemID = Zotero.Items.getIDFromLibraryAndKey(
        row.library_id,
        row.item_key,
      );
      if (!itemID) return null;
      const item = await Zotero.Items.getAsync(itemID);
      if (!item || item.isInTrash() || !item.isRegularItem()) return null;
      await Zotero.Items.loadDataTypes([item], ["itemData"]);
      const key = getCitationKey(item).trim();
      return key && !/[\s[\]|]/.test(key)
        ? { id: row.id, alias: `@${key}` }
        : null;
    }),
  );
  const aliases = await getAll<{ key: string; card_id: string }>(
    "SELECT key, card_id FROM note_keys",
  );
  const current = await getAll<{ id: string; custom_key: string }>(
    "SELECT id, custom_key FROM zettels WHERE kind = 'thinking' AND custom_key IS NOT NULL",
  );
  const byAlias = new Map<string, string | null>(
    aliases.map((row) => [row.key, row.card_id]),
  );
  for (const candidate of candidates) {
    if (!candidate) continue;
    byAlias.set(
      candidate.alias,
      byAlias.has(candidate.alias) ? null : candidate.id,
    );
  }
  const byID = new Map<string, string>(
    current.map((row) => [row.id, row.custom_key]),
  );
  for (const [alias, id] of byAlias)
    if (id && alias.startsWith("@")) byID.set(id, alias);
  return { byID, byAlias };
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
