import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-lifecycle-"));
const output = join(workspace, "hooks.mjs");
await build({
  entryPoints: ["src/hooks.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  plugins: [
    {
      name: "host-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /(?:modules|utils)\// }, (args) => ({
          path: args.path,
          namespace: "lifecycle",
        }));
        builder.onLoad({ filter: /.*/, namespace: "lifecycle" }, () => ({
          contents: `
      const state = () => globalThis.lifecycle;
      const run = async (name) => {
        state().calls.push(name);
        if (state().fail === name) throw new Error(name + " failed");
        if (name === "initDB") await state().gate;
      };
      export const initLocale = () => {};
      export const getString = (key) => key;
      export const initDB = () => run("initDB");
      export const closeDB = () => run("closeDB");
      export const initNativeNotes = () => run("nativeNotes");
      export const stopNativeNotes = () => run("stopNativeNotes");
      export const closeNativeNotes = () => run("closeNativeNotes");
      export const initAssets = () => run("initAssets");
      export const stopAssets = () => run("stopAssets");
      export const closeAssets = () => run("closeAssets");
      export const cleanupImagesAfterChange = () => run("cleanupImages");
      export const rebuildCounts = () => run("rebuildCounts");
      export const registerPreferences = () => run("registerPreferences");
      export const unregisterPreferences = () => {};
      export const registerItemPaneUI = () => run("registerPane");
      export const unregisterItemPaneUI = () => run("unregisterPane");
      export const registerReaderUI = () => run("registerReader");
      export const unregisterReaderUI = () => run("unregisterReader");
      export const clearStartupLog = () => run("clearLog");
      export const reportStartupFailure = async (step, error) => { state().failures.push({ step, error }); };
    `,
        }));
      },
    },
  ],
});
let serial = 0;
async function fixture({ fail, deferred = false, unready = false } = {}) {
  let resolve;
  const gate = deferred
    ? new Promise((r) => {
        resolve = r;
      })
    : Promise.resolve();
  const doms = [0, 1].map(
    () =>
      new JSDOM(
        '<main><div id="menu_ToolsPopup"></div><div id="zotero-itemmenu"></div></main>',
      ),
  );
  for (const dom of doms) {
    dom.window.document.createXULElement = (tag) =>
      dom.window.document.createElement(tag);
    dom.window.MozXULElement = { insertFTLIfNeeded() {} };
    dom.window.ZoteroPane = { getSelectedItems: () => [] };
  }
  globalThis.lifecycle = { calls: [], failures: [], errors: [], fail, gate };
  const state = globalThis.lifecycle;
  globalThis.Zotero = {
    initializationPromise: Promise.resolve(),
    unlockPromise: Promise.resolve(),
    uiReadyPromise: unready ? new Promise(() => {}) : Promise.resolve(),
    getMainWindows: () => doms.map((dom) => dom.window),
    logError: (e) => state.errors.push(e),
  };
  const observers = new Map();
  globalThis.Services = {
    wm: { getEnumerator: () => [] },
    obs: {
      addObserver: (observer, topic) => observers.set(topic, observer),
      removeObserver: (observer, topic) => {
        assert.equal(observers.get(topic), observer);
        observers.delete(topic);
      },
    },
  };
  globalThis.addon = {
    data: { alive: true },
    api: {
      openManager: () => state.calls.push("openManager"),
      openEditor: () => {},
    },
  };
  globalThis.ztoolkit = {
    unregisterAll: () => state.calls.push("unregisterToolkit"),
  };
  const { default: hooks } = await import(
    pathToFileURL(output).href + `?case=${serial++}`
  );
  return {
    hooks,
    state,
    doms,
    resolve,
    observers,
    close: () => doms.forEach((dom) => dom.window.close()),
  };
}

