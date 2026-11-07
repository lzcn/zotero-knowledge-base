/* global SWTagPolicy, SWTagFormat, SWTagTerms */
function swTagAliasKey(key) {
  return SWTagTerms.aliasKey(key);
}

function swTagDuplicateReason(left, right) {
  if (left === right) return "name";
  if (swTagAliasKey(left) === swTagAliasKey(right)) return "alias";
  // Explicit expansions avoid guessing ambiguous acronyms from initials alone.
  const expansion = (value) => {
    const match = value.match(/^(.+?)\s*\(([a-z][a-z0-9]{1,9})\)$/);
    if (!match) return null;
    const words = match[1].trim().split(" ");
    return words.map((word) => word[0]).join("") === match[2]
      ? [match[1].trim(), match[2]]
      : null;
  };
  if (expansion(left)?.includes(right) || expansion(right)?.includes(left))
    return "abbreviation";
  const singular = (word) =>
    word.length > 4 && /ies$/.test(word)
      ? word.slice(0, -3) + "y"
      : word.length > 4 && /s$/.test(word) && !/(ss|us|is)$/.test(word)
        ? word.slice(0, -1)
        : word;
  const l = left.split(" "),
    r = right.split(" ");
  if (l.length !== r.length) return null;
  if (l.every((word, i) => singular(word) === singular(r[i]))) return "plural";
  const differences = l
    .map((word, i) => [word, r[i]])
    .filter(([x, y]) => x !== y);
  if (differences.length !== 1) return null;
  const [x, y] = differences[0];
  // Never blur numbers, scientific punctuation or semantic qualifiers.
  if (
    !/^[a-z]{7,}$/.test(x) ||
    !/^[a-z]{7,}$/.test(y) ||
    /^(non|un|semi|self|weak|supervised)/.test(x) ||
    /^(non|un|semi|self|weak|supervised)/.test(y)
  )
    return null;
  if (Math.abs(x.length - y.length) > 1) return null;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return null;
    if (x.length >= y.length) i++;
    if (y.length >= x.length) j++;
  }
  return edits + (x.length - i) + (y.length - j) === 1 ? "spelling" : null;
}

