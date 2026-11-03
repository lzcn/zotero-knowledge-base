// Naming boundaries are used for matching, never to rename stored labels.
var SWTagPolicy = {
  words(name) {
    return String(name)
      .normalize("NFKC")
      .trim()
      .replace(/^#+\s*/u, "")
      .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Nd})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, "$1 $2")
      .split(/[\s_\p{Pd}−]+/u)
      .filter(Boolean);
  },

  key(name) {
    return SWTagPolicy.words(name).join(" ").toLowerCase();
  },

  excludedKeys(value) {
    return new Set(
      String(value || "")
        .split(/[,，\r\n]+/u)
        .map(SWTagPolicy.key)
        .filter(Boolean),
    );
  },

  visible(names, excluded) {
    return names.filter((name) => !excluded.has(SWTagPolicy.key(name)));
  },
};

if (typeof module !== "undefined") module.exports = { SWTagPolicy };
