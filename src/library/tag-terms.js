// Curated spellings and explicit equivalences have one inspectable source.
var SWTagTerms = {
  spellings: new Map(),
  aliases: new Map(),
  pattern: null,
  phrasePattern: "",

  async load(rootURI) {
    this.set(
      JSON.parse(
        await Zotero.File.getResourceAsync(rootURI + "tag-terms.json"),
      ),
    );
  },

  set(data) {
    if (
      !Array.isArray(data?.spellings) ||
      !Array.isArray(data?.aliases) ||
      data.spellings.some(
        (name) =>
          typeof name !== "string" || !name.trim() || name !== name.trim(),
      ) ||
      data.aliases.some(
        (entry) =>
          !entry ||
          typeof entry.name !== "string" ||
          !entry.name.trim() ||
          !Array.isArray(entry.forms) ||
          entry.forms.some((name) => typeof name !== "string" || !name.trim()),
      )
    )
      throw new Error("Invalid tag term catalog");
    const spellings = new Map(),
      aliases = new Map();
    for (const name of data.spellings) {
      const key = name.toLowerCase();
      if (spellings.has(key)) throw new Error("Duplicate tag spelling: " + key);
      spellings.set(key, name);
    }
    for (const entry of data.aliases)
      for (const name of [entry.name, ...entry.forms]) {
        const key = name.toLowerCase();
        if (aliases.has(key) && aliases.get(key) !== entry.name)
          throw new Error("Conflicting tag alias: " + key);
        aliases.set(key, entry.name);
      }
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    this.phrasePattern = [...spellings.keys()]
      .filter((name) => name.includes(" "))
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join("|");
    this.spellings = spellings;
    this.aliases = aliases;
    this.pattern = aliases.size
      ? new RegExp(
          "\\b(?:" +
            [...aliases.keys()]
              .sort((a, b) => b.length - a.length)
              .map(escape)
              .join("|") +
            ")\\b",
          "g",
        )
      : null;
  },

  aliasKey(key) {
    return this.pattern
      ? key.replace(this.pattern, (name) => this.aliases.get(name))
      : key;
  },
};
if (typeof module !== "undefined") module.exports = { SWTagTerms };
