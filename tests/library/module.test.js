const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function fixture({ terms, failStop = false, failClose = false } = {}) {
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
          target.SWTags = {
            loadTerms: () => terms || Promise.resolve(),
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
            start: async () => calls.push("index.start"),
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

test("quit during preparation cannot start indexing or register late resources", async () => {
  let resolve;
  const f = fixture({
    terms: new Promise((done) => {
      resolve = done;
    }),
  });
  const starting = f.runtime.start();
  await f.runtime.close(true);
  resolve();
  await starting;
  assert.ok(!f.calls.includes("index.start"));
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
