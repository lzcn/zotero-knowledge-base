const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

// Small DOM fixture: exercise the actual render callbacks without a browser dependency.
class Element {
  constructor(tag, doc) {
    this.tag = tag;
    this.ownerDocument = doc;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.isConnected = true;
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  appendChild(n) {
    this.append(n);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
  setAttribute(k, v) {
    this[k] = v;
  }
  removeAttribute(k) {
    delete this[k];
  }
  addEventListener(k, fn) {
    this.listeners[k] = fn;
  }
  checkValidity() {
    return Number(this.value) >= 1 && Number(this.value) <= 100;
  }
  reportValidity() {}
  closest() {
    return { open: this.open !== false };
  }
  querySelectorAll(selector) {
    const match = (n) =>
      selector.startsWith(".")
        ? n.className === selector.slice(1)
        : selector.startsWith("input[type=")
          ? n.tag === "input" && n.type === selector.slice(11, -1)
          : n.tag === selector;
    return this.children.flatMap((n) => [
      ...(match(n) ? [n] : []),
      ...n.querySelectorAll(selector),
    ]);
  }
  querySelector(s) {
    return this.querySelectorAll(s)[0] || null;
  }
}

function harness() {
  const items = new Map(),
    prefs = new Map([["similar-works.minFulltextTerms", 1]]);
  const files = new Map(),
    queued = [],
    errors = [],
    selected = [];
  const doc = {
    createElementNS(ns, tag) {
      assert.equal(ns, "http://www.w3.org/1999/xhtml");
      return new Element(tag, doc);
    },
    l10n: {
      async formatValue() {
        return "";
      },
    },
    defaultView: {
      ZoteroPane: {
        selectItem(id) {
          selected.push(id);
        },
      },
    },
  };
  const Zotero = {
    Prefs: {
      get: (k) => prefs.get(k),
      set: (k, v) => prefs.set(k, v),
      prefHasUserValue: (k) => prefs.has(k),
      clear: (k) => prefs.delete(k),
    },
    Promise: { delay: async () => {} },
    logError: (e) => errors.push(e),
    Items: {
      async getAsync(id) {
        return Array.isArray(id) ? id.map((i) => items.get(i)) : items.get(id);
      },
      async getByLibraryAndKeyAsync(lib, key) {
        return [...items.values()].find(
          (i) => i.libraryID === lib && i.key === key,
        );
      },
      async getAll(lib) {
        return [...items.values()]
          .filter((i) => i.libraryID === lib && !i.deleted && !i.parentItemID)
          .map((i) => i.id);
      },
    },
    Tags: { getAll: async () => [], getColors: () => new Map() },
    Libraries: { getAll: () => [{ id: 1 }] },
    Fulltext: {
      isCachedMIMEType: (mime) => mime === "application/pdf",
      getItemCacheFile: (att) => ({ path: "/cache/" + att.key }),
      async queueItem(att) {
        queued.push(att.id);
      },
    },
    DB: { valueQueryAsync: async () => 50 },
    ItemPaneManager: {
      registerSection: (opts) => {
        Zotero.hooks = opts;
        return "namespaced-pane";
      },
      unregisterSection: (id) => {
        Zotero.unregistered = id;
      },
    },
  };
  const context = vm.createContext({
    Zotero,
    SWPlugin: { id: "test" },
    TextDecoder,
    setTimeout,
    clearTimeout,
    IOUtils: {
      exists: async (p) => files.has(p),
      read: async (p) => new TextEncoder().encode(files.get(p)),
      stat: async (p) => ({ lastModified: 1, size: files.get(p).length }),
    },
  });
  for (const file of [
    "storage",
    "stemmer",
    "tokenizer",
    "search",
    "corpus",
    "indexer",
    "tag-policy",
    "tag-terms",
    "tag-format",
    "tags",
    "tag-suggestions",
    "section",
  ]) {
    vm.runInContext(
      fs.readFileSync(
        path.join(__dirname, "../../src/library/" + file + ".js"),
        "utf8",
      ),
      context,
    );
  }
  context.SWTagTerms.set(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../addon/content/library/tag-terms.json"),
        "utf8",
      ),
    ),
  );
  context.SWLibrarySources = {
    async scan(_cancelled, documentID = null) {
      return {
        items: new Map(
          [...items.values()].map((i) => [
            i.id,
            { key: i.libraryID + "/" + i.key, parentID: i.parentItemID },
          ]),
        ),
        documents: [...items.values()]
          .filter(
            (i) =>
              !i.deleted &&
              !i.parentItemID &&
              !i.isNote() &&
              (documentID === null || documentID === i.id),
          )
          .map((i) => ({
            id: i.id,
            key: i.libraryID + "/" + i.key,
            stamp: JSON.stringify([
              i.getField("title"),
              i.getField("abstractNote"),
              i.getCreators(),
              [...items.values()]
                .filter((a) => a.parentItemID === i.id && !a.deleted)
                .map((a) => [a.id, files.get("/cache/" + a.key)]),
            ]),
          })),
      };
    },
  };
  const corpus = vm.runInContext("new SWCorpus()", context);
  corpus._ready = Promise.resolve();
  corpus._resolveOpened();
  corpus.progress.phase = "ready";
  corpus.search.epoch = 1;
  context.SWIndexer.corpus = corpus;
  function item(id, title, parentItemID, libraryID = 1) {
    const it = {
      id,
      key: "KEY" + id,
      libraryID,
      parentItemID,
      deleted: false,
      isFeedItem: false,
      isNote: () => false,
      isAttachment: () => !!parentItemID,
      isRegularItem: () => !parentItemID,
      getField: (field) => (field === "title" ? title : ""),
      getCreators: () => [],
      getBestAttachment: async () =>
        [...items.values()].find((a) => a.parentItemID === id && !a.deleted),
      getAttachments: () =>
        [...items.values()]
          .filter((a) => a.parentItemID === id && !a.deleted)
          .map((a) => a.id),
      attachmentContentType: "application/pdf",
      fileExists: async () => true,
    };
    items.set(id, it);
    return it;
  }
  return {
    ...context,
    context,
    corpus,
    item,
    doc,
    items,
    files,
    prefs,
    queued,
    errors,
    selected,
    body: new Element("div", doc),
  };
}

test("attachment updates index the parent once; cache replaces metadata; trash keeps parent", async () => {
  const h = harness(),
    parent = h.item(1, "neural machine learning"),
    att = h.item(2, "attachment", 1);
  await h.SWIndexer.processItem(att);
  assert.equal(h.corpus.docs.get("1/KEY1").weak, true);
  assert.equal(h.corpus.docs.has("1/KEY2"), false);
  assert.deepEqual(
    h.queued,
    [],
    "reuse existing Zotero index without scheduling PDF extraction",
  );
  await h.SWIndexer.processItem(parent);
  assert.deepEqual(h.queued, []);
  h.files.set(
    "/cache/KEY2",
    "neural network learning optimization parameters ".repeat(4),
  );
  h.SWIndexer._onNotify("index", "item", [2]);
  await h.SWIndexer._drainPromise;
  assert.equal(h.corpus.docs.get("1/KEY1").weak, false);
  att.deleted = true;
  await h.SWIndexer._removeById(2);
  await h.SWIndexer._drainPromise;
  assert.equal(h.corpus.docs.get("1/KEY1").weak, true);
  assert.equal(h.corpus.n, 1);
  assert.equal(h.errors.length, 0);
});

