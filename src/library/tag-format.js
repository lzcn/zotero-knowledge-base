/* global SWTagTerms */
// Spelling protection is independent of fuzzy tag matching and never expands aliases.
var SWTagFormat = {
  structured(name) {
    // Namespaces, paths and repeated hashes have meaning beyond capitalization.
    return /[:/\\_]|^\s*#{2}/u.test(name);
  },

  format(name, { style, hashtag }) {
    if (!["sentence", "title"].includes(style) || typeof hashtag !== "boolean")
      throw new Error("similar-works-tags-invalid-format");
    if (this.structured(name)) return name;
    const body = name.trim().replace(/^#\s*/u, "").replace(/\s+/gu, " ");
    let first = true;
    const words = new RegExp(
      (SWTagTerms.phrasePattern
        ? "\\b(?:" + SWTagTerms.phrasePattern + ")\\b|"
        : "") + "[\\p{L}\\p{M}\\p{N}]+(?:['’][\\p{L}\\p{M}]+)?[+#]*",
      "giu",
    );
    const text = body.replace(words, (word) => {
      const capitalize = style === "title" || first;
      first = false;
      if (word.includes(" "))
        return SWTagTerms.spellings.get(word.toLowerCase());
      const spelling = SWTagTerms.spellings.get(word.toLowerCase());
      if (spelling && word === word.toLowerCase()) return spelling;
      // Preserve unknown mixed-case names, acronyms, numbers, symbols and
      // non-English scripts. No case folding is used to identify these.
      if (
        !/^[A-Za-z]+(?:['’][A-Za-z]+)?$/u.test(word) ||
        (word.length === 1 && word.toLowerCase() !== "a") ||
        /[a-z].*[A-Z]|[A-Z]{2}/u.test(word)
      )
        return word;
      if (spelling) return spelling;
      const lower = word.toLowerCase();
      return capitalize ? lower[0].toUpperCase() + lower.slice(1) : lower;
    });
    return text ? (hashtag ? "#" : "") + text : name;
  },
};

if (typeof module !== "undefined") module.exports = { SWTagFormat };
