const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function fixture() {
  const calls = [],
    timers = new Map();
  let idle,
    cancelled = false;
  class Corpus {
    constructor() {
      this.progress = { phase: "idle" };
      this.docs = new Map();
    }
    get ready() {
      calls.push("read-index");
      this.progress.phase = "ready";
      return Promise.resolve();
    }
  }
  const context = {
    SWCorpus: Corpus,
    SWSemantic: {
      status: { state: "disabled" },
      _queue: [],
      async start() {
        calls.push("read-vectors");
      },
    },
    IOUtils: {},
    swYield: async () => {},
    setTimeout(callback, delay) {
      timers.set(1, { callback, delay });
      return 1;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    Zotero: {
      Prefs: { get: () => undefined },
      Notifier: {
        registerObserver: () => 1,
        unregisterObserver: () => calls.push("unregister"),
      },
      logError: (error) => calls.push("error:" + error.message),
      getMainWindow: () => ({
        requestIdleCallback(callback) {
          idle = callback;
          return 7;
        },
        cancelIdleCallback() {
          cancelled = true;
        },
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/indexer.js"),
      "utf8",
    ),
    context,
  );
  const indexer = context.SWIndexer;
  indexer.enqueueLibrary = async () => calls.push("scan");
  indexer._drain = async () => calls.push("drain");
  return {
    indexer,
    calls,
    timers,
    get idle() {
      return idle;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

test("startup queues notifications without reading the text index or vectors", async () => {
  const f = fixture();
  await f.indexer.start();
  f.indexer.enqueue(123);
  assert.deepEqual(f.calls, []);
  assert.equal(f.timers.get(1).delay, 30000);
  f.indexer.requestStop();
  await f.indexer._scanPromise;
  assert.deepEqual(f.calls, ["unregister"]);
  assert.equal(f.timers.size, 0);
});

test("foreground expansion bypasses the delay and serializes text, vector and scan work", async () => {
  const f = fixture();
  await f.indexer.start();
  f.indexer.wake();
  await f.indexer._scanPromise;
  assert.deepEqual(f.calls, ["read-index", "read-vectors", "scan"]);
  assert.equal(f.timers.size, 0);
  f.indexer.requestStop();
});

test("background preparation waits for idle after the startup grace period", async () => {
  const f = fixture();
  await f.indexer.start();
  f.timers.get(1).callback();
  assert.deepEqual(f.calls, []);
  f.idle();
  await f.indexer._scanPromise;
  assert.ok(f.cancelled);
  assert.deepEqual(f.calls, ["read-index", "read-vectors", "scan"]);
  f.indexer.requestStop();
});

test("closing during idle preparation cancels the callback without loading resources", async () => {
  const f = fixture();
  await f.indexer.start();
  f.timers.get(1).callback();
  f.indexer.requestStop();
  await f.indexer._scanPromise;
  assert.ok(f.cancelled);
  assert.deepEqual(f.calls, ["unregister"]);
});

test("deletion during startup is cancelled before opening storage", async () => {
  const f = fixture();
  await f.indexer.start();
  const removing = f.indexer._removeById(123);
  f.indexer.requestStop();
  await Promise.all([f.indexer._scanPromise, removing]);
  assert.deepEqual(f.calls, ["unregister"]);
});
