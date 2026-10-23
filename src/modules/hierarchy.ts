import { exec, getAll, getOne } from "./db";
import { getNoteReferences } from "./note-references";

export interface CardIdentity {
  id: string;
  title: string;
  reference?: string;
}
export interface CardFamily {
  parent: CardIdentity | null;
  children: CardIdentity[];
}

/** Read every active Zettel and its stored parent in one database snapshot. */
export async function getZettelOutline() {
  const { byID } = await getNoteReferences();
  const rows = await getAll<{
    id: string;
    title: string;
    parent_id: string | null;
    parent_title: string | null;
    parent_unavailable: number;
  }>(`SELECT COALESCE(z.custom_key, z.id) AS id, z.title,
      COALESCE(parent.custom_key, p.parent_id) AS parent_id, parent.title AS parent_title,
      EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = parent.id) AS parent_unavailable
    FROM zettels z
    LEFT JOIN card_parents p ON p.card_id = z.id
    LEFT JOIN zettels parent ON parent.id = p.parent_id
    WHERE z.kind = 'zettel'
      AND NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id)
    ORDER BY z.title_folded, z.id`);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    parent: row.parent_id
      ? {
          id: byID.get(row.parent_id) || row.parent_id,
          title: row.parent_title,
          ...(row.parent_unavailable ? { unavailable: true } : {}),
        }
      : null,
  }));
}

/** null is the virtual knowledge root; every card has exactly one parent slot. */
export async function getFamily(id: string): Promise<CardFamily> {
  const parent = await getOne<CardIdentity>(
    `SELECT z.id, z.title FROM card_parents p JOIN zettels z ON z.id = p.parent_id WHERE p.card_id = ?`,
    [id],
  );
  const children = await getAll<CardIdentity>(
    `SELECT z.id, z.title FROM card_parents p JOIN zettels z ON z.id = p.card_id WHERE p.parent_id = ? ORDER BY z.title, z.id`,
    [id],
  );
  return { parent: parent || null, children };
}

/** Called inside the card save transaction, so invalid moves roll back the body too. */
export async function saveParent(
  id: string,
  parentId?: string | null,
): Promise<void> {
  if (parentId !== undefined && parentId !== null) {
    const rows = await getAll<{ card_id: string; parent_id: string | null }>(
      `SELECT card_id, parent_id FROM card_parents`,
    );
    const parents = new Map(rows.map((row) => [row.card_id, row.parent_id]));
    if (!parents.has(parentId)) throw new Error("Parent card does not exist");
    const visited = new Set([id]);
    let current: string | null = parentId;
    while (current) {
      if (visited.has(current))
        throw new Error("A card cannot be its own ancestor");
      visited.add(current);
      current = parents.get(current) ?? null;
    }
  }
  if (parentId === undefined)
    await exec(
      `INSERT OR IGNORE INTO card_parents (card_id, parent_id) VALUES (?, NULL)`,
      [id],
    );
  else
    await exec(
      `INSERT OR REPLACE INTO card_parents (card_id, parent_id) VALUES (?, ?)`,
      [id, parentId],
    );
}

/** Deleting a card moves its children one level up, preserving their branches. */
export async function removeParent(id: string): Promise<void> {
  const row = await getOne<{ parent_id: string | null }>(
    `SELECT parent_id FROM card_parents WHERE card_id = ?`,
    [id],
  );
  await exec(`UPDATE card_parents SET parent_id = ? WHERE parent_id = ?`, [
    row?.parent_id ?? null,
    id,
  ]);
  await exec(`DELETE FROM card_parents WHERE card_id = ?`, [id]);
}

export async function getParentCandidates(
  id: string | null,
  query = "",
): Promise<CardIdentity[]> {
  const rows = await getAll<{
    id: string;
    title: string;
    parent_id: string | null;
    custom_key: string | null;
  }>(
    `SELECT z.id, z.title, z.custom_key, p.parent_id FROM zettels z JOIN card_parents p ON p.card_id = z.id ORDER BY z.title, z.id`,
  );
  const children = new Map<string, string[]>();
  for (const row of rows)
    if (row.parent_id) {
      const siblings = children.get(row.parent_id) || [];
      siblings.push(row.id);
      children.set(row.parent_id, siblings);
    }
  const excluded = new Set<string>();
  const pending = id ? [id] : [];
  while (pending.length) {
    const next = pending.pop()!;
    if (excluded.has(next)) continue;
    excluded.add(next);
    pending.push(...(children.get(next) || []));
  }
  const search = query.trim().toLowerCase();
  return rows
    .filter(
      (row) =>
        !excluded.has(row.id) &&
        `${row.id} ${row.custom_key ?? ""} ${row.title}`
          .toLowerCase()
          .includes(search),
    )
    .slice(0, 100)
    .map((row) => ({ id: row.id, title: row.title }));
}
