// Persistent local document embeddings. Inference runs outside Zotero's UI thread.
var SWSemantic = {
  model: "Xenova/all-MiniLM-L6-v2",
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  version: "minilm-l6-fp32-v2",
  dimensions: 384,
  assets: {
    "onnx/model.onnx":
      "759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e",
    "config.json":
      "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
    "tokenizer.json":
      "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    "tokenizer_config.json":
      "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
    "special_tokens_map.json":
      "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
  },
  vectors: new Map(),
  unavailable: new Map(),
  _recommendations: new Map(),
  _worker: null,
  _pending: new Map(),
  _sequence: 0,
  _generation: 0,
  _vectorRevision: 0,
  _queue: [],
  _queued: new Set(),
  _priority: new Set(),
  _running: null,
  _initializing: null,
  _stopped: false,
  _enabled: false,
  _loaded: null,
  _notifiedAt: 0,
  _startupTimer: null,
  _idleWait: null,
  _downloads: new Map(),
  _assetLoads: new Map(),
  _resourceHandler: null,
  status: { state: "disabled", indexedItems: 0, error: null },

  start(corpus) {
    if (!this._loaded) this._loaded = this._load(corpus);
    return this._loaded;
  },
  async _load(corpus) {
    this.corpus = corpus;
    await corpus.ready;
    if (this._stopped || corpus.progress.phase !== "ready") return;
    let afterKey = "",
      sliceStarted = Date.now();
    // Keep existing model vectors intact. Keyset pages bound startup memory
    // and let selection, cancellation and shutdown run between decoding slices.
    while (!this._stopped) {
      const rows =
        (await corpus._db?.execute(
          "SELECT key, sourceHash, vector FROM embeddings WHERE model = ? AND key > ? ORDER BY key LIMIT 100",
          [this.version, afterKey],
        )) || [];
      if (!rows.length) break;
      for (const row of rows) {
        if (this._stopped) return;
        const key = row.getResultByName("key"),
          hash = row.getResultByName("sourceHash");
        afterKey = key;
        if (corpus.docs.get(key)?.hash !== hash) continue;
        try {
          this.vectors.set(key, {
            hash,
            vector: this.decode(row.getResultByName("vector")),
          });
        } catch (error) {
          Zotero.logError(error);
        }
        if (Date.now() - sliceStarted >= 6) {
          await swYield(20);
          sliceStarted = Date.now();
        }
      }
      this.status.indexedItems = this.vectors.size;
      await swYield(20);
    }
    if (this._stopped) return;
    this.status.indexedItems = this.vectors.size;
    if (Zotero.isMac && !this._enabled && !this._startupTimer) {
      this._startupTimer = setTimeout(() => {
        this._startupTimer = null;
        if (!this._stopped) this.enable();
      }, 30000);
    }
  },

  enable() {
    if (this._stopped) return;
    clearTimeout(this._startupTimer);
    this._startupTimer = null;
    this._enabled = true;
    this.status.error = null;
    this.status.state = "waiting";
    SWIndexer._reportStatus(true);
    for (const key of this.corpus.docs.keys()) this.enqueue(key);
    if (!this._running && this._queue.length) this._pump();
    if (!this._running && !this._queue.length) this.status.state = "idle";
  },

  pause() {
    clearTimeout(this._startupTimer);
    this._startupTimer = null;
    this._idleWait?.();
    this._generation++;
    this._enabled = false;
    this._queue = [];
    this._queued.clear();
    this._priority.clear();
    this.status.state = "disabled";
    this._terminate("Semantic indexing paused");
  },

  enqueue(key, priority = false) {
    if (this._stopped || !this._enabled) return;
    const doc = this.corpus.docs.get(key);
    if (
      !doc ||
      this.vectors.get(key)?.hash === doc.hash ||
      this.unavailable.get(key) === doc.hash
    )
      return;
    this.unavailable.delete(key);
    const hadVector = this.vectors.delete(key);
    this.status.indexedItems = this.vectors.size;
    if (hadVector) this._applyVectorChange(key);
    if (this._queued.has(key)) {
      if (!priority) return;
      this._queue.splice(this._queue.indexOf(key), 1);
    } else this._queued.add(key);
    if (priority) {
      this._idleWait?.();
      this._priority.add(key);
      this._queue.unshift(key);
    } else this._queue.push(key);
    if (!this._running) this._pump();
  },

  _pump() {
    this._running = this._drain().finally(() => {
      this._running = null;
      if (
        !this._stopped &&
        this._enabled &&
        this.status.state !== "error" &&
        this._queue.length
      )
        this._pump();
    });
  },

  async _drain() {
    const generation = this._generation;
    try {
      // Let selection rendering and library startup settle first.
      await this._rest(2000, generation);
      while (
        !this._stopped &&
        this._enabled &&
        generation === this._generation &&
        this._queue.length
      ) {
        if (!this._priority.size) await this._idle();
        if (this._stopped || !this._enabled || generation !== this._generation)
          break;
        const key = this._queue.shift();
        this._queued.delete(key);
        this._priority.delete(key);
        await this._build(key, generation);
        await this._rest(3000, generation);
      }
      if (this._enabled && !this._stopped && generation === this._generation)
        this.status.state = "idle";
    } catch (error) {
      if (!this._stopped && this._enabled && generation === this._generation) {
        this._terminate(String(error.message || error));
        this.status.state = "error";
        this.status.error = String(error.message || error);
        Zotero.logError(error);
      }
    } finally {
      SWIndexer._reportStatus(true);
      SWSection.refreshSemantic();
    }
  },

  _idle() {
    const win = Zotero.getMainWindow?.();
    if (!win?.requestIdleCallback) return Promise.resolve();
    return new Promise((resolve) => {
      let id;
      const release = () => {
        if (id !== undefined) win.cancelIdleCallback(id);
        if (this._idleWait === release) this._idleWait = null;
        resolve();
      };
      this._idleWait = release;
      id = win.requestIdleCallback(release, { timeout: 1000 });
    });
  },

  async _rest(ms, generation = this._generation) {
    while (
      !this._stopped &&
      this._enabled &&
      generation === this._generation &&
      ms > 0 &&
      !this._priority.size
    ) {
      await swYield(Math.min(ms, 100));
      ms -= 100;
    }
  },

  async _build(key, generation = this._generation) {
    const doc = this.corpus.docs.get(key);
    if (!doc || this.vectors.get(key)?.hash === doc.hash) return;
    const slash = key.indexOf("/");
    const item = await Zotero.Items.getByLibraryAndKeyAsync(
      Number(key.slice(0, slash)),
      key.slice(slash + 1),
    );
    if (
      !item ||
      item.deleted ||
      generation !== this._generation ||
      !this._enabled
    )
      return;
    let body = "";
    if (!item.getField("abstractNote")) {
      // Existing text extraction may skip cached full text, so explicitly read
      // a small cached prefix here. Never trigger PDF extraction or OCR.
      const info = await SWIndexer.extractText(item, true);
      body = info?.weak ? "" : info?.content || "";
    }
    const texts = this.chunks(
      item.getField("title"),
      item.getField("abstractNote"),
      body,
    );
    if (!texts.length) {
      this.unavailable.set(key, doc.hash);
      return;
    }
    if (this._stopped || !this._enabled || generation !== this._generation)
      return;
    await this._init();
    this.status.state = "indexing";
    const result = await this._encode(texts);
    const vector = this.pool(
      result.vectors,
      texts.map((_, i) => (i === 0 ? 3 : 1)),
    );
    // A modification/deletion while inference ran invalidates its output.
    if (
      this._stopped ||
      !this._enabled ||
      generation !== this._generation ||
      this.corpus.docs.get(key)?.hash !== doc.hash
    )
      return;
    await this.corpus.runTask(async () => {
      if (this._stopped || this.corpus.docs.get(key)?.hash !== doc.hash) return;
      await this.corpus._db?.execute(
        "INSERT OR REPLACE INTO embeddings (key, sourceHash, model, vector, updatedAt) VALUES (?, ?, ?, ?, ?)",
        [key, doc.hash, this.version, this.encode(vector), Date.now()],
      );
      this.vectors.set(key, { hash: doc.hash, vector });
      this.status.indexedItems = this.vectors.size;
      this._applyVectorChange(key);
    });
    SWIndexer._reportStatus();
    if (
      Date.now() - this._notifiedAt > 30000 ||
      SWSection._active.some((p) => SWIndexer.docKey(p.item) === key)
    ) {
      this._notifiedAt = Date.now();
      SWSection.refreshSemantic();
    }
  },

  _encoding: Promise.resolve(),
  _encode(texts, active = () => true) {
    const generation = this._generation;
    const pending = this._encoding.then(() => {
      if (
        this._stopped ||
        !this._enabled ||
        generation !== this._generation ||
        !active()
      )
        throw new Error("Semantic encoding cancelled");
      if (!this._native) throw new Error("Native inference is not ready");
      return this._nativeEncode(texts, generation, active);
    });
    this._encoding = pending.catch(() => null);
    return pending;
  },

  _tagVectors: new Map(),
  _tagRunning: Promise.resolve(),

  tagSimilarity(item, names, active = () => true) {
    const work = async () => {
      const query = this.vectors.get(SWIndexer.docKey(item));
      if (
        !query ||
        this.corpus.docs.get(SWIndexer.docKey(item))?.hash !== query.hash ||
        !this._worker ||
        this.status.state === "loading" ||
        !this._enabled ||
        this._stopped ||
        !active()
      )
        return null;
      const generation = this._generation;
      const uniqueNames = [...new Set(names)];
      // Keep frequently reused topics warm while browsing different papers.
      for (const name of uniqueNames) {
        const cached = this._tagVectors.get(name);
        if (!cached) continue;
        this._tagVectors.delete(name);
        this._tagVectors.set(name, cached);
      }
      const missing = uniqueNames.filter((name) => !this._tagVectors.has(name));
      if (missing.length) {
        const result = await this._encode(missing, active);
        if (generation !== this._generation || this._stopped || !active())
          return null;
        missing.forEach((name, i) =>
          this._tagVectors.set(name, result.vectors[i]),
        );
        // This is a bounded, rebuildable session cache, never another document index.
        while (this._tagVectors.size > 512)
          this._tagVectors.delete(this._tagVectors.keys().next().value);
      }
      if (
        !active() ||
        this.corpus.docs.get(SWIndexer.docKey(item))?.hash !== query.hash
      )
        return null;
      return names.map((name) =>
        this.dot(query.vector, this._tagVectors.get(name)),
      );
    };
    const pending = this._tagRunning.then(work);
    this._tagRunning = pending.catch(() => null);
    return pending;
  },

  chunks(title, abstract, body) {
    const chunks = [];
    const split = (text, limit) => {
      const words = SWSearch.clean(String(text || ""))
        .split(/\s+/)
        .filter(Boolean);
      for (let i = 0; i < words.length && chunks.length < limit; i += 120) {
        const part = words
          .slice(i, i + 120)
          .join(" ")
          .slice(0, 1800);
        if (part) chunks.push(part);
      }
    };
    split(String(title || "") + ". " + String(abstract || ""), 3);
    if (!abstract) split(String(body || "").slice(0, 12000), 4);
    return chunks.filter((text) => /\p{L}/u.test(text));
  },

  pool(vectors, weights) {
    const pooled = new Float32Array(this.dimensions);
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector.length !== this.dimensions)
        throw new Error("Invalid embedding dimensions");
      const weight = weights[i];
      for (let j = 0; j < pooled.length; j++) pooled[j] += vector[j] * weight;
    }
    return this.normalize(pooled);
  },

  normalize(vector) {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
    const norm = Math.sqrt(sum);
    if (!Number.isFinite(norm) || !norm)
      throw new Error("Invalid embedding values");
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i] / norm;
    return vector;
  },

  encode(vector) {
    const bytes = new Uint8Array(vector.length * 4);
    if (vector instanceof Float32Array) {
      bytes.set(
        new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
      );
      return bytes;
    }
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < vector.length; i++)
      view.setFloat32(i * 4, vector[i], true);
    return bytes;
  },

  decode(bytes) {
    if (bytes.length !== this.dimensions * 4)
      throw new Error("Invalid stored embedding");
    // Reinterpret without a per-element DataView round trip. Copy so the typed
    // view is always four-byte aligned regardless of the BLOB's byteOffset.
    // mozStorage returns BLOBs as ordinary byte arrays, not typed views.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return this.normalize(new Float32Array(copy.buffer));
  },

  async search(
    key,
    k,
    filter,
    cancelled = () => false,
    progress = (_progress) => {},
  ) {
    const query = this.vectors.get(key);
    if (!query || this.corpus.docs.get(key)?.hash !== query.hash) return null;
    const best = new SWSearch.Heap(k);
    const qv = query.vector,
      dims = this.dimensions;
    let done = 0,
      sliceStarted = Date.now();
    for (const [candidate, doc] of this.vectors) {
      if (this._stopped || cancelled()) return [];
      const source = this.corpus.docs.get(candidate);
      if (
        candidate !== key &&
        source?.hash === doc.hash &&
        (!filter || filter(candidate, source))
      ) {
        const dv = doc.vector;
        let score = 0;
        for (let i = 0; i < dims; i++) score += qv[i] * dv[i];
        if (score > 0)
          best.add([candidate, Math.min(1, score), candidate, source.weak]);
      }
      if (++done % 100 === 0) {
        progress({ done, total: this.vectors.size });
        // Yield on elapsed CPU time rather than every 100 vectors; a 5000-doc
        // scan only takes a few milliseconds and previously paid hundreds of timers.
        if (Date.now() - sliceStarted >= 6) {
          await swYield(0);
          sliceStarted = Date.now();
        }
      }
    }
    progress({ done, total: done });
    if (this.corpus.docs.get(key)?.hash !== query.hash) return null;
    return best
      .sorted()
      .map(([candidate, score, _tie, weak]) => ({
        key: candidate,
        score,
        weak,
      }))
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  },

  dot(a, b) {
    let score = 0;
    for (let i = 0; i < this.dimensions; i++) score += a[i] * b[i];
    return score;
  },

  snapshot(key) {
    return {
      queryHash: this.corpus.docs.get(key)?.hash,
      revision: this.corpus.revision,
      epoch: this.corpus.search.epoch,
      vectorRevision: this._vectorRevision,
      generation: this._generation,
    };
  },

  async recommend(key, k, filter, cancelled = () => false) {
    return this.corpus.runTask(async () => {
      const snapshot = this.snapshot(key);
      const active = () => {
        const current = this.snapshot(key);
        return (
          !this._stopped &&
          !cancelled() &&
          Object.entries(snapshot).every(
            ([name, value]) => current[name] === value,
          )
        );
      };
      if (!snapshot.queryHash || !active()) return null;
      const lexical = await this.corpus.search.search(
        key,
        100,
        filter,
        () => !active(),
        () => swYield(0),
        () => {},
      );
      if (!active()) return null;
      const dense = await this.search(key, 100, filter, () => !active());
      if (!active()) return null;
      return {
        matches: SWSearch.fuse(
          [
            SWSearch.relevant(
              lexical,
              "text",
              Number(SWPref("minimumSimilarity", 0.05)),
            ),
            ...(dense ? [SWSearch.relevant(dense, "semantic")] : []),
          ],
          k,
        ),
        snapshot,
      };
    }, 1);
  },

  getRecommendations(key, includeWeak) {
    const cacheKey = JSON.stringify([key, includeWeak]);
    const cached = this._recommendations.get(cacheKey);
    if (!cached) return null;
    this._recommendations.delete(cacheKey);
    this._recommendations.set(cacheKey, cached);
    return cached;
  },

  recommendationsFresh(cached, key) {
    const snapshot = this.snapshot(key);
    return (
      !!cached &&
      !cached.dirty &&
      !!snapshot.queryHash &&
      Object.entries(snapshot).every(
        ([name, value]) => cached[name] === value,
      ) &&
      Date.now() - cached.computedAt < 24 * 60 * 60 * 1000
    );
  },

  async saveRecommendations(
    key,
    includeWeak,
    matches,
    snapshot = this.snapshot(key),
  ) {
    if (
      this._stopped ||
      !snapshot.queryHash ||
      !Object.entries(snapshot).every(
        ([name, value]) => this.snapshot(key)[name] === value,
      )
    )
      return;
    const cacheKey = JSON.stringify([key, includeWeak]);
    this._recommendations.set(cacheKey, {
      queryKey: key,
      includeWeak,
      ...snapshot,
      matches: matches.slice(0, 100),
      computedAt: Date.now(),
      dirty: false,
    });
    while (this._recommendations.size > 1000)
      this._recommendations.delete(this._recommendations.keys().next().value);
    await this.corpus.runTask(async () => {
      if (
        this._stopped ||
        !Object.entries(snapshot).every(
          ([name, value]) => this.snapshot(key)[name] === value,
        )
      )
        return;
      await this.corpus.saveHybridRecommendations(
        key,
        includeWeak,
        matches,
        snapshot,
        this.version,
      );
    });
  },

  forget(key) {
    const removed = this.vectors.delete(key);
    this.status.indexedItems = this.vectors.size;
    if (removed) this._applyVectorChange(key);
  },

  _applyVectorChange(key) {
    this._vectorRevision++;
    if (!this._recommendations.size) return;
    const slash = key.indexOf("/"),
      library = key.slice(0, slash);
    for (const [cacheKey, cached] of [...this._recommendations]) {
      if (cached.queryKey === key) {
        // The query's own vector moved: its ranking cannot be patched.
        this._recommendations.delete(cacheKey);
        continue;
      }
      const querySlash = cached.queryKey.indexOf("/");
      if (cached.queryKey.slice(0, querySlash) !== library) continue;
      // A changed dense rank can move every fused result. Recompute lazily;
      // a cosine score must never be patched into a reciprocal-rank cache.
      cached.dirty = true;
    }
  },

  async _init() {
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      if (!Zotero.isMac)
        throw new Error("Semantic recommendations currently require macOS");
      const win = Zotero.getMainWindow();
      if (!win) throw new Error("Open a Zotero window to initialize Semantic");
      this.status.state = "loading";
      const generation = this._generation;
      await this._startNative(generation);
      if (this._stopped || !this._enabled || generation !== this._generation)
        throw new Error("Native initialization cancelled");
      const handler = Services.io
        .getProtocolHandler("resource")
        .QueryInterface(Ci.nsIResProtocolHandler);
      this._resourceHandler = handler;
      handler.setSubstitution(
        "similar-works",
        Services.io.newURI(SWPlugin.rootURI),
      );
      this._worker = new win.Worker(
        "resource://similar-works/runtime/worker.js",
      );
      this._worker.onmessage = ({ data }) => {
        if (data.type === "asset") {
          void this._asset(data);
          return;
        }
        const pending = this._pending.get(data.id);
        this._pending.delete(data.id);
        clearTimeout(pending?.timer);
        if (data.error) pending?.reject(new Error(data.error));
        else pending?.resolve(data);
      };
      this._worker.onerror = (event) =>
        this._terminate(event.message || "Embedding worker failed");
      await this._request(
        "init",
        {
          model: this.model,
          revision: this.revision,
        },
        180000,
      );
    })();
    return this._initializing;
  },

  _native: null,
  _extracting: null,
  _nativeExit: Promise.resolve(),
  _nativeBuffer: "",

  _packageFile(name) {
    const { NetUtil } = ChromeUtils.importESModule(
      "resource://gre/modules/NetUtil.sys.mjs",
    );
    return new Promise((resolve, reject) => {
      const channel = NetUtil.newChannel({
        uri: SWPlugin.rootURI + name,
        loadUsingSystemPrincipal: true,
      });
      NetUtil.asyncFetch(channel, (stream, status) => {
        if (status) {
          reject(new Error("Packaged resource read failed: " + name));
          return;
        }
        try {
          resolve(
            new Uint8Array(NetUtil.readInputStream(stream, stream.available())),
          );
        } catch (error) {
          reject(error);
        }
      });
    });
  },

  async _startNative(generation) {
    const { Subprocess } = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(await this._packageFile("native/manifest.json")),
    );
    const names = ["inference", "libonnxruntime.1.22.0.dylib"];
    if (
      !manifest?.files ||
      names.some((name) => !/^[a-f0-9]{64}$/.test(manifest.files[name])) ||
      !/^[a-f0-9]{64}$/.test(manifest.runtime?.sha256) ||
      manifest.runtime?.url !==
        "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-osx-universal2-1.22.0.tgz" ||
      manifest.runtime?.member !==
        "onnxruntime-osx-universal2-1.22.0/lib/" + names[1]
    )
      throw new Error("Invalid native runtime manifest");
    const dir = SWStorage.runtime();
    await IOUtils.makeDirectory(dir, {
      createAncestors: true,
      ignoreExisting: true,
    });
    for (const name of names) {
      const path = PathUtils.join(dir, name);
      let valid = false;
      if (await IOUtils.exists(path))
        valid =
          (await IOUtils.computeHexDigest(path, "sha256")) ===
          manifest.files[name];
      if (!valid) {
        if (name === "inference") {
          const bytes = await this._packageFile("native/" + name);
          if ((await this._checksum(bytes)) !== manifest.files[name])
            throw new Error("Native helper checksum mismatch");
          if (
            this._stopped ||
            !this._enabled ||
            generation !== this._generation
          )
            throw new Error("Native initialization cancelled");
          await IOUtils.write(path, bytes, { tmpPath: path + ".tmp" });
        } else {
          await this._downloadRuntime(
            manifest.runtime,
            path,
            manifest.files[name],
            generation,
          );
        }
      }
    }
    const command = PathUtils.join(dir, "inference");
    await IOUtils.setPermissions(command, 0o700);
    await this._modelFile("onnx/model.onnx");
    if (this._stopped || !this._enabled || generation !== this._generation)
      throw new Error("Native initialization cancelled");
    const model = PathUtils.join(SWStorage.model(), "model.onnx");
    const process = await Subprocess.call({
      command,
      arguments: [model],
      stderr: "pipe",
    });
    if (this._stopped || !this._enabled || generation !== this._generation) {
      await process.kill(0);
      throw new Error("Native initialization cancelled");
    }
    this._native = process;
    this._nativeBuffer = "";
    // Drain stderr so a full pipe cannot block inference. Keep the latest diagnostic.
    void (async () => {
      try {
        while (this._native === process) {
          const text = await process.stderr.readString();
          if (!text) break;
          this.status.nativeDiagnostic = text.slice(-2000);
        }
      } catch (error) {
        if (this._native === process) Zotero.logError(error);
      }
    })();
    const ready = await this._nativeReply(process, 180000);
    if (!ready.ready)
      throw new Error(ready.error || "Native model did not initialize");
    this.status.backend = ready.backend;
    Zotero.debug("[knowledge-base] Semantic backend: " + ready.backend);
  },

  async _downloadRuntime(asset, destination, checksum, generation) {
    const checkActive = () => {
      if (this._stopped || !this._enabled || generation !== this._generation)
        throw new Error("Native runtime preparation cancelled");
    };
    checkActive();
    this.status.state = "downloading";
    SWIndexer._reportStatus(true);
    const staging = await IOUtils.createUniqueDirectory(
      PathUtils.parent(destination),
      "download",
      0o700,
    );
    const archive = PathUtils.join(staging, "runtime.tgz");
    let process;
    try {
      checkActive();
      const xhr = await Zotero.HTTP.request("GET", asset.url, {
        responseType: "arraybuffer",
        timeout: 180000,
        requestObserver: (request) => this._downloads.set(archive, request),
      });
      checkActive();
      const bytes = new Uint8Array(xhr.response);
      if ((await this._checksum(bytes)) !== asset.sha256)
        throw new Error("Native runtime archive checksum mismatch");
      checkActive();
      await IOUtils.write(archive, bytes);
      checkActive();
      this.status.state = "loading";
      SWIndexer._reportStatus(true);
      const { Subprocess } = ChromeUtils.importESModule(
        "resource://gre/modules/Subprocess.sys.mjs",
      );
      // Extract only the verified library, using macOS's existing archive tool.
      process = await Subprocess.call({
        command: "/usr/bin/tar",
        arguments: ["-xzf", archive, "-C", staging, asset.member],
        stderr: "stdout",
      });
      checkActive();
      this._extracting = process;
      const [result, diagnostic] = await Promise.all([
        process.wait(),
        process.stdout.readString(),
      ]);
      checkActive();
      if (result.exitCode !== 0)
        throw new Error("Native runtime extraction failed: " + diagnostic);
      const library = PathUtils.join(staging, ...asset.member.split("/"));
      if ((await IOUtils.computeHexDigest(library, "sha256")) !== checksum)
        throw new Error("Native runtime library checksum mismatch");
      checkActive();
      await IOUtils.move(library, destination);
    } finally {
      this._downloads.delete(archive);
      if (this._extracting === process) this._extracting = null;
      try {
        if (process) await process.kill(0);
      } finally {
        await IOUtils.remove(staging, { recursive: true });
      }
    }
  },

  async _nativeReply(process, timeout = 30000) {
    let timer;
    const read = async () => {
      while (this._native === process) {
        const index = this._nativeBuffer.indexOf("\n");
        if (index >= 0) {
          const line = this._nativeBuffer.slice(0, index);
          this._nativeBuffer = this._nativeBuffer.slice(index + 1);
          const value = JSON.parse(line);
          if (value.error) throw new Error(value.error);
          return value;
        }
        const part = await process.stdout.readString();
        if (!part) throw new Error("Native inference process exited");
        this._nativeBuffer += part;
        if (this._nativeBuffer.length > 65536)
          throw new Error("Native response too large");
      }
      throw new Error("Native inference cancelled");
    };
    try {
      return await Promise.race([
        read(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            this._terminate("Native inference timed out");
            reject(new Error("Native inference timed out"));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  },

  async _nativeEncode(texts, generation, active) {
    const process = this._native;
    const { inputs } = await this._request("tokenize", { texts });
    const vectors = [];
    for (const input of inputs) {
      if (
        this._stopped ||
        !this._enabled ||
        generation !== this._generation ||
        !active() ||
        this._native !== process
      )
        throw new Error("Native inference cancelled");
      await process.stdin.write(JSON.stringify(input) + "\n");
      const result = await this._nativeReply(process);
      if (
        !Array.isArray(result.vector) ||
        result.vector.length !== this.dimensions ||
        result.vector.some((n) => !Number.isFinite(n))
      )
        throw new Error("Invalid native embedding");
      this.status.backend = result.backend;
      vectors.push(new Float32Array(result.vector));
    }
    return { vectors };
  },

  async _checksum(bytes) {
    const digest = await Zotero.getMainWindow().crypto.subtle.digest(
      "SHA-256",
      bytes,
    );
    return Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
  },

  _request(type, payload, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error("Embedding worker stopped"));
        return;
      }
      const id = ++this._sequence;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("Embedding request timed out"));
        this._terminate("Embedding request timed out");
      }, timeout);
      this._pending.set(id, { resolve, reject, timer });
      this._worker.postMessage({ id, type, ...payload });
    });
  },

  async _asset(request) {
    const worker = this._worker;
    try {
      const filename = request.url
        .split("/resolve/")[1]
        ?.split("/")
        .slice(1)
        .join("/");
      if (!filename) throw new Error("Unknown embedding asset");
      const bytes = (await this._modelFile(filename)).slice();
      if (worker && worker === this._worker)
        worker.postMessage({ type: "asset-result", id: request.id, bytes }, [
          bytes.buffer,
        ]);
    } catch (error) {
      if (worker && worker === this._worker)
        worker.postMessage({
          type: "asset-result",
          id: request.id,
          error: String(error.message || error),
        });
    }
  },

  _modelFile(filename) {
    if (this._assetLoads.has(filename)) return this._assetLoads.get(filename);
    const work = this._readModelFile(filename).finally(() => {
      if (this._assetLoads.get(filename) === work)
        this._assetLoads.delete(filename);
    });
    this._assetLoads.set(filename, work);
    return work;
  },

  async _readModelFile(filename) {
    const generation = this._generation;
    if (!Object.hasOwn(this.assets, filename)) {
      // Transformers asks for optional configuration files. They have no model code.
      if (/^[a-z_]+\.json$/.test(filename))
        return new TextEncoder().encode("{}");
      throw new Error("Unknown embedding asset: " + filename);
    }
    const dir = SWStorage.model();
    const file = PathUtils.join(dir, filename.split("/").pop());
    if (await IOUtils.exists(file)) {
      try {
        const bytes = await IOUtils.read(file);
        await this._validateAsset(filename, bytes);
        return bytes;
      } catch (error) {
        Zotero.logError(error);
      }
    }
    if (this._stopped || !this._enabled || generation !== this._generation)
      throw new Error("Embedding download cancelled");
    this.status.state = "downloading";
    SWIndexer._reportStatus(true);
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    let error;
    for (const host of ["https://huggingface.co", "https://hf-mirror.com"]) {
      if (this._stopped || !this._enabled || generation !== this._generation)
        throw new Error("Embedding download cancelled");
      try {
        const xhr = await Zotero.HTTP.request(
          "GET",
          `${host}/${this.model}/resolve/${this.revision}/${filename}`,
          {
            responseType: "arraybuffer",
            timeout: host === "https://huggingface.co" ? 15000 : 120000,
            requestObserver: (request) => {
              this._downloads.set(file, request);
            },
          },
        );
        const bytes = new Uint8Array(xhr.response);
        await this._validateAsset(filename, bytes);
        if (this._stopped || !this._enabled || generation !== this._generation)
          throw new Error("Embedding download cancelled");
        await IOUtils.write(file, bytes, { tmpPath: file + ".tmp" });
        return bytes;
      } catch (caught) {
        error = caught;
      } finally {
        this._downloads.delete(file);
      }
    }
    throw error;
  },

  async _validateAsset(filename, bytes) {
    const hex = await this._checksum(bytes);
    if (hex !== this.assets[filename])
      throw new Error("Embedding asset checksum mismatch: " + filename);
  },

  _terminate(reason) {
    const native = this._native;
    const extracting = this._extracting;
    this._native = null;
    this._extracting = null;
    if (native || extracting)
      this._nativeExit = Promise.allSettled([
        this._nativeExit,
        ...[native, extracting]
          .filter(Boolean)
          .map((process) =>
            process.kill(0).catch((error) => Zotero.logError(error)),
          ),
      ]).then(() => undefined);
    this._worker?.terminate();
    this._worker = null;
    this._initializing = null;
    this._resourceHandler?.setSubstitution("similar-works", null);
    this._resourceHandler = null;
    this._assetLoads.clear();
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this._pending.clear();
    for (const request of this._downloads.values()) request.abort();
    this._downloads.clear();
  },

  stop() {
    const initializing = this._initializing;
    this._stopped = true;
    clearTimeout(this._startupTimer);
    this._startupTimer = null;
    this.pause();
    // Initialization may be awaiting Subprocess.call when stop clears its handle.
    this._nativeExit = Promise.allSettled([
      this._nativeExit,
      initializing,
    ]).then(() => undefined);
    this.status.state = "stopped";
  },
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { SWSemantic };
