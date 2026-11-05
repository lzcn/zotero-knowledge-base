import { config, version } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { closeDB, initDB } from "./modules/db";
import {
  initNativeNotes,
  closeNativeNotes,
  stopNativeNotes,
  recoverNativeSaves,
  discoverNativeNotes,
} from "./modules/native-notes";
import {
  initNativeMarkdown,
  stopNativeMarkdown,
  closeNativeMarkdown,
} from "./modules/native-markdown";
import { rebuildCounts } from "./modules/zettel";
import { regularItemOf } from "./modules/zotero";
import { initTagExclusions, stopTagExclusions } from "./modules/note-tags";
import {
  initNoteSessions,
  stopNoteSessions,
  closeNoteSessions,
} from "./modules/note-sessions";
import { stopWorkbenches, closeWorkbenches } from "./modules/workbench";
import { stopEditorView } from "./modules/editor-views";
import { stopNativeNoteViews } from "./modules/native-note-view";
import {
  registerReaderClipping,
  unregisterReaderClipping,
} from "./modules/reader-clipping";
import { registerPreferences, unregisterPreferences } from "./modules/settings";
import { closeSourceReferences } from "./modules/source-reference";
import { registerItemPaneUI, unregisterItemPaneUI } from "./modules/item-pane";
import {
  registerReaderToolbar,
  unregisterReaderToolbar,
} from "./modules/reader-toolbar";
import {
  initAssets,
  closeAssets,
  stopAssets,
  cleanupImagesAfterChange,
} from "./modules/assets";
import {
  clearStartupLog,
  reportStartupFailure,
} from "./modules/startup-errors";

// Same-version development installs must not reuse Zotero's cached sidebar CSS.
const sectionStyleVersion = `${version}-${Date.now()}`;
const windows = new Map<Window, Element[]>();
const windowCleanups = new Map<Window, () => void>();
let ready = false;
let generation = 0;
let startupPromise: Promise<void> | undefined;
let shutdownPromise: Promise<void> | undefined;
let observingQuit = false;
let quitClient:
  | {
      addBlocker(name: string, blocker: () => Promise<void>): void;
      removeBlocker(blocker: () => Promise<void>): void;
    }
  | undefined;
let appShutdownPromise: Promise<void> | undefined;
let draftWrites: Promise<unknown>[] = [];
let stopping = false;
let cancelReadiness: (() => void) | undefined;
const quitObserver = { observe: () => onAppShutdown() };

function removeQuitObserver(): void {
  if (!observingQuit) return;
  Services.obs.removeObserver(quitObserver, "quit-application-granted");
  observingQuit = false;
}

async function onStartup(): Promise<void> {
  if (startupPromise) return startupPromise;
  const { AsyncShutdown } = ChromeUtils.importESModule(
    "resource://gre/modules/AsyncShutdown.sys.mjs",
  );
  quitClient = AsyncShutdown.quitApplicationGranted;
  quitClient!.addBlocker(
    "Knowledge Base: finish local writes and searches",
    finishAppShutdown,
  );
  Services.obs.addObserver(quitObserver, "quit-application-granted");
  observingQuit = true;
  const token = ++generation;
  startupPromise = start(token);
  return startupPromise;
}

async function start(token: number): Promise<void> {
  let step = "Zotero readiness";
  try {
    await Promise.race([
      Promise.all([
        Zotero.initializationPromise,
        Zotero.unlockPromise,
        Zotero.uiReadyPromise,
      ]),
      new Promise<void>((resolve) => {
        cancelReadiness = resolve;
      }),
    ]);
    cancelReadiness = undefined;
    if (token !== generation) return;
    initLocale();
    const steps: [string, () => Promise<unknown> | unknown][] = [
      ["initDB", initDB],
      ["initAssets", initAssets],
      ["noteSessions", initNoteSessions],
      [
        "recoverNativeSaves",
        () => recoverNativeSaves(() => token !== generation),
      ],
      ["nativeNotes", initNativeNotes],
      ["tagExclusions", initTagExclusions],
      ["rebuildCounts", () => rebuildCounts(() => token !== generation)],
      ["cleanupUnusedImages", cleanupImagesAfterChange],
      ["nativeMarkdown", initNativeMarkdown],
      ["registerPreferences", registerPreferences],
      ["registerReaderToolbar", registerReaderToolbar],
      ["registerReaderClipping", registerReaderClipping],
      ["libraryRuntime", () => libraryRuntime.start()],
      ["registerItemPaneUI", registerItemPaneUI],
    ];
    for (const [name, run] of steps) {
      step = name;
      await run();
      if (token !== generation) return;
    }
    ready = true;
    step = "registerWindowUI";
    for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
    void discoverNativeNotes().catch((error) => {
      if (token === generation) Zotero.logError(error);
    });
    await clearStartupLog();
  } catch (error) {
    ready = false;
    try {
      await reportStartupFailure(step, error);
    } catch (reportError) {
      Zotero.logError(
        reportError instanceof Error
          ? reportError
          : new Error(String(reportError)),
      );
    } finally {
      await releaseResources();
    }
  }
}

