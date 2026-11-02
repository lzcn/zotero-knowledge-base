const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { SWSearch } = require("../../src/library/search.js");
function fixture() {
  const writes = [];
  const context = vm.createContext({
    SWSearch,
    SWPref: (_key, fallback) => fallback,
    SWIndexer: { _reportStatus() {} },
    SWSection: { _active: [], refreshSemantic() {} },
    Zotero: { logError() {}, isMac: true, Items: {} },
    swYield: async () => {},
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Float32Array,
    Uint8Array,
    DataView,
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/storage.js"),
      "utf8",
    ),
    context,
  );
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/semantic.js"),
      "utf8",
    ),
    context,
  );
  const semantic = context.SWSemantic;
  semantic.corpus = {
    docs: new Map(),
    revision: 0,
    search: { epoch: 1 },
    progress: { phase: "ready" },
    ready: Promise.resolve(),
    runTask: async (work) => work(),
    saveHybridRecommendations: async () => {},
    _db: {
      execute: async (...args) => {
        writes.push(args);
        return [];
      },
    },
  };
  function put(key, hash, values, weak = false) {
    const vector = new Float32Array(384);
    vector.set(values);
    semantic.corpus.docs.set(key, { hash, weak });
    semantic.vectors.set(key, { hash, vector: semantic.pool([vector], [1]) });
  }
  return { context, semantic, put, writes };
}
test("dense vectors preserve signed values, normalize and reject corruption", () => {
  const { semantic } = fixture();
  const values = new Float32Array(384);
  values[0] = -3;
  values[1] = 4;
  const vector = semantic.pool([values], [3]);
  assert.ok(Math.abs(vector[0] + 0.6) < 1e-6);
  assert.ok(Math.abs(vector[1] - 0.8) < 1e-6);
  assert.deepEqual(semantic.decode(semantic.encode(vector)), vector);
  assert.throws(() => semantic.decode(new Uint8Array(7)), /Invalid/);
  values[0] = NaN;
  assert.throws(() => semantic.pool([values], [1]), /Invalid/);
});
test("native SQLite byte arrays and unaligned views retain cached embeddings", async () => {
  const { semantic } = fixture();
  const vector = new Float32Array(384);
  vector[0] = -0.6;
  vector[1] = 0.8;
  const bytes = semantic.encode(vector);
  const nativeBytes = Array.from(bytes);
  assert.deepEqual(semantic.decode(nativeBytes), semantic.decode(bytes));
  const unaligned = new Uint8Array(bytes.length + 1);
  unaligned.set(bytes, 1);
  assert.deepEqual(
    semantic.decode(unaligned.subarray(1)),
    semantic.decode(bytes),
  );
  semantic.corpus.docs.set("1/A", { hash: "unchanged" });
  semantic.corpus._db.execute = async (_sql, params) =>
    params[1]
      ? []
      : [
          {
            getResultByName: (name) =>
              ({ key: "1/A", sourceHash: "unchanged", vector: nativeBytes })[
                name
              ],
          },
        ];
  await semantic.start(semantic.corpus);
  assert.equal(semantic.status.indexedItems, 1);
  assert.ok(semantic._startupTimer);
  semantic.enable();
  assert.equal(semantic._startupTimer, null);
  assert.equal(semantic._queue.length, 0);
  assert.equal(semantic._running, null);
  assert.equal((await semantic.search("1/A", 20)).length, 0);
  semantic.stop();
});

test("existing vectors load in bounded pages without re-encoding or writing old caches", async () => {
  const { semantic, context } = fixture();
  const nativeBytes = Array.from(
    semantic.encode(semantic.normalize(new Float32Array(384).fill(1))),
  );
  const rows = Array.from({ length: 235 }, (_, i) => ({
    key: `1/${String(i).padStart(4, "0")}`,
    sourceHash: "unchanged",
    vector: nativeBytes,
  }));
  rows.forEach((row) =>
    semantic.corpus.docs.set(row.key, { hash: row.sourceHash }),
  );
  rows[12].sourceHash = "stale";
  let reads = 0,
    yields = 0,
    elapsed = 0;
  context.Date = { now: () => elapsed };
  context.swYield = async () => {
    yields++;
  };
  const decode = semantic.decode.bind(semantic);
  semantic.decode = (bytes) => {
    // Force a realistic long decode slice without a wall-clock-dependent test.
    elapsed += 7;
    return decode(bytes);
  };
  semantic.corpus._db.execute = async (sql, params) => {
    assert.match(sql, /^SELECT /);
    assert.equal(params[0], "minilm-l6-fp32-v2");
    reads++;
    return rows
      .filter((row) => row.key > params[1])
      .slice(0, 100)
      .map((row) => ({ getResultByName: (name) => row[name] }));
  };
  await semantic.start(semantic.corpus);
  assert.equal(reads, 4);
  assert.equal(semantic.vectors.size, 234);
  assert.ok(!semantic.vectors.has(rows[12].key));
  assert.ok(yields > 0);
  semantic.corpus.docs.delete(rows[12].key);
  semantic._pump = () => assert.fail("Unchanged vectors must not be rebuilt");
  semantic.enable();
  assert.equal(semantic._queue.length, 0);
  semantic.stop();
});

