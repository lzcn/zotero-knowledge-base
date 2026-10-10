import { isAccelKey } from "./platform";
import {
  attachMarkdownToggle,
  getNativeTypography,
} from "./native-markdown-toolbar";
import { attachReadingView } from "./native-reading-view";
import type { NativeNoteChange } from "../modules/note-sessions";

interface NoteLinkTarget {
  id: string;
  href: string;
  label: string;
}
interface NativeEditorView {
  state: {
    doc: unknown;
    selection: {
      empty: boolean;
      from: number;
      to: number;
      $from: {
        parentOffset: number;
        parent: {
          type: { name: string };
          textBetween(
            from: number,
            to: number,
            separator: string,
            leaf: string,
          ): string;
        };
        marks(): { type: { name: string } }[];
      };
    };
    schema: {
      marks: {
        link: {
          create(attrs: { href: string; title: string }): {
            type: { name: string };
          };
        };
      };
      text(text: string, marks: unknown[]): unknown;
    };
    tr: { replaceWith(from: number, to: number, node: unknown): unknown };
  };
  dispatch(transaction: unknown): void;
}

const NOTE_LINK_URL = /^(?:knowledge-base:\/\/|zotero:\/\/(?:select\/|note\/))/;

/** Thin adapter around Zotero's editor; the host owns editing and note storage. */
export interface NativeEditorInstance {
  instanceID: string;
  _initPromise: Promise<void>;
  _disableSaving: boolean;
  _iframeWindow: Window & {
    wrappedJSObject: {
      getDataSync(force: boolean): { html: string; state?: unknown } | null;
      JSON: { parse(text: string): { href: string; title: string } };
      _currentEditorInstance?: {
        _editorCore?: { view?: NativeEditorView; getHTML?(): string };
      };
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
  resolveNoteLink(ref: string): Promise<NoteLinkTarget | null>;
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
  const getHTML = () => {
    const core = frame?.wrappedJSObject._currentEditorInstance?._editorCore;
    return core?.getHTML?.() ?? frame?.wrappedJSObject.getDataSync(false)?.html;
  };
  const changed = (html?: string) => {
    if (destroyed || readOnly) return;
    html ??= getHTML();
    if (html && html !== lastHTML) {
      lastHTML = html;
      // Native refresh messages also report HTML saved by another editor.
      // A view matching storage has no local change to save again.
      if (html === options.item.getNote()) options.onExternalHTML(html);
      else options.onChange(html);
    }
  };
  const insertWikiLink = async () => {
    if (destroyed || readOnly || sourceMode) return;
    const view =
      frame.wrappedJSObject._currentEditorInstance?._editorCore?.view;
    if (!view) return;
    const { state } = view;
    const { selection } = state;
    if (!selection.empty || selection.$from.parent.type.name !== "paragraph")
      return;
    const marks = selection.$from.marks();
    if (marks.some((mark) => ["code", "link"].includes(mark.type.name))) return;
    const before = selection.$from.parent.textBetween(
      0,
      selection.$from.parentOffset,
      "\n",
      "\ufffc",
    );
    const match = /\[\[([^\][\n]+)\]\]$/.exec(before);
    if (!match || before[match.index - 1] === "\\") return;
    const [ref, ...alias] = match[1].split("|");
    const target = await options.resolveNoteLink(ref.trim());
    if (
      !target ||
      destroyed ||
      readOnly ||
      sourceMode ||
      view !==
        frame.wrappedJSObject._currentEditorInstance?._editorCore?.view ||
      view.state.doc !== state.doc ||
      view.state.selection.from !== selection.from ||
      view.state.selection.to !== selection.to
    )
      return;
    const label = alias.join("|").trim();
    // The content compartment cannot read objects allocated by a chrome window.
    const attributes = frame.wrappedJSObject.JSON.parse(
      JSON.stringify({
        href: target.href,
        title: `[[${target.id}${label ? `|${label}` : ""}]]`,
      }),
    );
    const link = state.schema.marks.link.create(attributes);
    // A native transaction preserves cursor mapping, undo and Zotero's autosave.
    view.dispatch(
      state.tr.replaceWith(
        selection.from - match[0].length,
        selection.from,
        state.schema.text(label || target.label, marks.concat(link)),
      ),
    );
    changed();
  };
  const input = (event: Event) => {
    queueMicrotask(() => {
      changed();
      if (
        !(event as InputEvent).isComposing &&
        !["historyUndo", "historyRedo"].includes(
          (event as InputEvent).inputType,
        )
      )
        void insertWikiLink().catch((error) => Zotero.logError(error));
    });
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
    if (event.data.message?.action === "update")
      changed(event.data.message.noteData?.html);
    if (
      event.data.message?.action === "openURL" &&
      NOTE_LINK_URL.test(event.data.message.url)
    ) {
      event.stopImmediatePropagation();
      options.onOpenLink(event.data.message.url);
    }
  };
  const click = (event: MouseEvent) => {
    if (event.button !== 0 || !isAccelKey(event)) return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    const href = link?.getAttribute("href") || "";
    if (!link?.closest(".primary-editor") || !NOTE_LINK_URL.test(href)) return;
    // Resolve the actual anchor; native coordinate lookup can miss short labels.
    event.preventDefault();
    event.stopImmediatePropagation();
    options.onOpenLink(href);
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
    frame.document.removeEventListener("click", click, true);
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
    frame.document.addEventListener("click", click, true);
    frame.addEventListener("message", message, true);
    lastHTML = getHTML() || options.item.getNote();
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
    getHTML: () => getHTML() || lastHTML,
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
