const test = require("node:test");
const assert = require("node:assert/strict");
global.swPorterStem = require("../../src/library/stemmer.js").swPorterStem;
const tokenizer = require("../../src/library/tokenizer.js");
global.SWTokenizer = {
  termFreq: tokenizer.swTermFreq,
  isStopword: tokenizer.swIsStopword,
};
if (!global.Zotero) global.Zotero = { logError() {} };
const { SWSearch } = require("../../src/library/search.js");
global.SWSearch = SWSearch;
global.SWStorage = require("../../src/library/storage.js").SWStorage;
const { SWCorpus } = require("../../src/library/corpus.js");
const noPause = async () => {};
const noCancel = () => false;

test("match evidence contains actual passages on both sides without inventing an explanation", () => {
  const { SWEvidence } = require("../../src/library/retrieval-evidence.js");
  const left = [
    {
      field: "abstract",
      text: "Temporal neighborhoods retain graph context. A separate experiment tests noise.",
    },
  ];
  const right = [
    { field: "title", text: "Ocean surveys" },
    {
      field: "abstract",
      text: "We study graph context with temporal neighborhoods. Performance depends on edge history.",
    },
  ];
  const result = SWEvidence.compare(left, right);
  assert.ok(result.terms.length);
  assert.ok(left.some((field) => field.text.includes(result.current.text)));
  assert.ok(right.some((field) => field.text.includes(result.match.text)));
  assert.equal(result.match.field, "abstract");
  assert.deepEqual(
    SWEvidence.compare(left, [{ field: "title", text: "Marine species" }])
      .terms,
    [],
  );
});

test("item evidence reads cached text on demand and drops cancelled work", async () => {
  const { SWEvidence } = require("../../src/library/retrieval-evidence.js");
  const previous = global.SWIndexer;
  let reads = 0;
  let active = true;
  const item = { getField: () => "Temporal graph context" };
  global.SWIndexer = {
    resolveDocItem: async (value) => value,
    tagText: async () => {
      reads++;
      return "Temporal graph neighborhoods retain context.";
    },
  };
  try {
    const result = await SWEvidence.compareItems(item, item);
    assert.ok(result.current.text && result.match.text);
    assert.equal(reads, 2);
    assert.equal(await SWEvidence.compareItems(item, item, () => false), null);
    assert.equal(reads, 2);
    global.SWIndexer.tagText = async () => {
      active = false;
      return "Temporal graph context";
    };
    assert.equal(await SWEvidence.compareItems(item, item, () => active), null);
  } finally {
    if (previous === undefined) delete global.SWIndexer;
    else global.SWIndexer = previous;
  }
});

test("schema initialization uses LIKE bindings accepted by Gecko", async () => {
  const corpus = new SWCorpus();
  corpus._db = {
    async execute(sql) {
      // Gecko rejects literal LIKE patterns even when Node SQLite accepts them.
      if (/\bLIKE\b\s(?![@:?])/i.test(sql))
        throw new Error("Please enter a LIKE clause with bindings");
      return [];
    },
  };
  await corpus._ensureSchema();
});

test("RRF uses fixed ranks rather than incompatible score scales", () => {
  const lexical = [
    { key: "1/A", score: 1000, weak: true },
    { key: "1/B", score: 10, weak: true },
  ];
  const dense = [
    { key: "1/C", score: 0.99 },
    { key: "1/B", score: 0.01, weak: true },
  ];
  const result = SWSearch.fuse([lexical, dense]);
  assert.equal(result[0].key, "1/B");
  assert.ok(Math.abs(result[0].score - 61 / 62) < 1e-12);
  assert.equal(result[0].weak, true);
  assert.deepEqual(
    SWSearch.fuse([
      lexical.map((m) => ({ ...m, score: m.score / 1e6 })),
      dense,
    ]).map(({ key, score }) => ({ key, score })),
    result.map(({ key, score }) => ({ key, score })),
  );
  assert.deepEqual(SWSearch.fuse([]), []);
  assert.equal(SWSearch.fuse([lexical, dense], 1).length, 1);
});