test("shutdown during cached-vector loading stops before the next page", async () => {
  const { semantic } = fixture();
  const bytes = semantic.encode(
    semantic.normalize(new Float32Array(384).fill(1)),
  );
  let reads = 0;
  semantic.corpus.docs.set("1/A", { hash: "a" });
  semantic.corpus._db.execute = async () => {
    reads++;
    semantic.stop();
    return [
      {
        getResultByName: (name) =>
          ({ key: "1/A", sourceHash: "a", vector: bytes })[name],
      },
    ];
  };
  await semantic.start(semantic.corpus);
  assert.equal(reads, 1);
  assert.equal(semantic.vectors.size, 0);
  assert.equal(semantic._startupTimer, null);
  assert.equal(semantic.status.state, "stopped");
});
test("semantic Top-K uses valid same-library vectors and respects cancellation", async () => {
  const { semantic, put } = fixture();
  put("1/Q", "q", [1, 0]);
  put("1/A", "a", [0.8, 0.6]);
  put("1/B", "b", [0.1, 0.99]);
  put("2/A", "a", [1, 0]);
  put("1/stale", "old", [1, 0]);
  semantic.corpus.docs.get("1/stale").hash = "new";
  const result = await semantic.search("1/Q", 1, (key) => key.startsWith("1/"));
  assert.equal(result.length, 1);
  assert.equal(result[0].key, "1/A");
  assert.equal((await semantic.search("1/Q", 20, null, () => true)).length, 0);
  semantic.corpus.docs.get("1/Q").hash = "updated";
  assert.equal(await semantic.search("1/Q", 20, null), null);
});
test("source changes invalidate a vector and foreground requests move ahead", () => {
  const { semantic, put } = fixture();
  semantic._enabled = true;
  semantic._running = Promise.resolve();
  put("1/A", "old", [1]);
  semantic.corpus.docs.get("1/A").hash = "new";
  semantic.enqueue("1/A");
  semantic.corpus.docs.set("1/B", { hash: "b" });
  semantic.enqueue("1/B", true);
  assert.equal(semantic.vectors.has("1/A"), false);
  assert.deepEqual(Array.from(semantic._queue), ["1/B", "1/A"]);
});
test("switching away and quitting terminate inference and abort downloads", async () => {
  const { semantic } = fixture();
  let terminated = 0,
    aborted = 0;
  semantic._worker = {
    postMessage() {},
    terminate() {
      terminated++;
    },
  };
  semantic._downloads.set("model", {
    abort() {
      aborted++;
    },
  });
  const pending = semantic._request("tokenize", { texts: ["hashing"] });
  const rejected = assert.rejects(pending, /paused/);
  semantic.stop();
  await rejected;
  assert.equal(terminated, 1);
  assert.equal(aborted, 1);
  assert.equal(semantic._pending.size, 0);
  assert.equal(semantic._queue.length, 0);
  assert.equal(semantic.status.state, "stopped");
});
test("a source changing during inference never persists an obsolete embedding", async () => {
  const { semantic, context, writes } = fixture();
  semantic._enabled = true;
  semantic.corpus.docs.set("1/A", { hash: "old" });
  context.Zotero.Items.getByLibraryAndKeyAsync = async () => ({
    deleted: false,
    getField: () => "Hashing",
  });
  semantic._init = async () => {};
  semantic._native = {};
  semantic._nativeEncode = async () => {
    semantic.corpus.docs.set("1/A", { hash: "new" });
    const vector = new Float32Array(384);
    vector[0] = 1;
    return { vectors: [vector] };
  };
  await semantic._build("1/A");
  assert.equal(writes.length, 0);
  assert.equal(semantic.vectors.size, 0);
});
test("input chunking stays bounded and removes reference sections", () => {
  const { semantic } = fixture();
  const chunks = semantic.chunks(
    "Spectral hashing",
    "",
    "binary codes ".repeat(10000) + "\nReferences\nSmith 2008",
  );
  assert.ok(chunks.length <= 4);
  assert.ok(chunks[0].includes("spectral hashing"));
  assert.ok(chunks.every((s) => s.length <= 1800 && !s.includes("Smith")));
});

