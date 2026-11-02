import { getTaggedNoteIDs } from "./note-tags";
import { noteSortOrder, type NoteSort } from "./note-sort";
import { getNoteReferences } from "./note-references";
import { exec, getAll, transaction, type ZettelRow } from "./db";
import { searchQueryTerms } from "./search-query";

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
  availability?: "active" | "trash";
  sort?: NoteSort;
  tag?: string;
  ownTagsOnly?: boolean;
  limit?: number;
  cursor?: string | null;
  summary?: boolean;
  cardIDs?: string[];
}

interface Cursor {
  scope: string;
  rank: number;
  value: number | string;
  id: string;
}

/** Keyword and quoted-phrase search with title/key ranking and keyset pagination. */
export async function searchRows(query = "", options: SearchOptions = {}) {
  const q = query.trim();
  const keywords = searchQueryTerms(q);
  const sort = options.sort ?? "updated-desc";
  const [sortField, sortDirection] = noteSortOrder(sort);
  const defaults =
    sortField === "reference" || q
      ? (await getNoteReferences()).defaults
      : new Map<string, string>();
  const comparison = sortDirection === "ASC" ? ">" : "<";
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
    options.tag ?? null,
    options.ownTagsOnly ?? false,
    options.availability ?? "active",
    options.cardIDs ?? null,
    sort,
  ]);
  let cursor: Cursor | undefined;
  if (options.cursor) {
    cursor = JSON.parse(options.cursor);
    if (
      !cursor ||
      cursor.scope !== scope ||
      typeof cursor.id !== "string" ||
      !Number.isSafeInteger(cursor.rank) ||
      (sortField === "title_folded" || sortField === "reference"
        ? typeof cursor.value !== "string"
        : !Number.isSafeInteger(cursor.value))
    )
      throw new Error("Invalid search cursor");
  }
  const indexed = keywords.some((term) => Array.from(term).length >= 2);
  if (indexed) await flushSearchIndex();
  const rank = q
    ? `CASE WHEN z.id = ? OR z.custom_key = ? ${defaults.size ? "OR i.reference = ?" : ""} THEN 0 WHEN INSTR(z.title_folded, ?) > 0 THEN 1 ELSE 2 END`
    : "0";
  const filters: string[] = [];
  const params: unknown[] = defaults.size
    ? [JSON.stringify(Object.fromEntries(defaults))]
    : [];
  if (q) params.push(q, q, ...(defaults.size ? [q] : []), q.toLowerCase());
  for (const keyword of keywords) {
    const parts: string[] = [];
    if (Array.from(keyword).length >= 2) {
      const grams = [...terms(keyword)].slice(0, keywords.length > 1 ? 24 : 64);
      parts.push(
        `z.id IN (SELECT card_id FROM search_terms WHERE term IN (${grams.map(() => "?").join(",")}) GROUP BY card_id HAVING COUNT(*) = ?)`,
      );
      params.push(...grams, grams.length);
      parts.push(
        "(INSTR(d.title, ?) > 0 OR INSTR(d.body, ?) > 0 OR INSTR(LOWER(z.id), ?) > 0 OR INSTR(d.custom_key, ?) > 0)",
      );
      params.push(keyword, keyword, keyword, keyword);
    } else {
      const like = `%${keyword.replace(/[\\%_]/g, "\\$&")}%`;
      parts.push(
        "(z.title LIKE ? ESCAPE '\\' OR z.body LIKE ? ESCAPE '\\' OR z.id LIKE ? ESCAPE '\\' OR z.custom_key LIKE ? ESCAPE '\\')",
      );
      params.push(like, like, like, like);
    }
    filters.push(
      `((${parts.join(" AND ")})${defaults.size ? " OR INSTR(LOWER(i.reference), ?) > 0" : ""})`,
    );
    if (defaults.size) params.push(keyword);
  }
  if (options.tag) {
    filters.push("z.id IN (SELECT value FROM json_each(?))");
    params.push(
      JSON.stringify(await getTaggedNoteIDs(options.tag, options.ownTagsOnly)),
    );
  }
  if (options.cardIDs) {
    filters.push(
      `z.id IN (${options.cardIDs.map(() => "?").join(",") || "NULL"})`,
    );
    params.push(...options.cardIDs);
  }
  const availability = options.availability ?? "active";
  if (!["active", "trash"].includes(availability))
    throw new Error("Invalid note availability");
  filters.push(
    `${availability === "active" ? "NOT " : ""}EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id${availability === "trash" ? " AND u.state = 'trashed'" : ""})`,
  );
  const excerptStart = keywords.length
    ? "MAX(1, COALESCE((SELECT MIN(NULLIF(INSTR(LOWER(body), value), 0)) FROM json_each(?)), 1) - 180)"
    : "1";
  if (options.summary && keywords.length) params.push(JSON.stringify(keywords));
  const projection = options.summary
    ? `id, title, title_folded, SUBSTR(body, ${excerptStart}, 2048) AS body, item_key, library_id, annotation_key, source_note, custom_key, created_at, updated_at, search_rank`
    : "*";
  const continuation = cursor
    ? `WHERE (search_rank > ? OR (search_rank = ? AND (sort_value ${comparison} ? OR (sort_value = ? AND id ${comparison} ?))))`
    : "";
  if (cursor) {
    params.push(
      cursor.rank,
      cursor.rank,
      cursor.value,
      cursor.value,
      cursor.id,
    );
  }
  params.push(limit + 1);
  const rows = await getAll<ZettelRow & { search_rank: number }>(
    `WITH ${defaults.size ? "default_ids AS MATERIALIZED (SELECT key AS id, value AS reference FROM json_each(?))," : ""} candidates AS (SELECT z.*, ${rank} AS search_rank, ${sortField === "reference" ? `COALESCE(z.custom_key, ${defaults.size ? "i.reference," : ""} z.id)` : `z.${sortField}`} AS sort_value FROM zettels z
     ${defaults.size ? "LEFT JOIN default_ids i ON i.id = z.id" : ""}
     ${indexed ? "JOIN search_documents d ON d.card_id = z.id" : ""}
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""})
     SELECT ${projection} FROM candidates ${continuation}
     ORDER BY search_rank ASC, sort_value ${sortDirection}, id ${sortDirection} LIMIT ?`,
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
            value:
              sortField === "reference"
                ? last.custom_key || defaults.get(last.id) || last.id
                : sortField === "title_folded"
                  ? last.title.toLowerCase()
                  : last[sortField],
            id: last.id,
          } satisfies Cursor)
        : null,
  };
}
