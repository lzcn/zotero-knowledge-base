const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function fixture() {
  const calls = [];
  let release;
  const loaded = new Promise((resolve) => {
    release = resolve;
  });
  class Corpus {
    async saveSearchCache() {}
    constructor() {
      this.progress = { phase: "idle" };
      this.docs = new Map();
    }
    get ready() {
      if (!this._ready) {
        calls.push("read-index");
        this._ready = loaded.then(() => {
          this.progress.phase = "ready";
        });
      }
      return this._ready;
    }
  }
  const context = {
    SWCorpus: Corpus,
    SWSemantic: {
      status: { state: "disabled" },
      _queue: [],
      start: async () => {
        calls.push("read-vectors");
      },
    },
    IOUtils: {},
    swYield: async () => {},
    setTimeout,
    clearTimeout,
    Zotero: {
      Prefs: { get: () => undefined },
      Notifier: {
        registerObserver: () => 1,
        unregisterObserver: () => calls.push("unregister"),
      },
      logError: (error) => calls.push("error:" + error.message),
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
  return { indexer, context, calls, release };
}

test("startup immediately preloads persisted retrieval without blocking UI registration or waiting for a timer", async () => {
  const f = fixture();
  await f.indexer.start();
  await f.indexer.start();
  assert.deepEqual(f.calls, ["read-index"]);
  f.release();
  await f.indexer._scanPromise;
  assert.deepEqual(f.calls, ["read-index", "read-vectors", "scan"]);
  f.indexer.requestStop();
});

test("stopping during preload prevents vectors, library scanning and deletion writes", async () => {
  const f = fixture();
  await f.indexer.start();
  const removing = f.indexer._removeById(123);
  f.indexer.requestStop();
  f.release();
  await Promise.all([f.indexer._scanPromise, removing]);
  assert.deepEqual(f.calls, ["read-index", "unregister"]);
});

test("changed documents pause once per batch instead of after every document", async () => {
  const f = fixture();
  await f.indexer.start();
  f.release();
  await f.indexer._scanPromise;
  const processed = [];
  let pauseSlices = 0;
  f.indexer._processId = async (id) => {
    processed.push(id);
    return true;
  };
  f.context.swYield = async (ms) => {
    if (ms === 100) pauseSlices++;
  };
  for (let id = 0; id < 11; id++) {
    f.indexer._queue.push(id);
    f.indexer._queued.add(id);
  }
  await f.indexer._drain();
  assert.equal(processed.length, 11);
  assert.equal(pauseSlices, 20);
  f.indexer.requestStop();
});

test("quitting before index preparation never creates a competing status-only cache directory", async () => {
  const f = fixture();
  let writes = 0;
  f.context.IOUtils.writeUTF8 = async () => {
    writes++;
  };
  f.context.IOUtils.makeDirectory = async () => {
    throw new Error("Unexpected directory creation");
  };
  await f.indexer.start();
  const previous = f.indexer._statusWrite;
  f.indexer._reportStatus(true);
  assert.equal(f.indexer._statusWrite, previous);
  f.indexer.requestStop();
  f.release();
  await f.indexer._scanPromise;
  assert.equal(writes, 0);
});
