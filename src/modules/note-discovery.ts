import { getAll, getOne } from "./db";
import { getParentExclusions } from "./hierarchy";
import { flushSearchIndex, searchRows } from "./search";
import { getOwnNoteTags, getTaggedNoteIDs, visibleNoteTags } from "./note-tags";
import { noteSnippet } from "./markdown";
import { searchQueryTerms } from "./search-query";

export interface NoteDiscoveryContext {
  title?: string;
  body?: string;
  paragraph?: string;
  noteID?: number;
  tags?: string[];
}

const STOP_WORDS = new Set(
  "the and for with from this that these those into are was were has have not can will how why our their about using used also than then 一个 这个 这些 我们 可以 进行 通过 以及 因为 所以 但是".split(
    " ",
  ),
);

/** Whole Latin words and Chinese bigrams share the existing local search index. */
function words(text: string): string[] {
  const clean = text
    .toLowerCase()
    .replace(/```[\s\S]*?```|https?:\/\/\S+|<[^>]*>|\[\[[^\]]*\]\]/g, " ");
  return [...clean.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}]{3,}/gu)]
    .flatMap(([word]) =>
      /^\p{Script=Han}+$/u.test(word)
        ? Array.from(word)
            .slice(1)
            .map((_, i) =>
              Array.from(word)
                .slice(i, i + 2)
                .join(""),
            )
        : [word],
    )
    .filter((word) => word.length <= 64 && !STOP_WORDS.has(word));
}

