import { isAccelKey } from "./platform";
import {
  attachMarkdownToggle,
  getNativeTypography,
} from "./native-markdown-toolbar";
import { attachReadingView } from "./native-reading-view";
import type { NativeNoteChange } from "../modules/note-sessions";

/** Thin adapter around Zotero's editor; the host owns editing and note storage. */
export interface NativeEditorInstance {
  instanceID: string;
  _initPromise: Promise<void>;
  _disableSaving: boolean;
  _iframeWindow: Window & {
    wrappedJSObject: {
      getDataSync(force: boolean): { html: string; state?: unknown } | null;
    };
  };
  _postMessage(message: Record<string, unknown>): void;
  _save(data: { html: string; state?: unknown } | null): Promise<void>;
}
export interface NativeNoteElement extends HTMLElement {
  mode: "edit" | "view";
  item: Zotero.Item;
  _initPromise: Promise<void>;
  getCurrentInstance(): NativeEditorInstance;
  initEditor(): Promise<void>;
  focus(): Promise<void>;
  destroy(): void;
}
export interface NativeEditorOptions {
  element: NativeNoteElement;
  item: Zotero.Item;
  readOnly?: boolean;
  onChange(html: string): void;
  onSavedHTML(html: string): void;
  onExternalHTML(html: string): void;
  subscribeNote(
    noteID: number,
    listener: (change: NativeNoteChange) => void,
  ): () => void;
  onOpenLink(href: string): void;
  onShortcut(key: string): void;
  markdownLabel: string;
  onMarkdown(): void;
  readingLabel: string;
  onReading(): void;
  noteLinkLabel: string;
  onNoteLink(): void;
}
export interface NativeEditorController {
  getHTML(): string;
  getSavedHTML(): string;
  flush(): Promise<void>;
  setReadOnly(value: boolean): Promise<void>;
  setSourceMode(value: boolean): void;
  setReadingMode(value: boolean, html?: string): void;
  getTypography(): Record<string, string>;
  reload(): Promise<void>;
  insertHTML(html: string): void;
  focus(): void;
  destroy(): void;
}

