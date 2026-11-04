import { swTermFreq } from "../library/tokenizer.js";
import type { GraphGroup } from "./preferences";

// Graph colors are presentation only; native Zotero tag colors stay untouched.
const PALETTE = [
  "#3478f6",
  "#16a085",
  "#a855f7",
  "#ed8936",
  "#089fbd",
  "#e05278",
  "#b49a16",
  "#7060e8",
  "#42a64b",
  "#cf52af",
];
const key = (tag: string) => tag.normalize("NFKC").toLocaleLowerCase("en-US");
export function graphTagColor(tag: string): string {
  let hash = 2166136261;
  for (const char of key(tag))
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return PALETTE[(hash >>> 0) % PALETTE.length];
}

/** One vocabulary per graph; no persistent index or model inference. */
export function graphColorSelector(groups: GraphGroup[]) {
  const terms = new Map<
    string,
    { vector: Map<string, number>; norm: number; key: string }
  >();
  const configured = new Map(groups.map((group) => [group.tag, group.color]));
  return (tags: string[], title: string, body: string) => {
    const preferred = tags.filter((tag) => configured.has(tag));
    const candidates = [...new Set(preferred.length ? preferred : tags)];
    if (!candidates.length) return {};
    if (candidates.length === 1) {
      const tag = candidates[0];
      return { color: configured.get(tag) || graphTagColor(tag), group: tag };
    }
    const frequencies = (text: string): Map<string, number> =>
      swTermFreq(text.replace(/<[^>]*>/g, " "));
    const query = frequencies(body);
    for (const [term, count] of frequencies(title))
      query.set(term, (query.get(term) || 0) + count * 4);
    // Query magnitude is shared by all candidates, so omit it from cosine.
    let tag = candidates[0],
      best = -Infinity,
      bestKey = "";
    for (const candidate of candidates) {
      let cached = terms.get(candidate);
      if (!cached) {
        const vector = frequencies(candidate);
        const norm = Math.sqrt(
          [...vector.values()].reduce((sum, count) => sum + count * count, 0),
        );
        terms.set(candidate, (cached = { vector, norm, key: key(candidate) }));
      }
      let dot = 0;
      for (const [term, count] of cached.vector)
        dot += count * (query.get(term) || 0);
      const score = cached.norm ? dot / cached.norm : 0;
      if (
        score > best ||
        (score === best &&
          (cached.key < bestKey || (cached.key === bestKey && candidate < tag)))
      ) {
        tag = candidate;
        best = score;
        bestKey = cached.key;
      }
    }
    return { color: configured.get(tag) || graphTagColor(tag), group: tag };
  };
}