test("field counts preserve boundaries and reject truncated storage", async () => {
  const counts = await SWSearch.extract({
    title: "traffic",
    abstract: "learning",
    body: "radar radar",
  });
  const encoded = SWSearch.encodeCounts(counts);
  const decoded = SWSearch.decodeCounts(encoded);
  assert.deepEqual(decoded, counts);
  assert.equal(decoded.fields[0].get(SWSearch.hash("w:traffic")), 1);
  assert.equal(decoded.fields[2].get(SWSearch.hash("w:radar")), 2);
  assert.throws(() => SWSearch.decodeCounts(encoded.slice(0, -1)), /Truncated/);
  assert.deepEqual(
    SWSearch.decodeCounts(SWSearch.encodeCounts(new Map([[123, 2]]))),
    new Map([[123, 2]]),
  );
});

test("BM25F normalizes fields separately before term saturation", async () => {
  const index = new SWSearch.Index();
  index.epochN = 10;
  index.averageFieldLengths = [2, 8, 20];
  const counts = await SWSearch.extract({
    title: "traffic",
    body: "radar radar",
  });
  const vector = index.fingerprint(counts);
  const weights = new Map(vector);
  // Both terms have the same IDF, so it cancels from the normalized ratio.
  const titleTf = 4 / (0.7 + 0.3 / 2);
  // Body contains two unigrams and one bigram.
  const bodyTf = 2 / (0.25 + (0.75 * 3) / 20);
  const expected = titleTf / (titleTf + 1.2) / (bodyTf / (bodyTf + 1.2));
  const actual =
    weights.get(SWSearch.hash("w:traffic")) /
    weights.get(SWSearch.hash("w:radar"));
  assert.ok(Math.abs(actual - expected) < 0.0001);
});

test("epoch rebuild preserves field averages with lazy database counts", async () => {
  const index = new SWSearch.Index();
  const a = await SWSearch.extract({
    title: "traffic radar",
    abstract: "learning",
  });
  const b = await SWSearch.extract({ body: "traffic radar" });
  const stored = new Map([
    ["1/A", SWSearch.encodeCounts(a)],
    ["1/B", SWSearch.encodeCounts(b)],
  ]);
  index.add("1/A", a, true);
  index.add("1/B", b, true);
  for (const doc of index.docs.values()) doc.counts = null;
  await index.rebuild(noPause, noCancel, async (doc) => stored.get(doc.key));
  assert.deepEqual(index.averageFieldLengths, [1.5, 0.5, 1.5]);
  assert.ok(index.docs.get("1/A").vector.length > 0);
  const oldID = index.docs.get("1/A").id;
  index.remove("1/A", stored.get("1/A"));
  assert.equal(index.byID.has(oldID), false);
  assert.equal(index.df.get(SWSearch.hash("w:traffic")), 1);
});

test("missing signatures are rebuilt from stored feature counts", async () => {
  const corpus = new SWCorpus();
  const counts = SWSearch.encodeCounts(new Map([[123, 4]]));
  let page = 0;
  corpus._db = {
    async execute(sql) {
      if (sql.startsWith("SELECT COUNT")) return [{ getResultByName: () => 1 }];
      if (sql.startsWith("SELECT d.key"))
        return page++
          ? []
          : [
              {
                getResultByName: (name) =>
                  ({
                    key: "1/A",
                    hash: "a",
                    weak: 1,
                    tf: "{}",
                    counts,
                    signature: null,
                    epoch: 0,
                    simhash: null,
                  })[name],
              },
            ];
      if (sql.startsWith("SELECT counts"))
        return [{ getResultByName: () => counts }];
      return [];
    },
  };
  corpus._persistFingerprints = async () => {};
  corpus._maintainEpoch = async () => {};
  await corpus._loadAll();
  assert.equal(corpus.progress.phase, "ready");
  assert.deepEqual([...corpus.search.docs.get("1/A").vector.ids], [123]);
});

