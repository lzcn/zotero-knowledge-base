function SWPref(name, fallback) {
  try {
    var v = Zotero.Prefs.get("similar-works." + name);
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function SWResultLimit(value) {
  var n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(100, Math.floor(n)) : 20;
}

var SWIndexer = {
  corpus: null,
  _queue: [],
  _queued: new Set(),
  _inFlight: new Map(),
  _itemKeys: new Map(),
  _stopped: false,
  _drainPromise: null,
  _scanPromise: null,
  _requestedFulltext: new Set(),
  _pendingRemovals: new Set(),
  _draining: false,
  _notifierID: null,
  _started: false,
  _startupPending: false,
  _startupTimer: null,
  _startupIdleCancel: null,
  _releaseStartup: null,
  _startupWait: null,
  _libraryScanned: false,
  _libraryScanning: false,
  _libraryTotal: null,
  _statusLastWrite: 0,
  _statusWrite: Promise.resolve(),
  _tagText: new Map(),
  _tagTextPending: new Map(),

  getStatus() {
    const indexedItems = this.corpus?.n || 0;
    return {
      updatedAt: new Date().toISOString(),
      state: this._stopped
        ? "stopped"
        : this._startupPending
          ? "waiting"
          : this.corpus?.progress.phase === "error"
            ? "error"
            : this.corpus?.progress.phase !== "ready"
              ? "preparing"
              : this._libraryScanning
                ? "scanning"
                : !this._libraryScanned
                  ? "waiting"
                  : this._draining || this._queue.length || this._inFlight.size
                    ? "indexing"
                    : "idle",
      indexedItems,
      totalItems: this._libraryTotal,
      queuedItems: this._queue.length,
      libraryScanComplete: this._libraryScanned,
      error: this.corpus?.progress.error || null,
      semantic:
        typeof SWSemantic === "undefined"
          ? null
          : { ...SWSemantic.status, queuedItems: SWSemantic._queue.length },
    };
  },

  _reportStatus(force = false) {
    if (typeof IOUtils.writeUTF8 !== "function") return;
    const now = Date.now();
    if (!force && now - this._statusLastWrite < 10000) return;
    this._statusLastWrite = now;
    const status = this.getStatus();
    this._statusWrite = this._statusWrite
      .then(async () => {
        const dir = SWStorage.cache();
        await IOUtils.makeDirectory(dir, {
          createAncestors: true,
          ignoreExisting: true,
        });
        await IOUtils.writeUTF8(
          PathUtils.join(dir, "index-status.json"),
          JSON.stringify(status, null, 2) + "\n",
        );
      })
      .catch((error) => Zotero.logError(error));
  },

  async start() {
    if (this._started) {
      return;
    }
    this._started = true;
    this.corpus = new SWCorpus();
    // Register immediately; open the heavy index only after startup has settled
    // or an explicit Similar Items request takes priority.
    this._startupPending = true;
    this._scanPromise = (async () => {
      await (this._startupWait = new Promise((resolve) => {
        this._releaseStartup = resolve;
        const delay = Math.max(0, SWPref("backgroundStartupDelayMs", 30000));
        if (!delay) {
          this.wake();
          return;
        }
        this._startupTimer = setTimeout(() => {
          this._startupTimer = null;
          const win = Zotero.getMainWindow?.();
          if (win?.requestIdleCallback) {
            const id = win.requestIdleCallback(() => this.wake(), {
              timeout: 5000,
            });
            this._startupIdleCancel = () => win.cancelIdleCallback(id);
          } else this.wake();
        }, delay);
      }));
      if (this._stopped) return;
      await this.corpus.ready;
      if (this._stopped || this.corpus.progress.phase !== "ready") return;
      this._reportStatus(true);
      if (this._queue.length && !this._draining)
        this._drainPromise = this._drain();
      if (typeof SWSemantic !== "undefined")
        await SWSemantic.start(this.corpus);
      // Do not overlap initial cache loading with a full-library scan.
      for (
        let remaining = 1500;
        !this._stopped && remaining > 0;
        remaining -= 100
      )
        await swYield(100);
      if (!this._stopped) await this.enqueueLibrary();
    })().catch((error) => Zotero.logError(error));
    this.registerNotifier();
  },

  wake() {
    clearTimeout(this._startupTimer);
    this._startupTimer = null;
    try {
      this._startupIdleCancel?.();
    } catch (error) {
      Zotero.logError(error);
    }
    this._startupIdleCancel = null;
    this._startupPending = false;
    this._releaseStartup?.();
    this._releaseStartup = null;
  },

  registerNotifier() {
    var observer = {
      notify: (event, type, ids, extraData) => {
        try {
          this._onNotify(event, type, ids, extraData);
        } catch (e) {
          Zotero.logError(e);
        }
      },
    };
    this._notifierID = Zotero.Notifier.registerObserver(
      observer,
      ["item"],
      "similar-works",
    );
  },

  _onNotify(event, type, ids, extraData = {}) {
    if (this._stopped || type !== "item") {
      return;
    }
    if (event === "trash" || event === "delete") {
      for (const id of ids) {
        const work = this._removeById(id, extraData[id]).catch((e) =>
          Zotero.logError(e),
        );
        this._pendingRemovals.add(work);
        work.then(() => this._pendingRemovals.delete(work));
      }
      return;
    }
    if (
      event === "add" ||
      event === "modify" ||
      event === "index" ||
      event === "refresh"
    ) {
      for (const id of ids) {
        this.enqueue(id, 1);
      }
    }
  },

  async _removeById(id, extra = {}) {
    if (this._startupPending) await this._startupWait;
    if (this._stopped) return;
    await this.corpus.ready;
    if (this._stopped) return;
    var item = await Zotero.Items.getAsync(id);
    var record = this._itemKeys.get(id);
    var parentID = item?.parentItemID || record?.parentID || extra.parentItemID;
    // A child attachment disappearing changes its parent's text, not the parent existence.
    if (parentID) this.enqueue(parentID);
    var key = item ? this.docKey(item) : record?.key;
    if (!key && extra.libraryID && extra.key)
      key = extra.libraryID + "/" + extra.key;
    if (key) {
      await this.corpus.removeDoc(key);
    }
    this._itemKeys.delete(id);
  },

  docKey(item) {
    return item.libraryID + "/" + item.key;
  },

  async resolveDocItem(item) {
    if (!item || item.deleted || item.isNote() || item.isFeedItem) {
      return null;
    }
    if (item.isAttachment()) {
      var pid = item.parentItemID;
      if (pid) {
        var parent = await Zotero.Items.getAsync(pid);
        return parent && !parent.deleted ? parent : null;
      }
      return item;
    }
    if (item.isRegularItem()) {
      return item;
    }
    return null;
  },

  enqueue(id, priority = 0) {
    if (this._stopped) return;
    if (this._queued.has(id)) {
      if (priority > 0) {
        const at = this._queue.indexOf(id);
        if (at >= 0) this._queue.splice(at, 1);
        this._queue.unshift(id);
      }
      return;
    }
    this._queued.add(id);
    if (priority > 0) this._queue.unshift(id);
    else this._queue.push(id);
    if (!this._startupPending && !this._draining)
      this._drainPromise = this._drain();
  },

  async enqueueLibrary() {
    this._libraryScanning = true;
    this._libraryScanned = false;
    this._reportStatus(true);
    try {
      var live = new Set();
      var oldKeys = Array.from(this.corpus.docs.keys());
      var sliceStarted = Date.now();
      for (var lib of Zotero.Libraries.getAll()) {
        var ids = await Zotero.Items.getAll(lib.id, true, false, true);
        // Fetch items in pages through the host API instead of one call per row.
        for (let offset = 0; offset < ids.length; offset += 25) {
          if (this._stopped) return;
          var page = await Zotero.Items.getAsync(
            ids.slice(offset, offset + 25),
          );
          for (var item of page) {
            if (this._stopped) return;
            if (Date.now() - sliceStarted >= 6) {
              await swYield(20);
              sliceStarted = Date.now();
            }
            var target = await this.resolveDocItem(item);
            if (!target) continue;
            const key = this.docKey(target);
            const seen = live.has(key);
            live.add(key);
            this._itemKeys.set(item.id, {
              key: this.docKey(item),
              parentID: item.parentItemID,
            });
            if (!seen && SWPref("backgroundIndexing", true))
              this.enqueue(target.id);
          }
          await swYield(20);
        }
      }
      this._libraryTotal = live.size;
      for (var key of oldKeys) {
        if (this._stopped) return;
        if (!live.has(key)) await this.corpus.removeDoc(key);
      }
      this._libraryScanned = true;
    } catch (e) {
      Zotero.logError(e);
    } finally {
      this._libraryScanning = false;
      this._reportStatus(true);
    }
  },

  async _drain() {
    if (this._draining) {
      return;
    }
    this._draining = true;
    try {
      await this.corpus.ready;
      let sliceStarted = Date.now();
      while (!this._stopped && this._queue.length) {
        var id = this._queue.shift();
        this._queued.delete(id);
        const changed = await this._processId(id);
        this._reportStatus();
        // Pace expensive updates, not the cheap source checks on every restart.
        var remaining = changed
          ? Math.max(2000, SWPref("indexDelayMs", 2000))
          : 0;
        while (!this._stopped && remaining > 0) {
          await swYield(Math.min(100, remaining));
          remaining -= 100;
        }
        if (Date.now() - sliceStarted >= 6) {
          await swYield(20);
          sliceStarted = Date.now();
        }
        if (this._stopped) break;
      }
    } finally {
      this._draining = false;
      this._reportStatus(true);
    }
  },

  async _processId(id) {
    try {
      var item = await Zotero.Items.getAsync(id);
      if (item) {
        return await this.processItem(item);
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },

  async ensureForDisplay(item) {
    var target = await this.resolveDocItem(item);
    if (!target || this._stopped) return null;
    var key = this.docKey(target);
    if (!this.corpus.docs.has(key)) {
      var metadata = this.metadataText(target);
      if (metadata)
        await this.corpus.upsertDoc(
          key,
          metadata.hash,
          true,
          await SWSearch.extract({
            title: target.getField("title"),
            abstract: target.getField("abstractNote"),
            body: "",
          }),
          1,
        );
    }
    if (SWPref("backgroundIndexing", true)) this.enqueue(target.id);
    return target;
  },

  async ensureNow(item) {
    var target = await this.resolveDocItem(item);
    if (!target) {
      return null;
    }
    await this.processItem(target, 1);
    return target;
  },

  async processItem(item, priority = 0) {
    await this.corpus.ready;
    if (this._stopped || this.corpus.progress.phase !== "ready") return;
    var prior = this._itemKeys.get(item.id);
    if (prior?.parentID && prior.parentID !== item.parentItemID)
      this.enqueue(prior.parentID);
    this._itemKeys.set(item.id, {
      key: this.docKey(item),
      parentID: item.parentItemID,
    });
    if (item.deleted) {
      await this._removeById(item.id);
      return;
    }
    var target = await this.resolveDocItem(item);
    if (!target) return;
    var pending = this._inFlight.get(target.id);
    if (pending) {
      this.corpus.promote(pending, priority);
      await pending;
      return this.processItem(item, priority);
    }
    var work = this.corpus.runTask(
      () => this._processDoc(target, priority > 0),
      priority,
    );
    this._inFlight.set(target.id, work);
    try {
      return await work;
    } finally {
      this._inFlight.delete(target.id);
    }
  },

  async _processDoc(item, foreground = false) {
    if (item.isNote() || item.isFeedItem) {
      return;
    }
    if (!item.isRegularItem() && !item.isAttachment()) {
      return;
    }
    var key = this.docKey(item);
    if (item.deleted) {
      return await this.corpus._removeDoc(key);
    }
    var info = await this.extractText(item);
    if (!info) {
      return await this.corpus._removeDoc(key);
    }
    if (this._stopped) return;
    if (item.deleted) {
      await this.corpus._removeDoc(key);
      return;
    }
    await this.corpus.recordSource(
      key,
      String(item.getField("dateModified") || ""),
      info.hash,
    );
    var prev = this.corpus.docs.get(key);
    if (prev && prev.hash === info.hash) {
      if (typeof SWSemantic !== "undefined") SWSemantic.enqueue(key);
      return;
    }
    await this.corpus.yieldToForeground();
    const tf = await SWSearch.extract(
      {
        title: item.getField("title"),
        abstract: item.getField("abstractNote"),
        body: info.weak ? "" : info.content,
      },
      async () => {
        await swYield(foreground ? 5 : 80);
        await this.corpus.yieldToForeground();
      },
      () => this._stopped,
    );
    if (!tf || this._stopped) return;
    var weak = info.weak || tf.size < SWPref("minFulltextTerms", 25);
    await this.corpus._upsertDoc(key, info.hash, weak, tf);
    if (typeof SWSemantic !== "undefined") SWSemantic.enqueue(key);
    return true;
  },

  async termFreqInBackground(text) {
    var tf = new Map(),
      offset = 0,
      count = 0;
    // Split on word boundaries so English tokens and CJK bigrams keep
    // the same meaning; release the UI thread between small text batches.
    while (!this._stopped && offset < text.length && count < SW_MAX_TOKENS) {
      var end = Math.min(offset + 4000, text.length);
      while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++;
      var tokens = SWTokenizer.tokenize(text.slice(offset, end), {
        minLength: SWPref("minTokenLength", 2),
      });
      for (var token of tokens) {
        if (count++ >= SW_MAX_TOKENS) break;
        tf.set(token, (tf.get(token) || 0) + 1);
      }
      offset = end;
      if (offset < text.length) {
        await swYield(80);
        await this.corpus.yieldToForeground();
      }
    }
    return tf;
  },

  /** @param {Zotero.Item} item */
  async extractText(item, readCached = false) {
    if (item.isRegularItem()) {
      var atts = [];
      try {
        var best = await item.getBestAttachment();
        if (best && !best.deleted) {
          atts.push(best);
        }
      } catch (e) {}
      try {
        var attIds = await item.getAttachments();
        var attItems = await Zotero.Items.getAsync(attIds.slice(0, 8));
        for (var a of attItems) {
          if (a && !a.deleted && !atts.includes(a)) {
            atts.push(a);
          }
        }
      } catch (e) {}
      for (var att of atts.slice(0, 5)) {
        var t = await this.attachmentText(att, readCached);
        if (t) {
          return t;
        }
      }
      return this.metadataText(item);
    }
    if (item.isAttachment()) {
      return (
        (await this.attachmentText(item, readCached)) || this.metadataText(item)
      );
    }
    return null;
  },

  // Read only the selected paper's existing Zotero cache, never index or OCR
  // on demand. Reuse the bounded sample until its indexed source changes.
  async tagText(item, active = () => true) {
    if (this._stopped || !active()) return "";
    const key = this.docKey(item);
    const source = this.corpus?.docs.get(key)?.hash;
    const version = JSON.stringify([
      source,
      item.getField("title"),
      item.getField("abstractNote"),
    ]);
    const cached = this._tagText.get(key);
    if (cached?.version === version) return cached.text;
    const pendingKey = key + version;
    let work = this._tagTextPending.get(pendingKey);
    if (!work) {
      work = this.extractText(item, true)
        .then((info) => {
          const text = info && !info.weak ? info.content : "";
          if (
            !this._stopped &&
            this.corpus?.docs.get(key)?.hash === source &&
            active()
          ) {
            this._tagText.delete(key);
            this._tagText.set(key, { version, text });
            while (this._tagText.size > 16)
              this._tagText.delete(this._tagText.keys().next().value);
          }
          return text;
        })
        .finally(() => this._tagTextPending.delete(pendingKey));
      this._tagTextPending.set(pendingKey, work);
    }
    const text = await work;
    return !this._stopped &&
      active() &&
      this.corpus?.docs.get(key)?.hash === source
      ? text
      : "";
  },

  async attachmentText(att, readCached = false) {
    try {
      if (att.deleted) return null;
      this._itemKeys.set(att.id, {
        key: this.docKey(att),
        parentID: att.parentItemID,
      });
      var fulltext = Zotero.Fulltext;
      var mime = att.attachmentContentType || "";
      if (!fulltext.isCachedMIMEType(mime) && mime !== "text/plain") {
        return null;
      }

      var path = fulltext.getItemCacheFile(att).path;
      var have = await IOUtils.exists(path);
      if (
        !have &&
        !readCached &&
        SWPref("requestMissingFulltext", false) &&
        !this._requestedFulltext.has(att.id) &&
        (await att.fileExists())
      ) {
        this._requestedFulltext.add(att.id);
        await fulltext.queueItem(att);
      }
      if (!have) {
        return null;
      }
      if (have) this._requestedFulltext.delete(att.id);
      var stat = await IOUtils.stat(path);
      var hash = "f" + att.key + ":" + stat.lastModified + ":" + stat.size;
      var parent = att.parentItemID
        ? await Zotero.Items.getAsync(att.parentItemID)
        : att;
      if (parent)
        hash +=
          ":v3:" +
          SWTokenizer.swFnv1a(
            String(parent.getField("title") || "") +
              "\n" +
              String(parent.getField("abstractNote") || ""),
          );
      if (
        !readCached &&
        parent &&
        this.corpus.docs.get(this.docKey(parent))?.hash === hash
      ) {
        return { content: "", hash, weak: false };
      }
      var buf = await IOUtils.read(path, {
        maxBytes: readCached ? 24000 : SWPref("maxTextChars", 1200000),
      });
      var content = new TextDecoder("utf-8").decode(buf);
      if (!content || content.trim().length < 40) {
        return null;
      }
      return { content: content, hash, weak: false };
    } catch (e) {
      Zotero.logError(e);
      return null;
    }
  },

  metadataText(item) {
    var parts = [];
    var title = item.getField("title");
    if (title) {
      parts.push(title);
    }
    var abs = item.getField("abstractNote");
    if (abs) {
      parts.push(abs);
    }
    try {
      for (var c of item.getCreators()) {
        if (c.lastName) {
          parts.push(c.lastName);
        }
        if (c.firstName) {
          parts.push(c.firstName);
        }
      }
    } catch (e) {}
    if (!parts.length) {
      return null;
    }
    var content = parts.join("\n");
    return {
      content: content,
      hash: "m3" + SWTokenizer.swFnv1a(content),
      weak: true,
    };
  },

  requestStop() {
    if (this._stopped) return;
    this._stopped = true;
    this.wake();
    if (this.corpus) this.corpus._stopped = true;
    if (this._notifierID) {
      Zotero.Notifier.unregisterObserver(this._notifierID);
      this._notifierID = null;
    }
    this._queue = [];
    this._queued.clear();
    this._tagText.clear();
    this._reportStatus(true);
  },

  async shutdown() {
    this.requestStop();
    await Promise.allSettled(Array.from(this._pendingRemovals));
    await this._scanPromise;
    await this._drainPromise;
    await Promise.allSettled(Array.from(this._inFlight.values()));
    await Promise.allSettled(Array.from(this._tagTextPending.values()));
    await this._statusWrite;
  },
};