test("two windows retain independent resources; duplicate registration and shutdown are safe", async () => {
  const h = await fixture();
  try {
    await Promise.all([h.hooks.onStartup(), h.hooks.onStartup()]);
    assert.equal(h.state.calls.filter((name) => name === "initDB").length, 1);
    for (const dom of h.doms)
      assert.equal(dom.window.document.querySelectorAll("menuitem").length, 2);
    await h.hooks.onMainWindowLoad(h.doms[1].window);
    assert.equal(
      h.doms[1].window.document.querySelectorAll("menuitem").length,
      2,
    );
    await h.hooks.onMainWindowUnload(h.doms[0].window);
    assert.equal(
      h.doms[0].window.document.querySelectorAll("menuitem").length,
      0,
    );
    assert.equal(
      h.doms[1].window.document.querySelectorAll("menuitem").length,
      2,
    );
    h.doms[1].window.document
      .getElementById("knowledge-base-menu-open-manager")
      .dispatchEvent(new h.doms[1].window.Event("command"));
    assert.ok(h.state.calls.includes("openManager"));
    await Promise.all([h.hooks.onShutdown(), h.hooks.onShutdown()]);
    assert.equal(h.state.calls.filter((name) => name === "closeDB").length, 1);
    assert.equal(
      h.doms[1].window.document.querySelectorAll("menuitem, link").length,
      0,
    );
  } finally {
    h.close();
  }
});

test("granted quit stops background work before windows unload without waiting for startup", async () => {
  const h = await fixture({ deferred: true });
  try {
    const starting = h.hooks.onStartup();
    await new Promise((r) => setImmediate(r));
    const observer = h.observers.get("quit-application-granted");
    assert.ok(observer);
    observer.observe();
    assert.equal(globalThis.addon.data.alive, false);
    assert.ok(h.state.calls.includes("stopAssets"));
    assert.equal(h.observers.size, 0);
    h.hooks.onAppShutdown();
    h.resolve();
    await starting;
    assert.ok(!h.state.calls.includes("registerPane"));
    await h.hooks.onShutdown();
  } finally {
    h.close();
  }
});

test("disabling the plugin removes the quit observer", async () => {
  const h = await fixture();
  try {
    await h.hooks.onStartup();
    assert.equal(h.observers.size, 1);
    await h.hooks.onShutdown();
    assert.equal(h.observers.size, 0);
  } finally {
    h.close();
  }
});

test("initialization failure stops UI and releases partial resources", async () => {
  const h = await fixture({ fail: "rebuildCounts" });
  try {
    await h.hooks.onStartup();
    assert.equal(h.state.failures[0].step, "rebuildCounts");
    assert.ok(!h.state.calls.includes("registerPane"));
    assert.ok(h.state.calls.includes("closeDB"));
    await h.hooks.onMainWindowLoad(h.doms[0].window);
    assert.equal(
      h.doms[0].window.document.querySelectorAll("menuitem").length,
      0,
    );
  } finally {
    h.close();
  }
});

test("a missing window menu rolls back styles and menus in every window", async () => {
  const h = await fixture();
  try {
    h.doms[1].window.document.getElementById("zotero-itemmenu").remove();
    await h.hooks.onStartup();
    assert.equal(h.state.failures[0].step, "registerWindowUI");
    assert.ok(h.state.calls.includes("closeDB"));
    for (const dom of h.doms)
      assert.equal(
        dom.window.document.querySelectorAll("menuitem, link").length,
        0,
      );
  } finally {
    h.close();
  }
});

test("shutdown during startup prevents late menus and closes initialized storage", async () => {
  const h = await fixture({ deferred: true });
  try {
    const starting = h.hooks.onStartup();
    await new Promise((r) => setImmediate(r));
    const stopping = h.hooks.onShutdown();
    h.resolve();
    await Promise.all([starting, stopping]);
    assert.ok(!h.state.calls.includes("registerPane"));
    assert.equal(h.state.calls.filter((name) => name === "closeDB").length, 1);
    assert.equal(
      h.doms[0].window.document.querySelectorAll("menuitem").length,
      0,
    );
  } finally {
    h.close();
  }
});

after(async () => rm(workspace, { recursive: true, force: true }));
test(
  "disable before host readiness cancels the wait instead of hanging shutdown",
  { timeout: 2000 },
  async () => {
    const h = await fixture({ unready: true });
    try {
      const starting = h.hooks.onStartup();
      await new Promise((resolve) => setImmediate(resolve));
      await h.hooks.onShutdown();
      await starting;
      assert.ok(!h.state.calls.includes("initDB"));
      assert.equal(h.observers.size, 0);
    } finally {
      h.close();
    }
  },
);
