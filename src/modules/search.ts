import { exec, getAll, transaction, type NoteKind, type ZettelRow } from "./db";

function terms(text: string): Set<string> {
  const chars = Array.from(text.toLowerCase());
  const tokens = new Set<string>();
  for (let i = 1; i < chars.length; i++) tokens.add(chars[i - 1] + chars[i]);
  return tokens;
}

let indexing: Promise<void> | undefined;
async function flushSearchIndex(): Promise<void> {
  if (indexing) return indexing;
  indexing = (async () => {
    while (true) {
      const count = await transaction(async () => {
        const dirty = await getAll<ZettelRow>(
          "SELECT z.* FROM zettels z JOIN search_dirty d ON d.card_id = z.id LIMIT 50",
        );
        for (const row of dirty) {
          const desired = new Set(
            [row.title, row.body, row.id, row.custom_key ?? ""].flatMap(
              (text) => [...terms(text)],
            ),
          );
          const previous = new Set(
            (
              await getAll<{ term: string }>(
                "SELECT term FROM search_terms WHERE card_id = ?",
                [row.id],
              )
            ).map((term) => term.term),
          );
          const removed = [...previous].filter((term) => !desired.has(term));
          for (let i = 0; i < removed.length; i += 200) {
            const batch = removed.slice(i, i + 200);
            await exec(
              `DELETE FROM search_terms WHERE card_id = ? AND term IN (${batch.map(() => "?").join(",")})`,
              [row.id, ...batch],
            );
          }
          const added = [...desired].filter((term) => !previous.has(term));
          for (let i = 0; i < added.length; i += 200) {
            const batch = added.slice(i, i + 200);
            await exec(
              `INSERT INTO search_terms(term, card_id) VALUES ${batch.map(() => "(?, ?)").join(",")}`,
              batch.flatMap((term) => [term, row.id]),
            );
          }
          await exec(
            "INSERT OR REPLACE INTO search_documents(card_id, title, body, custom_key) VALUES (?, ?, ?, ?)",
            [
              row.id,
              row.title.toLowerCase(),
              row.body.toLowerCase(),
              (row.custom_key ?? "").toLowerCase(),
            ],
          );
          await exec("DELETE FROM search_dirty WHERE card_id = ?", [row.id]);
        }
        return dirty.length;
      });
      if (!count) return;
    }
  })().finally(() => {
    indexing = undefined;
  });
  return indexing;
}

export interface SearchOptions {
  availability?: "active" | "deleted";
  entriesOnly?: boolean;
  kind?: NoteKind;
  limit?: number;
  cursor?: string | null;
  summary?: boolean;
  cardIDs?: string[];
}

interface Cursor {
  scope: string;
  rank: number;
  updated: number;
  id: string;
}

/** Literal substring search, ranked by title/key relevance, with keyset pagination. */
export async function searchRows(query = "", options: SearchOptions = {}) {
  const q = query.trim();
  if (
    options.kind &&
    !["literature", "zettel", "thinking"].includes(options.kind)
  )
    throw new Error("Invalid note type");
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Invalid search page size");
  if (
    options.cardIDs &&
    (options.cardIDs.length > 500 ||
      options.cardIDs.some((id) => typeof id !== "string" || !id))
  )
    throw new Error("Invalid note IDs");
  const scope = JSON.stringify([
    q,
    !!options.entriesOnly,
    options.kind ?? null,
    options.availability ?? null,
    options.cardIDs ?? null,
  ]);
  let cursor: Cursor | undefined;
  if (options.cursor) {
    cursor = JSON.parse(options.cursor);
    if (
      !cursor ||
      cursor.scope !== scope ||
      typeof cursor.id !== "string" ||
      !Number.isFinite(cursor.rank) ||
      !Number.isSafeInteger(cursor.updated)
    )
      throw new Error("Invalid search cursor");
  }
  const indexed = Array.from(q).length >= 2;
  if (indexed) await flushSearchIndex();
  const rank = q
    ? "CASE WHEN z.id = ? OR z.custom_key = ? THEN 0 WHEN INSTR(z.title_folded, ?) > 0 THEN 1 ELSE 2 END"
    : "0";
  const filters: string[] = [];
  const params: unknown[] = q ? [q, q, q.toLowerCase()] : [];
  if (indexed) {
    const grams = [...terms(q)].slice(0, 64);
    filters.push(
      `z.id IN (SELECT card_id FROM search_terms WHERE term IN (${grams.map(() => "?").join(",")}) GROUP BY card_id HAVING COUNT(*) = ?)`,
    );
    params.push(...grams, grams.length);
    filters.push(
      "(INSTR(d.title, ?) > 0 OR INSTR(d.body, ?) > 0 OR INSTR(LOWER(z.id), ?) > 0 OR INSTR(d.custom_key, ?) > 0)",
    );
    params.push(
      q.toLowerCase(),
      q.toLowerCase(),
      q.toLowerCase(),
      q.toLowerCase(),
    );
  } else if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    filters.push(
      "(z.title LIKE ? ESCAPE '\\' OR z.body LIKE ? ESCAPE '\\' OR z.id LIKE ? ESCAPE '\\' OR z.custom_key LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like);
  }
  if (options.kind) {
    filters.push("z.kind = ?");
    params.push(options.kind);
  }
  if (options.entriesOnly)
    filters.push(
      "z.id IN (SELECT card_id FROM card_parents WHERE parent_id IS NULL)",
    );
  if (options.cardIDs) {
    filters.push(
      `z.id IN (${options.cardIDs.map(() => "?").join(",") || "NULL"})`,
    );
    params.push(...options.cardIDs);
  }
  if (options.availability) {
    if (!["active", "deleted"].includes(options.availability))
      throw new Error("Invalid note availability");
    filters.push(
      `${options.availability === "active" ? "NOT " : ""}EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id)`,
    );
  }
  const projection = options.summary
    ? "id, title, title_folded, SUBSTR(body, 1, 2048) AS body, item_key, library_id, annotation_key, kind, custom_key, created_at, updated_at, search_rank"
    : "*";
  const continuation = cursor
    ? "WHERE (search_rank > ? OR (search_rank = ? AND (updated_at < ? OR (updated_at = ? AND id < ?))))"
    : "";
  if (cursor) {
    params.push(
      cursor.rank,
      cursor.rank,
      cursor.updated,
      cursor.updated,
      cursor.id,
    );
  }
  params.push(limit + 1);
  const rows = await getAll<ZettelRow & { search_rank: number }>(
    `WITH candidates AS (SELECT z.*, ${rank} AS search_rank FROM zettels z
     ${indexed ? "JOIN search_documents d ON d.card_id = z.id" : ""}
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""})
     SELECT ${projection} FROM candidates ${continuation}
     ORDER BY search_rank ASC, updated_at DESC, id DESC LIMIT ?`,
    params,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    cursor:
      rows.length > limit && last
        ? JSON.stringify({
            scope,
            rank: last.search_rank,
            updated: last.updated_at,
            id: last.id,
          } satisfies Cursor)
        : null,
  };
}