test("permanent deletion uses notifier identity; startup prunes stale and child vectors", async () => {
  const h = harness();
  h.item(1, "machine learning");
  await h.corpus.upsertDoc("1/GONE", "x", false, new Map([["machine", 1]]));
  await h.SWIndexer._removeById(99, { libraryID: 1, key: "GONE" });
  assert.equal(h.corpus.n, 0);
  await h.corpus.upsertDoc("1/STALE", "x", false, new Map([["machine", 1]]));
  h.prefs.set("similar-works.backgroundIndexing", false);
  await h.SWIndexer.enqueueLibrary();
  assert.equal(h.corpus.n, 0);
});

test("sidebar ranks top K in same library, preserves rows during indexing, and navigates each row", async () => {
  const h = harness();
  const query = h.item(1, "neural machine learning"),
    a = h.item(2, "neural machine learning"),
    b = h.item(3, "machine learning algorithm"),
    other = h.item(4, "neural machine learning", null, 2);
  for (const it of [query, a, b, other]) await h.SWIndexer.processItem(it);
  h.prefs.set("similar-works.maxRecommendations", 2);
  h.SWIndexer._draining = true;
  let summary;
  const props = {
    body: h.body,
    item: query,
    tabType: "library",
    setSectionSummary: (s) => (summary = s),
  };
  await h.SWSection.renderBody(props, true);
  const rows = h.body.querySelectorAll(".sw-row");
  assert.equal(rows.length, 2);
  assert.equal(summary, "");
  assert.doesNotMatch(
    h.body.querySelector(".sw-status").textContent,
    /index|comput/i,
  );
  await rows[0].listeners.click();
  await rows[1].listeners.click();
  assert.deepEqual(h.selected, [2, 3]);
  assert.equal(
    rows[0].title,
    undefined,
    "recommendations do not expose technical hover text",
  );
  assert.equal(h.SWSection._active.length, 1);
  await h.SWSection.renderBody(props, true);
  assert.equal(
    h.SWSection._active.length,
    1,
    "refresh does not duplicate bodies",
  );
  assert.equal(h.body.querySelector("input[type=number]"), null);
  assert.equal(h.body.querySelector("input[type=checkbox]"), null);
  h.prefs.set("similar-works.maxRecommendations", 1);
  await h.SWSection.renderBody(props, true);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  h.prefs.set("similar-works.allowMetadataOnlyRecommendations", false);
  await h.SWSection.renderBody(props, true);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  assert.equal(h.errors.length, 0);
});

test("the initial batch hides counts and never pads weak results", async () => {
  const h = harness();
  const query = h.item(1, "machine learning");
  for (let i = 1; i <= 31; i++)
    await h.SWIndexer.processItem(
      i === 1 ? query : h.item(i, "machine learning"),
    );
  // Ignore a legacy hidden preference rather than carrying its old limit forward.
  h.prefs.set("similar-works.recommendationCount", 10);
  let summary;
  const props = {
    body: h.body,
    item: query,
    setSectionSummary: (value) => (summary = value),
  };
  await h.SWSection.renderBody(props, true);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 20);
  assert.equal(summary, "");
  const rows = await h.SWSection._resolveRows([
    { key: "1/KEY2", score: 0.05, weak: true },
    { key: "1/KEY3", score: 0.049, weak: true },
    { key: "1/KEY4", score: NaN, weak: true },
  ]);
  assert.equal(
    rows.length,
    1,
    "threshold is inclusive and invalid scores are excluded",
  );
  h.corpus.scoreTopKAsync = async () => [
    { key: "1/KEY2", score: 0.04, weak: true },
  ];
  await h.SWSection.renderBody(props, true);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 0);
  assert.equal(summary, "");
});

test("switching items during a delayed render discards previous results; closed pane is lazy", async () => {
  const h = harness(),
    q = h.item(1, "machine learning"),
    a = h.item(2, "machine learning"),
    b = h.item(3, "cooking tomato pasta");
  for (const it of [q, a, b]) await h.SWIndexer.processItem(it);
  let release,
    calls = 0;
  const ensure = h.SWIndexer.ensureNow.bind(h.SWIndexer);
  h.SWIndexer.ensureNow = async (it) => {
    calls++;
    if (it === q) await new Promise((resolve) => (release = resolve));
    return ensure(it);
  };
  const pending = h.SWSection.renderBody({ body: h.body, item: q }, true);
  await new Promise((resolve) => setImmediate(resolve));
  await h.SWSection.renderBody({ body: h.body, item: b }, true);
  release();
  await pending;
  assert.equal(h.body["aria-busy"], "false");
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, true);
  assert.match(h.body.querySelector(".sw-status").textContent, /No similar/);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 0);
  h.body.open = false;
  await h.SWSection.renderBody({ body: h.body, item: a }, true);
  assert.equal(calls, 2);
});

test("background updates keep existing rows until explicit refresh finishes", async () => {
  const h = harness(),
    q = h.item(1, "machine learning"),
    a = h.item(2, "machine learning");
  for (const it of [q, a]) await h.SWIndexer.processItem(it);
  const props = { body: h.body, item: q };
  await h.SWSection.renderBody(props, true);
  const original = h.body.querySelector(".sw-row");
  await h.SWIndexer.processItem(h.item(3, "machine learning"));
  assert.equal(
    h.body.querySelector(".sw-row"),
    original,
    "background vector updates leave the current results unchanged",
  );
  let release;
  const ensure = h.SWIndexer.ensureNow.bind(h.SWIndexer);
  h.SWIndexer.ensureNow = async (it) => {
    await new Promise((resolve) => (release = resolve));
    return ensure(it);
  };
  const pending = h.SWSection.renderBody(props, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    h.body.querySelector(".sw-row"),
    original,
    "no intermediate clear while computing",
  );
  assert.doesNotMatch(
    h.body.querySelector(".sw-status").textContent,
    /Computing|Updated|Preparing/,
  );
  assert.equal(h.body["aria-busy"], "true");
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, false);
  const computeToken = h.body._swToken;
  await h.SWSection.renderBody(props);
  assert.equal(
    h.body._swToken,
    computeToken,
    "progress refresh cannot cancel a manual calculation",
  );
  release();
  await pending;
  assert.equal(h.body["aria-busy"], "false");
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, true);
  assert.doesNotMatch(
    h.body.querySelector(".sw-status").textContent,
    /Computing|Updated|Preparing/,
  );
  h.SWSection.shutdown();
});

