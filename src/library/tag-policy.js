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

  exclusions(value, coloredNames = []) {
    const rules = { keys: new Set(), patterns: [], colored: false };
    for (const token of String(value || "").split(/[,，\r\n]+/u)) {
      if (token.trim().toLowerCase() === "@colored") {
        rules.colored = true;
        continue;
      }
      const key = SWTagPolicy.key(token);
      if (!key) continue;
      if (key.includes("*")) {
        const pattern = key
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        rules.patterns.push(new RegExp("^" + pattern + "$", "u"));
      } else rules.keys.add(key);
    }
    if (rules.colored)
      for (const name of coloredNames) rules.keys.add(SWTagPolicy.key(name));
    return rules;
  },

  excludes(name, rules) {
    const key = SWTagPolicy.key(name);
    return (
      rules.keys.has(key) || rules.patterns.some((pattern) => pattern.test(key))
    );
  },

  visible(names, rules) {
    return names.filter((name) => !SWTagPolicy.excludes(name, rules));
  },
};

if (typeof module !== "undefined") module.exports = { SWTagPolicy };
