/** Spaces join keywords; double quotes keep a phrase together. */
export function searchQueryTerms(query: string): string[] {
  const result = [...query.matchAll(/"([^"]+)"|(\S+)/gu)].map((match) =>
    (match[1] ?? match[2]).toLowerCase(),
  );
  const unique = [...new Set(result)];
  if (unique.length > 16 || query.length > 2048)
    throw new Error("SEARCH_QUERY_TOO_LONG");
  return unique;
}
