const STOP_WORDS = new Set(
  "a an and are as at be been being by can could did do does for from had has have how if in into is it its may more most not of on or our should than that the their these they this those to using was we were what when where which who will with would you your also such through between based each both one two used use study method results show shows paper".split(
    " ",
  ),
);

/** Words plus Han bigrams keep English and Chinese retrieval local and dependency-free. */
export function retrievalTokens(value: string): string[] {
  const tokens: string[] = [];
  for (const match of value
    .normalize("NFKC")
    .toLowerCase()
    .matchAll(/[a-z][a-z0-9-]+|[\p{Script=Han}]+/gu)) {
    const word = match[0];
    if (/^[a-z]/.test(word)) {
      if (!STOP_WORDS.has(word))
        tokens.push(
          word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word,
        );
    } else {
      const chars = Array.from(word);
      if (chars.length === 1) tokens.push(word);
      for (let i = 1; i < chars.length; i++)
        tokens.push(chars[i - 1] + chars[i]);
    }
  }
  return tokens;
}

/** Retain query matches, never full library bodies, while scanning a bounded DB page. */
export function createConnectionRetriever(
  title: string,
  body: string,
  queries: string[],
) {
  const weights = new Map<string, number>();
  const addQuery = (value: string, weight: number) => {
    for (const term of retrievalTokens(value))
      weights.set(term, Math.min(12, (weights.get(term) || 0) + weight));
  };
  addQuery(body, 1);
  addQuery(title, 4);
  for (const query of queries) addQuery(query, 4);
  const terms = [...weights]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 64);
  const frequency = terms.map(() => 0);
  const rows: {
    id: string;
    title: number[];
    body: number[];
    summary: number[];
    length: number;
  }[] = [];
  const matches = (text: string) => {
    const tokens = new Set(retrievalTokens(text));
    return {
      length: tokens.size,
      values: terms.flatMap(([term], index) =>
        tokens.has(term) ? [index] : [],
      ),
    };
  };
  return {
    add(id: string, noteTitle: string, noteBody: string, summary = "") {
      const title = matches(noteTitle),
        body = matches(noteBody),
        cached = matches(summary);
      for (const index of new Set([
        ...title.values,
        ...body.values,
        ...cached.values,
      ]))
        frequency[index]++;
      rows.push({
        id,
        title: title.values,
        body: body.values,
        summary: cached.values,
        length: body.length,
      });
    },
    candidates(): string[] {
      const score = (indices: number[]) =>
        indices.reduce(
          (total, index) =>
            total +
            Math.log(1 + (rows.length + 1) / (frequency[index] + 1)) *
              terms[index][1],
          0,
        );
      const lexical = rows
        .map((row) => ({
          id: row.id,
          score:
            score(row.body) / Math.sqrt(Math.max(1, Math.log2(row.length + 1))),
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, 12);
      const cached = rows
        .map((row) => ({ id: row.id, score: score(row.summary) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, 8);
      return [
        ...new Set(
          Array.from(
            { length: Math.max(lexical.length, cached.length) },
            (_, index) => [lexical[index]?.id, cached[index]?.id],
          )
            .flat()
            .filter((id): id is string => !!id),
        ),
      ];
    },
  };
}
