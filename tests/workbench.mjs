import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(join(tmpdir(), "knowledge-base-workbench-"));
try {
  await build({
    entryPoints: ["src/modules/workbench.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "workbench.mjs"),
  });
  const dom = new JSDOM("<main></main>");
  const doc = dom.window.document;
  doc.createXULElement = (name) => doc.createElement(name);
  globalThis.Services = {
    io: { newURI: (value) => value },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
  };
  const module = await import(pathToFileURL(join(root, "workbench.mjs")));
  const editor = doc.createElement("browser");
  doc.body.append(editor);
  const locations = [];
  editor.loadURI = (location) => {
    locations.push(location);
    const args = module.getViewArguments(
      new URL(location).searchParams.get("context"),
    );
    editor.contentWindow = {
      document: doc,
      knowledgeBaseCardId: args.zettelId,
      knowledgeBaseReady: async () => {},
      save: async () => true,
    };
    globalThis.queueMicrotask(() => {
      const event = new dom.window.Event("load");
      Object.defineProperty(event, "target", { value: doc });
      editor.dispatchEvent(event);
    });
  };
  editor.contentWindow = { save: async () => false };
  assert.equal(await module.mountEditor(editor, { zettelId: "next" }), false);
  assert.deepEqual(locations, []);
  console.log("PASS A failed save keeps the current workbench document");
  let finishSave;
  const save = new Promise((resolve) => {
    finishSave = resolve;
  });
  let saveCalls = 0;
  let activeSaves = 0;
  let maxActiveSaves = 0;
  editor.contentWindow.save = async () => {
    saveCalls++;
    activeSaves++;
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
    try {
      return await save;
    } finally {
      activeSaves--;
    }
  };
  const first = module.mountEditor(editor, { zettelId: "first" });
  const last = module.mountEditor(editor, { zettelId: "last" });
  finishSave(true);
  assert.equal(await first, false);
  assert.equal(await last, true);
  assert.equal(saveCalls, 2);
  assert.equal(maxActiveSaves, 1);
  assert.equal(locations.length, 1);
  const token = new URL(locations[0]).searchParams.get("context");
  assert.equal(editor.contentWindow.knowledgeBaseCardId, "last");
  assert.throws(() => module.getViewArguments(token), /expired/);
  console.log(
    "PASS Only the latest asynchronous navigation loads a document; contexts are consumed once",
  );

  let finishLoad;
  let preparingSaveCalls = 0;
  const ready = new Promise((resolve) => {
    finishLoad = resolve;
  });
  const loadEditor = editor.loadURI;
  editor.loadURI = (location) => {
    loadEditor(location);
    editor.contentWindow.knowledgeBaseReady = () => ready;
    editor.contentWindow.save = async () => {
      preparingSaveCalls++;
      return true;
    };
  };
  const loading = module.mountEditor(editor, { zettelId: "loading" });
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = module.mountEditor(editor, { zettelId: "replacement" });
  const latest = module.mountEditor(editor, { zettelId: "loading" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(preparingSaveCalls, 0);
  finishLoad();
  assert.equal(await loading, false);
  assert.equal(await replacement, false);
  assert.equal(await latest, true);
  assert.equal(editor.contentWindow.knowledgeBaseCardId, "loading");
  assert.equal(preparingSaveCalls, 0);
  console.log(
    "PASS Navigation waits for editor readiness and returning to the loading note supersedes queued replacements",
  );

  editor.loadURI = loadEditor;
  editor.contentWindow = {
    knowledgeBaseCardId: "missing-note",
    save: async () => false,
    knowledgeBasePrepareNavigation: async () => true,
  };
  assert.equal(
    await module.mountEditor(editor, { zettelId: "healthy-note" }),
    true,
  );
  assert.equal(editor.contentWindow.knowledgeBaseCardId, "healthy-note");
  editor.contentWindow.knowledgeBasePrepareNavigation = async () => false;
  assert.equal(
    await module.mountEditor(editor, { zettelId: "blocked" }),
    false,
  );
  assert.equal(editor.contentWindow.knowledgeBaseCardId, "healthy-note");
  console.log(
    "PASS Clean unavailable notes allow navigation while pending drafts still block it",
  );

  editor.loadURI = (location) => {
    locations.push(location);
  };
  const cancelled = module.mountEditor(editor, { zettelId: "cancelled" });
  await new Promise((resolve) => setImmediate(resolve));
  module.clearEditor(editor);
  assert.equal(await cancelled, false);
  console.log("PASS Clearing an editor cancels pending document loads");

  const nativeStates = [
    { type: "library" },
    { type: "reader", data: { itemID: 7 } },
    { type: "knowledgebase" },
  ];
  const originalGetState = () => nativeStates;
  let close;
  const tabs = {
    getState: originalGetState,
    select() {},
    add(options) {
      close = options.onClose;
      return { id: "workbench", container: doc.querySelector("main") };
    },
    close() {
      close();
    },
  };
  const create = doc.createXULElement;
  let auditRequests = 0;
  doc.createXULElement = (name) => {
    const node = create(name);
    node.loadURI = () => {};
    node.contentWindow = {
      document: doc,
      knowledgeBaseRefreshNotes: () => auditRequests++,
    };
    return node;
  };
  dom.window.Zotero_Tabs = tabs;
  globalThis.Zotero = { getMainWindow: () => dom.window };
  module.openWorkbench();
  module.openWorkbench();
  assert.equal(auditRequests, 1);
  assert.deepEqual(tabs.getState(), nativeStates.slice(0, 2));
  module.closeWorkbenches();
  assert.equal(tabs.getState, originalGetState);
  console.log(
    "PASS Workbench leaves native Zotero document state intact and removes its session hook on close",
  );

  let openedWindows = 0;
  let alreadyLoaded = false;
  let windowLifecycle;
  let separate;
  let browser;
  let separateArgs;
  let refreshes = 0;
  let draftFlushes = 0;
  let editorStops = 0;
  const selections = [];
  dom.window.openDialog = (_url, _name, _features, lifecycle) => {
    windowLifecycle = lifecycle;
    openedWindows++;
    separate = new JSDOM(
      '<main><browser id="knowledge-base-window-browser"></browser></main>',
    ).window;
    if (alreadyLoaded)
      Object.defineProperty(separate.document, "readyState", {
        value: "complete",
      });
    separate.focus = () => {};
    browser = separate.document.getElementById("knowledge-base-window-browser");
    browser.contentWindow = { document: separate.document };
    browser.loadURI = (location) => {
      separateArgs = module.getViewArguments(
        new URL(location).searchParams.get("context"),
      );
      browser.contentWindow.knowledgeBaseRefreshNotes = () => refreshes++;
      browser.contentWindow.ZoteroKnowledgeBase_selectZettel = (id) =>
        selections.push(id);
    };
    if (alreadyLoaded) lifecycle.load(separate);
    return separate;
  };
  module.openWorkbenchWindow({ selectId: "first" });
  module.openWorkbenchWindow({ selectId: "latest" });
  assert.equal(openedWindows, 1);
  windowLifecycle.load(separate);
  assert.equal(separateArgs.selectId, "latest");
  assert.equal(separateArgs.embedded, true);
  assert.equal(separateArgs.window, true);
  module.openWorkbenchWindow({ selectId: "third" });
  assert.deepEqual(selections, ["third"]);
  assert.equal(refreshes, 1);
  const inline = separate.document.createElement("browser");
  inline.id = "knowledge-base-workbench-editor";
  inline.contentWindow = {
    knowledgeBaseFlushDraft: async () => draftFlushes++,
    knowledgeBaseStopEditor: () => editorStops++,
  };
  separate.document.body.append(inline);
  windowLifecycle.stop();
  windowLifecycle.stop();
  windowLifecycle.closed();
  await Promise.resolve();
  assert.equal(draftFlushes, 1);
  assert.equal(editorStops, 1);
  separate.close();
  alreadyLoaded = true;
  module.openWorkbenchWindow({ selectId: "already-loaded" });
  assert.equal(openedWindows, 2);
  assert.equal(separateArgs.selectId, "already-loaded");
  const reopened = separate;
  let shutdownClose = false;
  reopened.close = () => {
    shutdownClose = true;
  };
  module.closeWorkbenches();
  assert.equal(shutdownClose, true);
  console.log(
    "PASS Independent workbench reuses pending and ready windows, keeps the latest selection, flushes drafts on close and closes on shutdown",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
