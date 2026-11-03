// Recommend a small set of topics grounded in the current title and abstract.
var SWTagSuggestions = {
  text(value) {
    return swTagAliasKey(swTagKey(String(value || "").replace(/<[^>]*>/g, " ")))
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
      .trim();
  },

  isSpecific(name, normalized = this.text(name)) {
    if (
      /\b(?:et al|references|bibliography)\b|^(?:via|using|based on|towards?)\b|\b(?:generative|discrete|continuous|unsupervised|supervised|neural|independent|conditional)$/i.test(
        normalized,
      )
    )
      return false;
    const words = normalized.split(" ").filter(Boolean);
    if (words.length === 1) {
      if (
        /^(?:learning|networks?|models?|optimization|representation|analysis|systems?|frameworks?|methods?|algorithms?|approach(?:es)?|performance|results?|research)$/.test(
          words[0],
        )
      )
        return false;
      if (/^#?C(?:\+\+|#)$/.test(String(name))) return true;
      if (/\p{Script=Han}/u.test(words[0]))
        return (
          words[0].length >= 4 &&
          !/^(研究方法|实验结果|性能提升|相关研究)$/.test(words[0])
        );
      return (
        /^[A-Z][A-Z0-9]{1,9}$/.test(String(name).replace(/^#/, "")) &&
        !/^(AI|ML|DL|LLMS?)$/.test(String(name).replace(/^#/, ""))
      );
    }
    const generic =
      /^(?:proposed|novel|new|effective|efficient|improved?|approach(?:es)?|methods?|frameworks?|results?|research|study|studies|papers?|performance|improvements?|solutions?|experiments?|problems?)$/;
    return (
      words.filter(
        (word) =>
          word.length > 1 &&
          !SWTokenizer.isStopword(word) &&
          !generic.test(word),
      ).length >= 2
    );
  },

  occurrences(text, phrase) {
    if (!phrase) return 0;
    const needle = " " + phrase + " ";
    let count = 0,
      from = 0;
    while ((from = text.indexOf(needle, from)) !== -1) {
      count++;
      from += needle.length - 1;
    }
    return count;
  },

  phrases(title, abstract) {
    if (!abstract.trim()) return [];
    const text = " " + this.text(abstract) + " ";
    const found = new Map();
    // Keep complete title segments, never sliding n-grams or PDF prose.
    for (const run of title.match(
      /[\p{L}][\p{L}\p{N}+#-]*(?: +[\p{L}][\p{L}\p{N}+#-]*)*/gu,
    ) || []) {
      let group = [];
      const add = () => {
        const name = group.join(" "),
          key = this.text(name);
        if (
          group.length >= 2 &&
          group.length <= 4 &&
          name.length <= 64 &&
          this.isSpecific(name, key) &&
          this.occurrences(text, key)
        )
          found.set(key, name);
        group = [];
      };
      for (const word of [...run.split(/ +/), ""]) {
        if (
          word &&
          !SWTokenizer.isStopword(word.toLowerCase()) &&
          !/^(?:via|using|towards?|based|novel|new|proposed|efficient|effective|paper|study|results?|methods?|approach|show|demonstrate|experiments?|solving)$/i.test(
            word,
          )
        )
          group.push(word);
        else add();
      }
    }
    return [...found.values()];
  },

  async rank(target, rows, names, active = () => true) {
    const title = String(target.getField?.("title") || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 12000);
    const abstract = String(target.getField?.("abstractNote") || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 12000);
    const texts = [title, abstract].map((text) => " " + this.text(text) + " ");
    const catalog = new Map();
    for (const name of names)
      if (!catalog.has(this.text(name))) catalog.set(this.text(name), name);
    const excluded = new Set(
      [
        ...SWTags.protectedKeys(target.libraryID),
        ...(target.getTags?.() || []).map((t) => t.tag),
      ].map((name) => this.text(name)),
    );
    const votes = new Map(
      SWTags.recommend(target, rows.slice(0, 12), Infinity).map((tag) => [
        this.text(tag.name),
        tag,
      ]),
    );
    const pool = new Map(catalog);
    for (const name of this.phrases(title, abstract))
      if (!pool.has(this.text(name))) pool.set(this.text(name), name);
    for (const [key, vote] of votes)
      if (!pool.has(key)) pool.set(key, vote.name);
    const voteMax = Math.max(1, ...[...votes.values()].map((tag) => tag.score));
    const candidates = [];
    let visited = 0;
    for (const [key, name] of pool) {
      if (++visited % 128 === 0) {
        await swYield(0);
        if (SWTags._stopped || !active()) return [];
      }
      if (!key || excluded.has(key) || !this.isSpecific(name, key)) continue;
      const [inTitle, inAbstract] = texts.map((text) =>
        this.occurrences(text, key),
      );
      const vote = votes.get(key),
        isNew = !catalog.has(key) && !vote;
      // New names need two metadata fields. Known library topics still require
      // evidence in this paper, regardless of how many neighbors use them.
      if (isNew ? !inTitle || !inAbstract : !inTitle && !inAbstract) continue;
      const direct = inTitle
        ? 1
        : 0.84 + Math.min(0.04, (inAbstract - 1) * 0.02);
      candidates.push({
        name,
        isNew,
        count: vote?.count || 0,
        score: direct + (0.03 * (vote?.score || 0)) / voteMax,
      });
    }
    return candidates
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.count - a.count ||
          b.name.length - a.name.length ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 24);
  },

  select(candidates) {
    const ranked = [...candidates].sort(
      (a, b) =>
        b.score - a.score ||
        (b.count || 0) - (a.count || 0) ||
        b.name.length - a.name.length ||
        a.name.localeCompare(b.name),
    );
    if (!ranked.length) return [];
    const floor = Math.max(0.84, ranked[0].score * 0.9),
      selected = [];
    for (const tag of ranked) {
      if (tag.score < floor) break;
      const key = " " + this.text(tag.name) + " ";
      if (
        selected.some((other) => {
          const existing = " " + this.text(other.name) + " ";
          return (
            key.includes(existing) ||
            existing.includes(key) ||
            SWTags.duplicateReason(tag.name, other.name)
          );
        })
      )
        continue;
      selected.push(tag);
      if (selected.length === 6) break;
    }
    return selected;
  },

  async suggest(target, rows, active) {
    const names = await SWTags.catalog(target.libraryID);
    if (SWTags._stopped || !active()) return [];
    // Tag suggestions never read a PDF or wait for the document index.
    let candidates = await this.rank(target, rows, names, active);
    if (
      typeof SWSemantic !== "undefined" &&
      SWSemantic._enabled &&
      typeof SWSemantic.tagSimilarity === "function"
    ) {
      try {
        const scores = await SWSemantic.tagSimilarity(
          target,
          candidates.map((tag) => tag.name),
          active,
        );
        if (scores)
          candidates.forEach((tag, i) => {
            if (Number.isFinite(scores[i]))
              tag.score += 0.03 * Math.max(0, scores[i]);
          });
      } catch (error) {
        if (active() && !SWTags._stopped) Zotero.logError(error);
      }
    }
    if (SWTags._stopped || !active()) return [];
    const protectedKeys = new Set(
      [...SWTags.protectedKeys(target.libraryID)].map((key) => this.text(key)),
    );
    candidates = candidates
      .map((tag) =>
        tag.isNew ? { ...tag, name: SWTags.formatName(tag.name) } : tag,
      )
      .filter((tag) => !protectedKeys.has(this.text(tag.name)));
    return this.select(candidates);
  },
};
