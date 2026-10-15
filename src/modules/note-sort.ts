const NOTE_SORTS = {
  "updated-desc": ["updated_at", "DESC"],
  "updated-asc": ["updated_at", "ASC"],
  "created-desc": ["created_at", "DESC"],
  "created-asc": ["created_at", "ASC"],
  "title-asc": ["title_folded", "ASC"],
  "title-desc": ["title_folded", "DESC"],
} as const;

export type NoteSort = keyof typeof NOTE_SORTS;

export function noteSortOrder(value: string) {
  if (!Object.hasOwn(NOTE_SORTS, value)) throw new Error("Invalid note sort");
  return NOTE_SORTS[value as NoteSort];
}

interface NoteSummary {
  id: string;
  title: string;
  updated_at: number;
  created_at: number;
  searchRank?: number;
}

// SQLite orders folded titles by Unicode code point, including supplementary characters.
function compareText(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!);
  const right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export function compareNoteSummaries(
  a: NoteSummary,
  b: NoteSummary,
  sort: NoteSort,
): number {
  const [field, direction] = noteSortOrder(sort);
  const rank = (a.searchRank ?? 0) - (b.searchRank ?? 0);
  const value =
    field === "title_folded"
      ? compareText(a.title.toLowerCase(), b.title.toLowerCase())
      : (a[field] ?? 0) - (b[field] ?? 0);
  return (
    rank || (direction === "ASC" ? 1 : -1) * (value || compareText(a.id, b.id))
  );
}