test("opening computes once; fresh cache is reused; stale cache stays visible during revalidation", async () => {
  const h = harness(),
    q = h.item(1, "machine learning"),
    a = h.item(2, "machine learning");
  for (const it of [q, a]) await h.SWIndexer.processItem(it);
  const props = { body: h.body, item: q };
  let calculations = 0;
  const score = h.corpus.scoreTopKAsync.bind(h.corpus);
  h.corpus.scoreTopKAsync = (...args) => {
    calculations++;
    return score(...args);
  };
  await h.SWSection.renderBody(props);
  assert.equal(calculations, 1);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  await h.SWSection.renderBody(props);
  assert.equal(calculations, 1, "unchanged index reuses cache");
  await h.SWSection.renderBody(props, true);
  assert.equal(calculations, 2, "explicit refresh bypasses cache");
  await h.SWIndexer.processItem(h.item(3, "machine learning algorithm"));
  await h.SWSection.renderBody(props);
  assert.equal(calculations, 2, "reverse update avoids a full recalculation");
  assert.equal(h.body.querySelectorAll(".sw-row").length, 2);
  const cached = await h.corpus.getRecommendations("1/KEY1", true);
  cached.dirty = true;
  let release;
  h.corpus.scoreTopKAsync = async (...args) => {
    calculations++;
    await new Promise((r) => (release = r));
    return score(...args);
  };
  const original = h.body.querySelector(".sw-row");
  const pending = h.SWSection.renderBody(props);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.body.querySelector(".sw-row"), original);
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, true);
  await h.SWSection.renderBody(props);
  assert.equal(
    calculations,
    3,
    "duplicate render does not start another calculation",
  );
  release();
  await pending;
  assert.equal(h.body.querySelectorAll(".sw-row").length, 2);
});

test("database recommendations survive restart; neighbor changes invalidate freshness but age alone does not", async () => {
  const h = harness(),
    payloads = new Map();
  h.corpus._db = {
    async executeTransaction(fn) {
      await fn();
    },
    async execute(sql, args) {
      if (sql.startsWith("INSERT OR REPLACE INTO recommendations"))
        payloads.set(args[0], args[1]);
      if (sql.startsWith("UPDATE recommendations SET payload"))
        payloads.set(args[1], args[0]);
      if (sql.startsWith("SELECT cacheKey, payload"))
        return [...payloads].map(([cacheKey, payload]) => ({
          getResultByName: (name) => ({ cacheKey, payload })[name],
        }));
      if (sql.startsWith("SELECT payload"))
        return payloads.has(args[0])
          ? [{ getResultByName: () => payloads.get(args[0]) }]
          : [];
      return [];
    },
  };
  await h.corpus.upsertDoc("1/A", "a", false, new Map([["learning", 2]]));
  await h.corpus.saveRecommendations(
    "1/A",
    true,
    [{ key: "1/B", score: 0.9, weak: false }],
    h.corpus.revision,
    "a",
  );
  h.corpus._recommendations.clear();
  const cached = await h.corpus.getRecommendations("1/A", true);
  assert.equal(cached.matches[0].score, 0.9);
  assert.equal(h.corpus.recommendationsFresh(cached, "1/A"), true);
  assert.equal(
    await h.corpus.getRecommendations("1/A", false),
    null,
    "filter caches are independent",
  );
  cached.computedAt -= 25 * 60 * 60 * 1000;
  assert.equal(h.corpus.recommendationsFresh(cached, "1/A"), true);
  cached.computedAt = Date.now();
  await h.corpus.upsertDoc("1/C", "c", false, new Map([["unrelated", 1]]));
  assert.equal(h.corpus.recommendationsFresh(cached, "1/A"), true);
  const revision = h.corpus.revision;
  await h.corpus.upsertDoc("1/B", "b", false, new Map([["learning", 1]]));
  assert.equal(h.corpus.recommendationsFresh(cached, "1/A"), false);
  h.corpus._recommendations.clear();
  assert.equal(
    (await h.corpus.getRecommendations("1/A", true)).dirty,
    true,
    "neighbor invalidation survives restart",
  );
  await h.corpus.saveRecommendations("1/A", true, [], revision, "a");
  assert.equal(
    (await h.corpus.getRecommendations("1/A", true)).matches.length,
    1,
    "obsolete in-flight results cannot overwrite cache",
  );
  payloads.set(JSON.stringify(["1/C", true]), "invalid JSON");
  assert.equal(
    await h.corpus.getRecommendations("1/C", true),
    null,
    "bad cache is recoverable",
  );
});

test("cooperative tokenization keeps word and CJK boundaries; unchanged PDFs skip reads", async () => {
  const h = harness();
  const text = "machine learning 参数优化 neural-network 数据分析 ".repeat(200);
  const batched = await h.SWIndexer.termFreqInBackground(text);
  const direct = h.SWTokenizer.termFreq(text, { minLength: 2 });
  assert.deepEqual([...batched], [...direct]);
  const q = h.item(1, "machine learning");
  h.item(2, "PDF", 1);
  h.files.set("/cache/KEY2", text);
  let reads = 0;
  const read = h.context.IOUtils.read;
  h.context.IOUtils.read = (...args) => {
    reads++;
    return read(...args);
  };
  await h.SWIndexer.processItem(q);
  await h.SWIndexer.processItem(q);
  assert.equal(
    reads,
    1,
    "matching cache fingerprint avoids repeated fulltext reads",
  );
  const asyncScores = await h.corpus.scoreTopKAsync("1/KEY1", 10);
  assert.deepEqual(asyncScores, h.corpus.scoreTopK("1/KEY1", 10));
});

test("SQLite persists source modification times and vector revisions without score caches", async () => {
  const h = harness(),
    timestamps = new Map(),
    sources = new Map(),
    sqls = [];
  const counts = new Map();
  h.corpus.search.epoch = 1;
  let revision = 0,
    transactions = 0;
  h.corpus._db = {
    async executeTransaction(fn) {
      transactions++;
      await fn();
    },
    async execute(sql, args) {
      sqls.push(sql);
      if (sql.startsWith("INSERT OR REPLACE INTO fingerprints"))
        counts.set(args[0], args[1]);
      if (sql.startsWith("SELECT counts FROM fingerprints"))
        return counts.has(args[0])
          ? [{ getResultByName: () => counts.get(args[0]) }]
          : [];
      if (sql.includes("'corpusRevision', ?")) revision = Number(args[0]);
      if (sql.startsWith("INSERT OR REPLACE INTO doc_updates"))
        timestamps.set(args[0], args[1]);
      if (sql.startsWith("INSERT OR REPLACE INTO source_updates"))
        sources.set(args[0], args.slice(1));
      return [];
    },
  };
  await h.corpus.recordSource("1/A", "2026-10-02 01:00:00", "source-v1");
  await h.corpus.upsertDoc(
    "1/A",
    "source-v1",
    false,
    new Map([["learning", 2]]),
  );
  assert.equal(transactions, 1);
  assert.equal(revision, 1);
  assert.ok(timestamps.get("1/A") > 0);
  assert.equal(sources.get("1/A")[0], "2026-10-02 01:00:00");
  const count = sqls.length;
  await h.corpus.recordSource("1/A", "2026-10-02 01:00:00", "source-v1");
  assert.equal(
    sqls.length,
    count,
    "unchanged source does not cause another database write",
  );
  await h.corpus.upsertDoc(
    "1/A",
    "source-v2",
    false,
    new Map([["learning", 3]]),
  );
  assert.equal(revision, 2);
  assert.ok(sqls.some((sql) => sql.includes("fingerprints")));
});

