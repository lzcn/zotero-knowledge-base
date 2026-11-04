const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function fixture({ indexStart, failStop = false, failClose = false } = {}) {
  const calls = [];
  let scope;
  const context = {
    SWHost: {
      id: "knowledge-base@lzcn",
      rootURI: "jar:knowledgeBase!/content/library/",
      manifestURI: "jar:knowledgeBase!/manifest.json",
    },
    Zotero: {
      logError: (error) => calls.push("error:" + error.message),
    },
    ChromeUtils: {},
    Services: {
      io: { newURI: (value) => value },
      scriptloader: {
        loadSubScript(uri, target) {
          scope = target;
          calls.push("load:" + uri.split("/").pop());
          target.SWTagTerms = { load: async () => {} };
          target.SWTags = {
            stop() {
              calls.push("tags.stop");
              if (failStop) throw new Error("stop failure");
            },
            finishWrites: async () => {
              calls.push("tags.writes");
              if (failClose) throw new Error("write failure");
            },
          };
          target.SWSection = {
            init: () => calls.push("register"),
            shutdown: () => calls.push("section.stop"),
            injectWindow: () => calls.push("window.load"),
            removeWindow: () => calls.push("window.unload"),
          };
          target.SWSemantic = { stop: () => calls.push("semantic.stop") };
          target.SWIndexer = {
            start: async () => {
              calls.push("index.start");
              await indexStart;
            },
            requestStop: () => calls.push("index.stop"),
            shutdown: async () => calls.push("index.drain"),
            corpus: {
              ready: Promise.resolve(),
              close: async () => calls.push("database.close"),
            },
          };
        },
      },
    },
    Components: {
      classes: {
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService: () => ({
            registerChrome: () => ({
              destruct: () => calls.push("chrome.close"),
            }),
          }),
        },
      },
      interfaces: {},
    },
    IOUtils: {},
    PathUtils: {},
    TextDecoder,
    TextEncoder,
    Ci: {},
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/runtime.js"),
      "utf8",
    ),
    context,
  );
  return {
    runtime: context.libraryRuntime,
    context,
    calls,
    get scope() {
      return scope;
    },
  };
}

test("one owner starts the item index once; settings belong to Knowledge Base", async () => {
  const f = fixture();
  await Promise.all([f.runtime.start(), f.runtime.start()]);
  assert.equal(f.runtime.state, "ready");
  assert.equal(f.calls.filter((value) => value === "index.start").length, 1);
  assert.equal(f.scope.SWPlugin.id, "knowledge-base@lzcn");
  f.runtime.onWindowLoad({});
  f.runtime.onWindowUnload({});
  await f.runtime.close();
  await f.runtime.close();
  assert.equal(f.calls.filter((value) => value === "database.close").length, 1);
  assert.ok(f.calls.includes("window.unload"));
});

test("quit during index preparation cannot register late resources", async () => {
  let resolve;
  const f = fixture({
    indexStart: new Promise((done) => {
      resolve = done;
    }),
  });
  const starting = f.runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  await f.runtime.close(true);
  resolve();
  await starting;
  assert.equal(f.calls.filter((call) => call === "index.start").length, 1);
  assert.ok(!f.calls.includes("register"));
  assert.equal(f.runtime.state, "stopped");
});

test("stop and write failures do not skip remaining cleanup", async () => {
  const f = fixture({ failStop: true, failClose: true });
  await f.runtime.start();
  await f.runtime.close();
  assert.ok(f.calls.includes("semantic.stop"));
  assert.ok(f.calls.includes("index.stop"));
  assert.ok(f.calls.includes("database.close"));
  assert.ok(f.calls.includes("chrome.close"));
});

test("application quit does not wait for a library scan", async () => {
  const f = fixture();
  await f.runtime.start();
  f.scope.SWIndexer.shutdown = () => new Promise(() => {});
  await f.runtime.close(true);
  assert.ok(f.calls.includes("database.close"));
});

test("tag suggestions load cached neighbors tags in one batch without opening the full index", async () => {
  const f = fixture();
  await f.runtime.start();
  const target = { id: 1 },
    neighbor = { id: 2 };
  let loaded = false,
    suggested = 0;
  f.scope.SWIndexer.resolveDocItem = async () => target;
  f.scope.SWIndexer.docKey = () => "1/ITEM";
  f.scope.SWIndexer.corpus.getRecommendations = async () => ({
    matches: [{ key: "1/NEIGHBOR", score: 0.9 }],
  });
  Object.defineProperty(f.scope.SWIndexer.corpus, "ready", {
    get() {
      throw new Error("Tags must not wait for the index");
    },
  });
  f.scope.SWSection._resolveRows = async () => [{ item: neighbor }];
  f.context.Zotero.Items = {
    loadDataTypes: async (items, types) => {
      assert.deepEqual(Array.from(items), [target, neighbor]);
      assert.deepEqual(Array.from(types), ["tags"]);
      loaded = true;
    },
  };
  f.scope.SWTags.suggest = async () => {
    assert.ok(loaded);
    suggested++;
    return ["topic"];
  };
  assert.deepEqual(await f.runtime.suggestTags(target, () => true), ["topic"]);
  assert.equal(suggested, 1);
  await f.runtime.close();
});

test("uncached tag neighbors search completed fingerprints or vectors without starting document indexing", async () => {
  for (const dense of [false, true]) {
    const f = fixture();
    await f.runtime.start();
    const target = { id: 1, libraryID: 1 },
      neighbor = { id: 2, libraryID: 1 };
    const corpus = f.scope.SWIndexer.corpus;
    const matches = [{ key: "1/NEIGHBOR", score: 0.8 }];
    let searches = 0;
    corpus.getRecommendations = async () => null;
    corpus.progress = { phase: "ready" };
    corpus.search = {
      docs: new Map([["1/ITEM", {}]]),
      search: async (key, _count, filter, cancelled) => {
        assert.equal(key, "1/ITEM");
        assert.ok(filter("1/NEIGHBOR"));
        assert.ok(!filter("2/FOREIGN"));
        assert.ok(!cancelled());
        searches++;
        return matches;
      },
    };
    Object.defineProperty(corpus, "ready", {
      get() {
        throw new Error("Tag requests must not reload the corpus");
      },
    });
    f.scope.SWIndexer.resolveDocItem = async () => target;
    f.scope.SWIndexer.docKey = () => "1/ITEM";
    f.scope.SWIndexer.ensureNow = () => {
      throw new Error("Unexpected paper indexing");
    };
    Object.assign(f.scope.SWSemantic, {
      ready: dense,
      vectors: new Map([["1/ITEM", {}]]),
      recommend: async () => {
        searches++;
        return { matches };
      },
    });
    f.scope.SWSection._resolveRows = async (result, method) => {
      assert.equal(result, matches);
      assert.equal(method, dense ? "hybrid" : "text");
      return [{ item: neighbor, score: 0.8 }];
    };
    f.context.Zotero.Items = {
      loadDataTypes: async (items) =>
        assert.deepEqual(Array.from(items), [target, neighbor]),
    };
    f.scope.SWTags.suggest = async (_item, rows) => {
      assert.equal(rows[0].item, neighbor);
      return ["topic"];
    };
    assert.deepEqual(await f.runtime.suggestTags(target, () => true), [
      "topic",
    ]);
    assert.equal(searches, 1);
    await f.runtime.close();
  }
});