var SWTags = {
  _stopped: false,
  _dialogs: new Set(),
  _writes: new Set(),
  _formatting: new Set(),
  _duplicateCache: new Map(),

  recommend(
    target,
    rows,
    limit = 6,
    excluded = this.exclusions(target.libraryID),
  ) {
    const existing = new Set(
      (target.getTags?.() || []).map((tag) =>
        swTagAliasKey(SWTagPolicy.key(tag.tag)),
      ),
    );
    const candidates = new Map();
    const seenItems = new Set();
    for (const row of rows) {
      if (
        row.item.libraryID !== target.libraryID ||
        row.item.id === target.id ||
        row.item.deleted ||
        !Number.isFinite(row.score) ||
        row.score <= 0
      )
        continue;
      if (seenItems.has(row.item.id)) continue;
      seenItems.add(row.item.id);
      const seen = new Set();
      for (const { tag } of row.item.getTags?.() || []) {
        const rawKey = SWTagPolicy.key(tag),
          key = swTagAliasKey(rawKey);
        if (
          !key ||
          seen.has(key) ||
          existing.has(key) ||
          SWTagPolicy.excludes(tag, excluded)
        )
          continue;
        seen.add(key);
        const candidate = candidates.get(key) || {
          name: tag,
          score: 0,
          count: 0,
        };
        candidate.score += row.score;
        candidate.count++;
        candidates.set(key, candidate);
      }
    }
    return [...candidates.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.count - a.count ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit);
  },

  normalizeName(name) {
    return String(name).normalize("NFKC").replace(/\s+/gu, " ").trim();
  },

  // Split naming boundaries without stemming or guessing unbroken words.
  words: SWTagPolicy.words,

  namingOptions() {
    return {
      style:
        typeof SWPref === "undefined"
          ? "sentence"
          : SWPref("tagNameStyle", "sentence"),
      hashtag:
        typeof SWPref === "undefined" ? false : SWPref("tagHashtag", false),
    };
  },

  formatName(name, options = this.namingOptions()) {
    return SWTagFormat.format(name, options);
  },

  exclusions(libraryID) {
    const value =
      typeof SWPref === "undefined" ? "" : SWPref("excludedTags", "");
    return SWTagPolicy.exclusions(
      value,
      Zotero.Tags.getColors(libraryID).keys(),
    );
  },

  _assertAllowed(libraryID, names) {
    const rules = this.exclusions(libraryID);
    if (names.some((name) => SWTagPolicy.excludes(name, rules)))
      throw new Error("similar-works-tags-protected");
  },

  suggest(target, rows, active = () => true) {
    return SWTagSuggestions.suggest(target, rows, active);
  },

  duplicateReason(a, b) {
    return swTagDuplicateReason(SWTagPolicy.key(a), SWTagPolicy.key(b));
  },

  semanticCompatible(a, b) {
    const left = SWTagPolicy.key(a),
      right = SWTagPolicy.key(b);
    if (SWTagFormat.structured(a) || SWTagFormat.structured(b)) return false;
    const numbers = (value) =>
      [...value.matchAll(/\d+/g)]
        .map((match) => match[0])
        .sort()
        .join(",");
    if (numbers(left) !== numbers(right)) return false;
    if (/[+#]/u.test(left + right) && left !== right) return false;
    // Closely related opposites and task qualifiers must not become synonyms.
    const qualifiers = (value) =>
      (
        value
          .replace(/\bcategorization\b/g, "classification")
          .replace(/\bforecasting\b/g, "prediction")
          .match(
            /\b(?:non\w*|un\w*|semi\w*|self|supervised|online|offline|centralized|decentralized|distributed|detection|classification|segmentation|prediction|tracking|retrieval)\b/g,
          ) || []
      )
        .sort()
        .join(" ");
    return qualifiers(left) === qualifiers(right);
  },

  async potentialDuplicates(names, active = () => true) {
    const lexical = this.duplicateGroups(names);
    if (typeof SWSemantic === "undefined" || !SWSemantic._enabled)
      return { groups: lexical, semantic: false };
    const valid = () => !this._stopped && active();
    const key = JSON.stringify([
      SWSemantic.version,
      SWSemantic._generation,
      names,
    ]);
    if (valid() && this._duplicateCache.has(key))
      return this._duplicateCache.get(key);
    const edges = await SWSemantic.tagRelations(names, valid);
    if (!valid()) return { groups: [], semantic: false };
    if (!SWSemantic._enabled) return { groups: lexical, semantic: false };
    const links = new Set(
      edges
        .filter((edge) => this.semanticCompatible(edge.left, edge.right))
        .map((edge) => JSON.stringify([edge.left, edge.right].sort())),
    );
    const groups = new Set(lexical),
      owners = new Map();
    for (const group of lexical)
      for (const name of group) owners.set(name, group);
    for (const edge of edges) {
      const a = owners.get(edge.left) || [edge.left],
        b = owners.get(edge.right) || [edge.right];
      if (
        a === b ||
        !a.every((left) =>
          b.every(
            (right) =>
              this.duplicateReason(left, right) ||
              links.has(JSON.stringify([left, right].sort())),
          ),
        )
      )
        continue;
      groups.delete(a);
      groups.delete(b);
      const merged = [...a, ...b];
      groups.add(merged);
      for (const name of merged) owners.set(name, merged);
    }
    const result = { groups: [...groups], semantic: true };
    this._duplicateCache.set(key, result);
    while (this._duplicateCache.size > 4)
      this._duplicateCache.delete(this._duplicateCache.keys().next().value);
    return result;
  },

  refreshSemantic() {
    if (this._stopped) return;
    for (const win of this._dialogs)
      if (!win.closed)
        win.dispatchEvent(new win.Event("knowledge-base-tags-semantic-ready"));
  },

  duplicateGroups(names) {
    const groups = [],
      index = new Map();
    const keys = new Map(
      [...new Set(names)].map((name) => [name, SWTagPolicy.key(name)]),
    );
    for (const [name, key] of keys) {
      if (!key) continue;
      const words = key.split(" ");
      const singular = (word) =>
        word.length > 4 && /ies$/.test(word)
          ? word.slice(0, -3) + "y"
          : word.length > 4 && /s$/.test(word) && !/(ss|us|is)$/.test(word)
            ? word.slice(0, -1)
            : word;
      const signatures = new Set([
        "name:" + key,
        "alias:" + swTagAliasKey(key),
        "plural:" + words.map(singular).join(" "),
      ]);
      const explicit = key.match(/^(.+?)\s*\(([a-z][a-z0-9]{1,9})\)$/);
      if (explicit && swTagDuplicateReason(key, explicit[2]))
        for (const alias of [explicit[1].trim(), explicit[2]])
          signatures.add("name:" + alias);
      // Deletion signatures retrieve edit-distance-one candidates without an all-pairs scan.
      words.forEach((word, position) => {
        if (
          !/^[a-z]{7,}$/.test(word) ||
          /^(non|un|semi|self|weak|supervised)/.test(word)
        )
          return;
        const add = (value) =>
          signatures.add(
            "spelling:" +
              words.map((part, i) => (i === position ? value : part)).join(" "),
          );
        add(word);
        for (let i = 0; i < word.length; i++)
          add(word.slice(0, i) + word.slice(i + 1));
      });
      const candidates = new Set(
        [...signatures].flatMap((signature) => [
          ...(index.get(signature) || []),
        ]),
      );
      // Complete-link groups prevent a weak match from chaining unrelated tags.
      const group = [...candidates].find((values) =>
        values.every((value) => swTagDuplicateReason(keys.get(value), key)),
      );
      const values = group || [name];
      if (group) group.push(name);
      else groups.push(values);
      for (const signature of signatures) {
        if (!index.has(signature)) index.set(signature, new Set());
        index.get(signature).add(values);
      }
    }
    return groups.filter((group) => group.length > 1);
  },

  _check(libraryID, active = () => true) {
    if (this._stopped || !active())
      throw new Error("similar-works-tags-cancelled");
    const library = Zotero.Libraries.get(libraryID);
    if (!library || !library.editable)
      throw new Error("similar-works-tags-readonly");
  },

  async _write(work) {
    const pending = work();
    this._writes.add(pending);
    try {
      return await pending;
    } finally {
      this._writes.delete(pending);
    }
  },

  async addSelected(
    itemID,
    libraryID,
    names,
    active = () => true,
    newNames = [],
  ) {
    if (
      names.some(
        (name) =>
          typeof name !== "string" ||
          !name ||
          name.length > 255 ||
          [...name].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          ),
      )
    )
      throw new Error("similar-works-tags-invalid-name");
    if (
      newNames.some(
        (name) => !names.includes(name) || name !== this.normalizeName(name),
      )
    )
      throw new Error("similar-works-tags-invalid-name");
    this._check(libraryID, active);
    this._assertAllowed(libraryID, names);
    const item = await Zotero.Items.getAsync(itemID);
    this._check(libraryID, active);
    if (
      !item ||
      item.deleted ||
      item.libraryID !== libraryID ||
      !item.isEditable()
    )
      throw new Error("similar-works-tags-readonly");
    const existing = new Set(
      (await Zotero.Tags.getAll(libraryID)).map((tag) => tag.tag),
    );
    this._check(libraryID, active);
    if (names.some((name) => !existing.has(name) && !newNames.includes(name)))
      throw new Error("similar-works-tags-changed");
    let added = 0;
    try {
      await this._write(() =>
        Zotero.DB.executeTransaction(async () => {
          this._check(libraryID, active);
          this._assertAllowed(libraryID, names);
          if (item.deleted || !item.isEditable())
            throw new Error("similar-works-tags-readonly");
          for (const name of new Set(names))
            if (!item.hasTag(name) && item.addTag(name, 0)) added++;
          if (added) await item.save();
          this._check(libraryID, active);
          this._assertAllowed(libraryID, names);
        }),
      );
    } catch (error) {
      await item.reload(null, true);
      throw error;
    }
    return added;
  },

  async catalog(libraryID, managed = false) {
    const tags = await Zotero.Tags.getAll(libraryID);
    const rules = managed
      ? this.exclusions(libraryID)
      : SWTagPolicy.exclusions("");
    return [
      ...new Set(
        tags
          .filter((tag) => !rules.automatic || tag.type !== 1)
          .map((tag) => tag.tag),
      ),
    ]
      .filter((name) => !SWTagPolicy.excludes(name, rules))
      .sort((a, b) => a.localeCompare(b));
  },

  async usageCounts(libraryID) {
    // Match native tag membership, including notes and attachments. Fetch all
    // counts together instead of issuing one query for every displayed tag.
    const rows = await Zotero.DB.queryAsync(
      "SELECT name AS tag, COUNT(DISTINCT itemID) AS count " +
        "FROM itemTags JOIN tags USING (tagID) JOIN items USING (itemID) " +
        "WHERE libraryID = ? GROUP BY tagID",
      [libraryID],
    );
    return new Map(rows.map((row) => [row.tag, row.count]));
  },

  async preview(libraryID, names, active = () => true) {
    this._check(libraryID, active);
    this._assertAllowed(libraryID, names);
    const existing = new Set(await this.catalog(libraryID));
    if (new Set(names).size < 1 || names.some((name) => !existing.has(name)))
      throw new Error("similar-works-tags-changed");
    const items = new Set();
    for (const name of new Set(names)) {
      this._check(libraryID, active);
      const tagID = Zotero.Tags.getID(name);
      if (!tagID) throw new Error("similar-works-tags-changed");
      for (const id of await Zotero.Tags.getTagItems(libraryID, tagID))
        items.add(id);
    }
    this._check(libraryID, active);
    return items.size;
  },

  async merge(libraryID, names, target, active = () => true) {
    if (
      !target ||
      target !== this.normalizeName(target) ||
      target.length > 255 ||
      [...target].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new Error("similar-works-tags-invalid-name");
    this._assertAllowed(libraryID, [...names, target]);
    await this.preview(libraryID, names, active);
    let merged = 0;
    for (const name of new Set(names)) {
      if (name === target) continue;
      await this._rename(libraryID, name, target, active);
      merged++;
    }
    return merged;
  },

  async remove(
    libraryID,
    names,
    active = () => true,
    progress = (_done, _total) => {},
  ) {
    const sources = [...new Set(names)];
    await this.preview(libraryID, sources, active);
    let done = 0;
    for (let offset = 0; offset < sources.length; offset += 50) {
      const chunk = sources.slice(offset, offset + 50);
      this._check(libraryID, active);
      this._assertAllowed(libraryID, chunk);
      const ids = chunk.map((name) => {
        const id = Zotero.Tags.getID(name);
        if (!id) throw new Error("similar-works-tags-changed");
        return id;
      });
      // Native removal updates item caches and sends the host notifications.
      await this._write(() =>
        Zotero.Tags.removeFromLibrary(libraryID, ids, undefined, undefined),
      );
      done += chunk.length;
      progress(done, sources.length);
    }
    return done;
  },

  async _rename(libraryID, name, target, active) {
    this._check(libraryID, active);
    this._assertAllowed(libraryID, [name, target]);
    // The host returns color/position; zotero-types declares a tag object.
    const color = /** @type {{color: string, position: number} | false} */ (
      /** @type {unknown} */ (
        Zotero.Tags.getColor(libraryID, target) ||
          Zotero.Tags.getColor(libraryID, name)
      )
    );
    // Finish the current native write before releasing resources on close.
    await this._write(async () => {
      await Zotero.Tags.rename(libraryID, name, target);
      if (color)
        await Zotero.DB.executeTransaction(() =>
          Zotero.Tags.setColor(libraryID, target, color.color, color.position),
        );
    });
  },

  async planFormat(libraryID, names, active = () => true) {
    this._check(libraryID, active);
    const sources = [...new Set(names)];
    this._assertAllowed(libraryID, sources);
    const existing = new Set(await this.catalog(libraryID));
    this._check(libraryID, active);
    if (!sources.length || sources.some((name) => !existing.has(name)))
      throw new Error("similar-works-tags-changed");
    const options = this.namingOptions();
    const rows = sources.map((from) => ({
      from,
      to: this.formatName(from, options),
      status: "unchanged",
      itemIDs: [],
    }));
    const destinations = new Map();
    for (const row of rows)
      destinations.set(row.to, (destinations.get(row.to) || 0) + 1);
    const items = new Set();
    const rules = this.exclusions(libraryID);
    for (const row of rows) {
      if (SWTagFormat.structured(row.from)) row.status = "structured";
      else if (row.from === row.to) continue;
      else if (
        !row.to ||
        row.to.length > 255 ||
        [...row.to].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
      )
        row.status = "invalid";
      else if (SWTagPolicy.excludes(row.to, rules)) row.status = "protected";
      else if (existing.has(row.to) || destinations.get(row.to) > 1)
        row.status = "collision";
      else {
        row.status = "change";
        const id = Zotero.Tags.getID(row.from);
        if (!id) throw new Error("similar-works-tags-changed");
        row.itemIDs = [...(await Zotero.Tags.getTagItems(libraryID, id))].sort(
          (a, b) => a - b,
        );
        for (const id of row.itemIDs) items.add(id);
      }
      this._check(libraryID, active);
    }
    this._assertAllowed(libraryID, sources);
    return { sources, options, rows, itemCount: items.size };
  },

  async applyFormat(
    libraryID,
    plan,
    active = () => true,
    progress = (_done, _total) => {},
  ) {
    if (this._formatting.has(libraryID))
      throw new Error("similar-works-tags-changed");
    this._formatting.add(libraryID);
    try {
      const current = await this.planFormat(libraryID, plan.sources, active);
      if (JSON.stringify(current) !== JSON.stringify(plan))
        throw new Error("similar-works-tags-changed");
      const changes = current.rows.filter((row) => row.status === "change");
      let done = 0;
      for (const row of changes) {
        const id = Zotero.Tags.getID(row.from);
        if (!id) throw new Error("similar-works-tags-changed");
        const itemIDs = [
          ...(await Zotero.Tags.getTagItems(libraryID, id)),
        ].sort((a, b) => a - b);
        const existing = new Set(await this.catalog(libraryID));
        this._check(libraryID, active);
        this._assertAllowed(libraryID, [row.from, row.to]);
        if (
          !existing.has(row.from) ||
          existing.has(row.to) ||
          JSON.stringify(this.namingOptions()) !==
            JSON.stringify(current.options) ||
          JSON.stringify(itemIDs) !== JSON.stringify(row.itemIDs)
        )
          throw new Error("similar-works-tags-changed");
        await this._rename(libraryID, row.from, row.to, active);
        progress(++done, changes.length);
      }
      return done;
    } finally {
      this._formatting.delete(libraryID);
    }
  },

  open(win, libraryID) {
    this._check(libraryID);
    const existing = [...this._dialogs].find(
      (dialog) => !dialog.closed && dialog.arguments[0].libraryID === libraryID,
    );
    if (existing) {
      existing.focus();
      return existing;
    }
    const url = "chrome://similar-works/content/tags.xhtml";
    const dialog = win.openDialog(
      url,
      "",
      "chrome,centerscreen,resizable,width=680,height=560",
      {
        api: this,
        libraryID,
        isMac: !!Zotero.isMac,
      },
    );
    this._dialogs.add(dialog);
    // Ignore the initial about:blank unload during native window navigation.
    const loaded = () => {
      if (
        dialog.document.documentURI !== url ||
        dialog.document.readyState !== "complete"
      )
        return;
      dialog.removeEventListener("load", loaded);
      dialog.addEventListener("unload", () => this._dialogs.delete(dialog), {
        once: true,
      });
    };
    dialog.addEventListener("load", loaded);
    loaded();
    return dialog;
  },

  stop() {
    this._stopped = true;
    this._duplicateCache.clear();
    for (const dialog of this._dialogs) if (!dialog.closed) dialog.close();
    this._dialogs.clear();
  },

  async finishWrites() {
    await Promise.allSettled([...this._writes]);
  },
};

if (typeof module !== "undefined") module.exports = { SWTags, swTagAliasKey };