test("K validation, identical document scores, and nested view cleanup", async () => {
  const h = harness();
  for (const [v, expected] of [
    [0, 20],
    ["bad", 20],
    [999, 100],
    [2.8, 2],
    ["5", 5],
  ]) {
    assert.equal(h.SWResultLimit(v), expected);
  }
  await h.corpus.upsertDoc("1/A", "a", false, new Map([["learning", 3]]));
  await h.corpus.upsertDoc("1/B", "b", true, new Map([["learning", 3]]));
  assert.equal(h.corpus.scoreTopK("1/A", 1)[0].score, 1);
  assert.equal(h.corpus.scoreTopK("1/A", -1).length, 0);
  assert.equal(h.corpus.scoreTopK("1/A", 5, (_, d) => !d.weak).length, 0);
  h.SWSection.init("file:///test/");
  h.Zotero.hooks = h.SWSection.getItemPaneCallbacks();
  h.SWSection.shutdown();
  assert.equal(h.Zotero.unregistered, undefined);
  assert.equal(h.SWSection._stopped, true);
});

test("TXT uses Zotero cache and concurrent attachment renders stay canonical", async () => {
  const h = harness(),
    parent = h.item(1, "machine learning"),
    att = h.item(2, "text file", 1);
  att.attachmentContentType = "text/plain";
  att.getFilePathAsync = async () => "/plain.txt";
  h.files.set(
    "/plain.txt",
    "machine neural learning ".repeat(10) + "unindexedending",
  );
  assert.equal(await h.SWIndexer.attachmentText(att), null);
  h.files.set(
    "/cache/KEY2",
    "machine neural learning ".repeat(10).slice(0, 50),
  );
  const text = await h.SWIndexer.attachmentText(att);
  assert.equal(text.content.length, 50);
  assert.equal(text.content.includes("unindexedending"), false);
  await Promise.all([
    h.SWIndexer.processItem(att),
    h.SWIndexer.processItem(parent),
  ]);
  assert.equal(h.corpus.n, 1);
  assert.equal(h.corpus.docs.get("1/KEY1").weak, false);
  assert.equal(h.errors.length, 0);
});

test("embedded module loads Zotero globals and closes SQLite on shutdown", async () => {
  const h = harness();
  h.prefs.set("similar-works.backgroundIndexing", false);
  let closed = false;
  const blockers = new Set();
  h.Zotero.File = {
    getResourceAsync: async () =>
      fs.readFileSync(
        path.join(__dirname, "../../addon/content/library/tag-terms.json"),
        "utf8",
      ),
  };
  h.Zotero.DataDirectory = { dir: "/data" };
  h.Zotero.DB.queryAsync = async () => [];
  h.Zotero.initializationPromise = Promise.resolve();
  h.Zotero.getMainWindows = () => [];
  h.Zotero.Notifier = {
    registerObserver: () => 1,
    unregisterObserver: () => {},
  };
  h.IOUtils.makeDirectory = async () => {};
  const env = {
    Zotero: h.Zotero,
    IOUtils: h.IOUtils,
    PathUtils: {
      join: (...parts) => parts.join("/"),
      parent: (value) => value.slice(0, value.lastIndexOf("/")),
    },
    TextDecoder,
    TextEncoder,
    Ci: {},
    SWHost: {
      id: "knowledge-base@lzcn",
      version: "0.5.0",
      rootURI: "",
      manifestURI: "manifest.json",
    },
    setTimeout,
    clearTimeout,
    ChromeUtils: {
      importESModule: () => ({
        AddonManager: {
          getAddonByID: async () => null,
          addAddonListener() {},
          removeAddonListener() {},
        },
        AsyncShutdown: {
          quitApplicationGranted: { addBlocker() {}, removeBlocker() {} },
        },
        Sqlite: {
          shutdown: {
            addBlocker: (_name, blocker) => blockers.add(blocker),
            removeBlocker: (blocker) => blockers.delete(blocker),
          },
          openConnection: async () => ({
            executeTransaction: async (work) => work(),
            execute: async (sql) =>
              sql.includes("COUNT(*)") ? [{ getResultByName: () => 0 }] : [],
            close: async () => {
              closed = true;
            },
          }),
        },
      }),
    },
  };
  env.Components = {
    classes: {
      "@mozilla.org/addons/addon-manager-startup;1": {
        getService: () => ({ registerChrome: () => ({ destruct() {} }) }),
      },
    },
    interfaces: {},
  };
  env.Services = {
    io: { newURI: (uri) => uri },
    prefs: {
      prefHasUserValue: (name) =>
        h.prefs.has(name.replace("extensions.zotero.", "")),
      clearUserPref: (name) =>
        h.prefs.delete(name.replace("extensions.zotero.", "")),
    },
    scriptloader: {
      loadSubScript(uri, scope) {
        env.loaded = scope;
        if (!vm.isContext(scope)) vm.createContext(scope);
        vm.runInContext(
          fs.readFileSync(
            path.join(
              __dirname,
              "../../src/library",
              uri.replace(/^scripts\//, ""),
            ),
            "utf8",
          ),
          scope,
        );
      },
    },
  };
  const context = vm.createContext(env);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/runtime.js"),
      "utf8",
    ),
    context,
  );
  await context.libraryRuntime.start();
  assert.deepEqual(h.errors, [], "Plugin startup must succeed");
  await context.loaded.SWIndexer.corpus.ready;
  assert.equal(context.loaded.SWIndexer.corpus.progress.phase, "ready");
  assert.equal(context.loaded.SWTokenizer.termFreq("machine learning").size, 2);
  assert.equal(context.loaded.SWSection._registered, null);
  assert.equal(blockers.size, 1);
  // Profile shutdown must close our connection even before add-on shutdown runs.
  await [...blockers][0]();
  assert.equal(blockers.size, 0);
  await context.libraryRuntime.close();
  assert.equal(closed, true);
  assert.equal(h.errors.length, 0);
});

test("Fluent progress labels are accessible in both locales", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const ftl = fs.readFileSync(
      path.join(__dirname, "../../addon/locale", locale, "similar-works.ftl"),
      "utf8",
    );
    assert.match(ftl, /^similar-works-progress =\s*\n\s+\.aria-label = .+$/m);
  }
});

test("refresh gives immediate feedback and resumes after database loading", async () => {
  const h = harness(),
    q = h.item(1, "machine learning"),
    a = h.item(2, "machine learning");
  for (const it of [q, a]) await h.SWIndexer.processItem(it);
  let finishLoading;
  h.corpus.progress.phase = "loading";
  h.corpus._ready = new Promise(
    (resolve) =>
      (finishLoading = () => {
        h.corpus.progress.phase = "ready";
        resolve();
      }),
  );
  const pending = h.SWSection.renderBody({ body: h.body, item: q }, true);
  assert.doesNotMatch(
    h.body.querySelector(".sw-status").textContent,
    /Computing|Updated|Preparing/,
  );
  assert.equal(h.body["aria-busy"], "true");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.body.querySelectorAll(".sw-row").length, 0);
  finishLoading();
  await pending;
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  assert.doesNotMatch(
    h.body.querySelector(".sw-status").textContent,
    /Computing|Updated|Preparing/,
  );
  assert.equal(h.body["aria-busy"], "false");
  assert.equal(h.body.querySelector(".sw-progress"), null);
});

test("automatic display gives feedback while storage is being prepared", async () => {
  const h = harness();
  const q = h.item(1, "machine learning");
  await h.SWIndexer.processItem(q);
  await h.SWIndexer.processItem(h.item(2, "machine learning"));
  let resolve;
  h.corpus.progress.phase = "loading";
  h.corpus._ready = new Promise((r) => {
    resolve = r;
  });
  const pending = h.SWSection.renderBody({ body: h.body, item: q });
  await new Promise((r) => setImmediate(r));
  assert.doesNotMatch(
    h.body.querySelector(".sw-status").textContent,
    /Computing|Updated|Preparing/,
  );
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, false);
  assert.equal(h.body["aria-busy"], "true");
  h.corpus.progress.phase = "ready";
  resolve();
  await pending;
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  assert.equal(h.body["aria-busy"], "false");
});

