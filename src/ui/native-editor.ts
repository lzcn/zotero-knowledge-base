import { attachMarkdownMenu } from "./native-markdown-menu";

/** Thin adapter around Zotero's editor; the host owns editing and note storage. */
export interface NativeEditorInstance {
  instanceID: string;
  _initPromise: Promise<void>;
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
  onOpenLink(href: string): void;
  onShortcut(key: string): void;
  markdownLabel: string;
  onMarkdown(): void;
}
export interface NativeEditorController {
  getHTML(): string;
  getSavedHTML(): string;
  flush(): Promise<void>;
  setReadOnly(value: boolean): Promise<void>;
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
  let removeMarkdownMenu = () => {};
  const ownedInstances = new Set<string>();
  const observerID = Zotero.Notifier.registerObserver(
    {
      notify(_event, _type, ids, extraData) {
        if (destroyed || !ids.some((id) => Number(id) === options.item.id))
          return;
        const id =
          extraData?.[options.item.id]?.noteEditorID || extraData?.noteEditorID;
        if (ownedInstances.has(id)) options.onSavedHTML(options.item.getNote());
      },
    },
    ["item"],
    "knowledge-base-editor",
  );
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
      options.onChange(html);
    }
  };
  const input = () => {
    queueMicrotask(changed);
  };
  const keydown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
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
    removeMarkdownMenu();
    if (!frame) return;
    frame.document.removeEventListener("input", input, true);
    frame.document.removeEventListener("keydown", keydown, true);
    frame.document.removeEventListener("keydown", stopEscape);
    frame.removeEventListener("message", message, true);
  };
  const attach = () => {
    ownedInstances.add(element.getCurrentInstance().instanceID);
    frame = element.getCurrentInstance()._iframeWindow;
    const style = frame.document.createElement("style");
    style.dataset.knowledgeBase = "paper";
    style.textContent = `
      :root { color-scheme: light; --color-background: #fff; --color-toolbar: #f7f8fa; --color-control: #fff; --color-button: #fff; --color-border: #dfe3e9; --fill-primary: #252a34; --fill-secondary: #717886; --fill-tertiary: #9aa2ad; --fill-quarternary: #e6e9ee; }
      body { background: #fff; }
      .primary-editor { color: #252a34; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.65; max-width: 820px; margin: 0 auto; padding: 28px 36px 48px; box-sizing: border-box; }
      .primary-editor h1 { font-size: 27px; line-height: 1.3; margin: 0 0 24px; }
      .primary-editor h2 { font-size: 20px; line-height: 1.4; }
      .primary-editor h3 { font-size: 17px; }
    `;
    frame.document.querySelector("style[data-knowledge-base]")?.remove();
    frame.document.head.appendChild(style);
    if (!readOnly)
      removeMarkdownMenu = attachMarkdownMenu(
        frame,
        options.markdownLabel,
        options.onMarkdown,
      );
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
      await element.getCurrentInstance()._save(getData());
    }
  };
  return {
    getHTML: () => getData()?.html || lastHTML,
    getSavedHTML: () => options.item.getNote(),
    flush,
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
      detach();
      Zotero.Notifier.unregisterObserver(observerID);
      element.destroy();
    },
  };
}
window.KnowledgeBaseNativeEditor = { create };
