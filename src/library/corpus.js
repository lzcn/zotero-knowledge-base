var SW_SCHEMA_VERSION = 3;

/** @param {number} ms @returns {Promise<void>} */
function swYield(ms) {
  if (typeof Zotero !== "undefined" && Zotero.Promise && Zotero.Promise.delay) {
    return Zotero.Promise.delay(ms || 0);
  }
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

var SWCorpus = class {
  constructor() {
    this._stopped = false;
    this._tasks = [];
    this._taskRunning = false;
    this._taskPromises = new WeakMap();
    this._taskDrain = Promise.resolve();
    this._epochPending = false;
    this._closePromise = null;
    this._shutdownClient = null;
    this._shutdownBlocker = () => this.close();
    this.search = new SWSearch.Index();
    this.docs = new Map();
    this.df = new Map();
    this.n = 0;
    this.dfVersion = 0;
    this.revision = 0;
    this.lastChangedAt = 0;
    this._sourceStates = new Map();
    this._recommendations = new Map();
    this._storedReads = new Set();
    this._db = null;
    this._dbPath = null;
    this.progress = { phase: "idle", done: 0, total: 0 };
    this._ready = null;
    this._opened = new Promise((resolve) => {
      this._resolveOpened = resolve;
    });
  }

  get ready() {
    if (!this._ready) {
      this._ready = this._openAndLoad();
    }
    return this._ready;
  }

  get opened() {
    void this.ready;
    return this._opened;
  }

  async _openAndLoad() {
    try {
      var dir = await SWStorage.prepareCache(() => !this._stopped);
      if (this._stopped) return;
      this._dbPath = PathUtils.join(dir, "similarity.sqlite");
      var { Sqlite } = ChromeUtils.importESModule(
        "resource://gre/modules/Sqlite.sys.mjs",
      );
      this._shutdownClient = Sqlite.shutdown;
      this._shutdownClient?.addBlocker(
        "Similar Items: close similarity database",
        this._shutdownBlocker,
      );
      this._db = await Sqlite.openConnection({ path: this._dbPath });
      if (this._stopped) return;
      await this._db.execute("PRAGMA journal_mode = WAL");
      await this._db.executeTransaction(() => this._ensureSchema());
      this._resolveOpened();
      // Give cached-result readers a turn before decoding the large IDF model.
      await swYield(0);
      if (this._stopped) return;
      if (await this._loadSearchCache()) return;
      await this._loadModel();
      if (this._stopped) return;
      await this._loadAll();
      if (!this._stopped) void this.saveSearchCache();
    } catch (e) {
      if (this._stopped) return;
      Zotero.logError(
        new Error("[similar-works] corpus init failed: " + String(e)),
      );
      this.progress = {
        phase: "error",
        done: 0,
        total: 0,
        error: String(e && e.message ? e.message : e),
      };
      // A rejected schema must not keep the database handle and shutdown
      // blocker alive after the user has been told the index is unavailable.
      await this._closeDatabase();
    } finally {
      this._resolveOpened();
    }
  }

  async _loadSearchCache() {
    const rows = await this._db.execute(
      "SELECT v FROM meta WHERE k = 'searchCache'",
    );
    if (!rows.length) return false;
    try {
      const saved = JSON.parse(rows[0].getResultByName("v"));
      if (saved.format !== 1 || saved.revision !== this.revision) return false;
      const path = SWStorage.searchCache();
      if (!(await IOUtils.exists(path))) return false;
      if (
        !/^[a-f0-9]{64}$/.test(saved.digest) ||
        (await IOUtils.computeHexDigest(path, "sha256")) !== saved.digest
      )
        throw new Error("Search cache checksum mismatch");
      await this._finishStoredReads();
      if (this._stopped) return false;
      const restored = await SWSearchCache.decode(
        await IOUtils.read(path),
        this.revision,
        async () => {
          await swYield(0);
          await this._finishStoredReads();
        },
        () => !this._stopped,
      );
      if (!restored || this._stopped) return false;
      const counts = await this._db.execute("SELECT COUNT(*) AS c FROM docs");
      if (counts[0]?.getResultByName("c") !== restored.docs.size)
        throw new Error("Search cache document count mismatch");
      const sources = await this._db.execute(
        "SELECT key, itemModifiedAt, sourceHash FROM source_updates",
      );
      if (this._stopped) return false;
      this.search = restored.search;
      this.docs = restored.docs;
      this.n = this.docs.size;
      this.df = this.search.df;
      for (const row of sources) {
        const key = row.getResultByName("key"),
          stamp = row.getResultByName("itemModifiedAt"),
          hash = row.getResultByName("sourceHash");
        if (typeof stamp === "string" && this.docs.get(key)?.hash === hash)
          this._sourceStates.set(key, JSON.stringify([stamp, hash]));
      }
      this._searchCacheStamp = JSON.stringify([
        this.revision,
        this.search.epoch,
        this.search.changes,
      ]);
      this.restoredSearchCache = true;
      this.progress = { phase: "ready", done: this.n, total: this.n };
      void this._maintainEpoch();
      return true;
    } catch (error) {
      if (!this._stopped)
        Zotero.logError(
          new Error(
            "[knowledge-base] search cache rejected; restoring stored fingerprints",
            { cause: error },
          ),
        );
      return false;
    }
  }

  saveSearchCache() {
    if (!this._dbPath) return Promise.resolve();
    if (this._searchCacheWork) return this._searchCacheWork;
    const work = this.runTask(async () => {
      if (
        this._stopped ||
        !this._db ||
        this.progress.phase !== "ready" ||
        !this.search.epoch ||
        this._epochPending
      )
        return;
      const stamp = JSON.stringify([
        this.revision,
        this.search.epoch,
        this.search.changes,
      ]);
      if (stamp === this._searchCacheStamp) return;
      const active = () =>
        !this._stopped &&
        stamp ===
          JSON.stringify([
            this.revision,
            this.search.epoch,
            this.search.changes,
          ]);
      const bytes = await SWSearchCache.encode(
        this,
        async () => {
          await swYield(0);
          await this._finishStoredReads();
          await this.yieldToForeground();
        },
        active,
      );
      if (!bytes || !active()) return;
      const path = SWStorage.searchCache();
      await IOUtils.write(path, bytes, { tmpPath: path + ".tmp" });
      const digest = await IOUtils.computeHexDigest(path, "sha256");
      if (!active()) return;
      await this._db.execute(
        "INSERT OR REPLACE INTO meta (k,v) VALUES ('searchCache',?)",
        [JSON.stringify({ format: 1, revision: this.revision, digest })],
      );
      this._searchCacheStamp = stamp;
    }, -2).catch((error) => {
      if (!this._stopped) Zotero.logError(error);
    });
    this._searchCacheWork = work;
    void work.finally(() => {
      if (this._searchCacheWork === work) this._searchCacheWork = null;
    });
    return work;
  }

  async _ensureSchema() {
    const tables = await this._db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE ?",
      ["sqlite_%"],
    );
    if (tables.length) {
      const hasMeta = tables.some(
        (row) => row.getResultByName("name") === "meta",
      );
      const rows = hasMeta
        ? await this._db.execute("SELECT v FROM meta WHERE k = 'schemaVersion'")
        : [];
      const version = rows[0]?.getResultByName("v");
      if (String(version) !== String(SW_SCHEMA_VERSION))
        throw new Error(
          `Unsupported index schema: ${version ?? "missing"}; expected ${SW_SCHEMA_VERSION}`,
        );
    }
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, hash TEXT NOT NULL, weak INTEGER NOT NULL DEFAULT 0, tf TEXT NOT NULL)",
    );
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
    );
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS doc_updates (key TEXT PRIMARY KEY, updatedAt INTEGER NOT NULL)",
    );
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS source_updates (key TEXT PRIMARY KEY, itemModifiedAt TEXT NOT NULL, sourceHash TEXT NOT NULL, checkedAt INTEGER NOT NULL)",
    );
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS recommendations (cacheKey TEXT PRIMARY KEY, payload TEXT NOT NULL, computedAt INTEGER NOT NULL)",
    );
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS fingerprints (key TEXT PRIMARY KEY, counts BLOB NOT NULL, signature BLOB NOT NULL, epoch INTEGER NOT NULL, simhash BLOB NOT NULL)",
    );
    await this._db.execute(
      "CREATE TABLE IF NOT EXISTS embeddings (key TEXT PRIMARY KEY, sourceHash TEXT NOT NULL, model TEXT NOT NULL, vector BLOB NOT NULL, updatedAt INTEGER NOT NULL)",
    );
    var revisions = await this._db.execute(
      "SELECT v FROM meta WHERE k = 'corpusRevision'",
    );
    this.revision = revisions.length
      ? Number(revisions[0].getResultByName("v"))
      : 0;
    await this._db.execute(
      "INSERT OR REPLACE INTO meta (k, v) VALUES ('schemaVersion', '" +
        SW_SCHEMA_VERSION +
        "')",
    );
  }

  async _loadModel() {
    await this._finishStoredReads();
    if (this._stopped) return;
    var models = await this._db.execute(
      "SELECT v FROM meta WHERE k = 'signatureModel'",
    );
    await this._finishStoredReads();
    if (this._stopped) return;
    if (models.length) {
      try {
        const model = JSON.parse(models[0].getResultByName("v"));
        if (
          model.algorithm === 4 &&
          Number.isInteger(model.epoch) &&
          Array.isArray(model.df) &&
          Array.isArray(model.averageFieldLengths) &&
          model.averageFieldLengths.length === 3 &&
          model.averageFieldLengths.every((n) => Number.isFinite(n) && n > 0)
        ) {
          this.search.epoch = model.epoch;
          this.search.epochN = model.n;
          this.search.averageLength = model.averageLength;
          this.search.averageFieldLengths = model.averageFieldLengths;
          this.search.frozenDF = new Map(model.df);
        }
      } catch (error) {
        Zotero.logError(error);
      }
    }
    const changes = await this._db.execute(
      "SELECT v FROM meta WHERE k = 'signatureChanges'",
    );
    this._loadedChanges = changes.length
      ? Number(changes[0].getResultByName("v")) || 0
      : 0;
  }

  async _loadAll() {
    var countRows = await this._db.execute("SELECT COUNT(*) AS c FROM docs");
    var total = countRows.length ? countRows[0].getResultByName("c") : 0;
    this.progress = { phase: "loading", done: 0, total: total };
    var rebuild = !this.search.epoch;
    var lastKey = "";
    var done = 0;
    var chunk = 100;
    var sliceStarted = Date.now();
    var damaged = [];
    var damagedError = null;
    while (!this._stopped) {
      await this._finishStoredReads();
      if (this._stopped) return;
      var rows = await this._db.execute(
        "SELECT d.key, d.hash, d.weak, f.counts, f.signature, f.epoch, f.simhash, s.itemModifiedAt, s.sourceHash FROM docs d LEFT JOIN fingerprints f ON f.key = d.key LEFT JOIN source_updates s ON s.key = d.key WHERE d.key > ? ORDER BY d.key LIMIT ?",
        [lastKey, chunk],
      );
      if (!rows.length) {
        break;
      }
      for (var row of rows) {
        if (this._stopped) return;
        var key = row.getResultByName("key");
        lastKey = key;
        var counts, signature, simhash;
        try {
          counts = row.getResultByName("counts");
          if (!counts) throw new Error("Missing stored feature counts");
          counts = new Uint8Array(counts);
          var tf = SWSearch.decodeCounts(counts);
          signature =
            row.getResultByName("epoch") === this.search.epoch
              ? row.getResultByName("signature")
              : null;
          if (signature) SWSearch.decodeSignature(signature);
          var storedSimhash = row.getResultByName("simhash");
          if (storedSimhash) {
            simhash = SWSearch.decodeSimhash(storedSimhash);
          } else simhash = null;
        } catch (e) {
          // The index is rebuildable. Drop this row and let the library scan
          // recreate it instead of making every cached document unreadable.
          damaged.push(key);
          damagedError = damagedError || e;
          continue;
        }
        var doc = {
          hash: row.getResultByName("hash"),
          weak: !!parseInt(row.getResultByName("weak")),
          tf: tf,
          counts: counts,
          signature: signature,
          simhash: simhash,
        };
        if (!doc.signature) rebuild = true;
        this._memInsert(key, doc, false);
        if (!rebuild) this.search.docs.get(key).counts = null;
        const modifiedAt = row.getResultByName("itemModifiedAt");
        if (
          typeof modifiedAt === "string" &&
          row.getResultByName("sourceHash") === doc.hash
        )
          this._sourceStates.set(key, JSON.stringify([modifiedAt, doc.hash]));
        if (Date.now() - sliceStarted >= 6) {
          await swYield(20);
          sliceStarted = Date.now();
        }
      }
      done += rows.length;
      this.progress = { phase: "loading", done: done, total: total };
      await swYield(20);
    }
    if (damaged.length) {
      Zotero.logError(
        new Error(
          "[similar-works] rebuilding damaged index rows: " +
            damaged.join(", "),
          { cause: damagedError },
        ),
      );
      if (this._db && !this._stopped) {
        try {
          await this._db.executeTransaction(async () => {
            for (const key of damaged) {
              if (this._stopped) throw new Error("Index repair cancelled");
              for (const sql of [
                "DELETE FROM embeddings WHERE key = ?",
                "DELETE FROM fingerprints WHERE key = ?",
                "DELETE FROM doc_updates WHERE key = ?",
                "DELETE FROM source_updates WHERE key = ?",
                "DELETE FROM docs WHERE key = ?",
              ])
                await this._db.execute(sql, [key]);
              this._sourceStates.delete(key);
            }
          });
        } catch (error) {
          if (!this._stopped) Zotero.logError(error);
        }
      }
    }
    if (rebuild) {
      await this.search.rebuild(
        () => swYield(10),
        () => this._stopped,
        (doc) => this._readCounts(doc.key),
      );
      if (this._stopped) return;
      await this._persistFingerprints();
    } else {
      this.search.changes = this._loadedChanges;
      // Keep encoded counts through a rebuild so its per-document reads stay in
      // memory; release them once load-time validation is complete.
      for (const doc of this.search.docs.values()) doc.counts = null;
    }
    this.progress = { phase: "ready", done: this.n, total: this.n };
    void this._maintainEpoch();
  }

  _memInsert(key, doc, bump) {
    this.search.add(
      key,
      doc.tf,
      doc.weak,
      doc.signature,
      doc.simhash,
      doc.counts,
    );
    this.docs.set(key, { hash: doc.hash, weak: doc.weak });
    this.n = this.docs.size;
    this.df = this.search.df;
    if (bump) this.dfVersion++;
  }

  async _memRemove(key, counts = null) {
    if (!this.docs.has(key)) return false;
    this.search.remove(key, counts || (await this._readCounts(key)));
    this.docs.delete(key);
    this.n = this.docs.size;
    this.dfVersion++;
    return true;
  }

  async _persistFingerprints() {
    if (!this._db) return;
    await this._db.execute("DELETE FROM meta WHERE k = 'searchCache'");
    this._searchCacheStamp = null;
    let batch = [];
    const flush = async () => {
      await this._db.executeTransaction(async () => {
        for (const doc of batch) await this._writeFingerprint(doc);
      });
      for (const doc of batch) doc.counts = null;
      batch = [];
      await swYield(40);
    };
    for (const doc of this.search.docs.values()) {
      if (this._stopped) return;
      batch.push(doc);
      if (batch.length === 20) await flush();
    }
    if (batch.length) await flush();
    await this._db.execute(
      "INSERT OR REPLACE INTO meta (k, v) VALUES ('signatureModel', ?)",
      [
        JSON.stringify({
          algorithm: 4,
          epoch: this.search.epoch,
          n: this.search.epochN,
          averageLength: this.search.averageLength,
          averageFieldLengths: this.search.averageFieldLengths,
          df: [...this.search.frozenDF],
        }),
      ],
    );
    await this._db.execute(
      "INSERT OR REPLACE INTO meta (k, v) VALUES ('signatureChanges', ?)",
      [String(this.search.changes)],
    );
  }

  async _readCounts(key) {
    const doc = this.search.docs.get(key);
    if (doc?.counts) return doc.counts;
    if (!this._db) throw new Error("Missing feature counts for " + key);
    const rows = await this._db.execute(
      "SELECT counts FROM fingerprints WHERE key = ?",
      [key],
    );
    if (!rows.length)
      throw new Error("Missing stored feature counts for " + key);
    return rows[0].getResultByName("counts");
  }

  async _writeFingerprint(doc) {
    const signature = SWSearch.encodeSignature(doc.vector);
    if (doc.counts) {
      await this._db.execute(
        "INSERT OR REPLACE INTO fingerprints (key, counts, signature, epoch, simhash) VALUES (?, ?, ?, ?, ?)",
        [
          doc.key,
          doc.counts,
          signature,
          this.search.epoch,
          SWSearch.encodeSimhash(doc.simhash),
        ],
      );
    } else
      await this._db.execute(
        // Sqlite.sys.mjs treats an array starting with an object as batch bindings.
        // Keep the scalar key first so the signature is bound as a BLOB.
        "UPDATE fingerprints SET signature = ?2, epoch = ?3 WHERE key = ?1",
        [doc.key, signature, this.search.epoch],
      );
  }

  async _maintainEpoch() {
    if (this._epochPending || !this.search.needsEpoch() || this._stopped)
      return;
    const work = () => {
      if (this._stopped || this._epochPending || !this.search.needsEpoch())
        return Promise.resolve();
      this._epochPending = true;
      return this.runTask(async () => {
        try {
          if (
            await this.search.rebuild(
              async () => {
                await swYield(80);
                await this.yieldToForeground();
              },
              () => this._stopped,
              (doc) => this._readCounts(doc.key),
            )
          ) {
            this.dfVersion++;
            await this._persistFingerprints();
          }
        } finally {
          this._epochPending = false;
          if (!this._stopped && !this.search.needsEpoch())
            void this.saveSearchCache();
          // A rebuild aborts when documents change; retry once the queue
          // reaches a stable point instead of waiting for the next edit.
          if (!this._stopped && this.search.needsEpoch())
            void work().catch(report);
        }
      }, -1);
    };
    const report = (error) => {
      if (typeof Zotero !== "undefined") Zotero.logError(error);
    };
    void work().catch(report);
  }

  upsertDoc(key, hash, weak, tf, priority = 0) {
    return this.runTask(() => this._upsertDoc(key, hash, weak, tf), priority);
  }

  async _upsertDoc(key, hash, weak, tf) {
    var prev = this.docs.get(key);
    if (prev && prev.hash === hash) {
      return false;
    }
    const previousCounts = prev ? await this._readCounts(key) : null;
    const previousFingerprint = this.search.docs.get(key);
    const previousRevision = this.revision,
      previousChanges = this.search.changes;
    if (prev) await this._memRemove(key, previousCounts);
    this._memInsert(key, { hash: hash, weak: weak, tf: tf }, true);
    this.revision++;
    this.lastChangedAt = Date.now();
    if (this._db) {
      try {
        await this._persistChange(
          "INSERT OR REPLACE INTO docs (key, hash, weak, tf) VALUES (?, ?, ?, '{}')",
          [key, hash, weak ? 1 : 0],
          key,
          false,
        );
      } catch (e) {
        await this._memRemove(key, this.search.docs.get(key).counts);
        if (prev)
          this._memInsert(
            key,
            {
              ...prev,
              tf: SWSearch.decodeCounts(previousCounts),
              signature: SWSearch.encodeSignature(previousFingerprint.vector),
              simhash: previousFingerprint.simhash,
            },
            false,
          );
        this.revision = previousRevision;
        this.search.changes = previousChanges;
        throw new Error("[similar-works] persist doc failed", { cause: e });
      }
    }
    if (this._db) this.search.docs.get(key).counts = null;
    await this._reverseUpdate(key);
    void this._maintainEpoch();
    return true;
  }

  removeDoc(key) {
    return this.runTask(() => this._removeDoc(key));
  }

  async _removeDoc(key) {
    // Forget the semantic vector first: item deletions must invalidate the
    // semantic Top-K cache even if the text corpus never tracked this key.
    if (typeof SWSemantic !== "undefined") SWSemantic.forget(key);
    const previous = this.docs.get(key);
    if (!previous) return false;
    const counts = await this._readCounts(key),
      fingerprint = this.search.docs.get(key);
    const previousRevision = this.revision,
      previousChanges = this.search.changes;
    await this._memRemove(key, counts);
    this.revision++;
    this.lastChangedAt = Date.now();
    if (this._db) {
      try {
        await this._persistChange(
          "DELETE FROM docs WHERE key = ?",
          [key],
          key,
          true,
        );
      } catch (e) {
        this._memInsert(
          key,
          {
            ...previous,
            tf: SWSearch.decodeCounts(counts),
            signature: SWSearch.encodeSignature(fingerprint.vector),
            simhash: fingerprint.simhash,
          },
          false,
        );
        this.revision = previousRevision;
        this.search.changes = previousChanges;
        throw new Error("[similar-works] delete doc failed", { cause: e });
      }
    }
    await this._reverseUpdate(key);
    void this._maintainEpoch();
    return true;
  }

  async _persistChange(sql, params, key, removed, revision = this.revision) {
    await this._db.executeTransaction(async () => {
      await this._db.execute(sql, params);
      await this._db.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('corpusRevision', ?)",
        [String(revision)],
      );
      await this._db.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('signatureChanges', ?)",
        [String(this.search.changes)],
      );
      if (removed) {
        await this._db.execute("DELETE FROM doc_updates WHERE key = ?", [key]);
        await this._db.execute("DELETE FROM source_updates WHERE key = ?", [
          key,
        ]);
        this._sourceStates.delete(key);
        await this._db.execute("DELETE FROM fingerprints WHERE key = ?", [key]);
        await this._db.execute("DELETE FROM embeddings WHERE key = ?", [key]);
      } else {
        await this._writeFingerprint(this.search.docs.get(key));
        await this._db.execute(
          "INSERT OR REPLACE INTO doc_updates (key, updatedAt) VALUES (?, ?)",
          [key, Date.now()],
        );
      }
    });
  }

  async recordSource(key, modifiedAt, hash) {
    var state = JSON.stringify([modifiedAt, hash]);
    if (this._sourceStates.get(key) === state) return;
    if (this._db) {
      try {
        await this._db.execute(
          "INSERT OR REPLACE INTO source_updates (key, itemModifiedAt, sourceHash, checkedAt) VALUES (?, ?, ?, ?)",
          [key, modifiedAt, hash, Date.now()],
        );
      } catch (e) {
        Zotero.logError(e);
        return;
      }
    }
    this._sourceStates.set(key, state);
  }

  runTask(work, priority = 0) {
    let task;
    const promise = new Promise((resolve, reject) => {
      task = { work, priority, resolve, reject };
      this._tasks.push(task);
    });
    this._taskPromises.set(promise, task);
    if (!this._taskRunning) this._taskDrain = this._drainTasks();
    return promise;
  }

  promote(promise, priority) {
    const task = this._taskPromises?.get(promise);
    if (task) task.priority = Math.max(task.priority, priority);
  }

  async _drainTasks() {
    if (this._taskRunning) return;
    this._taskRunning = true;
    try {
      while (this._tasks.length) {
        this._tasks.sort((a, b) => b.priority - a.priority);
        var task = this._tasks.shift();
        if (this._stopped) {
          task.resolve(undefined);
          continue;
        }
        try {
          task.resolve(await task.work());
        } catch (error) {
          task.reject(error);
        }
      }
    } finally {
      this._taskRunning = false;
    }
  }

  async yieldToForeground() {
    // Called only at safe boundaries of background indexing, before index mutation.
    while (!this._stopped) {
      var index = this._tasks.findIndex((task) => task.priority > 0);
      if (index < 0) return;
      var task = this._tasks.splice(index, 1)[0];
      try {
        task.resolve(await task.work());
      } catch (error) {
        task.reject(error);
      }
    }
  }

  async getRecommendations(queryKey, includeWeak, method = "text") {
    var cacheKey = JSON.stringify(
      method === "hybrid"
        ? [queryKey, includeWeak, method]
        : [queryKey, includeWeak],
    );
    var cached = this._recommendations.get(cacheKey);
    if (!cached && this._db) {
      try {
        var rows = await this._db.execute(
          "SELECT payload FROM recommendations WHERE cacheKey = ?",
          [cacheKey],
        );
        if (rows.length)
          cached = JSON.parse(rows[0].getResultByName("payload"));
      } catch (e) {
        Zotero.logError(e);
      }
    }
    if (
      !this._validRecommendations(cached) ||
      (cached.method || "text") !== method ||
      (method === "hybrid" && cached.queryKey !== queryKey)
    )
      return null;
    this._recommendations.delete(cacheKey);
    this._recommendations.set(cacheKey, cached);
    while (this._recommendations.size > 1000)
      this._recommendations.delete(this._recommendations.keys().next().value);
    return cached;
  }

  async readStored(work) {
    // Foreground reads must never wait for the in-memory index. Background
    // loading pauses at safe boundaries until these bounded reads finish.
    const reading = (async () => {
      await this.opened;
      if (!this._stopped) return work();
      return null;
    })();
    this._storedReads.add(reading);
    try {
      return await reading;
    } finally {
      this._storedReads.delete(reading);
    }
  }

  async _finishStoredReads() {
    while (this._storedReads.size && !this._stopped) {
      await Promise.allSettled([...this._storedReads]);
      // Let the first rows paint before resuming synchronous model decoding.
      await swYield(20);
    }
  }

  _validRecommendations(cached) {
    return (
      cached &&
      cached.algorithm === 5 &&
      (cached.method === undefined || cached.method === "hybrid") &&
      typeof cached.queryHash === "string" &&
      Number.isInteger(cached.epoch) &&
      cached.epoch >= 0 &&
      Number.isFinite(cached.computedAt) &&
      Number.isFinite(cached.revision) &&
      Array.isArray(cached.matches) &&
      cached.matches.length <= 100 &&
      cached.matches.every(
        (m) =>
          m &&
          typeof m.key === "string" &&
          Number.isFinite(m.score) &&
          m.score >= 0 &&
          m.score <= 1 &&
          (cached.method !== "hybrid" ||
            [m.lexicalScore, m.semanticScore].every(
              (score) => Number.isFinite(score) && score >= 0 && score <= 1,
            )),
      )
    );
  }

  recommendationsFresh(cached, queryKey) {
    return (
      cached &&
      cached.epoch === this.search.epoch &&
      !cached.dirty &&
      cached.queryHash === this.docs.get(queryKey)?.hash
    );
  }

  async saveRecommendations(
    queryKey,
    includeWeak,
    matches,
    revision,
    queryHash,
    epoch = this.search.epoch,
  ) {
    // A yielded computation must never be tagged with a newer index revision.
    if (
      epoch !== this.search.epoch ||
      revision !== this.revision ||
      queryHash !== this.docs.get(queryKey)?.hash
    )
      return;
    var cacheKey = JSON.stringify([queryKey, includeWeak]);
    var cached = {
      algorithm: 5,
      epoch: this.search.epoch,
      revision,
      queryHash,
      computedAt: Date.now(),
      matches: matches.slice(0, 100),
    };
    await this._storeRecommendations(cacheKey, cached);
  }

  async saveHybridRecommendations(
    queryKey,
    includeWeak,
    matches,
    snapshot,
    model,
  ) {
    if (
      this._stopped ||
      snapshot.revision !== this.revision ||
      snapshot.epoch !== this.search.epoch ||
      snapshot.queryHash !== this.docs.get(queryKey)?.hash
    )
      return;
    const cached = {
      algorithm: 5,
      method: "hybrid",
      model,
      queryKey,
      ...snapshot,
      computedAt: Date.now(),
      matches: matches.slice(0, 100),
    };
    await this._storeRecommendations(
      JSON.stringify([queryKey, includeWeak, "hybrid"]),
      cached,
    );
  }

  async _storeRecommendations(cacheKey, cached) {
    if (this._stopped) return;
    this._recommendations.set(cacheKey, cached);
    while (this._recommendations.size > 1000)
      this._recommendations.delete(this._recommendations.keys().next().value);
    if (this._db) {
      try {
        await this._db.executeTransaction(async () => {
          await this._db.execute(
            "INSERT OR REPLACE INTO recommendations (cacheKey, payload, computedAt) VALUES (?, ?, ?)",
            [cacheKey, JSON.stringify(cached), cached.computedAt],
          );
          await this._db.execute(
            "DELETE FROM recommendations WHERE cacheKey NOT IN (SELECT cacheKey FROM recommendations ORDER BY computedAt DESC, cacheKey LIMIT 1000)",
          );
        });
      } catch (e) {
        Zotero.logError(e);
      }
    }
  }

  async _reverseUpdate(changedKey) {
    const changed = this.search.docs.get(changedKey);
    // Persisted caches are bounded at 1000. Read their small Top-K payloads,
    // never compare full vectors across all document pairs.
    if (this._db && !this._reverseLoaded) {
      this._reverseLoaded = true;
      const rows = await this._db.execute(
        "SELECT cacheKey, payload FROM recommendations",
      );
      for (const row of rows) {
        try {
          const key = row.getResultByName("cacheKey"),
            payload = JSON.parse(row.getResultByName("payload"));
          const decodedKey = JSON.parse(key);
          if (
            Array.isArray(decodedKey) &&
            typeof decodedKey[0] === "string" &&
            typeof decodedKey[1] === "boolean" &&
            this._validRecommendations(payload) &&
            !this._recommendations.has(key)
          )
            this._recommendations.set(key, payload);
        } catch (error) {
          Zotero.logError(error);
        }
      }
    }
    const changedLibrary = changedKey.split("/")[0];
    let sliceStarted = Date.now();
    // Iterate over a snapshot: foreground saves can reorder or replace entries
    // while this background pass yields, and stale entries must not be written.
    for (const [cacheKey, cached] of [...this._recommendations]) {
      if (this._recommendations.get(cacheKey) !== cached) continue;
      // Comparing against the serialized form is only needed to decide whether
      // a persistence write is required, so skip it entirely without a database.
      const original = this._db ? JSON.stringify(cached) : null;
      const [queryKey, includeWeak] = JSON.parse(cacheKey);
      const query = this.search.docs.get(queryKey);
      const before = cached.matches.some((m) => m.key === changedKey);
      if (cached.method === "hybrid") {
        // A text-source change invalidates fusion; never patch cosine into RRF.
        if (queryKey.split("/")[0] === changedLibrary) cached.dirty = true;
      } else if (queryKey === changedKey) cached.dirty = true;
      else if (
        cached.epoch === this.search.epoch &&
        query &&
        queryKey.split("/")[0] === changedLibrary
      ) {
        const matches = cached.matches.filter((m) => m.key !== changedKey);
        if (before) cached.dirty = true; // Deletion can expose an unknown next neighbor.
        if (changed && (includeWeak || !changed.weak)) {
          const score = this.search.similarity(query, changed);
          const duplicate = SWSearch.isDuplicate(query, changed);
          const duplicateNeighbor = matches.some((m) => {
            const neighbor = this.search.docs.get(m.key);
            return neighbor && SWSearch.isDuplicate(neighbor, changed);
          });
          if (score > 0 && !duplicate && !duplicateNeighbor)
            matches.push({ key: changedKey, score, weak: changed.weak });
        }
        matches.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
        cached.matches = matches.slice(0, 100);
      }
      if (
        this._db &&
        this._recommendations.get(cacheKey) === cached &&
        original !== JSON.stringify(cached)
      )
        await this._db.execute(
          "UPDATE recommendations SET payload = ? WHERE cacheKey = ?",
          [JSON.stringify(cached), cacheKey],
        );
      // Yield on a CPU-time budget instead of a fixed item count. A full scan of
      // the 1000-entry cache is only a few milliseconds, so yielding every 20
      // items turned one change into seconds of idle waiting during bulk imports.
      if (Date.now() - sliceStarted >= 30) {
        await swYield(40);
        await this.yieldToForeground();
        if (this._stopped) break;
        sliceStarted = Date.now();
      }
    }
    while (this._recommendations.size > 1000)
      this._recommendations.delete(this._recommendations.keys().next().value);
  }

  // Synchronous helper for offline consumers; UI uses bounded Block-Max WAND.
  scoreTopK(queryKey, k, filter) {
    const query = this.search.docs.get(queryKey);
    if (!query || !Number.isFinite(k) || k < 1) return [];
    return [...this.search.docs.values()]
      .filter(
        (doc) => doc.key !== queryKey && (!filter || filter(doc.key, doc)),
      )
      .map((doc) => ({
        key: doc.key,
        score: this.search.similarity(query, doc),
        weak: doc.weak,
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, k);
  }

  scoreTopKAsync(
    queryKey,
    k,
    filter,
    cancelled = () => false,
    onProgress = (_progress) => {},
    restMs = 20,
    onSnapshot = (_revision, _hash, _epoch) => {},
  ) {
    return this.runTask(
      () =>
        this._scoreTopKAsync(
          queryKey,
          k,
          filter,
          cancelled,
          onProgress,
          restMs,
          onSnapshot,
        ),
      1,
    ).then((results) => results || []);
  }

  async _scoreTopKAsync(
    queryKey,
    k,
    filter,
    cancelled = () => false,
    onProgress = () => {},
    restMs = 20,
    onSnapshot = (_revision, _hash, _epoch) => {},
  ) {
    k = Math.floor(Number(k));
    if (!Number.isFinite(k) || k < 1 || this._stopped || cancelled()) return [];
    onSnapshot(this.revision, this.docs.get(queryKey)?.hash, this.search.epoch);
    return this.search.search(
      queryKey,
      Math.min(100, k),
      filter,
      () => this._stopped || cancelled(),
      () => swYield(Math.min(5, Math.max(0, restMs))),
      onProgress,
    );
  }

  close() {
    this._stopped = true;
    if (!this._closePromise) this._closePromise = this._close();
    return this._closePromise;
  }

  async _closeDatabase() {
    var db = this._db;
    this._db = null;
    if (db) {
      try {
        await db.close();
      } catch (e) {
        Zotero.logError(e);
      }
    }
    this._shutdownClient?.removeBlocker(this._shutdownBlocker);
    this._shutdownClient = null;
  }

  async _close() {
    // An in-progress open must finish before its connection can be closed.
    await this._ready;
    await this._taskDrain;
    await this._closeDatabase();
    this.search.docs.clear();
    this.search.byID.clear();
    this.search.postings.clear();
    this.search.df.clear();
    this.search.frozenDF.clear();
    this.docs.clear();
    this._recommendations.clear();
    this._sourceStates.clear();
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SWCorpus: SWCorpus, swYield: swYield };
}