test("binary counts and quantized signatures round-trip; feature cap is enforced", async () => {
  const counts = new Map(Array.from({ length: 800 }, (_, i) => [i, i + 1]));
  assert.deepEqual(
    SWSearch.decodeCounts(SWSearch.encodeCounts(counts)),
    counts,
  );
  const index = new SWSearch.Index();
  index.add("1/A", counts, true);
  await index.rebuild();
  const vector = index.docs.get("1/A").vector;
  assert.equal(vector.length, 256);
  assert.equal(SWSearch.encodeSignature(vector).length, 1536);
  assert.ok(Math.abs(SWSearch.cosine(vector, vector) - 1) < 1e-12);
  assert.throws(() => SWSearch.decodeSignature(new Uint8Array(7)));
});

test("cleaning, fields, English bigrams and CJK features", async () => {
  const title = await SWSearch.extract({ title: "traffic forecasting" });
  const body = await SWSearch.extract({ body: "traffic forecasting" });
  assert.equal(
    title.get(SWSearch.hash("w:traffic")),
    body.get(SWSearch.hash("w:traffic")) * 4,
  );
  assert.ok(body.has(SWSearch.hash("b:traffic forecast")));
  const cjk = await SWSearch.extract({ body: "交通拥堵预测" });
  assert.ok(cjk.has(SWSearch.hash("c:交通拥")));
  const text = "paper body ".repeat(40) + "\nReferences\nSmith 2020";
  assert.ok(!SWSearch.clean(text).includes("smith"));
});

test("Block-Max WAND preserves the exhaustive Top-300 threshold", async () => {
  const index = new SWSearch.Index();
  for (let i = 0; i < 700; i++) {
    const counts = new Map();
    for (let t = 0; t < 70; t++)
      if ((i * 17 + t * 11) % 9 < 3)
        counts.set(t, (((i + 3) * (t + 7)) % 23) + 1);
    index.add(`1/${i}`, counts, true);
  }
  await index.rebuild();
  const query = index.docs.get("1/0"),
    top = new SWSearch.Heap(48);
  for (const pair of query.vector) top.add(pair);
  const queryWeights = new Map(top.sorted());
  const exhaustive = [...index.docs.values()]
    .filter((d) => d !== query)
    .map((d) => [
      d.id,
      d.vector.reduce((s, [id, w]) => s + (queryWeights.get(id) || 0) * w, 0),
      d.key,
    ]);
  exhaustive.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const actual = await index.retrieve(query, () => true, noPause, noCancel);
  const scores = new Map(exhaustive.map((pair) => [pair[2], pair[1]]));
  const threshold = exhaustive
    .filter((pair) => pair[1] > 0)
    .slice(0, 300)
    .at(-1)[1];
  assert.equal(actual.length, 300);
  assert.equal(new Set(actual).size, 300);
  assert.ok(actual.every((key) => scores.get(key) + 1e-12 >= threshold));
  index.remove("1/7");
  assert.ok(
    !(await index.retrieve(query, () => true, noPause, noCancel)).includes(
      "1/7",
    ),
  );
  assert.deepEqual(await index.retrieve(query, null, noPause, () => true), []);
});

test("SimHash excludes duplicate full text but keeps identical short metadata", async () => {
  const index = new SWSearch.Index(),
    tf = new Map([
      [1, 90],
      [2, 30],
      [3, 20],
    ]);
  index.add("1/A", tf, false);
  index.add("1/B", tf, false);
  index.add("1/C", tf, true);
  await index.rebuild();
  assert.equal(
    SWSearch.distance(
      index.docs.get("1/A").simhash,
      index.docs.get("1/B").simhash,
    ),
    0,
  );
  const result = await index.search(
    "1/A",
    50,
    null,
    noCancel,
    noPause,
    () => {},
  );
  assert.deepEqual(
    result.map((m) => m.key),
    ["1/C"],
  );
});