test("online similarity reports completed candidate progress and obeys cancellation", async () => {
  const h = harness();
  for (let id = 1; id <= 4; id++)
    await h.SWIndexer.processItem(h.item(id, "machine learning algorithm"));
  const progress = [];
  const matches = await h.corpus.scoreTopKAsync(
    "1/KEY1",
    10,
    () => true,
    () => false,
    (p) => progress.push(p),
  );
  assert.equal(matches.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(progress[0])), {
    done: 0,
    total: 0,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(progress.at(-1))), {
    done: 3,
    total: 3,
  });
  assert.equal(
    (
      await h.corpus.scoreTopKAsync(
        "1/KEY1",
        10,
        () => true,
        () => true,
      )
    ).length,
    0,
  );
});

test("sparse candidate pruning preserves cosine scores and tracks replaced terms", async () => {
  const h = harness();
  await h.corpus.upsertDoc(
    "1/A",
    "a",
    false,
    new Map([
      ["alpha", 2],
      ["beta", 1],
    ]),
  );
  await h.corpus.upsertDoc(
    "1/B",
    "b",
    false,
    new Map([
      ["alpha", 1],
      ["gamma", 3],
    ]),
  );
  await h.corpus.upsertDoc("1/C", "c", false, new Map([["delta", 4]]));
  const expected = h.context.SWSearch.cosine(
    h.corpus.search.docs.get("1/A").vector,
    h.corpus.search.docs.get("1/B").vector,
  );
  const matches = h.corpus.scoreTopK("1/A", 10);
  assert.equal(matches.length, 1);
  assert.ok(Math.abs(matches[0].score - expected) < 1e-12);
  await h.corpus.upsertDoc("1/B", "b2", false, new Map([["delta", 1]]));
  assert.equal(h.corpus.scoreTopK("1/A", 10).length, 0);
  await h.corpus.removeDoc("1/C");
  assert.equal(
    h.corpus.search.postings.get(h.context.SWSearch.hash("w:delta")).length,
    1,
  );
});

test("opening the section permits bounded cache reading without foreground indexing", async () => {
  const h = harness(),
    q = h.item(1, "machine learning"),
    a = h.item(2, "machine learning");
  h.prefs.set("similar-works.backgroundIndexing", false);
  await h.SWIndexer.processItem(a);
  h.SWIndexer.extractText = async (_item, bounded) => {
    assert.equal(
      bounded,
      true,
      "Only a bounded existing cache sample is permitted",
    );
    return null;
  };
  await h.SWSection.renderBody({ body: h.body, item: q });
  assert.equal(h.corpus.docs.get("1/KEY1").weak, true);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  assert.equal(h.errors.length, 0);
});

test("async pruning preserves scores and never visits disjoint document vectors", async () => {
  const h = harness();
  await h.corpus.upsertDoc("1/A", "a", false, new Map([["shared", 2]]));
  await h.corpus.upsertDoc(
    "1/B",
    "b",
    false,
    new Map([
      ["shared", 1],
      ["extra", 1],
    ]),
  );
  await h.corpus.upsertDoc("1/C", "c", false, new Map([["unrelated", 1]]));
  const reference = JSON.stringify(h.corpus.scoreTopK("1/A", 10));
  h.corpus.docs.get("1/C").tf = new Proxy(new Map(), {
    get() {
      throw new Error("Disjoint vector visited");
    },
  });
  const progress = [];
  assert.equal(
    JSON.stringify(
      await h.corpus.scoreTopKAsync(
        "1/A",
        10,
        undefined,
        () => false,
        (p) => progress.push(p),
      ),
    ),
    reference,
  );
  assert.equal(progress.at(-1).total, 1);
});

test("foreground tasks interrupt background work only at safe batch boundaries", async () => {
  const h = harness(),
    order = [];
  let unblock;
  const background = h.corpus.runTask(async () => {
    order.push("index-start");
    await new Promise((r) => (unblock = r));
    await h.corpus.yieldToForeground();
    order.push("index-end");
  });
  const ordinary = h.corpus.runTask(() => order.push("next-index"));
  const foreground = h.corpus.runTask(() => order.push("query"), 1);
  unblock();
  await Promise.all([background, ordinary, foreground]);
  assert.deepEqual(order, ["index-start", "query", "index-end", "next-index"]);
  h.corpus._stopped = true;
  assert.equal((await h.corpus.scoreTopKAsync("1/A", 10)).length, 0);
});

test("background status distinguishes pending scans, queued work, and idle indexing", async () => {
  const h = harness();
  await h.SWIndexer.processItem(h.item(1, "spectral hashing"));
  const writes = [];
  h.Zotero.File = {
    getResourceAsync: async () =>
      fs.readFileSync(
        path.join(__dirname, "../../addon/content/library/tag-terms.json"),
        "utf8",
      ),
  };
  h.Zotero.DataDirectory = { dir: "/data" };
  h.context.PathUtils = { join: (...parts) => parts.join("/") };
  h.IOUtils.makeDirectory = async () => {};
  h.IOUtils.writeUTF8 = async (path, text) =>
    writes.push([path, JSON.parse(text)]);
  assert.equal(h.SWIndexer.getStatus().state, "waiting");
  h.SWIndexer._libraryScanned = true;
  h.corpus._dbPath =
    "/data/knowledge-base/cache/similar-items/similarity.sqlite";
  h.SWIndexer._libraryTotal = 2;
  h.SWIndexer._queue = [2];
  h.SWIndexer._reportStatus(true);
  await h.SWIndexer._statusWrite;
  assert.equal(
    writes[0][0],
    "/data/knowledge-base/cache/similar-items/index-status.json",
  );
  assert.equal(writes[0][1].state, "indexing");
  assert.equal(writes[0][1].indexedItems, 1);
  assert.equal(writes[0][1].totalItems, 2);
  h.SWIndexer._queue = [];
  assert.equal(h.SWIndexer.getStatus().state, "idle");
  h.SWIndexer.requestStop();
  await h.SWIndexer._statusWrite;
  assert.equal(writes.at(-1)[1].state, "stopped");
});

test("Zotero integer preference loading does not truncate the similarity threshold", async () => {
  const h = harness();
  h.context.pref = (key, value) => {
    // Zotero Plugins.setDefaultPrefs routes numbers through setIntPref.
    h.prefs.set(
      key.replace("extensions.zotero.", ""),
      typeof value === "number" ? Math.trunc(value) : value,
    );
  };
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../../addon/prefs.js"), "utf8"),
    h.context,
  );
  await h.SWIndexer.processItem(h.item(2, "hashing"));
  const rows = await h.SWSection._resolveRows([
    { key: "1/KEY2", score: 0.004, weak: true },
  ]);
  assert.equal(rows.length, 0);
});