test("hybrid caches invalidate on vector, lexical epoch and corpus changes", () => {
  const { semantic, put } = fixture();
  put("1/Q", "q", [1, 0]);
  put("1/A", "a", [1, 0]);
  semantic.saveRecommendations("1/Q", true, [
    { key: "1/A", score: 1, weak: false },
  ]);
  const cached = semantic.getRecommendations("1/Q", true);
  assert.ok(cached);
  assert.ok(semantic.recommendationsFresh(cached, "1/Q"));
  // Changing one dense rank invalidates fusion; cosine must not patch RRF scores.
  put("1/B", "b", [0.8, 0.6]);
  semantic._applyVectorChange("1/B");
  assert.deepEqual(
    cached.matches.map((m) => m.key),
    ["1/A"],
  );
  assert.ok(!semantic.recommendationsFresh(cached, "1/Q"));
  semantic.saveRecommendations("1/Q", true, cached.matches);
  let fresh = semantic.getRecommendations("1/Q", true);
  assert.ok(semantic.recommendationsFresh(fresh, "1/Q"));
  semantic.corpus.search.epoch++;
  assert.ok(!semantic.recommendationsFresh(fresh, "1/Q"));
  semantic.saveRecommendations("1/Q", true, fresh.matches);
  fresh = semantic.getRecommendations("1/Q", true);
  semantic.corpus.revision++;
  assert.ok(!semantic.recommendationsFresh(fresh, "1/Q"));
  semantic.forget("1/A");
  assert.equal(cached.dirty, true);
  assert.ok(!semantic.recommendationsFresh(cached, "1/Q"));
  // A changed query vector drops its own cached ranking.
  semantic._applyVectorChange("1/Q");
  assert.equal(semantic.getRecommendations("1/Q", true), null);
});

test("hybrid retrieval fuses ranks, falls back before embeddings and rejects stale work", async () => {
  const { semantic, put } = fixture();
  put("1/Q", "q", [1, 0]);
  put("1/A", "a", [0.8, 0.6]);
  put("1/B", "b", [1, 0]);
  const lexical = [
    { key: "1/A", score: 0.3 },
    { key: "1/C", score: 0.2 },
  ];
  semantic.corpus.search.search = async (_key, k) => {
    assert.equal(k, 100);
    return lexical;
  };
  let result = await semantic.recommend("1/Q", 10);
  assert.equal(result.matches[0].key, "1/A");
  assert.equal(result.matches.length, 3);
  semantic.vectors.delete("1/Q");
  result = await semantic.recommend("1/Q", 10);
  assert.deepEqual(
    result.matches.map((m) => [m.key, m.lexicalScore]),
    lexical.map((m) => [m.key, m.score]),
  );
  semantic.corpus.search.search = async () => {
    semantic.corpus.revision++;
    return lexical;
  };
  assert.equal(await semantic.recommend("1/Q", 10), null);
  assert.equal(await semantic.recommend("1/Q", 10, null, () => true), null);
  semantic.saveRecommendations("1/Q", true, lexical, result.snapshot);
  assert.equal(semantic.getRecommendations("1/Q", true), null);
});