test("reverse Top-K adds a new neighbor without invalidating an unrelated cache", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1; // Freeze one model so this test exercises incremental cache updates.
  await corpus.upsertDoc(
    "1/A",
    "a",
    true,
    new Map([
      [1, 3],
      [2, 1],
    ]),
  );
  await corpus.upsertDoc(
    "1/B",
    "b",
    true,
    new Map([
      [1, 1],
      [3, 2],
    ]),
  );
  const original = await corpus.scoreTopKAsync("1/A", 50);
  await corpus.saveRecommendations("1/A", true, original, corpus.revision, "a");
  await corpus.upsertDoc(
    "1/C",
    "c",
    true,
    new Map([
      [1, 3],
      [2, 1],
    ]),
  );
  const cached = await corpus.getRecommendations("1/A", true);
  assert.equal(cached.matches[0].key, "1/C");
  assert.ok(corpus.recommendationsFresh(cached, "1/A"));
  await corpus.removeDoc("1/C");
  assert.ok(
    !(await corpus.getRecommendations("1/A", true)).matches.some(
      (m) => m.key === "1/C",
    ),
  );
  assert.ok(!corpus.recommendationsFresh(cached, "1/A"));
});

test("epoch rebuild aborts if foreground indexing changes feature statistics", async () => {
  const index = new SWSearch.Index();
  for (let i = 0; i < 8; i++)
    index.add(
      `1/${i}`,
      new Map([
        [i, 2],
        [9, 1],
      ]),
      true,
    );
  const oldEpoch = index.epoch;
  const rebuilt = await index.rebuild(async () => {
    index.add("1/new", new Map([[99, 4]]), true);
  });
  assert.equal(rebuilt, false);
  assert.equal(index.epoch, oldEpoch);
  assert.ok(index.docs.has("1/new"));
});

test("failed vector writes restore the in-memory index", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1;
  await corpus.upsertDoc("1/A", "old", true, new Map([[1, 3]]));
  corpus._db = {
    executeTransaction: async () => {
      throw new Error("disk unavailable");
    },
  };
  await assert.rejects(
    corpus.upsertDoc("1/A", "new", true, new Map([[2, 4]])),
    /persist doc failed/,
  );
  assert.equal(corpus.docs.get("1/A").hash, "old");
  assert.ok(corpus.search.docs.get("1/A").vector.ids.includes(1));
  assert.ok(!corpus.search.docs.get("1/A").vector.ids.includes(2));
});

test("results computed before an IDF epoch switch cannot be cached as new", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1;
  await corpus.upsertDoc("1/A", "a", true, new Map([[1, 3]]));
  corpus.search.epoch = 2;
  await corpus.saveRecommendations("1/A", true, [], corpus.revision, "a", 1);
  assert.equal(await corpus.getRecommendations("1/A", true), null);
});

test("stored fingerprints bind BLOBs without being interpreted as batch parameters", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 3;
  const doc = { key: "1/A", vector: [[1148, 1]], counts: null };
  let persisted;
  corpus._db = {
    async execute(sql, params) {
      // Gecko's Sqlite.sys.mjs interprets an object in position zero as a batch.
      assert.notEqual(typeof params[0], "object");
      assert.match(sql, /signature = \?2, epoch = \?3 WHERE key = \?1/);
      assert.equal(params[0], doc.key);
      assert.ok(params[1] instanceof Uint8Array);
      assert.equal(params[2], 3);
      persisted = SWSearch.decodeSignature(params[1]);
    },
  };
  await corpus._writeFingerprint(doc);
  assert.deepEqual([...persisted], doc.vector);
});

