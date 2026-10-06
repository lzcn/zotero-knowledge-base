import { config } from "../../package.json";
import type { EditorArgs, ManagerArgs } from "./api";

interface Browser extends Element {
  loadURI(uri: nsIURI, options: { triggeringPrincipal: nsIPrincipal }): void;
  contentWindow: Window & {
    save?: (closeAfter: boolean) => Promise<boolean>;
  };
}
interface Tabs {
  getState(): { type: string }[];
  add(options: {
    type: string;
    data: object;
    title: string;
    select: boolean;
    onClose(): void;
  }): { id: string; container: Element };
  select(id: string): void;
  close(id: string): void;
}
const workbenches = new Map<
  Window,
  {
    id: string;
    browser: Browser;
    tabs: Tabs;
    args: ManagerArgs;
    restoreSession(): void;
  }
>();
const contexts = new Map<string, EditorArgs & ManagerArgs>();
const mounts = new WeakMap<Element, number>();
const pending = new WeakMap<Element, string>();
const transitions = new WeakMap<Element, Promise<boolean>>();
const cancelLoads = new WeakMap<Element, () => void>();

export function getViewArguments(token: string): EditorArgs & ManagerArgs {
  const args = contexts.get(token);
  if (!args) throw new Error("Knowledge Base view context expired");
  contexts.delete(token);
  return args;
}

function loadView(
  browser: Element,
  view: string,
  args: EditorArgs & ManagerArgs,
): void {
  const previous = pending.get(browser);
  if (previous) contexts.delete(previous);
  const token = `${Date.now()}-${Math.random()}`;
  contexts.set(token, args);
  pending.set(browser, token);
  (browser as Browser).loadURI(
    Services.io.newURI(
      `chrome://${config.addonRef}/content/${view}.xhtml?context=${token}`,
    ),
    {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    },
  );
}

export function openWorkbench(args: ManagerArgs = {}): void {
  const win = Zotero.getMainWindow();
  const existing = workbenches.get(win);
  if (existing) {
    existing.tabs.select(existing.id);
    if (args.editor) {
      existing.args.editor = args.editor;
      existing.browser.contentWindow.ZoteroKnowledgeBase_editNote?.(
        args.editor,
      );
    } else if (args.selectId) {
      existing.args.editor = undefined;
      existing.args.selectId = args.selectId;
      existing.browser.contentWindow.ZoteroKnowledgeBase_selectZettel?.(
        args.selectId,
      );
    }
    return;
  }
  const tabs = (win as unknown as { Zotero_Tabs: Tabs }).Zotero_Tabs;
  // Zotero's session restorer only understands its built-in document types.
  const getState = tabs.getState;
  const sessionState = () =>
    getState.call(tabs).filter((tab) => tab.type !== "knowledgebase");
  tabs.getState = sessionState;
  const tab = tabs.add({
    type: "knowledgebase",
    data: {},
    title: config.addonName,
    select: true,
    onClose: () => {
      stopWorkbench(win);
      workbenches.get(win)?.restoreSession();
      workbenches.delete(win);
    },
  });
  const browser = win.document.createXULElement(
    "browser",
  ) as unknown as Browser;
  browser.classList.add("knowledge-base-workbench");
  browser.setAttribute("flex", "1");
  browser.setAttribute("disableglobalhistory", "true");
  tab.container.append(browser);
  const viewArgs = {
    ...args,
    embedded: true,
    onClose: () => tabs.close(tab.id),
  };
  workbenches.set(win, {
    id: tab.id,
    browser,
    tabs,
    args: viewArgs,
    restoreSession: () => {
      if (tabs.getState === sessionState) tabs.getState = getState;
    },
  });
  loadView(browser, "manager", viewArgs);
}

export async function mountEditor(
  element: Element,
  args: EditorArgs,
): Promise<boolean> {
  const browser = element as Browser;
  const version = (mounts.get(element) || 0) + 1;
  mounts.set(element, version);
  const previous = transitions.get(element);
  const transition = (async () => {
    // A browser's old global stays accessible while its replacement loads.
    // Finish that load before another navigation reads or saves the document.
    if (previous) await previous.catch(() => false);
    if (version !== mounts.get(element) || !element.isConnected) return false;
    const current = browser.contentWindow;
    if (args.zettelId && current?.knowledgeBaseCardId === args.zettelId)
      return true;
    if (current?.save && !(await current.save(false))) return false;
    if (version !== mounts.get(element) || !element.isConnected) return false;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        browser.removeEventListener("load", onLoad, true);
        cancelLoads.delete(element);
      };
      const onLoad = (event: Event) => {
        if (event.target !== browser.contentWindow.document) return;
        browser.removeEventListener("load", onLoad, true);
        const ready = browser.contentWindow.knowledgeBaseReady;
        if (!ready) {
          cleanup();
          reject(new Error("Knowledge Base editor failed to load"));
          return;
        }
        Promise.resolve().then(ready).then(resolve, reject).finally(cleanup);
      };
      cancelLoads.set(element, () => {
        cleanup();
        resolve();
      });
      browser.addEventListener("load", onLoad, true);
      try {
        loadView(element, "editor", { ...args, embedded: true });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    return version === mounts.get(element) && element.isConnected;
  })();
  transitions.set(element, transition);
  try {
    return await transition;
  } finally {
    if (transitions.get(element) === transition) transitions.delete(element);
  }
}

export function clearEditor(element: Element): void {
  const browser = element as Browser;
  mounts.set(element, (mounts.get(element) || 0) + 1);
  cancelLoads.get(element)?.();
  const token = pending.get(element);
  if (token) contexts.delete(token);
  pending.delete(element);
  browser.contentWindow.knowledgeBaseStopping = true;
  browser.loadURI(Services.io.newURI("about:blank"), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
}

function stopWorkbench(win: Window): void {
  const record = workbenches.get(win);
  if (!record) return;
  const manager = record.browser.contentWindow;
  const editorBrowser = manager?.document.getElementById(
    "knowledge-base-workbench-editor",
  ) as unknown as Browser | null;
  const editor = editorBrowser?.contentWindow;
  if (editorBrowser) {
    mounts.set(editorBrowser, (mounts.get(editorBrowser) || 0) + 1);
    cancelLoads.get(editorBrowser)?.();
  }
  if (editor?.knowledgeBaseFlushDraft && !editor.knowledgeBaseStopping) {
    editor.knowledgeBaseFlushDraft().catch((error) => Zotero.logError(error));
    editor.knowledgeBaseStopping = true;
    editor.knowledgeBaseStopEditor?.();
  }
  for (const browser of [record.browser, editorBrowser]) {
    const token = browser && pending.get(browser);
    if (token) contexts.delete(token);
  }
}

export function stopWorkbenches(): void {
  for (const win of workbenches.keys()) stopWorkbench(win);
}

export function closeWorkbenches(win?: Window): void {
  for (const [owner, record] of [...workbenches]) {
    if (!win || win === owner) record.tabs.close(record.id);
  }
  if (!win) contexts.clear();
}