test("hybrid is an internal default and ignores obsolete algorithm preferences", async () => {
  const h = harness();
  h.context.Zotero.isMac = true;
  const item = h.item(1, "hashing");
  await h.SWIndexer.processItem(item);
  await h.SWIndexer.processItem(h.item(2, "binary codes"));
  let enabled = 0;
  h.context.SWSemantic = {
    _enabled: false,
    status: { state: "idle" },
    vectors: new Map(),
    start: async () => {},
    enable() {
      this._enabled = true;
      enabled++;
    },
    enqueue() {},
    getRecommendations: () => null,
    restoreRecommendations: async () => null,
    recommendationsFresh: () => false,
    saveRecommendations() {},
    recommend: async () => ({
      matches: [
        {
          key: "1/KEY2",
          score: 0.7,
          lexicalScore: 0.2,
          semanticScore: 0.7,
          weak: false,
        },
      ],
    }),
  };
  // Semantic evidence can admit a result independently of the lexical threshold.
  h.prefs.set("similar-works.minimumSimilarity", "0.8");
  h.prefs.set("similar-works.recommendationMethod", "semantic");
  await h.SWSection.renderBody({ body: h.body, item }, true);
  assert.equal(enabled, 1);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  assert.equal(h.body.querySelector("select"), null);
  assert.equal(h.body.querySelector(".sw-num").textContent, "");
  h.prefs.set("similar-works.recommendationMethod", "text");
  await h.SWSection.renderBody({ body: h.body, item }, true);
  assert.equal(enabled, 1);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
});

test("the 100-result setting survives computation and the recommendation cache", async () => {
  const h = harness();
  for (let index = 0; index < 81; index++) {
    await h.corpus.upsertDoc(
      "1/K" + index,
      "hash" + index,
      true,
      new Map([
        ["shared", 2],
        ["topic" + index, 1],
      ]),
    );
  }
  const matches = await h.corpus.scoreTopKAsync("1/K0", 100);
  assert.equal(matches.length, 80);
  await h.corpus.saveRecommendations(
    "1/K0",
    true,
    matches,
    h.corpus.revision,
    "hash0",
  );
  const cached = await h.corpus.getRecommendations("1/K0", true);
  assert.equal(cached.matches.length, 80);
  h.corpus._recommendations.set(JSON.stringify(["1/K0", true]), {
    ...cached,
    algorithm: 4,
    matches: cached.matches.slice(0, 50),
  });
  assert.equal(await h.corpus.getRecommendations("1/K0", true), null);
});

test("recommendation navigation follows each hop and clears on manual selection", async () => {
  const h = harness();
  h.SWSection.init("file://test/");
  h.Zotero.hooks = h.SWSection.getItemPaneCallbacks();
  const a = h.item(1, "Paper A");
  const b = h.item(2, "Paper B");
  const c = h.item(3, "Paper C");
  const props = (item) => ({
    body: h.body,
    item,
    tabType: "library",
    setEnabled() {},
  });
  await h.SWSection._selectItem(h.doc, b.id, "library", a);
  h.Zotero.hooks.onItemChange(props(b));
  await h.SWSection.renderBody(props(b));
  const source = h.body.querySelector(".sw-source");
  assert.equal(source.hidden, false);
  assert.equal(source.querySelector(".sw-title").textContent, "Paper A");
  await source.onclick();
  h.Zotero.hooks.onItemChange(props(a));
  await h.SWSection.renderBody(props(a));
  assert.equal(source.querySelector(".sw-title").textContent, "Paper B");
  h.Zotero.hooks.onItemChange(props(c));
  await h.SWSection.renderBody(props(c));
  assert.equal(source.hidden, true);
  assert.deepEqual(h.selected, [2, 1]);
  assert.deepEqual(h.errors, []);
});

test("qualified results load beyond the initial batch and stale observers cannot append", async () => {
  const h = harness();
  const observers = [];
  h.doc.defaultView.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {
      this.observing = true;
    }
    disconnect() {
      this.observing = false;
    }
  };
  const item = h.item(1, "Combinatorial optimization");
  const matches = Array.from({ length: 45 }, (_, i) => {
    const candidate = h.item(i + 2, "Combinatorial optimization " + i);
    return {
      key: h.SWIndexer.docKey(candidate),
      score: i < 40 ? 0.8 : 0.06,
      weak: true,
    };
  });
  h.SWSection.ensureSkeleton(h.body);
  h.body._swToken = 1;
  h.body._swMethod = "text";
  const props = { body: h.body, item };
  await h.SWSection._presentMatches(props, matches, "1/KEY1", 1);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 20);
  h.body._swToken = 2;
  await h.SWSection._presentMatches(props, matches, "1/KEY1", 2);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(
    h.body.querySelectorAll(".sw-row").length,
    40,
    "Refresh keeps the current paging callback valid",
  );
  assert.equal(h.body.querySelector(".sw-more"), null);
  h.prefs.set("similar-works.maxRecommendations", 1);
  await h.SWSection._presentMatches(props, matches, "1/KEY1", 2);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  const stale = observers.at(-1);
  h.SWSection.setStatus(h.body, "New selection");
  stale.callback([{ isIntersecting: true }]);
  assert.equal(h.body.querySelectorAll(".sw-row").length, 0);
  assert.equal(stale.observing, false);
});