test("close waits for an in-progress open and transaction, then closes only once", async () => {
  const corpus = new SWCorpus();
  let finishOpen, finishTransaction;
  let closes = 0,
    removals = 0;
  corpus._ready = new Promise((r) => {
    finishOpen = r;
  });
  corpus._taskDrain = new Promise((r) => {
    finishTransaction = r;
  });
  corpus._shutdownClient = { removeBlocker: () => removals++ };
  const first = corpus.close();
  assert.equal(corpus._stopped, true);
  assert.equal(corpus.close(), first);
  corpus._db = {
    close: async () => {
      closes++;
    },
  };
  finishOpen();
  await new Promise((r) => setImmediate(r));
  assert.equal(closes, 0);
  finishTransaction();
  await first;
  assert.equal(closes, 1);
  assert.equal(removals, 1);
  assert.equal(corpus._db, null);
});

test("common title topics survive rare body features and participate in retrieval", async () => {
  const index = new SWSearch.Index();
  index.epochN = 1000;
  index.averageFieldLengths = [3, 1, 2000];
  const hash = SWSearch.hash("w:hash");
  index.frozenDF.set(hash, 900);
  const title = new Map([[hash, 1]]),
    abstract = new Map(),
    body = new Map();
  for (let id = 1; id <= 2000; id++) body.set(id, 1);
  const counts = Object.assign(new Map([...body, ...title]), {
    fields: [title, abstract, body],
  });
  const query = index.add("1/query", counts, false);
  index.add(
    "1/hashing",
    Object.assign(new Map([[hash, 1]]), {
      fields: [title, abstract, new Map()],
    }),
    false,
  );
  index.add(
    "1/noise",
    new Map([
      [1, 1],
      [2, 1],
    ]),
    false,
  );
  assert.equal(query.vector.length, 256);
  assert.ok(new Map(query.vector).has(hash));
  const results = await index.search(
    "1/query",
    20,
    () => true,
    () => false,
    async () => {},
    () => {},
  );
  assert.equal(results[0].key, "1/hashing");
  assert.ok(
    results[0].score > 0.05,
    "shared title topics survive the display threshold",
  );
  await index.rebuild();
  assert.ok(index.docs.get("1/query").fieldVectors[0].length > 0);
});

test("damaged fingerprint rows are removed instead of blocking the whole index", async () => {
  const corpus = new SWCorpus();
  const counts = SWSearch.encodeCounts(new Map([[123, 4]]));
  const damaged = SWSearch.encodeCounts(new Map([[456, 2]])).slice(0, -1);
  const row = (key, values = {}) => ({
    getResultByName: (name) =>
      ({
        key,
        hash: key.slice(-1).toLowerCase(),
        weak: 0,
        counts,
        signature: null,
        epoch: 0,
        simhash: null,
        ...values,
      })[name],
  });
  const rows = [
    row("1/A"),
    row("1/B", { counts: damaged }),
    row("1/C", { signature: new Uint8Array(5) }),
    row("1/D", { simhash: new Uint8Array(4) }),
  ];
  const deletes = [];
  let page = 0;
  corpus._db = {
    async execute(sql, params) {
      if (sql.startsWith("SELECT COUNT")) return [{ getResultByName: () => 4 }];
      if (sql.startsWith("SELECT d.key")) return page++ ? [] : rows;
      if (sql.startsWith("SELECT counts"))
        return [{ getResultByName: () => counts }];
      if (sql.startsWith("DELETE")) deletes.push([sql, params]);
      return [];
    },
    async executeTransaction(run) {
      await run();
    },
  };
  corpus._persistFingerprints = async () => {};
  corpus._maintainEpoch = async () => {};
  await corpus._loadAll();
  assert.equal(corpus.progress.phase, "ready");
  assert.deepEqual([...corpus.docs.keys()], ["1/A"]);
  for (const key of ["1/B", "1/C", "1/D"])
    assert.equal(deletes.filter(([, params]) => params[0] === key).length, 5);
});

