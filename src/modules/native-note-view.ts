import { getString } from "../utils/locale";
import { ensureManagedNote } from "./native-notes";
import { mountEditor, clearEditor } from "./workbench";
import { stopEditorView } from "./editor-views";
import { getNativeNoteTakeover } from "./preferences";

export interface NativeEditorInstance {
  _item: Zotero.Item;
  _disableSaving: boolean;
  _ensureNoteCreated(): Promise<void>;
  insertAnnotations(annotations: unknown[]): Promise<void>;
}
type Browser = HTMLElement & { contentWindow: Window };
interface NativeNoteView {
  browser: Browser;
  bind(instance: NativeEditorInstance): void;
  dispose(): void;
}
const views = new Map<HTMLElement, NativeNoteView>();
const owners = new WeakMap<NativeEditorInstance, HTMLElement>();
let generation = 0;

/** Keep the Knowledge Base document alive when Zotero refreshes its hidden native editor. */
export async function attachNativeNoteEditor(
  instance: NativeEditorInstance,
  element: HTMLElement,
): Promise<boolean> {
  if (!getNativeNoteTakeover()) return false;
  const version = generation;
  await instance._ensureNoteCreated();
  const id = await ensureManagedNote(instance._item.id);
  if (!id || version !== generation || !element.isConnected) return false;
  const view = views.get(element) || createNativeNoteView(element);
  view.bind(instance);
  try {
    await mountEditor(view.browser, { zettelId: id });
    return true;
  } catch (error) {
    view.dispose();
    throw error;
  }
}

function createNativeNoteView(element: HTMLElement): NativeNoteView {
  const doc = element.ownerDocument;
  const browser = doc.createXULElement("browser") as unknown as Browser;
  browser.classList.add("knowledge-base-native-note-editor");
  browser.setAttribute("flex", "1");
  browser.setAttribute("disableglobalhistory", "true");
  browser.style.cssText = "flex: 1; min-width: 0; min-height: 0; width: 100%;";
  const display = element.style.display;
  let disposed = false;
  let restore: (() => void) | undefined;
  const forwarded = async (annotations: unknown[]) => {
    await browser.contentWindow.knowledgeBaseReady?.();
    if (!disposed)
      await browser.contentWindow.knowledgeBaseInsertAnnotations?.(annotations);
  };
  const observer = new doc.defaultView!.MutationObserver(() => {
    if (!element.isConnected) {
      void stopEditorView(browser.contentWindow);
      dispose();
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    doc.defaultView!.removeEventListener("unload", unload);
    views.delete(element);
    restore?.();
    element.style.display = display;
    clearEditor(browser);
    browser.remove();
  };
  const unload = () => {
    void stopEditorView(browser.contentWindow);
    dispose();
  };
  doc.defaultView!.addEventListener("unload", unload, { once: true });
  const bind = (instance: NativeEditorInstance) => {
    if (owners.get(instance) === element) return;
    restore?.();
    const disabled = instance._disableSaving;
    const insert = instance.insertAnnotations;
    instance._disableSaving = true;
    instance.insertAnnotations = forwarded;
    owners.set(instance, element);
    restore = () => {
      owners.delete(instance);
      if (!Zotero.closing) instance._disableSaving = disabled;
      if (instance.insertAnnotations === forwarded)
        instance.insertAnnotations = insert;
    };
  };
  element.after(browser);
  element.style.display = "none";
  observer.observe(element.parentElement!, {
    childList: true,
    subtree: true,
  });
  const view = { browser, bind, dispose };
  views.set(element, view);
  return view;
}

export function detachNativeNoteEditor(instance: NativeEditorInstance): void {
  const element = owners.get(instance);
  // A normal native reinit unregisters the instance, but keeps this note surface.
  if (!element || element.isConnected) return;
  const view = views.get(element);
  if (!view) return;
  void stopEditorView(view.browser.contentWindow);
  view.dispose();
}

export function nativeNoteEditorWindow(element: Element): Window | undefined {
  return views.get(element as HTMLElement)?.browser.contentWindow;
}

export async function stopNativeNoteViews(): Promise<void> {
  generation++;
  const closing = [...views.values()];
  // A removed browser loses its promise callbacks. Drain its writes before removal.
  await Promise.allSettled(
    closing.map((view) => stopEditorView(view.browser.contentWindow)),
  );
  for (const view of closing) view.dispose();
}

/** Flush before changing editor ownership; a failed save keeps the current view. */
export async function prepareNativeNoteViews(): Promise<HTMLElement[]> {
  const elements = [...views.keys()];
  for (const element of elements) {
    const view = views.get(element);
    if (
      view &&
      !(await view.browser.contentWindow.knowledgeBasePrepareNavigation?.())
    )
      throw new Error(getString("native-note-switch-save"));
  }
  return elements;
}