test("tag text reads a bounded existing cache once and invalidates with the source", async () => {
  const h = harness(),
    parent = h.item(1, "Discrete solvers");
  const attachment = h.item(2, "Attachment", parent.id);
  h.files.set(
    "/cache/" + attachment.key,
    "Lagrangian relaxation for binary decisions. ".repeat(2000),
  );
  h.corpus.docs.set("1/KEY1", { hash: "v1", weak: false });
  let reads = 0;
  h.context.IOUtils.read = async (_path, options) => {
    reads++;
    assert.ok([24000, 1200000].includes(options.maxBytes));
    return new TextEncoder()
      .encode(h.files.get("/cache/" + attachment.key))
      .slice(0, options.maxBytes);
  };
  const [a, b] = await Promise.all([
    h.SWIndexer.tagText(parent),
    h.SWIndexer.tagText(parent),
  ]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.ok(a.length <= 24000);
  await h.SWIndexer.tagText(parent);
  assert.equal(reads, 1);
  const full = await h.SWIndexer.tagText(parent, () => true, 1200000);
  assert.ok(full.length > 24000);
  assert.equal(
    reads,
    2,
    "a prefix cache must not masquerade as full cached text",
  );
  await h.SWIndexer.tagText(parent, () => true, 1200000);
  assert.equal(reads, 2);
  h.corpus.docs.set("1/KEY1", { hash: "v2", weak: false });
  await h.SWIndexer.tagText(parent);
  assert.equal(reads, 3);
  h.prefs.set("similar-works.requestMissingFulltext", true);
  h.files.clear();
  h.corpus.docs.set("1/KEY1", { hash: "v3", weak: true });
  assert.equal(await h.SWIndexer.tagText(parent), "");
  assert.deepEqual(
    h.queued,
    [],
    "Tag reading never requests missing full text",
  );
});

test("cancelled tag reads do not populate the session cache", async () => {
  const h = harness(),
    item = h.item(1, "Discrete solvers");
  h.corpus.docs.set("1/KEY1", { hash: "v1", weak: false });
  let finish,
    active = true;
  h.SWIndexer.extractText = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = h.SWIndexer.tagText(item, () => active);
  active = false;
  finish({ content: "Body text", weak: false });
  assert.equal(await pending, "");
  assert.equal(h.SWIndexer._tagText.size, 0);
  assert.equal(h.SWIndexer._tagTextPending.size, 0);
});

test("shutdown waits for a failed cache read without retaining its resources", async () => {
  const h = harness(),
    item = h.item(1, "Discrete solvers");
  let fail;
  h.SWIndexer.extractText = () =>
    new Promise((_resolve, reject) => {
      fail = reject;
    });
  const read = h.SWIndexer.tagText(item);
  const rejected = assert.rejects(read, /cache read failed/);
  let finished = false;
  const shutdown = h.SWIndexer.shutdown().then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  fail(new Error("cache read failed"));
  await Promise.all([rejected, shutdown]);
  assert.equal(h.SWIndexer._tagText.size, 0);
  assert.equal(h.SWIndexer._tagTextPending.size, 0);
});

test("a source change while reading discards the stale sample", async () => {
  const h = harness(),
    item = h.item(1, "Discrete solvers");
  h.corpus.docs.set("1/KEY1", { hash: "old", weak: false });
  let finish;
  h.SWIndexer.extractText = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const read = h.SWIndexer.tagText(item);
  h.corpus.docs.set("1/KEY1", { hash: "new", weak: false });
  finish({ content: "Stale body", weak: false });
  assert.equal(await read, "");
  assert.equal(h.SWIndexer._tagText.size, 0);
});

test("warm startup checks unchanged sources without per-item indexing delays", async () => {
  const h = harness();
  const items = [1, 2, 3].map((id) => h.item(id, "Neural machine learning"));
  for (const item of items) await h.SWIndexer.processItem(item, 1);
  const revision = h.corpus.revision;
  const pauses = [];
  h.Zotero.Promise.delay = async (ms) => {
    pauses.push(ms);
  };
  h.SWIndexer._draining = true;
  for (const item of items) h.SWIndexer.enqueue(item.id);
  h.SWIndexer._draining = false;
  await h.SWIndexer._drain();
  assert.equal(h.corpus.revision, revision);
  assert.equal(
    pauses.reduce((sum, ms) => sum + ms, 0),
    0,
    "Unchanged items must not consume the 2-second indexing delay",
  );
  items[0].getField = (field) =>
    field === "title" ? "Changed graph neural networks" : "";
  h.SWIndexer.enqueue(items[0].id);
  await h.SWIndexer._drainPromise;
  assert.ok(
    h.corpus.revision > revision,
    "Changed metadata still updates the index",
  );
  assert.equal(
    pauses.reduce((sum, ms) => sum + ms, 0),
    2000,
    "Expensive background updates remain paced",
  );
});

test("startup queues each document once when the library contains its attachments", async () => {
  const h = harness();
  const parent = h.item(1, "Graph neural networks");
  const a = h.item(2, "PDF", parent.id),
    b = h.item(3, "Supplement", parent.id);
  h.Zotero.Items.getAll = async () => [a.id, parent.id, b.id];
  h.SWIndexer._draining = true;
  await h.SWIndexer.enqueueLibrary();
  assert.deepEqual(Array.from(h.SWIndexer._queue), [parent.id]);
  assert.equal(h.SWIndexer._libraryTotal, 1);
  assert.equal(h.SWIndexer._itemKeys.get(a.id).parentID, parent.id);
  assert.equal(h.SWIndexer._itemKeys.get(b.id).parentID, parent.id);
});

function recommendationStore(h) {
  const payloads = new Map();
  h.corpus._db = {
    async executeTransaction(work) {
      return work();
    },
    async execute(sql, args) {
      if (sql.startsWith("INSERT OR REPLACE INTO recommendations"))
        payloads.set(args[0], args[1]);
      if (sql.startsWith("UPDATE recommendations SET payload"))
        payloads.set(args[1], args[0]);
      if (sql.startsWith("SELECT payload"))
        return payloads.has(args[0])
          ? [{ getResultByName: () => payloads.get(args[0]) }]
          : [];
      if (sql.startsWith("SELECT cacheKey, payload"))
        return [...payloads].map(([cacheKey, payload]) => ({
          getResultByName: (name) => ({ cacheKey, payload })[name],
        }));
      return [];
    },
  };
  return payloads;
}

test("persisted hybrid ranks retain channel scores and invalidate without cosine patching", async () => {
  const h = harness();
  await h.SWIndexer.processItem(h.item(1, "Molecule prediction"), 1);
  const payloads = recommendationStore(h);
  const snapshot = {
    queryHash: h.corpus.docs.get("1/KEY1").hash,
    revision: h.corpus.revision,
    epoch: h.corpus.search.epoch,
  };
  const match = {
    key: "1/KEY2",
    score: 0.9,
    lexicalScore: 0.3,
    semanticScore: 0.7,
    weak: true,
  };
  await h.corpus.saveHybridRecommendations(
    "1/KEY1",
    true,
    [match],
    snapshot,
    "minilm",
  );
  h.corpus._recommendations.clear();
  const cached = await h.corpus.getRecommendations("1/KEY1", true, "hybrid");
  assert.deepEqual(JSON.parse(JSON.stringify(cached.matches)), [match]);
  assert.equal(await h.corpus.getRecommendations("1/KEY1", true), null);
  await h.SWIndexer.processItem(h.item(2, "Molecule prediction"), 1);
  h.corpus._recommendations.clear();
  const changed = await h.corpus.getRecommendations("1/KEY1", true, "hybrid");
  assert.equal(changed.dirty, true);
  assert.equal(changed.matches[0].score, 0.9);
  assert.equal(changed.matches[0].semanticScore, 0.7);
  const key = JSON.stringify(["1/KEY1", true, "hybrid"]);
  const damaged = JSON.parse(payloads.get(key));
  delete damaged.matches[0].semanticScore;
  payloads.set(key, JSON.stringify(damaged));
  h.corpus._recommendations.clear();
  assert.equal(
    await h.corpus.getRecommendations("1/KEY1", true, "hybrid"),
    null,
  );
});

test("cached rows are usable before the text index and semantic vectors finish loading", async () => {
  const h = harness(),
    query = h.item(1, "Molecule prediction");
  const old = h.item(2, "Cached related paper"),
    fresh = h.item(3, "Updated related paper");
  await h.SWIndexer.processItem(query, 1);
  recommendationStore(h);
  const snapshot = {
    queryHash: h.corpus.docs.get("1/KEY1").hash,
    revision: h.corpus.revision,
    epoch: h.corpus.search.epoch,
  };
  await h.corpus.saveHybridRecommendations(
    "1/KEY1",
    true,
    [
      {
        key: h.SWIndexer.docKey(old),
        score: 0.9,
        lexicalScore: 0.3,
        semanticScore: 0.7,
      },
    ],
    snapshot,
    "minilm",
  );
  h.corpus._recommendations.clear();
  h.corpus.progress.phase = "loading";
  let loadIndex,
    loadVectors,
    calculations = 0;
  h.corpus._ready = new Promise((resolve) => {
    loadIndex = resolve;
  });
  const vectors = new Promise((resolve) => {
    loadVectors = resolve;
  });
  h.Zotero.isMac = true;
  h.prefs.set("similar-works.backgroundIndexing", false);
  h.SWTags.suggest = async () => [];
  h.context.SWSemantic = {
    version: "minilm",
    _enabled: true,
    ready: false,
    status: { state: "loading" },
    start: () =>
      vectors.then(() => {
        h.context.SWSemantic.ready = true;
      }),
    getRecommendations: () => null,
    restoreRecommendations: async () => null,
    enqueue() {},
    saveRecommendations() {},
    recommend: async () => {
      calculations++;
      return {
        matches: [
          {
            key: h.SWIndexer.docKey(fresh),
            score: 0.9,
            lexicalScore: 0.4,
            semanticScore: 0.8,
          },
        ],
        snapshot,
      };
    },
  };
  const pending = h.SWSection.renderBody({ body: h.body, item: query });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    h.body.querySelector(".sw-row").querySelector(".sw-title").textContent,
    "Cached related paper",
  );
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, true);
  assert.equal(h.body["aria-busy"], "false");
  assert.equal(calculations, 0);
  h.corpus.progress.phase = "ready";
  loadIndex();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calculations, 0);
  assert.equal(
    h.body.querySelector(".sw-row").querySelector(".sw-title").textContent,
    "Cached related paper",
  );
  await pending; // Cached rendering must finish while vectors are still blocked.
  h.context.SWSemantic.ready = true;
  loadVectors();
  await h.body._swRefreshWait;
  await h.body._swRefreshWait;
  assert.equal(calculations, 1);
  assert.equal(
    h.body.querySelector(".sw-row").querySelector(".sw-title").textContent,
    "Updated related paper",
  );
});

