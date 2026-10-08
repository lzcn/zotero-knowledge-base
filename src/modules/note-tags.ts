import { getAll } from "./db";
import { getTagInheritance } from "./preferences";

/** Read effective tags without copying inherited tags into native notes. */
export async function loadNativeTags(
  notes: Zotero.Item[],
  inherit: boolean,
): Promise<Map<Zotero.Item, string[]>> {
  const items = new Map<number, Zotero.Item>();
  for (const note of notes) items.set(note.id, note);
  if (inherit) {
    let batch = notes;
    while (batch.length) {
      const ids = [
        ...new Set(
          batch
            .map((item) => item.parentItemID)
            .filter(
              (id): id is number => typeof id === "number" && !items.has(id),
            ),
        ),
      ];
      batch = (
        await Promise.all(ids.map((id) => Zotero.Items.getAsync(id)))
      ).filter((item): item is Zotero.Item => !!item && !item.isInTrash());
      for (const item of batch) items.set(item.id, item);
    }
  }
  await Zotero.Items.loadDataTypes(
    [...new Set([...notes, ...items.values()])],
    ["tags"],
  );
  return new Map(
    notes.map((note) => {
      const tags = new Set<string>();
      const visited = new Set<Zotero.Item>();
      let item: Zotero.Item | undefined = note;
      while (item && !visited.has(item)) {
        visited.add(item);
        item.getTags().forEach(({ tag }) => tags.add(tag));
        item = inherit ? items.get(item.parentItemID || 0) : undefined;
      }
      return [note, [...tags]];
    }),
  );
}

/** Resolve ancestors iteratively so deep outlines cannot overflow the stack. */
export function inheritCardTags(
  ownTags: Map<string, string[]>,
  parents: Map<string, string | null>,
): Map<string, string[]> {
  const resolved = new Map<string, string[]>();
  for (const id of ownTags.keys()) {
    const chain: string[] = [];
    const visited = new Set<string>();
    let current: string | null = id;
    while (
      current &&
      ownTags.has(current) &&
      !resolved.has(current) &&
      !visited.has(current)
    ) {
      chain.push(current);
      visited.add(current);
      current = parents.get(current) ?? null;
    }
    let inherited =
      current && resolved.has(current) ? resolved.get(current)! : [];
    for (const card of chain.reverse()) {
      inherited = [...new Set([...(ownTags.get(card) || []), ...inherited])];
      resolved.set(card, inherited);
    }
  }
  return resolved;
}

export async function getEffectiveNoteTags(
  noteID: number | null,
  cardID?: string,
): Promise<string[]> {
  if (!noteID) return [];
  const note = await Zotero.Items.getAsync(noteID);
  if (!note?.isNote() || note.isInTrash()) return [];
  const inherit = getTagInheritance();
  const notes = [note];
  if (inherit && cardID) {
    const mappings = await getAll<{ library_id: number; note_key: string }>(
      `WITH RECURSIVE ancestors(id) AS (
        SELECT parent_id FROM card_parents WHERE card_id = ? AND NOT EXISTS
          (SELECT 1 FROM unavailable_notes u WHERE u.card_id = parent_id)
        UNION SELECT p.parent_id FROM card_parents p JOIN ancestors a ON p.card_id = a.id WHERE NOT EXISTS
          (SELECT 1 FROM unavailable_notes u WHERE u.card_id = p.parent_id)
      ) SELECT n.library_id, n.note_key FROM ancestors a JOIN card_notes n ON n.card_id = a.id
      WHERE NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = a.id)`,
      [cardID],
    );
    const ancestors = await Promise.all(
      mappings.map((row) =>
        Zotero.Items.getByLibraryAndKeyAsync(row.library_id, row.note_key),
      ),
    );
    notes.push(
      ...ancestors.filter(
        (item): item is Zotero.Item =>
          !!item && item.isNote() && !item.isInTrash(),
      ),
    );
  }
  const tags = await loadNativeTags(notes, inherit);
  return [...new Set(notes.flatMap((item) => tags.get(item) || []))];
}