async function onMainWindowLoad(win: Window): Promise<void> {
  if (!ready || windows.has(win)) return;
  const nodes: Element[] = [];
  windows.set(win, nodes);
  try {
    libraryRuntime.onWindowLoad(win);
    const doc = win.document;
    doc.documentElement.toggleAttribute(
      "data-plugin-bear",
      Zotero.Prefs.get("extensions.zotero.plugin-ui.bear", true) === true,
    );
    const chromeWindow = win as Window & {
      MozXULElement: { insertFTLIfNeeded(path: string): void };
    };
    chromeWindow.MozXULElement.insertFTLIfNeeded(
      `${config.addonRef}-item-pane.ftl`,
    );
    const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
    style.setAttribute("rel", "stylesheet");
    style.setAttribute(
      "href",
      `chrome://${config.addonRef}/content/section.css?v=${sectionStyleVersion}`,
    );
    doc.documentElement.appendChild(style);
    nodes.push(style);
    const addMenu = (
      popupID: string,
      suffix: string,
      label: string,
      command: () => void,
    ) => {
      const popup = doc.getElementById(popupID);
      if (!popup) throw new Error(`Missing Zotero menu: ${popupID}`);
      const menu = doc.createXULElement("menuitem");
      menu.id = `${config.addonRef}-${suffix}`;
      menu.setAttribute("label", getString(label));
      menu.classList.add("menuitem-iconic");
      menu.setAttribute(
        "image",
        `chrome://${config.addonRef}/content/icons/icon-16.svg`,
      );
      menu.addEventListener("command", command);
      popup.appendChild(menu);
      nodes.push(menu);
      return menu;
    };
    addMenu("menu_ToolsPopup", "menu-open-manager", "menu-open-manager", () =>
      addon.api.openManager(),
    );
    const toolbar = doc.getElementById("zotero-items-toolbar");
    if (!toolbar)
      throw new Error("Missing Zotero toolbar: zotero-items-toolbar");
    const button = doc.createXULElement("toolbarbutton");
    button.id = `${config.addonRef}-toolbar-button`;
    button.classList.add("zotero-tb-button");
    button.setAttribute("tooltiptext", getString("menu-open-manager"));
    button.setAttribute("aria-label", getString("menu-open-manager"));
    button.addEventListener("command", () => addon.api.openManager());
    toolbar.insertBefore(button, toolbar.querySelector(":scope > spacer"));
    nodes.push(button);
    addMenu("zotero-itemmenu", "itemmenu-new-card", "menu-new-zettel", () => {
      const pane = (
        win as Window & {
          ZoteroPane: ReturnType<typeof Zotero.getActiveZoteroPane>;
        }
      ).ZoteroPane;
      const item = pane.getSelectedItems()[0];
      if (!item) return;
      const source = regularItemOf(item);
      addon.api.openEditor({
        sourceItem: source
          ? { key: source.key, libraryID: source.libraryID }
          : undefined,
      });
    });
    let noteRequest = 0;
    const noteMenu = addMenu(
      "zotero-itemmenu",
      "itemmenu-open-note",
      "menu-open-native-note",
      () => {
        const pane = (
          win as Window & {
            ZoteroPane: ReturnType<typeof Zotero.getActiveZoteroPane>;
          }
        ).ZoteroPane;
        const items = pane.getSelectedItems();
        if (items.length !== 1 || !items[0].isNote() || items[0].isInTrash())
          return;
        const request = ++noteRequest;
        void (async () => {
          const draft = (await addon.api.listEditorDrafts()).find(
            (draft) => draft.noteID === items[0].id && !draft.id,
          );
          const id = draft
            ? null
            : await addon.api.ensureManagedNote(items[0].id);
          if (request === noteRequest && windows.has(win) && ready) {
            if (draft) addon.api.openEditor({ draftId: draft.draftId });
            else if (id) addon.api.openEditor({ zettelId: id });
          }
        })().catch((error) => Zotero.logError(error));
      },
    );
    const popup = doc.getElementById("zotero-itemmenu")!;
    const showing = () => {
      const pane = (
        win as Window & {
          ZoteroPane: ReturnType<typeof Zotero.getActiveZoteroPane>;
        }
      ).ZoteroPane;
      const items = pane.getSelectedItems();
      noteMenu.setAttribute("hidden", "true");
      if (items.length === 1 && items[0].isNote() && !items[0].isInTrash())
        noteMenu.removeAttribute("hidden");
    };
    noteMenu.setAttribute("hidden", "true");
    popup.addEventListener("popupshowing", showing);
    windowCleanups.set(win, () => {
      ++noteRequest;
      popup.removeEventListener("popupshowing", showing);
    });
  } catch (error) {
    await onMainWindowUnload(win);
    throw error;
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const actions = [
    windowCleanups.get(win),
    () => libraryRuntime.onWindowUnload(win),
    () => closeWorkbenches(win),
    ...(windows.get(win) ?? []).map((node) => () => node.remove()),
  ];
  // Release ownership before callbacks can trigger another unload.
  windows.delete(win);
  windowCleanups.delete(win);
  for (const action of actions) {
    try {
      action?.();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

async function releaseResources(): Promise<void> {
  ready = false;
  removeQuitObserver();
  for (const win of [...windows.keys()]) await onMainWindowUnload(win);
  const actions: (() => unknown | Promise<unknown>)[] = [
    () => {
      for (const kind of [
        "manager",
        "workbench",
        "editor",
        "graph",
        "annotations",
        "image",
        "templates",
      ]) {
        for (const win of Services.wm.getEnumerator(
          `${config.addonRef}:${kind}`,
        ))
          win.close();
      }
    },
    () => libraryRuntime.close(),
    stopTagExclusions,
    unregisterItemPaneUI,
    unregisterReaderToolbar,
    unregisterReaderClipping,
    unregisterPreferences,
    closeSourceReferences,
    closeNativeMarkdown,
    closeNativeNotes,
    closeNoteSessions,
    closeAssets,
    () => ztoolkit.unregisterAll(),
    closeDB,
    removeQuitBlocker,
  ];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

function onAppShutdown(): void {
  if (stopping) return;
  stopping = true;
  const stop = (action: () => unknown) => {
    try {
      action();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };
  stop(() => {
    draftWrites.push(
      stopWorkbenches().catch((error) => Zotero.logError(error)),
    );
  });
  stop(() => {
    draftWrites.push(
      stopNativeNoteViews().catch((error) => Zotero.logError(error)),
    );
  });
  for (const win of Services.wm.getEnumerator(`${config.addonRef}:templates`)) {
    win.knowledgeBaseStopping = true;
    win.close();
  }
  // Start pending draft writes before the database shutdown blocker drains them.
  for (const win of Services.wm.getEnumerator(`${config.addonRef}:editor`)) {
    try {
      const writing = stopEditorView(win as unknown as Window);
      if (writing) draftWrites.push(writing);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  for (const action of [
    stopTagExclusions,
    stopNativeMarkdown,
    stopNativeNotes,
    stopNoteSessions,
  ])
    stop(action);
  ++generation;
  ready = false;
  addon.data.alive = false;
  stop(() => libraryRuntime.stop());
  stop(stopAssets);
  stop(() => cancelReadiness?.());
  stop(removeQuitObserver);
}

function removeQuitBlocker(): void {
  quitClient?.removeBlocker(finishAppShutdown);
  quitClient = undefined;
}

function finishAppShutdown(): Promise<void> {
  if (appShutdownPromise) return appShutdownPromise;
  onAppShutdown();
  // Complete local persistence before Sqlite's later shutdown phase closes storage.
  // Remote requests are cancelled, never awaited for a successful response.
  appShutdownPromise = (async () => {
    await Promise.allSettled(draftWrites);
    draftWrites = [];
    for (const close of [
      () => libraryRuntime.close(true),
      () => closeNativeMarkdown(false),
      closeNativeNotes,
      closeNoteSessions,
      closeAssets,
    ]) {
      try {
        await close();
      } catch (error) {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    removeQuitBlocker();
  })();
  return appShutdownPromise;
}

async function onShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    onAppShutdown();
    await startupPromise;
    await releaseResources();
    addon.data.alive = false;
    delete (Zotero as unknown as Record<string, unknown>)[config.addonInstance];
  })();
  return shutdownPromise;
}

export default {
  onStartup,
  onShutdown,
  onAppShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
