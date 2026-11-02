// Current-paper evidence admits topics; neighbors and MiniLM only rank them.
var SWTagSuggestions = {
  text(value) {
    return swTagAliasKey(swTagKey(String(value || "").replace(/<[^>]*>/g, " ")))
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
      .trim();
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

  phrases(title, abstract, body) {
    const found = new Map();
    const usable = (word) =>
      !SWTokenizer.isStopword(word.toLowerCase()) &&
      !/^(paper|study|results?|methods?|approach|proposed|using|based|novel|show|demonstrate|experiments?)$/i.test(
        word,
      );
    for (const [text, field] of [
      [title, "title"],
      [abstract, "abstract"],
      [body, "body"],
    ]) {
      for (const run of text.match(
        /[\p{L}][\p{L}\p{N}+#-]*(?: +[\p{L}][\p{L}\p{N}+#-]*)*/gu,
      ) || []) {
        let group = [];
        const addGroup = () => {
          for (let i = 0; i < group.length; i++) {
            const standalone =
              /^[A-Z][A-Z0-9]{1,9}$/.test(group[i]) ||
              /^[\p{Script=Han}]{2,10}$/u.test(group[i]);
            for (
              let n = standalone ? 1 : 2;
              n <= 4 && i + n <= group.length;
              n++
            ) {
              const name = group.slice(i, i + n).join(" ");
              if (name.length > 64) continue;
              const key = this.text(name);
              const old = found.get(key) || {
                name,
                title: 0,
                abstract: 0,
                body: 0,
                complete: false,
              };
              old[field]++;
              if (field === "title" && i === 0 && n === group.length)
                old.complete = true;
              found.set(key, old);
            }
          }
          group = [];
        };
        for (const word of [...run.split(/ +/), ""]) {
          if (word && usable(word)) group.push(word);
          else addGroup();
        }
      }
    }
    const candidates = [...found.values()].filter(
      (p) =>
        p.complete ||
        (p.title && p.abstract + p.body > 0) ||
        p.abstract >= 2 ||
        p.body >= 3,
    );
    // Prefer complete phrases over fragments with exactly the same evidence.
    return candidates
      .filter(
        (p) =>
          !candidates.some(
            (other) =>
              other !== p &&
              other.name.length > p.name.length &&
              (" " + this.text(other.name) + " ").includes(
                " " + this.text(p.name) + " ",
              ) &&
              other.title === p.title &&
              other.abstract === p.abstract &&
              other.body === p.body,
          ),
      )
      .sort(
        (a, b) =>
          Number(b.complete) - Number(a.complete) ||
          3 * b.title +
            b.abstract +
            Math.log1p(b.body) -
            (3 * a.title + a.abstract + Math.log1p(a.body)),
      )
      .slice(0, 48)
      .map((p) => p.name);
  },

  async rank(target, rows, names, body = "", active = () => true) {
    const title = String(target.getField?.("title") || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 12000);
    const abstract = String(target.getField?.("abstractNote") || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 12000);
    // References and repeating page furniture cannot establish a paper's topic.
    body = SWSearch.clean(
      body.split(
        /(?:^|\n)\s*(?:references|bibliography|参考文献)\s*(?:\n|$)/i,
      )[0],
    );
    const texts = [title, abstract, body].map(
      (text) => " " + this.text(text) + " ",
    );
    const passages = body
      .split(/[.!?。！？\n]+/)
      .filter((s) => s.trim())
      .map((s) => " " + this.text(s) + " ");
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
    for (const name of this.phrases(title, abstract, body))
      if (!pool.has(this.text(name))) pool.set(this.text(name), name);
    for (const [key, vote] of votes)
      if (!pool.has(key)) pool.set(key, vote.name);
    const index =
      typeof SWIndexer === "undefined" ? null : SWIndexer.corpus?.search;
    const indexed = index?.docs.get(SWIndexer.docKey(target));
    const bodyCounts = indexed
      ? SWSearch.decodeCounts(indexed.counts).fields?.[2]
      : null;
    const voteMax = Math.max(1, ...[...votes.values()].map((tag) => tag.score));
    const candidates = [];
    let visited = 0;
    for (const [key, name] of pool) {
      if (++visited % 128 === 0) {
        await swYield(0);
        if (SWTags._stopped || !active()) return [];
      }
      if (!key || excluded.has(key)) continue;
      const [inTitle, inAbstract, inBody] = texts.map((text) =>
        this.occurrences(text, key),
      );
      // A single background mention or a neighbor's application is insufficient.
      if (!inTitle && !inAbstract) {
        if (inBody < 3) continue;
        const spread = passages.filter((text) =>
          this.occurrences(text, key),
        ).length;
        if (spread < 2) continue;
        const features = [...SWSearch.features(SWSearch.clean(name))];
        const indexedFrequency =
          bodyCounts && features.length
            ? Math.min(...features.map((id) => bodyCounts.get(id) || 0))
            : inBody;
        if (indexedFrequency < 3) continue;
      }
      const direct = inTitle
        ? 0.94
        : inAbstract
          ? 0.7 + Math.min(0.1, (inAbstract - 1) * 0.05)
          : 0.7 + Math.min(0.14, (inBody - 1) * 0.04);
      const vote = votes.get(key);
      const score = direct + (0.04 * (vote?.score || 0)) / voteMax;
      candidates.push({
        name,
        isNew: !catalog.has(key) && !vote,
        count: vote?.count || 0,
        score,
      });
    }
    return candidates
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.name.length - a.name.length ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 48);
  },

  select(candidates) {
    if (!candidates.length) return [];
    const remaining = candidates.filter(
        (tag) =>
          !candidates.some(
            (other) =>
              other !== tag &&
              other.score >= tag.score * 0.9 &&
              this.text(other.name).length > this.text(tag.name).length &&
              (" " + this.text(other.name) + " ").includes(
                " " + this.text(tag.name) + " ",
              ),
          ),
      ),
      selected = [];
    const floor = Math.max(0.68, remaining[0].score * 0.79);
    const overlap = (a, b) => {
      const left = this.text(a).split(" "),
        right = this.text(b).split(" ");
      const shared = left.filter((word) => right.includes(word)).length;
      if (
        (" " + this.text(a) + " ").includes(" " + this.text(b) + " ") ||
        (" " + this.text(b) + " ").includes(" " + this.text(a) + " ")
      )
        return 1;
      return shared / (new Set([...left, ...right]).size || 1);
    };
    while (remaining.length) {
      const ranked = remaining
        .map((tag) => ({
          tag,
          gain:
            tag.score -
            0.48 *
              Math.max(
                0,
                ...selected.map((other) => overlap(tag.name, other.name)),
              ),
        }))
        .sort((a, b) => b.gain - a.gain || b.tag.score - a.tag.score);
      const { tag, gain } = ranked[0];
      if (gain < floor) break;
      selected.push(tag);
      remaining.splice(remaining.indexOf(tag), 1);
    }
    // Presentation order never reserves or displaces a topic by tag type.
    return selected.sort(
      (a, b) => Number(b.isNew) - Number(a.isNew) || b.score - a.score,
    );
  },

  async suggest(target, rows, active) {
    const names = await SWTags.catalog(target.libraryID);
    if (SWTags._stopped || !active()) return [];
    const body =
      typeof SWIndexer === "undefined"
        ? ""
        : await SWIndexer.tagText(target, active);
    if (SWTags._stopped || !active()) return [];
    let candidates = await this.rank(target, rows, names, body, active);
    if (
      typeof SWSemantic !== "undefined" &&
      SWSemantic._enabled &&
      typeof SWSemantic.tagSimilarity === "function"
    ) {
      const pool = candidates.slice(0, 24);
      try {
        const scores = await SWSemantic.tagSimilarity(
          target,
          pool.map((tag) => tag.name),
          active,
        );
        // A missing semantic result must not discard otherwise eligible topics.
        if (scores)
          pool.forEach((tag, i) => {
            if (Number.isFinite(scores[i]))
              tag.score += 0.08 * Math.max(0, scores[i]);
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
      .filter((tag) => !protectedKeys.has(this.text(tag.name)))
      .sort((a, b) => b.score - a.score || b.name.length - a.name.length);
    return this.select(candidates);
  },
};