test("model cache deduplicates loads and verifies downloaded bytes", async () => {
  const { semantic, context } = fixture();
  const crypto = require("node:crypto");
  context.Zotero.getMainWindow = () => ({ crypto: crypto.webcrypto });
  const bytes = new TextEncoder().encode("model contents");
  semantic.assets["test"] = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  await semantic._validateAsset("test", bytes);
  await assert.rejects(
    semantic._validateAsset("test", new Uint8Array([1])),
    /checksum/,
  );
  let loads = 0;
  semantic._readModelFile = async () => {
    loads++;
    return bytes;
  };
  const [a, b] = await Promise.all([
    semantic._modelFile("test"),
    semantic._modelFile("test"),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(a, b);
});

test("rapid method switches do not let an old worker failure poison the new queue", async () => {
  const { semantic, context } = fixture();
  semantic._enabled = true;
  semantic._queue = ["1/A"];
  semantic._rest = async () => {};
  let fail;
  semantic._build = () =>
    new Promise((_resolve, reject) => {
      fail = reject;
    });
  const running = semantic._drain();
  await new Promise((resolve) => setImmediate(resolve));
  semantic.pause();
  semantic._enabled = true;
  semantic.status.state = "waiting";
  context.SWSection.refreshSemantic = () => {};
  fail(new Error("Old worker cancelled"));
  await running;
  assert.equal(semantic.status.state, "waiting");
  assert.equal(semantic.status.error, null);
});

test("foreground selection interrupts background delay and runs before queued work", async () => {
  const { context, semantic } = fixture();
  semantic._enabled = true;
  semantic.corpus.docs.set("1/B", { hash: "background" });
  semantic.corpus.docs.set("1/Q", { hash: "selected" });
  let resume;
  let waits = 0;
  context.swYield = () => {
    waits++;
    return new Promise((resolve) => {
      resume = resolve;
    });
  };
  const built = [];
  semantic._build = async (key) => {
    built.push(key);
    if (key === "1/B") semantic.pause();
  };
  semantic.enqueue("1/B");
  assert.equal(waits, 1);
  semantic.enqueue("1/Q", true);
  resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(built, ["1/Q"]);
  assert.equal(waits, 2);
  semantic.enqueue("1/B", true);
  resume();
  await semantic._running;
  assert.deepEqual(built, ["1/Q", "1/B"]);
  assert.equal(waits, 2);
  assert.equal(semantic._priority.size, 0);
});

test("a foreground request skips startup delay", async () => {
  const { context, semantic } = fixture();
  semantic._enabled = true;
  semantic.corpus.docs.set("1/Q", { hash: "selected" });
  let waits = 0;
  context.swYield = async () => {
    waits++;
  };
  semantic._build = async () => semantic.pause();
  semantic.enqueue("1/Q", true);
  await semantic._running;
  assert.equal(waits, 0);
});

test("tag-name inference reuses the paper vector and cached tags, serializes with document encoding, and cancels stale results", async () => {
  const { semantic, context, put } = fixture();
  context.SWIndexer.docKey = () => "1/A";
  put("1/A", "one", [1, 0]);
  semantic._worker = {};
  semantic._enabled = true;
  let running = 0,
    peak = 0,
    requests = 0;
  semantic._native = {};
  semantic._nativeEncode = async (texts) => {
    running++;
    peak = Math.max(peak, running);
    requests++;
    await new Promise((resolve) => setImmediate(resolve));
    running--;
    return {
      vectors: texts.map((text) => {
        const v = Array(384).fill(0);
        v[text === "Relevant" ? 0 : 1] = 1;
        return v;
      }),
    };
  };
  const [scores] = await Promise.all([
    semantic.tagSimilarity({}, ["Relevant", "Other"]),
    semantic._encode(["Document"]),
  ]);
  assert.deepEqual(Array.from(scores), [1, 0]);
  assert.equal(peak, 1);
  assert.equal(requests, 2);
  await semantic.tagSimilarity({}, ["Relevant", "Other"]);
  assert.equal(requests, 2, "tag names should not be encoded again");
  assert.equal(
    await semantic.tagSimilarity({}, ["Missing"], () => false),
    null,
  );
  semantic._native = {};
  semantic._nativeEncode = async (texts) => {
    semantic.corpus.docs.get("1/A").hash = "changed";
    return { vectors: texts.map(() => Array(384).fill(0)) };
  };
  assert.equal(await semantic.tagSimilarity({}, ["New"]), null);
});

test("background inference waits for host idle time and foreground selection releases that wait", async () => {
  const { semantic, context } = fixture();
  let idleCallback,
    cancelled = 0;
  context.Zotero.getMainWindow = () => ({
    requestIdleCallback(callback) {
      idleCallback = callback;
      return 7;
    },
    cancelIdleCallback(id) {
      assert.equal(id, 7);
      cancelled++;
    },
  });
  let done = false;
  const idle = semantic._idle().then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  semantic._enabled = true;
  semantic._running = Promise.resolve();
  semantic.corpus.docs.set("1/FOREGROUND", { hash: "selected" });
  semantic.enqueue("1/FOREGROUND", true);
  await idle;
  assert.equal(done, true);
  assert.equal(cancelled, 1);
  assert.equal(semantic._idleWait, null);
  const shutdownIdle = semantic._idle();
  semantic.pause();
  await shutdownIdle;
  assert.equal(cancelled, 2);
  assert.equal(semantic._idleWait, null);
  assert.ok(idleCallback);
});

test("tokenizer worker returns native inputs with bounded token length in document order", async () => {
  const source = fs
    .readFileSync(
      path.join(__dirname, "../../src/ui/library/worker.js"),
      "utf8",
    )
    .replace(
      'import { env, AutoTokenizer } from "@huggingface/transformers";',
      "",
    );
  const messages = [],
    calls = [];
  const context = vm.createContext({
    env: {},
    Response: globalThis.Response,
    AutoTokenizer: {
      from_pretrained: async () => (text, options) => {
        calls.push({ text, options });
        return {
          input_ids: { data: [BigInt(text.length)] },
          attention_mask: { data: [1n] },
        };
      },
    },
    self: { postMessage: (message) => messages.push(message) },
  });
  vm.runInContext(source, context);
  await context.self.onmessage({
    data: { type: "init", id: 1, model: "fixture" },
  });
  await context.self.onmessage({
    data: { type: "tokenize", id: 2, texts: ["first", "second"] },
  });
  assert.equal(messages[0].ready, true);
  assert.deepEqual(
    calls.map(({ text }) => text),
    ["first", "second"],
  );
  assert.ok(
    calls.every(
      ({ options }) =>
        options.truncation &&
        options.max_length === 256 &&
        options.padding === "max_length",
    ),
  );
  assert.equal(messages[1].inputs[0].input_ids[0], 5);
  assert.equal(messages[1].inputs[1].input_ids[0], 6);
});

test("native transport assembles partial lines and preserves subsequent replies", async () => {
  const { semantic } = fixture();
  const chunks = ['{"ready":', 'true}\n{"backend":"cpu"}\n'];
  const process = { stdout: { readString: async () => chunks.shift() || "" } };
  semantic._native = process;
  assert.equal((await semantic._nativeReply(process)).ready, true);
  assert.equal((await semantic._nativeReply(process)).backend, "cpu");
  await assert.rejects(semantic._nativeReply(process), /exited/);
});

test("pause immediately kills native inference and rejects worker requests", async () => {
  const { semantic } = fixture();
  let killed = null;
  semantic._native = {
    kill: async (timeout) => {
      killed = timeout;
    },
  };
  semantic._enabled = true;
  semantic.pause();
  assert.equal(killed, 0);
  assert.equal(semantic._native, null);
});

test("native process termination remains awaitable after its handle is cleared", async () => {
  const { semantic } = fixture();
  let release;
  semantic._native = {
    kill: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  let finishInitialization;
  semantic._initializing = new Promise((resolve) => {
    finishInitialization = resolve;
  });
  semantic.stop();
  let exited = false;
  const stopping = semantic._nativeExit.then(() => {
    exited = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exited, false);
  assert.equal(semantic._native, null);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exited, false);
  finishInitialization();
  await stopping;
  assert.equal(exited, true);
});

test("native embeddings validate dimensions and stop between cancelled chunks", async () => {
  const { semantic } = fixture();
  semantic._enabled = true;
  let writes = 0;
  semantic._native = {
    stdin: {
      write: async () => {
        writes++;
      },
    },
  };
  semantic._request = async () => ({
    inputs: [{ input_ids: [] }, { input_ids: [] }],
  });
  semantic._nativeReply = async () => ({
    vector: Array(384).fill(0),
    backend: "cpu",
  });
  const result = await semantic._nativeEncode(
    ["one", "two"],
    semantic._generation,
    () => true,
  );
  assert.equal(result.vectors.length, 2);
  assert.equal(writes, 2);
  writes = 0;
  await assert.rejects(
    semantic._nativeEncode(
      ["one", "two"],
      semantic._generation,
      () => writes === 0,
    ),
    /cancelled/,
  );
  assert.equal(writes, 1);
  semantic._nativeReply = async () => ({ vector: [1], backend: "cpu" });
  await assert.rejects(
    semantic._nativeEncode(["one"], semantic._generation, () => true),
    /Invalid native/,
  );
});

test("tag embedding cache keeps frequently used topics warm and encodes duplicate names once", async () => {
  const { semantic, context, put } = fixture();
  context.SWIndexer.docKey = () => "1/A";
  put("1/A", "one", [1, 0]);
  semantic._enabled = true;
  semantic._worker = {};
  const vector = Array(384).fill(0);
  vector[0] = 1;
  semantic._tagVectors.set("Frequent topic", vector);
  for (let i = 0; i < 511; i++) semantic._tagVectors.set("Topic " + i, vector);
  const encoded = [];
  semantic._encode = async (names) => {
    encoded.push(...names);
    return { vectors: names.map(() => vector) };
  };
  assert.deepEqual(
    Array.from(
      await semantic.tagSimilarity({}, [
        "Frequent topic",
        "New topic",
        "New topic",
      ]),
    ),
    [1, 1, 1],
  );
  assert.deepEqual(encoded, ["New topic"]);
  assert.equal(semantic._tagVectors.size, 512);
  assert.equal(semantic._tagVectors.has("Topic 0"), false);
  await semantic.tagSimilarity({}, ["Frequent topic", "New topic"]);
  assert.deepEqual(encoded, ["New topic"]);
});