async function create(
  options: NativeEditorOptions,
): Promise<NativeEditorController> {
  const { element } = options;
  element.mode = options.readOnly ? "view" : "edit";
  element.item = options.item;
  await element._initPromise;
  let frame: NativeEditorInstance["_iframeWindow"];
  let readOnly = !!options.readOnly;
  let lastHTML = options.item.getNote();
  let destroyed = false;
  let removeMarkdownToggle: ReturnType<typeof attachMarkdownToggle> | undefined;
  let removeNoteLink = () => {};
  let sourceMode = false;
  let readingView: ReturnType<typeof attachReadingView> | undefined;
  let previousDisableSaving = element.getCurrentInstance()._disableSaving;
  const ownedInstances = new Set<string>();
  const unsubscribeNote = options.subscribeNote(options.item.id, (change) => {
    if (destroyed) return;
    if (change.origin && ownedInstances.has(change.origin))
      options.onSavedHTML(change.html);
    else options.onExternalHTML(change.html);
  });
  const getData = () => {
    const data = frame?.wrappedJSObject.getDataSync(false);
    return data
      ? (JSON.parse(JSON.stringify(data)) as { html: string; state?: unknown })
      : null;
  };
  const changed = () => {
    if (destroyed || readOnly) return;
    const html = getData()?.html;
    if (html && html !== lastHTML) {
      lastHTML = html;
      // Native refresh messages also report HTML saved by another editor.
      // A view matching storage has no local change to save again.
      if (html === options.item.getNote()) options.onExternalHTML(html);
      else options.onChange(html);
    }
  };
  const input = () => {
    queueMicrotask(changed);
  };
  const keydown = (event: KeyboardEvent) => {
    if (!isAccelKey(event)) return;
    const key = event.key.toLowerCase();
    if (["s", "k", "w", "e"].includes(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      changed();
      options.onShortcut(key);
    }
  };
  const message = (event: MessageEvent) => {
    if (
      event.source !== frame ||
      event.data?.instanceID !== element.getCurrentInstance().instanceID
    )
      return;
    if (event.data.message?.action === "update") changed();
    if (
      event.data.message?.action === "openURL" &&
      /^knowledge-base:\/\//.test(event.data.message.url)
    ) {
      event.stopImmediatePropagation();
      options.onOpenLink(event.data.message.url);
    }
  };
  const stopEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") event.stopPropagation();
  };
  const detach = () => {
    readingView?.destroy();
    removeMarkdownToggle?.();
    removeNoteLink();
    if (!frame) return;
    frame.document.removeEventListener("input", input, true);
    frame.document.removeEventListener("keydown", keydown, true);
    frame.document.removeEventListener("keydown", stopEscape);
    frame.removeEventListener("message", message, true);
  };
  const attach = () => {
    ownedInstances.add(element.getCurrentInstance().instanceID);
    frame = element.getCurrentInstance()._iframeWindow;
    if (!readOnly)
      removeMarkdownToggle = attachMarkdownToggle(
        frame,
        options.markdownLabel,
        options.onMarkdown,
      );
    if (!readOnly) {
      const link = frame.document.createElement("button");
      link.className = "toolbar-button knowledge-base-note-link";
      link.setAttribute("aria-label", options.noteLinkLabel);
      link.title = options.noteLinkLabel;
      link.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6M8 7h5M8 11h5M8 15h3M18 15v6m-3-3h6"/></svg>';
      link.addEventListener("mousedown", (event) => event.preventDefault());
      link.addEventListener("click", options.onNoteLink);
      const toolbar = frame.document.querySelector(".toolbar .start");
      const insertLink = () => {
        if (!toolbar || toolbar.contains(link)) return;
        const toggle = toolbar.querySelector(".knowledge-base-markdown-toggle");
        if (toggle) toggle.after(link);
        else toolbar.append(link);
      };
      const Observer = (
        frame as unknown as Window & {
          MutationObserver: typeof MutationObserver;
        }
      ).MutationObserver;
      const observer = new Observer(insertLink);
      if (toolbar) observer.observe(toolbar, { childList: true });
      insertLink();
      removeNoteLink = () => {
        observer.disconnect();
        link.remove();
      };
    }
    removeMarkdownToggle?.setMode(sourceMode);
    if (!readOnly)
      readingView = attachReadingView(
        frame,
        options.readingLabel,
        options.onReading,
        options.onOpenLink,
      );
    if (sourceMode) element.getCurrentInstance()._disableSaving = true;
    frame.document.addEventListener("input", input, true);
    frame.document.addEventListener("keydown", keydown, true);
    frame.document.addEventListener("keydown", stopEscape);
    frame.addEventListener("message", message, true);
    lastHTML = getData()?.html || options.item.getNote();
  };
  attach();
  const flush = async () => {
    changed();
    if (!readOnly) {
      const current = await Zotero.Items.getAsync(options.item.id);
      if (!current || current.isInTrash()) throw new Error("NOTE_UNAVAILABLE");
      const data = getData();
      if (data && data.html !== current.getNote())
        await element.getCurrentInstance()._save(data);
    }
  };
  return {
    getHTML: () => getData()?.html || lastHTML,
    getSavedHTML: () => options.item.getNote(),
    flush,
    setSourceMode(value) {
      const instance = element.getCurrentInstance();
      if (value && !sourceMode) previousDisableSaving = instance._disableSaving;
      instance._disableSaving = value || previousDisableSaving;
      sourceMode = value;
      removeMarkdownToggle?.setMode(value);
      const height =
        frame.document.querySelector(".toolbar")?.getBoundingClientRect()
          .height || 40;
      element.parentElement?.style.setProperty(
        "--knowledge-base-toolbar-height",
        `${height}px`,
      );
    },
    setReadingMode(value, html) {
      readingView?.show(value, html);
      if (value) readingView?.focus();
    },
    getTypography: () => getNativeTypography(frame),
    async setReadOnly(value) {
      if (readOnly === value) return;
      await flush();
      detach();
      readOnly = value;
      element.mode = value ? "view" : "edit";
      await element.initEditor();
      attach();
    },
    async reload() {
      detach();
      await element.initEditor();
      attach();
    },
    insertHTML(html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const root = doc.querySelector("div[data-schema-version]") || doc.body;
      if (
        root.firstElementChild?.tagName === "H1" &&
        !root.firstElementChild.textContent
      )
        root.firstElementChild.remove();
      element
        .getCurrentInstance()
        ._postMessage({ action: "insertHTML", html: root.innerHTML });
    },
    focus: () => {
      void element.focus();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // A source-mode view must not flush its hidden rich-text document on teardown.
      if (!sourceMode)
        element.getCurrentInstance()._disableSaving = previousDisableSaving;
      detach();
      unsubscribeNote();
      element.destroy();
    },
  };
}
window.KnowledgeBaseNativeEditor = { create };