test("an unsupported index schema closes the database and shutdown blocker", async () => {
  const saved = {
    Zotero: global.Zotero,
    PathUtils: global.PathUtils,
    IOUtils: global.IOUtils,
    ChromeUtils: global.ChromeUtils,
  };
  let closed = 0;
  let removed = 0;
  global.Zotero = {
    DataDirectory: { dir: "/data" },
    logError() {},
  };
  global.PathUtils = { join: (...parts) => parts.join("/") };
  global.IOUtils = { makeDirectory: async () => {} };
  global.ChromeUtils = {
    importESModule: () => ({
      Sqlite: {
        shutdown: {
          addBlocker() {},
          removeBlocker() {
            removed++;
          },
        },
        openConnection: async () => ({
          async execute(sql) {
            if (sql.includes("sqlite_master"))
              return [{ getResultByName: () => "meta" }];
            if (sql.includes("schemaVersion"))
              return [{ getResultByName: () => "2" }];
            return [];
          },
          async executeTransaction(run) {
            await run();
          },
          async close() {
            closed++;
          },
        }),
      },
    }),
  };
  try {
    const corpus = new SWCorpus();
    await corpus._openAndLoad();
    assert.equal(corpus.progress.phase, "error");
    assert.equal(closed, 1);
    assert.equal(removed, 1);
  } finally {
    global.Zotero = saved.Zotero;
    global.PathUtils = saved.PathUtils;
    global.IOUtils = saved.IOUtils;
    global.ChromeUtils = saved.ChromeUtils;
  }
});

test("raw evidence rejects weak rankings and retains every strong match beyond a display batch", () => {
  const strong = Array.from({ length: 40 }, (_, i) => ({
    key: "1/S" + i,
    score: 0.8 - i * 0.004,
  }));
  const lexical = [...strong, { key: "1/TAIL", score: 0.07 }];
  assert.equal(SWSearch.relevant(lexical).length, 40);
  const weak = [{ key: "1/W", score: 0.01 }];
  assert.equal(SWSearch.relevant(weak).length, 0);
  assert.equal(SWSearch.relevant(weak, "semantic").length, 0);
  const fused = SWSearch.fuse([weak, weak]);
  assert.equal(fused[0].score, 1, "Rank alone cannot establish relevance");
  assert.equal(SWSearch.relevant(fused, "hybrid").length, 0);
  const accepted = SWSearch.fuse(
    [
      SWSearch.relevant(lexical),
      SWSearch.relevant([{ key: "1/D", score: 0.75 }], "semantic"),
    ],
    100,
  );
  assert.equal(accepted.length, 41);
  assert.equal(accepted.find((m) => m.key === "1/D").semanticScore, 0.75);
  assert.equal(accepted.find((m) => m.key === "1/S0").lexicalScore, 0.8);
});

test("startup restores source checks so an unchanged document needs no repeat write", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1;
  const counts = SWSearch.encodeCounts(new Map([[123, 4]]));
  const signature = SWSearch.encodeSignature([[123, 1]]);
  let page = 0;
  const writes = [];
  corpus._db = {
    async execute(sql, params) {
      if (sql.startsWith("SELECT COUNT")) return [{ getResultByName: () => 1 }];
      if (sql.startsWith("SELECT d.key"))
        return page++
          ? []
          : [
              {
                getResultByName: (name) =>
                  ({
                    key: "1/A",
                    hash: "source-v1",
                    weak: 1,
                    counts,
                    signature,
                    epoch: 1,
                    simhash: null,
                    itemModifiedAt: "2026-11-02 04:00:00",
                    sourceHash: "source-v1",
                  })[name],
              },
            ];
      writes.push([sql, params]);
      return [];
    },
  };
  corpus._maintainEpoch = async () => {};
  await corpus._loadAll();
  await corpus.recordSource("1/A", "2026-11-02 04:00:00", "source-v1");
  assert.equal(writes.length, 0);
  await corpus.recordSource("1/A", "2026-11-02 05:00:00", "source-v2");
  assert.equal(writes.length, 1);
  assert.ok(writes[0][0].includes("source_updates"));
});
