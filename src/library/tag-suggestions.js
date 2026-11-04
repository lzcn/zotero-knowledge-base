/* global SWTagPolicy */
// Reuse indexed evidence and neighboring vocabulary; add only grounded new topics.
var SWTagSuggestions = {
  text(value) {
    return swTagAliasKey(
      SWTagPolicy.key(String(value || "").replace(/<[^>]*>/g, " ")),
    )
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
      .trim();
  },

  isSpecific(name, normalized = this.text(name), existing = false) {
    if (
      /\b(?:et al|references|bibliography)\b|^(?:via|using|based on|towards?)\b|\b(?:generative|discrete|continuous|unsupervised|supervised|neural|independent|conditional|aerial|adversarial|convolutional|recurrent|probabilistic|molecular|spectral|visual|structural|combinatorial|stochastic|reinforcement)$/i.test(
        normalized,
      )
    )
      return false;
    const words = normalized.split(" ").filter(Boolean);
    if (words.length === 1) {
      if (
        /^(?:learning|networks?|models?|representation|analysis|systems?|frameworks?|methods?|algorithms?|approach(?:es)?|performance|results?|research)$/.test(
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
        (existing && /^[a-z]{4,}$/u.test(normalized)) ||
        (/^[A-Z][A-Z0-9]{1,9}$/.test(String(name).replace(/^#/, "")) &&
          !/^(AI|ML|DL|LLMS?)$/.test(String(name).replace(/^#/, "")))
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

  async phrases(title, abstract, body = "", active = () => true) {
    let started = Date.now();
    const fields = [title, abstract, body];
    const candidates = new Map();
    for (const [field, text] of fields.entries()) {
      for (const run of String(text).match(/[^.!?。！？;；\n]+/gu) || []) {
        if (Date.now() - started > 6) {
          await swYield(0);
          started = Date.now();
          if (!active() || SWTags._stopped) return [];
        }
        let group = [];
        const add = () => {
          for (let start = 0; start < group.length; start++)
            for (
              let length = 2;
              length <= 4 && start + length <= group.length;
              length++
            ) {
              if (
                /^\d/u.test(group[start + length] || "") ||
                /^\d/u.test(group[start - 1] || "")
              )
                continue;
              const name = group.slice(start, start + length).join(" "),
                key = this.text(name);
              if (name.length > 64 || !this.isSpecific(name, key)) continue;
              const entry = candidates.get(key) || { name, counts: [0, 0, 0] };
              entry.counts[field]++;
              candidates.set(key, entry);
            }
          group = [];
        };
        for (const word of [
          ...(run.match(/[\p{L}\p{N}][\p{L}\p{N}+#-]*/gu) || []),
          "",
        ]) {
          if (
            word &&
            !SWTokenizer.isStopword(word.toLowerCase()) &&
            !/^(?:via|using|towards?|based|novel|new|proposed|efficient|effective|paper|study|results?|methods?|approach|show|demonstrate|experiments?|solving|evaluate|discuss)$/i.test(
              word,
            )
          )
            group.push(word);
          else add();
        }
      }
    }
    // The candidate budget bounds inference work, not the number of suggestions.
    return [...candidates.values()]
      .filter((entry) => {
        const [t, a, b] = entry.counts;
        return (
          (t && (a || b || (!abstract.trim() && !body.trim()))) ||
          a >= 2 ||
          b >= 3
        );
      })
      .sort(
        (a, b) =>
          b.counts[0] * 4 +
            Math.min(3, b.counts[1]) * 2 +
            Math.min(4, b.counts[2]) -
            (a.counts[0] * 4 +
              Math.min(3, a.counts[1]) * 2 +
              Math.min(4, a.counts[2])) ||
          b.name.length - a.name.length ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 128)
      .map((entry) => entry.name);
  },

  async evidence(target, active) {
    const title = String(target.getField?.("title") || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 12000);
    const abstract = String(target.getField?.("abstractNote") || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 12000);
    let body = "",
      counts = null;
    const rawTitle = String(target.getField?.("title") || ""),
      rawAbstract = String(target.getField?.("abstractNote") || "");
    const corpus = typeof SWIndexer === "undefined" ? null : SWIndexer.corpus;
    const key =
      typeof SWIndexer === "undefined" ? null : SWIndexer.docKey?.(target);
    const source = corpus?.docs?.get(key)?.hash;
    const current = () =>
      active() &&
      !SWTags._stopped &&
      !target.deleted &&
      String(target.getField?.("title") || "") === rawTitle &&
      String(target.getField?.("abstractNote") || "") === rawAbstract &&
      (source === undefined || corpus?.docs?.get(key)?.hash === source);
    if (typeof SWIndexer !== "undefined") {
      if (
        corpus?.progress?.phase === "ready" &&
        corpus.search.docs.has(key) &&
        typeof corpus._readCounts === "function"
      ) {
        counts = SWSearch.decodeCounts(await corpus._readCounts(key));
        if (
          !active() ||
          SWTags._stopped ||
          corpus.docs.get(key)?.hash !== source
        )
          return null;
      }
      if (typeof SWIndexer.tagText === "function")
        body = SWSearch.clean(
          await SWIndexer.tagText(
            target,
            active,
            SWPref("maxTextChars", 1200000),
          ),
        );
    }
    return current() ? { title, abstract, body, counts, current } : null;
  },

  indexedHits(name, counts) {
    if (!counts) return 0;
    const body = counts.fields?.[2] || counts;
    const features = [...new Set(SWSearch.features(SWSearch.clean(name)))];
    if (!features.length) return 0;
    const values = features.map((id) => body.get(id) || 0);
    // Bigrams are part of the existing fingerprints. Requiring every feature
    // avoids accepting labels whose words occur in unrelated places.
    return values.every(Boolean) ? Math.min(...values) : 0;
  },

  async rank(target, rows, names, active = () => true, evidence = null) {
    evidence ||= await this.evidence(target, active);
    if (!evidence) return [];
    const { title, abstract, body, counts } = evidence;
    const focusAbstract = abstract
      .split(/(?<=[.!?])\s+|[。！？\n]/u)
      .filter(
        (sentence) =>
          !/\b(?:benchmarks?|for example|such as|et al)\b/i.test(sentence),
      )
      .join(" ");
    const focus = " " + this.text(focusAbstract) + " ";
    const texts = [title, abstract, body].map(
      (text) => " " + this.text(text) + " ",
    );
    const rules = SWTags.exclusions(target.libraryID),
      catalog = new Map();
    for (const name of names)
      if (!SWTagPolicy.excludes(name, rules) && !catalog.has(this.text(name)))
        catalog.set(this.text(name), name);
    const excluded = new Set(
      (target.getTags?.() || []).map((tag) => this.text(tag.tag)),
    );
    const votes = new Map(
      SWTags.recommend(target, rows, Infinity, rules).map((tag) => [
        this.text(tag.name),
        tag,
      ]),
    );
    const known = new Set(names);
    for (const [key, vote] of votes)
      if (catalog.has(key) && known.has(vote.name)) catalog.set(key, vote.name);
    const pool = new Map(catalog);
    for (const name of await this.phrases(title, abstract, body, active))
      if (!pool.has(this.text(name))) pool.set(this.text(name), name);
    const voteMax = Math.max(1, ...[...votes.values()].map((tag) => tag.score));
    const candidates = [];
    let visited = 0;
    for (const [key, name] of pool) {
      if (++visited % 128 === 0) {
        await swYield(0);
        if (!active() || SWTags._stopped) return [];
      }
      const isNew = !catalog.has(key),
        vote = votes.get(key);
      if (
        !key ||
        excluded.has(key) ||
        SWTagPolicy.excludes(name, rules) ||
        !this.isSpecific(name, key, !isNew)
      )
        continue;
      const [inTitle, inAbstract, inBody] = texts.map((text) =>
        this.occurrences(text, key),
      );
      const bodyHits = Math.max(inBody, this.indexedHits(name, counts));
      if (!inTitle && !inAbstract && bodyHits < 2 && !vote) continue;
      const direct = inTitle
        ? 0.84 + (inAbstract ? 0.04 : 0) + (bodyHits ? 0.02 : 0)
        : inAbstract
          ? 0.65 + Math.min(0.08, (inAbstract - 1) * 0.04)
          : bodyHits >= 2
            ? 0.59 + Math.min(0.09, Math.log2(bodyHits) * 0.025)
            : 0;
      candidates.push({
        name,
        isNew,
        count: vote?.count || 0,
        direct,
        bodyHits,
        inTitle,
        inAbstract,
        incidental:
          !inTitle &&
          inAbstract > 0 &&
          !this.occurrences(focus, key) &&
          bodyHits < 2,
        support: Math.min(1, (vote?.score || 0) / voteMax),
        score:
          direct + (0.08 * (vote?.score || 0)) / voteMax - (isNew ? 0.025 : 0),
      });
    }
    return candidates
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.support - a.support ||
          b.name.length - a.name.length ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 192);
  },

  affinity(a, b, semantic = () => null) {
    if (SWTags.duplicateReason(a, b)) return 1;
    if (!SWTags.semanticCompatible(a, b)) return 0;
    const ak = " " + this.text(a) + " ",
      bk = " " + this.text(b) + " ";
    if (ak.includes(bk) || bk.includes(ak)) return 1;
    const left = new Set(SWTokenizer.termFreq(this.text(a)).keys()),
      right = new Set(SWTokenizer.termFreq(this.text(b)).keys());
    const overlap =
      [...left].filter((word) => right.has(word)).length /
      Math.sqrt(Math.max(1, left.size * right.size));
    return Math.max(overlap, semantic(a, b) || 0);
  },

  select(candidates, semantic = () => null) {
    const ranked = [...candidates].sort(
      (a, b) =>
        b.score - a.score ||
        b.name.length - a.name.length ||
        a.name.localeCompare(b.name),
    );
    // Prefer the library spelling of a concept, including semantically equivalent
    // labels. A broader or differently qualified topic is not an alias.
    const existing = ranked.filter((tag) => !tag.isNew);
    const reused = ranked.filter((tag) => {
      if (!tag.isNew) return true;
      const key = " " + this.text(tag.name) + " ";
      if (
        existing.some(
          (other) =>
            SWTags.duplicateReason(tag.name, other.name) ||
            (SWTags.semanticCompatible(tag.name, other.name) &&
              (semantic(tag.name, other.name) || 0) >= 0.86),
        )
      )
        return false;
      const parts = existing.filter((other) =>
        key.includes(" " + this.text(other.name) + " "),
      );
      if (parts.length < 2) return true;
      const covered = new Set(
        parts.flatMap((other) => this.text(other.name).split(" ")),
      );
      return !this.text(tag.name)
        .split(" ")
        .every((word) => covered.has(word));
    });
    const complete = reused.filter(
      (tag) =>
        !reused.some((other) => {
          const a = " " + this.text(tag.name) + " ",
            b = " " + this.text(other.name) + " ";
          return (
            a !== b &&
            b.includes(a) &&
            other.score >= tag.score - 0.08 &&
            SWTags.semanticCompatible(tag.name, other.name)
          );
        }),
    );
    const pool = complete.filter(
      (tag) =>
        !tag.isNew ||
        !complete.some(
          (other) =>
            !other.isNew &&
            this.affinity(tag.name, other.name, semantic) >= 0.86,
        ),
    );
    const selected = [];
    while (pool.length) {
      let best = null,
        gain = 0;
      for (const tag of pool) {
        if (!Number.isFinite(tag.score) || tag.score < 0.58) continue;
        const redundancy = Math.max(
          0,
          ...selected.map((other) =>
            this.affinity(tag.name, other.name, semantic),
          ),
        );
        if (redundancy >= 0.86) continue;
        // Marginal topic coverage must justify growing reading/selection cost.
        // There is no target count, fixed cap or backfill to pad weak papers.
        const utility =
          tag.score - 0.48 * redundancy - (0.14 + 0.12 * selected.length);
        if (utility > gain) {
          best = tag;
          gain = utility;
        }
      }
      if (!best) break;
      selected.push(best);
      pool.splice(pool.indexOf(best), 1);
    }
    return selected.sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name),
    );
  },

  async suggest(target, rows, active = () => true) {
    const names = await SWTags.catalog(target.libraryID);
    if (SWTags._stopped || !active()) return [];
    const evidence = await this.evidence(target, active);
    if (!evidence) return [];
    let candidates = await this.rank(target, rows, names, active, evidence);
    const current = (target.getTags?.() || []).map((tag) => tag.tag);
    let scores = null;
    const semantic = typeof SWSemantic !== "undefined" ? SWSemantic : null;
    if (semantic?._enabled && typeof semantic.tagSimilarity === "function") {
      try {
        scores = await semantic.tagSimilarity(
          target,
          [...candidates.map((tag) => tag.name), ...current],
          active,
        );
      } catch (error) {
        if (active() && !SWTags._stopped) Zotero.logError(error);
      }
    }
    if (!active() || SWTags._stopped || !evidence.current()) return [];
    const hasTitle = candidates.some((tag) => tag.inTitle);
    candidates = candidates.filter((tag, i) => {
      const similarity = Number.isFinite(scores?.[i])
        ? Math.max(0, scores[i])
        : null;
      tag.semantic = similarity;
      if (tag.incidental) return false;
      if (
        hasTitle &&
        !tag.inTitle &&
        tag.inAbstract === 1 &&
        tag.bodyHits < 2 &&
        !tag.support
      )
        return false;
      if (!tag.direct && !(tag.support > 0 && similarity >= 0.38)) return false;
      if (
        tag.isNew &&
        !tag.inTitle &&
        !tag.inAbstract &&
        !(tag.bodyHits >= 3 && (similarity === null || similarity >= 0.3))
      )
        return false;
      tag.score = Math.min(
        1,
        tag.score +
          (similarity || 0) * 0.14 +
          (!tag.direct ? 0.45 + 0.22 * tag.support : 0),
      );
      if (!tag.inTitle && similarity !== null && similarity < 0.25)
        return false;
      return true;
    });
    const pair = (a, b) => semantic?.tagAffinity?.(a, b) ?? null;
    candidates = candidates.filter(
      (tag) =>
        !current.some((name) => this.affinity(tag.name, name, pair) >= 0.86),
    );
    const rules = SWTags.exclusions(target.libraryID);
    return this.select(candidates, pair)
      .map((tag) =>
        tag.isNew ? { ...tag, name: SWTags.formatName(tag.name) } : tag,
      )
      .filter((tag) => !SWTagPolicy.excludes(tag.name, rules));
  },
};
