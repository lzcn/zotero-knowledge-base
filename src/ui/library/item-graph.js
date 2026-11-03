import { SWSearch } from "../../library/search.js";

// A paper graph is intentionally stricter and sparser than a recommendation list.
const MINIMUM_TEXT = 0.35;
const MINIMUM_SEMANTIC = 0.75;
const CONNECTIONS = 3;

export async function buildItemGraph(
  documents,
  active = () => true,
  pause = async () => {},
) {
  const lexical = documents.map(() => []);
  const semantic = documents.map(() => []);
  let comparisons = 0;
  for (let i = 0; i < documents.length; i++) {
    const a = documents[i];
    for (let j = i + 1; j < documents.length; j++) {
      if (!active()) return null;
      const b = documents[j];
      if (a.key.split("/")[0] !== b.key.split("/")[0]) continue;
      const text =
        a.vector && b.vector ? SWSearch.Index.prototype.similarity(a, b) : 0;
      let dense = 0;
      if (a.semantic && b.semantic) {
        if (a.semantic.length !== b.semantic.length)
          throw new Error("Inconsistent item graph vector dimensions");
        for (let k = 0; k < a.semantic.length; k++)
          dense += a.semantic[k] * b.semantic[k];
      }
      if (!Number.isFinite(text) || !Number.isFinite(dense))
        throw new Error("Invalid item graph similarity");
      for (const [lists, score, minimum] of [
        [lexical, text, MINIMUM_TEXT],
        [semantic, dense, MINIMUM_SEMANTIC],
      ]) {
        if (score < minimum) continue;
        lists[i].push({ key: b.key, score: Math.min(1, score) });
        lists[j].push({ key: a.key, score: Math.min(1, score) });
      }
      if (++comparisons % 256 === 0) await pause();
    }
  }
  if (!active()) return null;
  const rank = (a, b) => b.score - a.score || a.key.localeCompare(b.key);
  const nearest = documents.map((doc, i) => {
    const rankings = [lexical[i].sort(rank)];
    if (doc.semantic) rankings.push(semantic[i].sort(rank));
    return SWSearch.fuse(rankings, CONNECTIONS);
  });
  const byKey = new Map(documents.map((doc, i) => [doc.key, i]));
  const edges = [];
  nearest.forEach((list, i) => {
    for (const peer of list) {
      const source = documents[i].key;
      if (
        source.localeCompare(peer.key) >= 0 ||
        !nearest[byKey.get(peer.key)].some((match) => match.key === source)
      )
        continue;
      edges.push({
        source: "item:" + source,
        target: "item:" + peer.key,
        kind: "similarity",
        ref: "",
        context: "",
        score: Math.max(peer.lexicalScore || 0, peer.semanticScore || 0),
      });
    }
  });
  return edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
}
