import { isAccelKey } from "../ui/platform";
import {
  attachMarkdownToggle,
  getNativeTypography,
} from "../ui/native-markdown-toolbar";
import { attachReadingView } from "../ui/native-reading-view";
import { api } from "./api";
import { onNativeNoteChange, writeNativeNote } from "./note-sessions";
import { mergeMarkdownDocuments } from "./document-merge";
import { getString } from "../utils/locale";
import {
  getMarkdownDocument,
  markdownDocumentHTML,
  repairNativeNoteLinks,
} from "./native-notes";
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
const sourceWindows = new WeakSet<Window>();
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
    await repairNativeNoteLinks(item);
    if (
      stopped ||
      token !== generation ||
      !notes()._editorInstances.includes(instance)
    )
      return;
    const container = frame.parentElement!;
    const bar = doc.createXULElement("hbox") as HTMLElement;
    bar.classList.add("knowledge-base-native-markdown");
    bar.hidden = true;
    bar.setAttribute("align", "center");
    bar.style.cssText = "padding: 3px 6px; gap: 6px;";
    const status = doc.createXULElement("label");
    status.classList.add("knowledge-base-native-status");
    status.setAttribute("flex", "1");
    const reload = doc.createXULElement("button") as HTMLElement & {
      disabled: boolean;
    };
    reload.setAttribute("label", getString("native-markdown-reload"));
    reload.hidden = true;
    bar.append(status, reload);
    const sourceTextarea = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "textarea",
    ) as HTMLTextAreaElement;
    sourceTextarea.className = "knowledge-base-native-source";
    sourceTextarea.setAttribute(
      "aria-label",
      getString("native-markdown-label"),
    );
    sourceTextarea.spellcheck = false;
    sourceTextarea.style.cssText =
      "flex: 1; min-height: 100px; box-sizing: border-box; width: 100%; resize: none; border: 0; outline: none; padding: 0; color: var(--fill-primary, #252a34); background: var(--material-background, #fff);";
    sourceTextarea.hidden = true;
    const previousPosition = container.style.position;
    container.style.position = "relative";
    const toolbarHeight =
      instance._iframeWindow.document
        .querySelector(".toolbar")
        ?.getBoundingClientRect().height || 40;
    sourceTextarea.style.position = "absolute";
    sourceTextarea.style.inset = `${toolbarHeight}px 0 0`;
    sourceTextarea.style.height = "auto";
    sourceTextarea.style.zIndex = "1";
    bar.style.cssText += `position: absolute; top: ${toolbarHeight}px; left: 0; right: 0; z-index: 2;`;
    container.insertBefore(bar, frame);
    container.insertBefore(sourceTextarea, frame.nextSibling);
    // Allocate the HTML/CodeMirror editor only when Markdown is first requested.
    // Ordinary native editing should not load another frame or alter focus.
    let source: import("../ui/markdown-source").MarkdownSource | undefined;
    const ensureSource = async () => {
      if (source) return;
      if (!sourceWindows.has(win)) {
        Services.scriptloader.loadSubScript(
          "chrome://knowledge-base/content/markdown-source.js",
          win,
        );
        sourceWindows.add(win);
      }
      source = await (
        win as Window & {
          KnowledgeBaseMarkdownSource: {
            create(
              input: HTMLTextAreaElement,
              labels?: Record<string, string>,
            ): Promise<import("../ui/markdown-source").MarkdownSource>;
          };
        }
      ).KnowledgeBaseMarkdownSource.create(sourceTextarea, {
        citation: getString("markdown-node-citation"),
        annotation: getString("markdown-node-annotation"),
        notelink: getString("markdown-node-note-link"),
        image: getString("markdown-node-image"),
      });
      if (
        stopped ||
        closed ||
        token !== generation ||
        !notes()._editorInstances.includes(instance)
      ) {
        source.destroy();
        source.remove();
        source = undefined;
        return;
      }
      source.addEventListener("input", changed);
      source.addEventListener("compositionstart", clearTimer);
      source.addEventListener("compositionend", changed);
      source.setTypography(getNativeTypography(instance._iframeWindow));
    };
    let sourceMode = false;
    let readingMode = false;
    let readingVersion = 0;
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
        // The native element also echoes our own HTML-only saves here. Note sessions
        // carry the writer identity and are the single source of external updates.
        pendingNativeUpdate = true;
      } else nativeUpdate.call(instance, data, preserveSelection);
    };
    instance.applyIncrementalUpdate = heldUpdate;
    const previousDisableSaving = instance._disableSaving;
    const draftID = () => `native-document:${item.libraryID}:${item.key}`;
    const dirty = () => sourceMode && source!.value !== baseline;
    const syncNote = () => {
      const html = item.getNote();
      if (html === original) return true;
      const document = getMarkdownDocument(html);
      const previousDocument = getMarkdownDocument(original);
      const merged = mergeMarkdownDocuments(
        previousDocument,
        source!.value,
        document,
      );
      if (merged === null) return false;
      original = html;
      baseline =
        mergeMarkdownDocuments(previousDocument, baseline, document) ??
        document;
      source!.value = merged;
      if (readingMode) void refreshReading().catch(report);
      return true;
    };
    const unsubscribeNote = onNativeNoteChange(item.id, (change) => {
      if (!sourceMode && !closed) {
        void track(repairNativeNoteLinks(item)).catch(report);
        return;
      }
      if (!sourceMode || closed || change.origin === instance.instanceID)
        return;
      pendingNativeUpdate = true;
      if (!syncNote()) show("native-markdown-conflict", true);
      else if (!dirty()) {
        status.textContent = "";
        bar.hidden = true;
        reload.hidden = true;
      }
    });
    const show = (key: string, conflict = false) => {
      bar.hidden = !sourceMode;
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
          body: source!.value,
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
        if (closed || stopped || !sourceMode || source!.isComposing)
          return false;
        if (!dirty()) return true;
        try {
          await persist();
          if (closed || stopped) return false;
          if (!syncNote() || !item.isEditable() || item.isInTrash()) {
            show("native-markdown-conflict", true);
            return false;
          }
          const value = source!.value;
          const expectedHTML = original;
          const html = await markdownDocumentHTML(value, expectedHTML);
          if (closed || stopped) return false;
          const committed = await writeNativeNote(
            item,
            expectedHTML,
            html,
            instance.instanceID,
            () => !closed && !stopped && sourceMode,
          );
          original = committed.html;
          baseline = value;
          instance.applyIncrementalUpdate({ html: item.getNote() }, true);
          if (item.getNote() !== original) {
            await persist();
            show("native-markdown-conflict", true);
            return false;
          }
          if (!dirty()) await discardEditorDraft(draftID());
          else await persist();
          show("editor-saved");
          return true;
        } catch (error) {
          report(error);
          show(
            String(error).includes("NOTE_CONFLICT") ||
              item.getNote() !== original ||
              item.isInTrash()
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
          }, 500);
      });
      return operation;
    };
    let changingMode = false;
    const changeMode = async () => {
      if (closed || stopped || changingMode) return;
      if (operation && !(await operation)) return;
      changingMode = true;
      removeMarkdownToggle.setDisabled(true);
      try {
        readingMode = false;
        ++readingVersion;
        readingView.show(false);
        if (sourceMode) source!.hidden = false;
        if (sourceMode) {
          if (!(await save()) || dirty()) return;
          sourceMode = false;
          if (pendingNativeUpdate) {
            // Keep the stale hidden writer disabled through uninit(), then reload from Zotero.
            await element.initEditor();
            return;
          }
          instance._disableSaving = previousDisableSaving;
          source!.hidden = true;
          frame.hidden = false;
          bar.hidden = true;
          removeMarkdownToggle.setMode(false);
          status.textContent = "";
          reload.hidden = true;
          element.focus();
        } else {
          await ensureSource();
          if (!source || closed || stopped) return;
          const data = instance._iframeWindow.wrappedJSObject.getDataSync(true);
          if (data) await instance._save(JSON.parse(JSON.stringify(data)));
          if (closed || stopped || !item.id) return;
          original = item.getNote();
          baseline = getMarkdownDocument(original);
          const draft = await getEditorDraft(draftID());
          if (closed || stopped) return;
          source!.value = draft?.body ?? baseline;
          revision = draft?.draftRevision ?? 0;
          if (draft?.expectedNoteHTML) {
            original = draft.expectedNoteHTML;
            baseline = getMarkdownDocument(original);
          }
          instance._disableSaving = true;
          sourceMode = true;
          bar.hidden = true;
          frame.hidden = false;
          removeMarkdownToggle.setMode(true);
          source!.hidden = false;
          source!.setTypography(getNativeTypography(instance._iframeWindow));

          if (draft) {
            const synced = syncNote();
            show(
              synced ? "native-markdown-draft" : "native-markdown-conflict",
              !synced,
            );
          } else status.textContent = "";
          source!.focus();
        }
      } catch (error) {
        report(error);
        show("native-markdown-failed", true);
      } finally {
        changingMode = false;
        removeMarkdownToggle.setDisabled(false);
      }
    };
    const changed = () => {
      clearTimer();
      show("editor-unsaved");
      if (!source!.isComposing)
        timer = win.setTimeout(() => {
          void track(save());
        }, 500);
      void persist().catch(report);
    };
    const refreshReading = async () => {
      const version = ++readingVersion;
      if (!readingMode) return;
      let html: string | undefined;
      if (sourceMode) {
        const body = source!.value;
        await api.prepareMarkdown(body);
        html = api.renderMarkdown(body);
      }
      if (closed || stopped || !readingMode || version !== readingVersion)
        return;
      readingView.show(true, html);
    };
    const toggleReading = async () => {
      if (closed || stopped || changingMode) return;
      readingMode = !readingMode;
      ++readingVersion;
      if (sourceMode) source!.hidden = readingMode;
      if (readingMode) {
        try {
          await refreshReading();
          if (readingMode) readingView.focus();
        } catch (error) {
          readingMode = false;
          if (sourceMode) source!.hidden = false;
          report(error);
        }
      } else {
        readingView.show(false);
        if (sourceMode) source!.focus();
        else element.focus();
      }
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
      baseline = source!.value = getMarkdownDocument(original);
      revision = 0;
      status.textContent = "";
      reload.hidden = true;
      if (readingMode) await refreshReading();
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
      if (!sourceMode || !isAccelKey(event)) return;
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
    const removeMarkdownToggle = attachMarkdownToggle(
      instance._iframeWindow,
      getString("editor-format-markdown"),
      () => {
        void changeMode();
      },
    );
    const readingView = attachReadingView(
      instance._iframeWindow,
      getString("editor-reading"),
      () => {
        void toggleReading().catch(report);
      },
      (href) => {
        void api.openLink(href).catch(report);
      },
    );
    const controller: Controller = {
      stop() {
        if (closed) return;
        clearTimer();
        void persist().catch(report);
        closed = true;
        ++readingVersion;
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
        unsubscribeNote();
        // uninit() has already skipped its hidden stale document before unregistering.
        if (instance.applyIncrementalUpdate === heldUpdate)
          instance.applyIncrementalUpdate = nativeUpdate;
        instance._disableSaving = previousDisableSaving;
        frame.hidden = false;
        container.style.position = previousPosition;
        removeMarkdownToggle();
        readingView.destroy();
        bar.remove();
        source?.destroy();
        source?.remove();
        sourceTextarea.remove();
        win.removeEventListener("keydown", keydown, true);
        win.removeEventListener("close", onClose, true);
        win.removeEventListener("unload", unload);
      },
    };

    reload.addEventListener("command", () => {
      void reloadSource().catch(report);
    });
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
