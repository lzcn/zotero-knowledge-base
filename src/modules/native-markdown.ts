import { attachMarkdownMenu } from "../ui/native-markdown-menu";
import { getString } from "../utils/locale";
import { getMarkdownDocument, markdownDocumentHTML } from "./native-notes";
import {
  getEditorDraft,
  saveEditorDraft,
  discardEditorDraft,
} from "./editor-drafts";

interface EditorInstance {
  instanceID: string;
  _item: Zotero.Item;
  _tabID?: string;
  _readOnly: boolean;
  _disableSaving: boolean;
  _initPromise: Promise<void>;
  _iframeWindow: Window & {
    browsingContext: { embedderElement: HTMLIFrameElement };
    wrappedJSObject: { getDataSync(force: boolean): { html: string } | null };
  };
  _save(data: { html: string } | null): Promise<void>;
  applyIncrementalUpdate(
    data: { html: string },
    preserveSelection: boolean,
  ): void;
}
interface Controller {
  stop(): void;
  dispose(): void;
  restore(): Promise<void>;
}
interface NativeNotes {
  _editorInstances: EditorInstance[];
  registerEditorInstance(instance: EditorInstance): void;
  unregisterEditorInstance(instance: EditorInstance): Promise<void>;
}
const notes = () => Zotero.Notes as unknown as NativeNotes;
const controllers = new Map<EditorInstance, Controller>();
const attaching = new Set<EditorInstance>();
const writes = new Set<Promise<unknown>>();
let stopped = true;
let generation = 0;
let undoHooks: (() => void) | undefined;

function report(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}
function track<T>(promise: Promise<T>): Promise<T> {
  writes.add(promise);
  void promise.finally(() => writes.delete(promise)).catch(report);
  return promise;
}

