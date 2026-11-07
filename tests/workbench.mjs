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
  await build({
    entryPoints: ["src/modules/editor-views.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "editor-views.mjs"),
  });
  const editorViews = await import(
    pathToFileURL(join(root, "editor-views.mjs"))
  );
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

  let finishStaleReady, finishCurrentReady;
  editor.contentWindow = {};
  editor.loadURI = (location) => {
    if (location === "about:blank") {
      editor.contentWindow = { document: doc };
      return;
    }
    const args = module.getViewArguments(
      new URL(location).searchParams.get("context"),
    );
    const ready = new Promise((resolve) => {
      if (args.zettelId === "stale-ready") finishStaleReady = resolve;
      else finishCurrentReady = resolve;
    });
    editor.contentWindow = { document: doc, knowledgeBaseReady: () => ready };
    globalThis.queueMicrotask(() => {
      const event = new dom.window.Event("load");
      Object.defineProperty(event, "target", { value: doc });
      editor.dispatchEvent(event);
    });
  };
  const staleReady = module.mountEditor(editor, { zettelId: "stale-ready" });
  await new Promise((resolve) => setImmediate(resolve));
  module.clearEditor(editor);
  assert.equal(await staleReady, false);
  const currentReady = module.mountEditor(editor, {
    zettelId: "current-ready",
  });
  await new Promise((resolve) => setImmediate(resolve));
  finishStaleReady();
  await new Promise((resolve) => setImmediate(resolve));
  module.clearEditor(editor);
  const currentResult = await Promise.race([
    currentReady,
    new Promise((resolve) => setTimeout(() => resolve("still loading"), 20)),
  ]);
  finishCurrentReady();
  await currentReady;
  assert.equal(currentResult, false);
  console.log(
    "PASS Late initialization cleanup cannot remove a newer editor's cancellation handler",
  );

  const nativeStates = [
    { type: "library" },
    { type: "reader", data: { itemID: 7 } },
    { type: "knowledgebase" },
  ];
  const originalGetState = () => nativeStates;
  let close;
  const tabs = {
    selectedID: "workbench",
    getState: originalGetState,
    select(id) {
      this.selectedID = id;
    },
    add(options) {
      close = options.onClose;
      return { id: "workbench", container: doc.querySelector("main") };
    },
    close() {
      this.selectedID = "zotero-pane";
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
  globalThis.Zotero = { getMainWindow: () => dom.window, isMac: true };
  module.openWorkbench();
  module.openWorkbench();
  assert.equal(auditRequests, 1);
  assert.deepEqual(tabs.getState(), nativeStates.slice(0, 2));
  const manager = doc.querySelector(".knowledge-base-workbench").contentWindow;
  let selectedKnownNote;
  manager.ZoteroKnowledgeBase_selectZettel = (id) => {
    selectedKnownNote = id;
  };
  module.openWorkbench({ selectId: "known-note" });
  assert.equal(selectedKnownNote, "known-note");
  assert.equal(auditRequests, 1);
  console.log(
    "PASS Targeted note navigation reuses the workbench without requesting a library scan",
  );
  let closeRequests = 0;
  manager.knowledgeBaseRequestClose = async () => {
    closeRequests++;
  };
  const shortcut = (options = {}) => {
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    dom.window.dispatchEvent(event);
    return event;
  };
  assert.equal(shortcut().defaultPrevented, true);
  assert.equal(closeRequests, 1);
  assert.notEqual(tabs.getState, originalGetState);
  for (const options of [
    { isComposing: true },
    { keyCode: 229 },
    { metaKey: false, ctrlKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
  ])
    assert.equal(shortcut(options).defaultPrevented, false);
  assert.equal(shortcut({ repeat: true }).defaultPrevented, true);
  assert.equal(closeRequests, 1);
  tabs.selectedID = "zotero-pane";
  assert.equal(shortcut().defaultPrevented, false);
  tabs.selectedID = "workbench";
  let finishClose;
  manager.knowledgeBaseRequestClose = async () => {
    await new Promise((resolve) => {
      finishClose = resolve;
    });
    tabs.close();
  };
  shortcut();
  assert.notEqual(tabs.getState, originalGetState);
  finishClose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tabs.getState, originalGetState);
  tabs.selectedID = "workbench";
  assert.equal(shortcut().defaultPrevented, false);
  module.closeWorkbenches();
  assert.equal(tabs.getState, originalGetState);
  console.log(
    "PASS Workbench close shortcuts await the editor, preserve cancellation, ignore other tabs/IME and release their listener",
  );
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
  assert.equal(refreshes, 0);
  module.openWorkbenchWindow();
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
  const shutdownErrors = [];
  globalThis.Zotero.logError = (error) => shutdownErrors.push(error);
  let finishDraft;
  let finishedStop = false;
  const reopenedEditor = reopened.document.createElement("browser");
  reopenedEditor.id = "knowledge-base-workbench-editor";
  reopenedEditor.contentWindow = {
    knowledgeBaseFlushDraft: () =>
      new Promise((resolve) => {
        finishDraft = resolve;
      }),
    knowledgeBaseStopEditor: () => {
      throw new Error("Fixture editor disposal failure");
    },
  };
  reopened.document.body.append(reopenedEditor);
  const stopping = module.stopWorkbenches().then(() => {
    finishedStop = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finishedStop, false);
  assert.equal(shutdownErrors.length, 1);
  finishDraft();
  await stopping;
  assert.equal(finishedStop, true);
  assert.equal(reopenedEditor.contentWindow.knowledgeBaseStopping, true);
  module.closeWorkbenches();
  assert.equal(shutdownClose, true);
  console.log(
    "PASS Independent workbench reuses pending and ready windows, keeps the latest selection, flushes drafts on close and closes on shutdown",
  );
  const openedEditors = [];
  let windowRequests = 0,
    focusRequests = 0,
    tagRequests = 0;
  globalThis.Services.wm = { getEnumerator: () => openedEditors };
  const openEditor = () => {
    windowRequests++;
    const view = new dom.window.EventTarget();
    Object.assign(view, {
      closed: false,
      focus: () => focusRequests++,
      close: () => {
        view.closed = true;
        view.dispatchEvent(new dom.window.Event("unload"));
      },
    });
    openedEditors.push(view);
    return view;
  };
  dom.window.openDialog = openEditor;
  editorViews.openEditorWindow({ zettelId: "one", window: true });
  editorViews.openEditorWindow({
    zettelId: "one",
    window: true,
    editTags: true,
  });
  assert.equal(windowRequests, 1);
  assert.equal(focusRequests, 1);
  openedEditors[0].knowledgeBaseEditTags = async () => tagRequests++;
  openedEditors[0].dispatchEvent(new dom.window.Event("load"));
  await Promise.resolve();
  assert.equal(tagRequests, 1);
  openedEditors[0].close();
  editorViews.openEditorWindow({ zettelId: "one", window: true });
  assert.equal(windowRequests, 2);
  editorViews.openEditorWindow({ draftId: "draft-one", window: true });
  editorViews.openEditorWindow({ draftId: "draft-one", window: true });
  assert.equal(windowRequests, 3);
  editorViews.openEditorWindow({ window: true });
  openedEditors.at(-1).knowledgeBaseCardId = "created-note";
  editorViews.openEditorWindow({ zettelId: "created-note", window: true });
  assert.equal(windowRequests, 4);
  dom.window.openDialog = () => null;
  assert.throws(
    () => editorViews.openEditorWindow({ zettelId: "failed" }),
    /Could not open note editor/,
  );
  dom.window.openDialog = openEditor;
  editorViews.openEditorWindow({ zettelId: "failed" });
  assert.equal(windowRequests, 5);
  console.log(
    "PASS Editor windows reuse pending notes, drafts and newly assigned identities, and recover after failed creation",
  );
  const viewErrors = [];
  globalThis.Zotero.logError = (error) => viewErrors.push(error);
  let stops = 0;
  const failedFlush = {
    knowledgeBaseFlushDraft: () => {
      throw new Error("Draft flush failed");
    },
    knowledgeBaseStopEditor: () => stops++,
  };
  editorViews.stopEditorView(failedFlush);
  editorViews.stopEditorView(failedFlush);
  assert.equal(stops, 1);
  assert.equal(failedFlush.knowledgeBaseStopping, true);
  assert.equal(viewErrors.length, 1);
  let completeFlush;
  const pendingFlush = {
    knowledgeBaseFlushDraft: () =>
      new Promise((resolve) => {
        completeFlush = resolve;
      }),
    knowledgeBaseStopEditor: () => {
      throw new Error("Stop failed");
    },
  };
  const flushed = editorViews.stopEditorView(pendingFlush);
  assert.equal(pendingFlush.knowledgeBaseStopping, true);
  assert.equal(viewErrors.length, 2);
  assert.equal(editorViews.stopEditorView(pendingFlush), flushed);
  completeFlush();
  await flushed;
  let released = false;
  let finishClosing;
  const closingWrite = new Promise((resolve) => {
    finishClosing = resolve;
  });
  const closingEditor = { knowledgeBaseFlushDraft: () => closingWrite };
  const closePending = editorViews.closeEditorView(closingEditor, () => {
    released = true;
  });
  await Promise.resolve();
  assert.equal(
    released,
    false,
    "Closing destroyed the document before its write completed",
  );
  finishClosing();
  await closePending;
  assert.equal(released, true);
  const preparing = {
    knowledgeBaseReady: async () => {},
    knowledgeBasePrepareNavigation: async () => false,
  };
  assert.equal(
    await editorViews.prepareEditorView(preparing),
    false,
    "A cancelled save allowed navigation",
  );
  console.log(
    "PASS Embedded and independent editors stop once and retain their pending draft writes when cleanup fails",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
