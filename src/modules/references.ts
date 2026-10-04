import { parseCitationKeys, type CitationReference } from "./markdown";
import { findCitationItems, type ItemSummary } from "./zotero";

const citations = new Map<string, CitationReference>();
const pending = new Map<string, Promise<ItemSummary | null>>();

export function getCitation(key: string): CitationReference | undefined {
  return citations.get(key);
}

export function resolveCitation(key: string): Promise<ItemSummary | null> {
  const existing = pending.get(key);
  if (existing) return existing;
  const task = findCitationItems(key)
    .then((items) => {
      const item = items.length === 1 ? items[0] : null;
      if (item)
        citations.set(key, {
          label: item.creatorYear || item.title || key,
          selectURL: item.selectURL,
        });
      else citations.delete(key);
      return item;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export async function prepareCitations(body: string): Promise<void> {
  await Promise.all(parseCitationKeys(body).map(resolveCitation));
}