async function attach(instance: EditorInstance, token: number): Promise<void> {
  if (attaching.has(instance) || controllers.has(instance)) return;
  attaching.add(instance);
  try {
    await instance._initPromise;
    if (
      stopped ||
      token !== generation ||
      instance._readOnly ||
      !notes()._editorInstances.includes(instance)
    )
      return;
    const frame = instance._iframeWindow.browsingContext.embedderElement;
    const element = frame.closest("note-editor") as HTMLElement & {
      mode: string;
      getCurrentInstance(): EditorInstance;
      initEditor(): Promise<void>;
    };
    if (
      !element ||
      element.mode !== "edit" ||
      element.getCurrentInstance() !== instance
    )
      return;
    const doc = element.ownerDocument;
    const win = doc.defaultView!;
    const windowType = doc.documentElement.getAttribute("windowtype") || "";
    if (windowType.startsWith("knowledge-base:")) return;
    const item = instance._item;
    if (!item?.isNote()) return;
    const container = frame.parentElement!;
    const bar = doc.createXULElement("hbox") as HTMLElement;
    bar.classList.add("knowledge-base-native-markdown");
    bar.hidden = true;
    bar.setAttribute("align", "center");
    bar.style.cssText = "padding: 3px 6px; gap: 6px;";
    const toggle = doc.createXULElement("button") as HTMLElement & {
      disabled: boolean;
    };
    toggle.setAttribute("label", "Markdown");
    const status = doc.createXULElement("label");
    status.classList.add("knowledge-base-native-status");
    status.setAttribute("flex", "1");
    const reload = doc.createXULElement("button") as HTMLElement & {
      disabled: boolean;
    };
    reload.setAttribute("label", getString("native-markdown-reload"));
    reload.hidden = true;
    bar.append(toggle, status, reload);
    const source = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "textarea",
    ) as HTMLTextAreaElement;
    source.className = "knowledge-base-native-source";
    source.setAttribute("aria-label", getString("native-markdown-label"));
    source.spellcheck = false;
    source.style.cssText =
      "flex: 1; min-height: 100px; box-sizing: border-box; width: 100%; resize: none; border: 0; outline: none; padding: 24px; color: var(--fill-primary, #252a34); background: var(--material-background, #fff); font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 4;";
    source.hidden = true;
    container.insertBefore(bar, frame);
    container.insertBefore(source, frame.nextSibling);
    let sourceMode = false;
    let closed = false;
    let baseline = "";
    let original = "";
    let revision = 0;
    let timer: number | undefined;
    let operation: Promise<boolean> | undefined;
    let closing = false;
    let bypassClose = false;
    let pendingNativeUpdate = false;
    const nativeUpdate = instance.applyIncrementalUpdate;
    const heldUpdate = function (
      data: { html: string },
      preserveSelection: boolean,
    ) {
      if (sourceMode) {
        pendingNativeUpdate = true;
        if (dirty() && item.getNote() !== original)
          show("native-markdown-conflict", true);
      } else nativeUpdate.call(instance, data, preserveSelection);
    };
    instance.applyIncrementalUpdate = heldUpdate;
    const previousDisableSaving = instance._disableSaving;
    const draftID = () => `native-document:${item.libraryID}:${item.key}`;
    const dirty = () => sourceMode && source.value !== baseline;
    const show = (key: string, conflict = false) => {
      status.textContent = getString(key);
      reload.hidden = !conflict;
    };
    const persist = () => {
      if (!dirty() || !item.key) return Promise.resolve();
      return track(
        saveEditorDraft({
          draftId: draftID(),
          draftRevision: ++revision,
          nativeDocument: true,
          title: item.getDisplayTitle(),
          body: source.value,
          noteID: item.id,
          expectedNoteHTML: original,
          sourceMode: true,
        }),
      );
    };
    const clearTimer = () => {
      win.clearTimeout(timer);
      timer = undefined;
    };
    const save = (): Promise<boolean> => {
      if (operation) return operation;
      operation = (async () => {
        clearTimer();
        if (closed || stopped || !sourceMode) return false;
        if (!dirty()) return true;
        const value = source.value;
        try {
          await persist();
          if (closed || stopped) return false;
          if (
            item.getNote() !== original ||
            !item.isEditable() ||
            item.isInTrash()
          ) {
            show("native-markdown-conflict", true);
            return false;
          }
          const html = await markdownDocumentHTML(value, original);
          if (closed || stopped) return false;
          let committedHTML = "";
          await Zotero.DB.executeTransaction(async () => {
            if (
              closed ||
              stopped ||
              item.getNote() !== original ||
              !item.isEditable() ||
              item.isInTrash()
            )
              throw new Error("NOTE_CONFLICT");
            item.setNote(html);
            committedHTML = item.getNote();
            await item.save({
              notifierData: { noteEditorID: instance.instanceID },
            });
          });
          original = committedHTML;
          baseline = value;
          if (item.getNote() === original)
            instance.applyIncrementalUpdate({ html: original }, true);
          if (!dirty()) await discardEditorDraft(draftID());
          else await persist();
          show("editor-saved");
          return true;
        } catch (error) {
          report(error);
          show(
            item.getNote() !== original || item.isInTrash()
              ? "native-markdown-conflict"
              : "native-markdown-failed",
            true,
          );
          return false;
        }
      })().finally(() => {
        operation = undefined;
        if (
          !closed &&
          !stopped &&
          dirty() &&
          reload.hidden &&
          timer === undefined
        )
          timer = win.setTimeout(() => {
            void track(save());
          }, 700);
      });
      return operation;
    };
    const changeMode = async () => {
      if (closed || stopped) return;
      if (operation && !(await operation)) return;
      toggle.disabled = true;
      try {
        if (sourceMode) {
          if (!(await save()) || dirty()) return;
          sourceMode = false;
          if (pendingNativeUpdate) {
            // Keep the stale hidden writer disabled through uninit(), then reload from Zotero.
            await element.initEditor();
            return;
          }
          instance._disableSaving = previousDisableSaving;
          source.hidden = true;
          frame.hidden = false;
          bar.hidden = true;
          toggle.setAttribute("label", "Markdown");
          status.textContent = "";
          reload.hidden = true;
          element.focus();
        } else {
          const data = instance._iframeWindow.wrappedJSObject.getDataSync(true);
          if (data) await instance._save(JSON.parse(JSON.stringify(data)));
          if (closed || stopped || !item.id) return;
          original = item.getNote();
          baseline = getMarkdownDocument(original);
          const draft = await getEditorDraft(draftID());
          if (closed || stopped) return;
          source.value = draft?.body ?? baseline;
          revision = draft?.draftRevision ?? 0;
          if (draft?.expectedNoteHTML) original = draft.expectedNoteHTML;
          instance._disableSaving = true;
          sourceMode = true;
          bar.hidden = false;
          frame.hidden = true;
          source.hidden = false;
          toggle.setAttribute("label", getString("editor-format-native"));
          if (draft)
            show(
              original === item.getNote()
                ? "native-markdown-draft"
                : "native-markdown-conflict",
              original !== item.getNote(),
            );
          else status.textContent = "";
          source.focus();
        }
      } catch (error) {
        report(error);
        show("native-markdown-failed", true);
      } finally {
        toggle.disabled = false;
      }
    };
    const changed = () => {
      clearTimer();
      show("editor-unsaved");
      timer = win.setTimeout(() => {
        void track(save());
      }, 700);
      void persist().catch(report);
    };
    const reloadSource = async () => {
      if (operation || stopped || closed) return;
      if (
        dirty() &&
        !Services.prompt.confirm(
          win as unknown as Parameters<typeof Services.prompt.confirm>[0],
          "Knowledge Base",
          getString("editor-confirm-discard"),
        )
      )
        return;
      clearTimer();
      await discardEditorDraft(draftID());
      original = item.getNote();
      baseline = source.value = getMarkdownDocument(original);
      revision = 0;
      status.textContent = "";
      reload.hidden = true;
    };
    const requestClose = async () => {
      if (closing) return;
      closing = true;
      clearTimer();
      try {
        await persist();
        if (closed || stopped) return;
        const flags =
          Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_SAVE +
          Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL +
          Services.prompt.BUTTON_POS_2 * Services.prompt.BUTTON_TITLE_IS_STRING;
        const choice = Services.prompt.confirmEx(
          win as unknown as Parameters<typeof Services.prompt.confirmEx>[0],
          "Knowledge Base",
          getString("native-markdown-close"),
          flags,
          "",
          "",
          getString("editor-draft-close"),
          "",
          { value: false },
        );
        if (choice === 1) return;
        if (choice === 0 && (!(await track(save())) || dirty())) return;
        if (choice === 2) await persist();
        bypassClose = true;
        if (instance._tabID) {
          (
            win as unknown as { Zotero_Tabs: { close(id: string): void } }
          ).Zotero_Tabs.close(instance._tabID);
        } else win.close();
      } finally {
        closing = false;
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (!sourceMode || !(event.metaKey || event.ctrlKey) || event.altKey)
        return;
      const key = event.key.toLowerCase();
      if (windowType !== "zotero:note" && !element.contains(doc.activeElement))
        return;
      if (
        key === "s" ||
        (key === "w" &&
          (windowType === "zotero:note" || instance._tabID) &&
          dirty())
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "s") void track(save());
        else void requestClose();
      }
    };
    const onClose = (event: Event) => {
      if (!bypassClose && !stopped && dirty() && windowType === "zotero:note") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void requestClose();
      }
    };
    const unload = () => {
      controller.dispose();
      controllers.delete(instance);
    };
    const removeMarkdownMenu = attachMarkdownMenu(
      instance._iframeWindow,
      getString("editor-format-markdown"),
      () => {
        void changeMode();
      },
    );
    const controller: Controller = {
      stop() {
        if (closed) return;
        clearTimer();
        void persist().catch(report);
        closed = true;
      },
      async restore() {
        // Rebuild an open native editor before re-enabling its writer on plugin disable.
        const rebuild =
          sourceMode &&
          !Zotero.closing &&
          !win.closed &&
          element.isConnected &&
          element.getCurrentInstance() === instance;
        controller.dispose();
        if (rebuild) {
          instance._disableSaving = true;
          await element.initEditor();
        }
      },
      dispose() {
        controller.stop();
        // uninit() has already skipped its hidden stale document before unregistering.
        if (instance.applyIncrementalUpdate === heldUpdate)
          instance.applyIncrementalUpdate = nativeUpdate;
        instance._disableSaving = previousDisableSaving;
        frame.hidden = false;
        removeMarkdownMenu();
        bar.remove();
        source.remove();
        win.removeEventListener("keydown", keydown, true);
        win.removeEventListener("close", onClose, true);
        win.removeEventListener("unload", unload);
      },
    };
    toggle.addEventListener("command", () => {
      void changeMode();
    });
    reload.addEventListener("command", () => {
      void reloadSource().catch(report);
    });
    source.addEventListener("input", changed);
    win.addEventListener("keydown", keydown, true);
    win.addEventListener("close", onClose, true);
    win.addEventListener("unload", unload);
    controllers.set(instance, controller);
  } finally {
    attaching.delete(instance);
  }
}

