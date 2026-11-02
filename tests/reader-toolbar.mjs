import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-reader-"));
const output = join(workspace, "reader.mjs");
await build({
  entryPoints: ["src/modules/reader-toolbar.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  plugins: [
    {
      name: "locale",
      setup(builder) {
        builder.onResolve({ filter: /utils\/locale$/ }, () => ({
          path: "locale",
          namespace: "reader-test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "reader-test" }, () => ({
          contents: "export const getString = () => readerTest.label;",
        }));
      },
    },
  ],
});
const windows = [];
function document() {
  const dom = new JSDOM(
    '<div class="toolbar"><div class="end"><div class="custom-sections"></div></div></div>',
  );
  windows.push(dom.window);
  return dom.window.document;
}
const first = document();
const second = document();
const listeners = new Map();
let opened = 0;
const openedArgs = [],
  lookups = [];
const notes = new Map([
  [
    1,
    [
      { id: "zettel-a", source_note: 0 },
      { id: "literature-a", source_note: 1 },
    ],
  ],
  [2, [{ id: "literature-b", source_note: 1 }]],
]);
const items = new Map([
  [11, { parentItemID: 101 }],
  [12, { parentItemID: 102 }],
  [13, { isRegularItem: () => false }],
  [101, { key: "SAMEKEY", libraryID: 1, isRegularItem: () => true }],
  [102, { key: "SAMEKEY", libraryID: 2, isRegularItem: () => true }],
]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
globalThis.readerTest = { label: "Knowledge Base" };
globalThis.addon = {
  api: {
    openManager: (args) => {
      opened++;
      openedArgs.push(args);
    },
    listByItem: async (key, libraryID) => {
      lookups.push([key, libraryID]);
      return notes.get(libraryID) || [];
    },
  },
};
globalThis.Zotero = {
  Items: { getAsync: async (id) => items.get(id) },
  logError: (error) => {
    throw error;
  },
  File: {
    getContentsFromURL: () =>
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" /></svg>',
  },
  Reader: {
    _readers: [
      { itemID: 11, _iframeWindow: first.defaultView },
      { itemID: 12, _iframeWindow: second.defaultView },
      {},
    ],
    registerEventListener(type, handler, pluginID) {
      assert.equal(type, "renderToolbar");
      assert.equal(pluginID, "knowledge-base@lzcn");
      assert.equal(listeners.size, 0);
      listeners.set(type, handler);
    },
    unregisterEventListener(type, handler) {
      assert.equal(listeners.get(type), handler);
      listeners.delete(type);
    },
  },
};
const { registerReaderToolbar, unregisterReaderToolbar } = await import(
  pathToFileURL(output).href
);
function button(doc) {
  return doc.getElementById("knowledge-base-reader-button");
}
function render(doc, clear = true) {
  const target = doc.querySelector(".custom-sections");
  if (clear) target.replaceChildren();
  listeners.get("renderToolbar")({
    reader: globalThis.Zotero.Reader._readers.find(
      (reader) => reader._iframeWindow?.document === doc,
    ) || { itemID: 13 },
    doc,
    append(node) {
      const section = doc.createElement("div");
      section.className = "section";
      section.append(node);
      target.append(section);
    },
  });
}
try {
  registerReaderToolbar();
  registerReaderToolbar();
  assert.equal(listeners.size, 1);
  for (const doc of [first, second]) {
    assert.ok(button(doc).closest(".toolbar .custom-sections"));
    assert.equal(button(doc).className, "toolbar-button");
    assert.equal(button(doc).getAttribute("aria-label"), "Knowledge Base");
    assert.equal(button(doc).querySelector("img").width, 20);
    assert.match(
      button(doc).querySelector("img").src,
      /^data:image\/svg\+xml,/,
    );
  }
  button(first).click();
  await tick();
  assert.equal(opened, 1);
  assert.deepEqual(openedArgs.at(-1), { selectId: "literature-a" });
  assert.deepEqual(lookups.at(-1), ["SAMEKEY", 1]);
  const old = button(first);
  render(first);
  old.click();
  assert.equal(opened, 1, "A replaced toolbar button kept its click handler");
  render(first, false);
  assert.equal(
    first.querySelectorAll("#knowledge-base-reader-button").length,
    1,
  );
  assert.equal(first.querySelectorAll(".section").length, 1);
  const third = document();
  globalThis.readerTest.label = "知识库";
  render(third);
  assert.equal(button(third).title, "知识库");
  button(third).click();
  await tick();
  assert.equal(opened, 2);
  assert.deepEqual(
    openedArgs.at(-1),
    {},
    "A standalone attachment did not open the default workbench",
  );
  button(second).click();
  await tick();
  assert.deepEqual(openedArgs.at(-1), { selectId: "literature-b" });
  assert.deepEqual(lookups.at(-1), ["SAMEKEY", 2]);
  notes.set(1, [{ id: "zettel-a", source_note: 0 }]);
  button(first).click();
  await tick();
  assert.deepEqual(
    openedArgs.at(-1),
    {},
    "A Zettel was treated as its source Literature Note",
  );
  const closing = button(third);
  third.defaultView.dispatchEvent(new third.defaultView.Event("unload"));
  assert.equal(closing.isConnected, false);
  assert.equal(third.querySelector(".custom-sections").childElementCount, 0);
  const late = listeners.get("renderToolbar");
  let releaseFirst;
  globalThis.addon.api.listByItem = (_key, libraryID) =>
    libraryID === 1
      ? new Promise((resolve) => {
          releaseFirst = resolve;
        })
      : Promise.resolve([{ id: "latest-reader", source_note: 1 }]);
  button(first).click();
  await tick();
  button(second).click();
  await tick();
  const afterLatestReader = opened;
  assert.deepEqual(openedArgs.at(-1), { selectId: "latest-reader" });
  releaseFirst([{ id: "stale-reader", source_note: 1 }]);
  await tick();
  assert.equal(
    opened,
    afterLatestReader,
    "An older PDF lookup replaced the latest reader target",
  );
  let releaseLookup,
    pendingLookups = 0;
  globalThis.addon.api.listByItem = () => {
    pendingLookups++;
    return new Promise((resolve) => {
      releaseLookup = resolve;
    });
  };
  button(first).click();
  button(first).click();
  await tick();
  assert.equal(
    pendingLookups,
    1,
    "Repeated clicks duplicated an in-progress lookup",
  );
  const beforeShutdown = opened;
  unregisterReaderToolbar();
  releaseLookup([{ id: "late-note", source_note: 1 }]);
  await tick();
  assert.equal(
    opened,
    beforeShutdown,
    "A completed lookup opened Knowledge Base after shutdown",
  );
  unregisterReaderToolbar();
  assert.equal(listeners.size, 0);
  assert.equal(button(first), null);
  assert.equal(button(second), null);
  assert.equal(first.querySelector(".custom-sections").childElementCount, 0);
  late({
    doc: third,
    append() {
      assert.fail("A late reader event added UI after shutdown");
    },
  });
  registerReaderToolbar();
  assert.equal(
    first.querySelectorAll("#knowledge-base-reader-button").length,
    1,
  );
  assert.equal(listeners.size, 1);
  unregisterReaderToolbar();
  console.log(
    "PASS Contextual Literature Note navigation, library scoping, default fallback, latest-click selection, reader toolbars, replaced handlers, cleanup and re-enabling.",
  );
} finally {
  unregisterReaderToolbar();
  for (const win of windows) win.close();
  delete globalThis.Zotero;
  delete globalThis.addon;
  delete globalThis.readerTest;
  await rm(workspace, { recursive: true, force: true });
}
