import {
  exec,
  getAll,
  getDatabaseGeneration,
  getDatabaseRevision,
  transaction,
} from "./db";
import { getTagRevision, notifyDataChange } from "./events";
import { getTagInheritance } from "./preferences";

/** Settings needs the tag vocabulary, without building graph edges or reading note bodies. */
export async function getGraphTags(): Promise<string[]> {
  return [...(await getTagIndex()).keys()].sort((a, b) => a.localeCompare(b));
}

let tagIndex: Promise<Map<string, string[]>> | undefined;
let tagIndexVersion = "";
async function getTagIndex(): Promise<Map<string, string[]>> {
  const version = `${getDatabaseGeneration()}:${getDatabaseRevision()}:${getTagRevision()}:${getTagInheritance()}`;
  if (!tagIndex || tagIndexVersion !== version) {
    tagIndexVersion = version;
    tagIndex = loadTagIndex().catch((error) => {
      if (tagIndexVersion === version) tagIndex = undefined;
      throw error;
    });
  }
  return tagIndex;
}
async function loadTagIndex(): Promise<Map<string, string[]>> {
  const rows = await getAll<{
    id: string;
    library_id: number | null;
    note_key: string | null;
    parent_id: string | null;
  }>(
    `SELECT z.id, n.library_id, n.note_key, p.parent_id FROM zettels z
    LEFT JOIN card_notes n ON n.card_id = z.id LEFT JOIN card_parents p ON p.card_id = z.id
    WHERE NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id)`,
  );
  const own = new Map<string, string[]>(rows.map((row) => [row.id, []]));
  const inherit = getTagInheritance();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const items = await Promise.all(
      batch.map((row) =>
        row.library_id && row.note_key
          ? Zotero.Items.getByLibraryAndKeyAsync(row.library_id, row.note_key)
          : null,
      ),
    );
    const notes = items.filter(
      (item): item is Zotero.Item =>
        !!item && item.isNote() && !item.isInTrash(),
    );
    const tags = await loadNativeTags(notes, inherit);
    batch.forEach((row, i) =>
      own.set(row.id, tags.get((items[i] || undefined)!) || []),
    );
  }
  for (const row of await getAll<{ zettel_id: string; tag: string }>(
    "SELECT zettel_id, tag FROM tags",
  )) {
    const tags = own.get(row.zettel_id);
    if (tags && !tags.includes(row.tag)) tags.push(row.tag);
  }
  const effective = inherit
    ? inheritCardTags(own, new Map(rows.map((row) => [row.id, row.parent_id])))
    : own;
  const index = new Map<string, string[]>();
  for (const [id, tags] of effective)
    for (const tag of tags) {
      const ids = index.get(tag) || [];
      ids.push(id);
      index.set(tag, ids);
    }
  return index;
}
export async function getTaggedNoteIDs(tag: string): Promise<string[]> {
  return (await getTagIndex()).get(tag) || [];
}

/** The tags table holds tags awaiting a native note, including one-time type conversion. */
export async function applyPendingNoteTags(
  note: Zotero.Item,
  cardID?: string,
): Promise<void> {
  if (!cardID) return;
  const rows = await getAll<{ tag: string }>(
    "SELECT tag FROM tags WHERE zettel_id = ?",
    [cardID],
  );
  if (!rows.length) return;
  const library = Zotero.Libraries.get(note.libraryID);
  if (!library || !library.editable) return;
  await Zotero.Items.loadDataTypes([note], ["tags"]);
  for (const { tag } of rows) note.addTag(tag);
  await note.saveTx({ skipSelect: true });
  await transaction(async () => {
    for (const { tag } of rows)
      await exec("DELETE FROM tags WHERE zettel_id = ? AND tag = ?", [
        cardID,
        tag,
      ]);
  });
  notifyDataChange({ cardIDs: [cardID], noteIDs: [note.id], fields: ["tags"] });
}
export async function applyPendingTagsToMappedNotes(
  shouldStop: () => boolean,
): Promise<void> {
  const rows = await getAll<{
    card_id: string;
    library_id: number;
    note_key: string;
  }>(
    "SELECT DISTINCT n.card_id, n.library_id, n.note_key FROM card_notes n JOIN tags t ON t.zettel_id = n.card_id",
  );
  for (const row of rows) {
    if (shouldStop()) return;
    const note = await Zotero.Items.getByLibraryAndKeyAsync(
      row.library_id,
      row.note_key,
    );
    if (shouldStop()) return;
    if (note && note.isNote() && !note.isInTrash())
      await applyPendingNoteTags(note, row.card_id);
  }
}
export async function getOwnNoteTags(
  noteID: number | null,
  cardID?: string,
): Promise<string[]> {
  const note = noteID ? await Zotero.Items.getAsync(noteID) : null;
  const tags = new Set<string>();
  if (note && note.isNote() && !note.isInTrash()) {
    await Zotero.Items.loadDataTypes([note], ["tags"]);
    note.getTags().forEach(({ tag }) => tags.add(tag));
  }
  if (cardID)
    for (const row of await getAll<{ tag: string }>(
      "SELECT tag FROM tags WHERE zettel_id = ?",
      [cardID],
    ))
      tags.add(row.tag);
  return [...tags].sort((a, b) => a.localeCompare(b));
}
export async function changeNoteTag(
  noteID: number,
  cardID: string | null,
  tag: string,
  add: boolean,
): Promise<void> {
  tag = tag.trim();
  if (!tag) throw new Error("Invalid note tag");
  const note = await Zotero.Items.getAsync(noteID);
  if (!note?.isNote() || note.isInTrash()) throw new Error("NOTE_UNAVAILABLE");
  const library = Zotero.Libraries.get(note.libraryID);
  if (!library || !library.editable) throw new Error("NOTE_READ_ONLY");
  await Zotero.Items.loadDataTypes([note], ["tags"]);
  if (add) note.addTag(tag);
  else note.removeTag(tag);
  await note.saveTx({ skipSelect: true });
  if (!add && cardID)
    await exec("DELETE FROM tags WHERE zettel_id = ? AND tag = ?", [
      cardID,
      tag,
    ]);
  notifyDataChange({
    cardIDs: cardID ? [cardID] : [],
    noteIDs: [noteID],
    fields: ["tags"],
  });
}

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
  if (!noteID) return cardID ? getOwnNoteTags(null, cardID) : [];
  const note = await Zotero.Items.getAsync(noteID);
  if (!note || !note.isNote() || note.isInTrash()) return [];
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
  return [
    ...new Set([
      ...notes.flatMap((item) => tags.get(item) || []),
      ...(await getOwnNoteTags(noteID, cardID)),
    ]),
  ];
}