export async function findNoteCandidates(
  id: string | null,
  query = "",
  context: NoteDiscoveryContext = {},
  parent = false,
  cursor: string | null = null,
) {
  const stored = id
    ? await getOne<{
        title: string;
        body: string;
        library_id: number | null;
        note_key: string | null;
      }>(
        "SELECT z.title, z.body, n.library_id, n.note_key FROM zettels z LEFT JOIN card_notes n ON n.card_id = z.id WHERE z.id = ?",
        [id],
      )
    : null;
  const weights = new Map<string, number>();
  for (const [text, weight] of [
    [context.title ?? stored?.title ?? "", 3],
    [context.paragraph || "", 5],
    [(context.body ?? stored?.body ?? "").slice(0, 12000), 1],
  ] as const)
    for (const word of new Set(words(text)))
      weights.set(word, (weights.get(word) || 0) + weight);
  const terms = [...weights]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([term]) => term);
  const excluded = new Set(
    parent ? await getParentExclusions(id) : id ? [id] : [],
  );
  const ids = new Set<string>();
  const searchRanks = new Map<string, number>();
  let nextCursor: string | null = null;
  const related = new Map<string, number>();
  const tagMatches = new Map<string, number>();
  const add = (candidate: string) => {
    if (!excluded.has(candidate) && ids.size < 180) ids.add(candidate);
  };
  if (query.trim()) {
    const page = await searchRows(query, {
      summary: true,
      limit: 30,
      sort: "title-asc",
      cursor,
      excludeIDs: [...excluded],
    });
    nextCursor = page.cursor;
    for (const [index, row] of page.rows.entries()) {
      add(row.id);
      searchRanks.set(row.id, index);
    }
  } else {
    // Structural neighbors are bounded seeds, not evidence of a parent relationship.
    if (id) {
      const neighbors = await getAll<{ id: string }>(
        `SELECT target_id AS id FROM links WHERE source_id = ? AND target_id IS NOT NULL
         UNION SELECT source_id AS id FROM links WHERE target_id = ?
         UNION SELECT parent_id AS id FROM card_parents WHERE card_id = ? AND parent_id IS NOT NULL
         UNION SELECT p.parent_id AS id FROM links l JOIN card_parents p ON p.card_id = l.target_id
           WHERE l.source_id = ? AND p.parent_id IS NOT NULL LIMIT 30`,
        [id, id, id, id],
      );
      for (const row of neighbors) {
        add(row.id);
        related.set(row.id, 1);
      }
    }
    if (terms.length) {
      await flushSearchIndex();
      const grams = [
        ...new Set(
          terms.flatMap((term) =>
            Array.from(term)
              .slice(1)
              .map((_, i) =>
                Array.from(term)
                  .slice(i, i + 2)
                  .join(""),
              ),
          ),
        ),
      ];
      const matches = await getAll<{ id: string }>(
        `WITH frequencies AS (
           SELECT term, COUNT(*) AS n FROM search_terms WHERE term IN (SELECT value FROM json_each(?)) GROUP BY term
         ) SELECT s.card_id AS id FROM search_terms s JOIN frequencies f ON f.term = s.term
         WHERE s.card_id NOT IN (SELECT value FROM json_each(?))
           AND NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = s.card_id)
         GROUP BY s.card_id ORDER BY SUM(1.0 / f.n) DESC, s.card_id LIMIT 100`,
        [JSON.stringify(grams), JSON.stringify([...excluded])],
      );
      matches.forEach((row) => add(row.id));
    }
    const ownNote =
      !context.noteID && stored?.library_id && stored.note_key
        ? await Zotero.Items.getByLibraryAndKeyAsync(
            stored.library_id,
            stored.note_key,
          )
        : null;
    const tags = visibleNoteTags(
      [
        ...new Set([
          ...(await getOwnNoteTags(
            context.noteID || (ownNote && ownNote.id) || null,
            id || undefined,
          )),
          ...(context.tags || []),
        ]),
      ],
      stored?.library_id,
    ).slice(0, 6);
    for (const tag of tags) {
      const matches = await getTaggedNoteIDs(tag, true);
      for (const candidate of matches) {
        if (ids.has(candidate) || tagMatches.size < 80) {
          add(candidate);
          tagMatches.set(candidate, (tagMatches.get(candidate) || 0) + 1);
        }
      }
    }
    if (!ids.size) {
      for (const row of (await searchRows("", { summary: true, limit: 30 }))
        .rows)
        add(row.id);
    }
  }
  if (!ids.size) return { items: [], cursor: null };
  const highlights = query.trim() ? searchQueryTerms(query) : terms;
  const rows = await getAll<{
    id: string;
    title: string;
    body: string;
    parent_title: string | null;
    children: number;
  }>(
    `SELECT z.id, z.title,
      SUBSTR(z.body, MAX(1, COALESCE((SELECT MIN(NULLIF(INSTR(LOWER(z.body), value), 0)) FROM json_each(?)), 1) - 180), 4096) AS body,
      parent.title AS parent_title,
      (SELECT COUNT(*) FROM card_parents child WHERE child.parent_id = z.id) AS children
    FROM zettels z LEFT JOIN card_parents p ON p.card_id = z.id
    LEFT JOIN zettels parent ON parent.id = p.parent_id
      AND NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = parent.id)
    WHERE z.id IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id)`,
    [JSON.stringify(highlights), JSON.stringify([...ids])],
  );
  const frequencies = new Map(
    terms.map((term) => [
      term,
      rows.filter((row) =>
        `${row.title} ${row.body}`.toLowerCase().includes(term),
      ).length,
    ]),
  );
  const items = rows
    .map((row) => {
      const title = row.title.toLowerCase(),
        body = row.body.toLowerCase();
      const contentScore = terms.reduce(
        (sum, term) =>
          sum +
          (((title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0)) *
            (weights.get(term) || 1)) /
            Math.sqrt(frequencies.get(term) || 1),
        0,
      );
      const queryScore = highlights.reduce(
        (sum, term) =>
          sum + (title.includes(term) ? 6 : 0) + (body.includes(term) ? 1 : 0),
        0,
      );
      return {
        id: row.id,
        title: row.title,
        parentTitle: row.parent_title,
        snippet: noteSnippet(
          row.body,
          highlights.map((term) => `"${term}"`).join(" "),
        ),
        matches: highlights,
        score:
          contentScore +
          (query.trim() ? queryScore * 10 : 0) +
          Math.min(tagMatches.get(row.id) || 0, 3) * 2 +
          (related.get(row.id) || 0) * 2 +
          (parent && row.children && contentScore > 0 ? 2 : 0),
      };
    })
    .filter((row) => query.trim() || !terms.length || row.score > 0)
    .sort(
      (a, b) =>
        (searchRanks.get(a.id) || 0) - (searchRanks.get(b.id) || 0) ||
        b.score - a.score ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, query.trim() ? 30 : 12)
    .map(({ score: _score, ...row }) => row);
  return { items, cursor: nextCursor };
}
