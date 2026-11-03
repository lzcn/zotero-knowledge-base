/* global SWTagPolicy */
function swTagAliasKey(key) {
  const expansions = {
    cnn: "convolutional neural network",
    gan: "generative adversarial network",
    gnn: "graph neural network",
    rnn: "recurrent neural network",
    gcn: "graph convolutional network",
    mlp: "multilayer perceptron",
    svm: "support vector machine",
    vqa: "visual question answering",
    nlp: "natural language processing",
    llm: "large language model",
  };
  return key
    .replace(/\b(networks|nets|models|machines|perceptrons)\b/g, (word) =>
      word.slice(0, -1),
    )
    .replace(
      /\b(cnn|gan|gnn|rnn|gcn|mlp|svm|vqa|nlp|llm)s?\b/g,
      (_, word) => expansions[word],
    )
    .replace(/\bconvolutional net\b/g, "convolutional neural network")
    .replace(/\bneural net\b/g, "neural network");
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

  recommend(target, rows, limit = 6, excluded = new Set()) {
    const existing = new Set(
      (target.getTags?.() || []).map((tag) => SWTagPolicy.key(tag.tag)),
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
        const key = SWTagPolicy.key(tag);
        if (!key || seen.has(key) || existing.has(key) || excluded.has(key))
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

  protectedKeys() {
    return SWTagPolicy.excludedKeys(
      typeof SWPref === "undefined" ? "" : SWPref("excludedTags", ""),
    );
  },

  _assertAllowed(names) {
    const protectedKeys = this.protectedKeys();
    if (names.some((name) => protectedKeys.has(SWTagPolicy.key(name))))
      throw new Error("similar-works-tags-protected");
  },

  suggest(target, rows, active = () => true) {
    return SWTagSuggestions.suggest(target, rows, active);
  },

  duplicateReason(a, b) {
    return swTagDuplicateReason(SWTagPolicy.key(a), SWTagPolicy.key(b));
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
    this._assertAllowed(names);
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
          this._assertAllowed(names);
          if (item.deleted || !item.isEditable())
            throw new Error("similar-works-tags-readonly");
          for (const name of new Set(names))
            if (!item.hasTag(name) && item.addTag(name, 0)) added++;
          if (added) await item.save();
          this._check(libraryID, active);
          this._assertAllowed(names);
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
    const protectedKeys = managed ? this.protectedKeys() : new Set();
    return [...new Set(tags.map((tag) => tag.tag))]
      .filter((name) => !protectedKeys.has(SWTagPolicy.key(name)))
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
    this._assertAllowed(names);
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
    this._assertAllowed([...names, target]);
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
      this._assertAllowed(chunk);
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
    this._assertAllowed([name, target]);
    // The host returns color/position; zotero-types declares a tag object.
    const color = /** @type {{color: string, position: number} | false} */ (
      /** @type {unknown} */ (
        Zotero.Tags.getColor(libraryID, target) ||
          Zotero.Tags.getColor(libraryID, name)
      )
    );
    // Finish the current native write before releasing resources on close.
    await this._write(async () => {
      try {
        await Zotero.Tags.rename(libraryID, name, target);
      } finally {
        if (color)
          await Zotero.DB.executeTransaction(() =>
            Zotero.Tags.setColor(
              libraryID,
              target,
              color.color,
              color.position,
            ),
          );
      }
    });
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
    for (const dialog of this._dialogs) if (!dialog.closed) dialog.close();
    this._dialogs.clear();
  },

  async finishWrites() {
    await Promise.allSettled([...this._writes]);
  },
};

if (typeof module !== "undefined") module.exports = { SWTags, swTagAliasKey };
