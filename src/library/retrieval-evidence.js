/** Locate shared vocabulary in actual text; never generate a research claim. */
var SWEvidence = {
  async compareItems(current, candidate, active = () => true) {
    const fields = async (item) => {
      const resolved = await SWIndexer.resolveDocItem(item);
      if (!resolved || !active()) return [];
      return [
        { field: "title", text: resolved.getField("title") },
        { field: "abstract", text: resolved.getField("abstractNote") },
        { field: "text", text: await SWIndexer.tagText(resolved, active) },
      ];
    };
    if (!active()) return null;
    const left = await fields(current);
    if (!active()) return null;
    const right = await fields(candidate);
    return active() ? this.compare(left, right) : null;
  },
  terms(text) {
    const result = new Map();
    for (const match of String(text).matchAll(
      /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu,
    )) {
      const word = match[0];
      for (const stem of SWTokenizer.termFreq(word).keys()) {
        if (
          stem.length < 3 &&
          !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
            stem,
          )
        )
          continue;
        if (!result.has(stem)) result.set(stem, word.length > 28 ? stem : word);
      }
      if (result.size >= 128) break;
    }
    return result;
  },
  excerpt(fields, shared) {
    let best = { field: "", text: "", score: 0 };
    for (const field of fields) {
      for (const text of String(field.text || "").split(
        /(?<=[.!?])\s+|(?<=[。！？])|\n+/u,
      )) {
        const tokens = this.terms(text);
        const score = [...shared].filter((key) => tokens.has(key)).length;
        if (score > best.score)
          best = { field: field.field, text: text.trim(), score };
      }
    }
    return {
      field: best.field,
      text: best.text.slice(0, 520) + (best.text.length > 520 ? "…" : ""),
    };
  },
  compare(left, right) {
    const a = this.terms(left.map((field) => field.text || "").join("\n"));
    const b = this.terms(right.map((field) => field.text || "").join("\n"));
    const shared = new Set([...a.keys()].filter((key) => b.has(key)));
    return {
      terms: [...shared].slice(0, 8).map((key) => a.get(key)),
      current: this.excerpt(left, shared),
      match: this.excerpt(right, shared),
    };
  },
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { SWEvidence };