test("an uncached paper displays a persisted-vector preview while the full index remains blocked", async () => {
  const h = harness(),
    query = h.item(1, "Unseen paper"),
    related = h.item(2, "Persisted neighbor");
  h.Zotero.isMac = true;
  h.corpus.progress.phase = "loading";
  let finish;
  h.corpus._ready = new Promise((resolve) => {
    finish = resolve;
  });
  let previews = 0;
  h.context.SWSemantic = {
    version: "minilm",
    ready: false,
    start: () => h.corpus.ready,
    preview: async (corpus, key, _limit, cancelled) => {
      previews++;
      assert.equal(corpus, h.corpus);
      assert.equal(key, "1/KEY1");
      assert.equal(cancelled(), false);
      return {
        matches: [
          {
            key: h.SWIndexer.docKey(related),
            score: 0.5,
            lexicalScore: 0,
            semanticScore: 0.8,
          },
        ],
      };
    },
  };
  await h.SWSection.renderBody({ body: h.body, item: query });
  assert.equal(previews, 1);
  assert.equal(
    h.body.querySelector(".sw-title").textContent,
    "Persisted neighbor",
  );
  assert.equal(h.body.querySelector(".sw-computation-progress").hidden, true);
  assert.equal(h.body["aria-busy"], "false");
  await h.SWSection.renderBody({ body: h.body, item: query });
  assert.equal(previews, 1);
  h.body.hidden = true;
  finish();
  await h.body._swRefreshWait;
});

test("a failed background index load preserves usable cached recommendations", async () => {
  const h = harness(),
    query = h.item(1, "Molecule prediction"),
    related = h.item(2, "Cached related paper");
  await h.SWIndexer.processItem(query, 1);
  await h.corpus.saveRecommendations(
    "1/KEY1",
    true,
    [{ key: h.SWIndexer.docKey(related), score: 0.8 }],
    h.corpus.revision,
    h.corpus.docs.get("1/KEY1").hash,
  );
  h.corpus.progress.phase = "loading";
  let finish;
  h.corpus._ready = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = h.SWSection.renderBody({ body: h.body, item: query });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  h.corpus.progress = { phase: "error", error: "Background restore failed" };
  finish();
  await pending;
  await h.body._swRefreshWait;
  assert.equal(h.body.querySelectorAll(".sw-row").length, 1);
  assert.match(
    h.body.querySelector(".sw-status").textContent,
    /Background restore failed/,
  );
});

test("match evidence stays hidden and dormant while its retained implementation remains usable", async () => {
  const h = harness(),
    query = h.item(1, "Graph neural networks"),
    related = h.item(2, "Graph representation learning");
  let comparisons = 0;
  h.context.SWEvidence = {
    compareItems: async () => {
      comparisons++;
      return {
        terms: ["graph"],
        current: { text: "Graph neural networks" },
        match: { text: "Graph representation learning" },
      };
    },
  };
  h.body._swToken = 1;
  h.SWSection.ensureSkeleton(h.body);
  const wrapper = h.SWSection._createRow(
    { body: h.body, item: query },
    { item: related, score: 0.8 },
    1,
    0.8,
    "",
  );
  h.body.querySelector(".sw-list").appendChild(wrapper);
  const evidence = wrapper.querySelector(".sw-evidence");
  assert.equal(evidence.hidden, true);
  assert.equal(typeof evidence.listeners.toggle, "function");
  evidence.open = true;
  await evidence.listeners.toggle();
  assert.equal(
    comparisons,
    0,
    "Hidden evidence must not perform text comparisons",
  );
  evidence.hidden = false;
  await evidence.listeners.toggle();
  assert.equal(comparisons, 1);
  assert.equal(evidence.querySelectorAll("blockquote").length, 2);
});

test("unchanged library snapshots skip hydration and extraction; only a new or changed item is queued", async () => {
  const h = harness();
  h.item(1, "Graph neural networks");
  h.item(2, "Temporal graph learning");
  await h.SWIndexer.enqueueLibrary();
  await h.SWIndexer._drainPromise;
  let hydrated = 0,
    extracted = 0;
  const get = h.Zotero.Items.getAsync;
  const extract = h.SWIndexer.extractText;
  h.Zotero.Items.getAsync = async (...args) => {
    hydrated++;
    return get(...args);
  };
  h.SWIndexer.extractText = async (...args) => {
    extracted++;
    return extract.call(h.SWIndexer, ...args);
  };
  await h.SWIndexer.enqueueLibrary();
  await h.SWIndexer._drainPromise;
  assert.equal(hydrated, 0);
  assert.equal(extracted, 0);
  h.item(3, "New temporal learning paper");
  await h.SWIndexer.enqueueLibrary();
  await h.SWIndexer._drainPromise;
  assert.equal(hydrated, 2); // one target and its empty attachment page
  assert.equal(extracted, 1);
  h.item(2, "Updated temporal graph learning");
  await h.SWIndexer.enqueueLibrary();
  await h.SWIndexer._drainPromise;
  assert.equal(extracted, 2);
});

test("a notification during a source snapshot prevents stale reuse and pruning", async () => {
  const h = harness();
  const item = h.item(1, "Graph neural networks");
  await h.SWIndexer.enqueueLibrary();
  await h.SWIndexer._drainPromise;
  const scan = h.context.SWLibrarySources.scan;
  h.context.SWLibrarySources.scan = async (cancelled, documentID) => {
    if (documentID) return scan(cancelled, documentID);
    const snapshot = await scan();
    h.SWIndexer._onNotify("modify", "item", [item.id]);
    await h.corpus.upsertDoc("1/NEW", "new", true, new Map([["graph", 1]]));
    return snapshot;
  };
  await h.SWIndexer.enqueueLibrary();
  await h.SWIndexer._drainPromise;
  assert.ok(h.corpus.docs.has("1/NEW"));
  assert.equal(h.SWIndexer._scanSources.size, 0);
});
