import { config, version } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { closeDB, initDB } from "./modules/db";
import {
  initNativeNotes,
  closeNativeNotes,
  stopNativeNotes,
} from "./modules/native-notes";
import { rebuildCounts } from "./modules/zettel";
import { registerItemPaneUI, unregisterItemPaneUI } from "./modules/item-pane";
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

import {
  registerPreferences,
  unregisterPreferences,
} from "./modules/preferences";

const windows = new Map<Window, Element[]>();
let ready = false;
let generation = 0;
let startupPromise: Promise<void> | undefined;
let shutdownPromise: Promise<void> | undefined;
let observingQuit = false;
let cancelReadiness: (() => void) | undefined;
const quitObserver = { observe: () => onAppShutdown() };

function removeQuitObserver(): void {
  if (!observingQuit) return;
  Services.obs.removeObserver(quitObserver, "quit-application-granted");
  observingQuit = false;
}

async function onStartup(): Promise<void> {
  if (startupPromise) return startupPromise;
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
      ["nativeNotes", initNativeNotes],
      ["rebuildCounts", () => rebuildCounts(() => token !== generation)],
      ["cleanupUnusedImages", cleanupImagesAfterChange],
      ["registerPreferences", registerPreferences],
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
    const doc = win.document;
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
      `chrome://${config.addonRef}/content/section.css?v=${version}`,
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
    };
    addMenu("menu_ToolsPopup", "menu-open-manager", "menu-open-manager", () =>
      addon.api.openManager(),
    );
    addMenu("zotero-itemmenu", "itemmenu-new-card", "menu-new-zettel", () => {
      const pane = (
        win as Window & {
          ZoteroPane: ReturnType<typeof Zotero.getActiveZoteroPane>;
        }
      ).ZoteroPane;
      const item = pane.getSelectedItems()[0];
      if (!item) return;
      addon.api.openEditor({
        sourceItem:
          item.isRegularItem() || item.isNote()
            ? { key: item.key, libraryID: item.libraryID }
            : undefined,
      });
    });
  } catch (error) {
    await onMainWindowUnload(win);
    throw error;
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  for (const node of windows.get(win) ?? []) node.remove();
  windows.delete(win);
}

async function releaseResources(): Promise<void> {
  ready = false;
  removeQuitObserver();
  for (const win of [...windows.keys()]) await onMainWindowUnload(win);
  const actions: (() => unknown | Promise<unknown>)[] = [
    () => {
      for (const kind of [
        "manager",
        "editor",
        "graph",
        "annotations",
        "image",
      ]) {
        for (const win of Services.wm.getEnumerator(
          `${config.addonRef}:${kind}`,
        ))
          win.close();
      }
    },
    unregisterPreferences,
    unregisterItemPaneUI,
    closeNativeNotes,
    closeAssets,
    () => ztoolkit.unregisterAll(),
    closeDB,
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
  // Start pending draft writes before the database shutdown blocker drains them.
  for (const win of Services.wm.getEnumerator(`${config.addonRef}:editor`)) {
    const editor = win as unknown as Window & {
      knowledgeBaseFlushDraft?: () => Promise<void>;
      knowledgeBaseStopping?: boolean;
      knowledgeBaseStopEditor?: () => void;
    };
    try {
      editor
        .knowledgeBaseFlushDraft?.()
        .catch((error) => Zotero.logError(error));
      editor.knowledgeBaseStopEditor?.();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    editor.knowledgeBaseStopping = true;
  }
  stopNativeNotes();
  ++generation;
  ready = false;
  addon.data.alive = false;
  stopAssets();
  unregisterPreferences();
  cancelReadiness?.();
  removeQuitObserver();
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
