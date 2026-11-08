import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-reader-"));
const output = join(workspace, "reader.mjs");
const entry = join(workspace, "entry.mjs");
await writeFile(
  entry,
  `export * from ${JSON.stringify(join(process.cwd(), "src/modules/reader-toolbar.ts"))};\nexport { notifyDataChange } from ${JSON.stringify(join(process.cwd(), "src/modules/events.ts"))};`,
);
await build({
  entryPoints: [entry],
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
          contents:
            "export const getString = key => key === 'menu-open-manager' ? readerTest.label : key;",
        }));
      },
    },
  ],
});
const windows = [];
function document() {
  const dom = new JSDOM(
    '<div class="toolbar"><div class="start"><button id="next"></button><input id="pageNumber"></div><div class="end"><div class="custom-sections"></div></div></div>',
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
const creations = [];
globalThis.addon = {
  api: {
    openManager: (args) => {
      opened++;
      openedArgs.push(args);
    },
    ensureLiteratureNote: async (key, libraryID, shouldStop) => {
      assert.equal(shouldStop(), false);
      const id = "created-" + libraryID;
      creations.push([key, libraryID]);
      notes.set(libraryID, [
        ...(notes.get(libraryID) || []),
        { id, source_note: 1 },
      ]);
      notifyDataChange({ fields: ["source"], itemKeys: [key] });
      return id;
    },
    listByItem: async (key, libraryID) => {
      lookups.push([key, libraryID]);
      return notes.get(libraryID) || [];
    },
  },
};
globalThis.Zotero = {
  getMainWindow: () => first.defaultView,
  Prefs: {
    get: () => true,
    registerObserver: () => 1,
    unregisterObserver: () => {},
  },
  isMac: true,
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
const { registerReaderToolbar, unregisterReaderToolbar, notifyDataChange } =
  await import(pathToFileURL(output).href);
function button(doc) {
  return doc.getElementById("knowledge-base-reader-button");
}
function render(doc, clear = true) {
  const target = doc.querySelector(".custom-sections");
  if (clear) {
    target.replaceChildren();
    button(doc)?.remove();
  }
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
    assert.equal(button(doc).nextElementSibling?.id, "pageNumber");
    assert.equal(button(doc).previousElementSibling?.id, "next");
    assert.equal(button(doc).className, "toolbar-button");
    assert.equal(button(doc).getAttribute("aria-label"), "Knowledge Base");
    assert.equal(button(doc).querySelector("img").width, 20);
    assert.match(
      button(doc).querySelector("img").src,
      /^data:image\/svg\+xml,/,
    );
  }
  await tick();
  assert.equal(button(first).dataset.hasLiteratureNote, "true");
  assert.equal(button(second).querySelector("img").style.filter, "none");
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
  assert.equal(first.querySelectorAll(".section").length, 0);
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
  notifyDataChange({ fields: ["availability"], itemKeys: ["SAMEKEY"] });
  await tick();
  assert.equal(button(first).dataset.hasLiteratureNote, "false");
  assert.equal(button(first).querySelector("img").style.filter, "grayscale(1)");
  button(first).dispatchEvent(
    new first.defaultView.MouseEvent("click", { ctrlKey: true, bubbles: true }),
  );
  await tick();
  assert.equal(creations.length, 0, "macOS Control-click created a note");
  assert.deepEqual(openedArgs.at(-1), {});
  const commandClick = (doc, options = { metaKey: true }) =>
    button(doc).dispatchEvent(
      new doc.defaultView.MouseEvent("click", { ...options, bubbles: true }),
    );
  commandClick(first);
  commandClick(first);
  await tick();
  assert.deepEqual(creations, [["SAMEKEY", 1]]);
  assert.deepEqual(openedArgs.at(-1), { selectId: "created-1" });
  assert.equal(button(first).dataset.hasLiteratureNote, "true");
  commandClick(first);
  await tick();
  assert.equal(creations.length, 1, "Existing Literature Note was duplicated");
  notes.set(2, []);
  globalThis.Zotero.isMac = false;
  commandClick(second, { metaKey: true });
  await tick();
  assert.equal(creations.length, 1, "Windows Meta-click created a note");
  commandClick(second, { ctrlKey: true });
  await tick();
  assert.deepEqual(creations.at(-1), ["SAMEKEY", 2]);
  assert.deepEqual(openedArgs.at(-1), { selectId: "created-2" });
  globalThis.Zotero.isMac = true;
  const interrupted = document();
  globalThis.Zotero.Reader._readers.push({
    itemID: 11,
    _iframeWindow: interrupted.defaultView,
  });
  render(interrupted);
  await tick();
  notes.set(1, []);
  const ensure = globalThis.addon.api.ensureLiteratureNote;
  let finishCreation;
  let cancelledCreation = false;
  globalThis.addon.api.ensureLiteratureNote = async (
    _key,
    _library,
    shouldStop,
  ) => {
    await new Promise((resolve) => {
      finishCreation = resolve;
    });
    cancelledCreation = shouldStop();
    if (cancelledCreation) throw new Error("NOTE_SESSION_CLOSED");
    return "unexpected-note";
  };
  commandClick(interrupted);
  await tick();
  const beforeClose = opened;
  interrupted.defaultView.dispatchEvent(
    new interrupted.defaultView.Event("unload"),
  );
  finishCreation();
  await tick();
  assert.equal(cancelledCreation, true);
  assert.equal(
    opened,
    beforeClose,
    "Closing a PDF allowed delayed creation navigation",
  );
  globalThis.addon.api.ensureLiteratureNote = ensure;
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