export function initNativeMarkdown(): void {
  if (undoHooks) return;
  stopped = false;
  const token = ++generation;
  const host = notes();
  const register = host.registerEditorInstance;
  const unregister = host.unregisterEditorInstance;
  const wrappedRegister = function (
    this: NativeNotes,
    instance: EditorInstance,
  ) {
    register.call(this, instance);
    // Registration precedes init() assigning the item, iframe and initialization promise.
    void Promise.resolve()
      .then(() => attach(instance, token))
      .catch(report);
  };
  const wrappedUnregister = function (
    this: NativeNotes,
    instance: EditorInstance,
  ) {
    controllers.get(instance)?.dispose();
    controllers.delete(instance);
    return unregister.call(this, instance);
  };
  host.registerEditorInstance = wrappedRegister;
  host.unregisterEditorInstance = wrappedUnregister;
  undoHooks = () => {
    if (host.registerEditorInstance === wrappedRegister)
      host.registerEditorInstance = register;
    if (host.unregisterEditorInstance === wrappedUnregister)
      host.unregisterEditorInstance = unregister;
  };
  for (const instance of host._editorInstances)
    void attach(instance, token).catch(report);
}
export function stopNativeMarkdown(): void {
  if (stopped) return;
  for (const controller of controllers.values()) controller.stop();
  stopped = true;
  ++generation;
}
export async function closeNativeMarkdown(): Promise<void> {
  stopNativeMarkdown();
  undoHooks?.();
  undoHooks = undefined;
  await Promise.allSettled([...writes]);
  await Promise.allSettled(
    [...controllers.values()].map((controller) => controller.restore()),
  );
  controllers.clear();
}
