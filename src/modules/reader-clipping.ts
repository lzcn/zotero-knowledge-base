import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { nativeNoteEditorWindow } from "./native-note-view";

interface Annotation {
  type: string;
  color?: string;
  position: { pageIndex: number; rects: number[][] };
  [key: string]: unknown;
}
interface PDFView {
  initializedPromise: Promise<void>;
  _iframeWindow: Window;
  _onAddAnnotation(annotation: Annotation, select?: boolean): unknown;
  _pdfRenderer: {
    _renderAnnotationImage(annotation: Annotation): Promise<string>;
  };
}
interface NativeTarget {
  _item: Zotero.Item;
  _readOnly: boolean;
  insertAnnotations(annotations: unknown[]): Promise<void>;
}
interface NativeNote extends HTMLElement {
  item: Zotero.Item;
  getCurrentInstance(): NativeTarget;
}
type ClipReader = Omit<
  _ZoteroTypes.ReaderInstance,
  "_window" | "_internalReader"
> & {
  _window: Window & { ZoteroContextPane?: { activeEditor?: NativeNote } };
  _internalReader: {
    _primaryView: PDFView;
    _secondaryView?: PDFView;
    _state: { tool: { type: string } };
    setTool(tool: { type: string }): void;
  };
};
const controls = new Map<Document, () => void>();
let registered = false;
let restoreSerializer: (() => void) | undefined;

/** Keep source metadata on the image/highlight, without a repeated visible citation. */
export function withoutAnnotationCitations(
  html: string,
  doc: Document,
): string {
  const root = new doc.defaultView!.DOMParser().parseFromString(
    html,
    "text/html",
  ).body;
  for (const citation of Array.from(
    root.querySelectorAll(".citation[data-citation]"),
  ) as HTMLElement[]) {
    if (citation.previousSibling?.nodeName === "BR")
      citation.previousSibling.remove();
    citation.remove();
  }
  return root.innerHTML;
}

function attach(
  reader: ClipReader,
  doc: Document,
  append: (button: HTMLButtonElement) => void,
): void {
  if (!registered || reader.type !== "pdf") return;
  controls.get(doc)?.();
  const button = doc.createElement("button");
  button.id = "knowledge-base-clip-figure";
  button.className = "toolbar-button";
  button.type = "button";
  button.tabIndex = -1;
  button.title =
    getString("clip-figure") + (Zotero.isMac ? " (⌘⇧X)" : " (Ctrl+Shift+X)");
  button.setAttribute("aria-label", button.title);
  button.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M8 12h8m-4-4v8"/></svg>';
  append(button);
  let disposed = false;
  let busy = false;
  let cancel: (() => void) | undefined;
  let operation = 0;
  const keyWindows = new Set<Window>();
  const fail = (error: unknown) => {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    if (!disposed)
      Services.prompt.alert(
        reader._window as unknown as mozIDOMWindowProxy,
        getString("clip-figure"),
        String(error instanceof Error ? error.message : error),
      );
  };
  const active = () => reader._window.ZoteroContextPane?.activeEditor;
  const start = async () => {
    if (disposed || busy) return;
    if (cancel) {
      cancel();
      return;
    }
    await reader._initPromise;
    if (disposed) return;
    const target = active();
    const instance = target?.getCurrentInstance();
    if (
      !target ||
      !instance ||
      instance._readOnly ||
      !target.item?.isEditable()
    )
      throw new Error(getString("clip-note-required"));
    const noteID = target.item.id;
    const internal = reader._internalReader;
    const pdfViews = [internal._primaryView, internal._secondaryView].filter(
      (view): view is PDFView => !!view?._pdfRenderer,
    );
    if (!pdfViews.length) throw new Error(getString("clip-unavailable"));
    const version = ++operation;
    const previousTool = internal._state.tool.type;
    const originals = pdfViews.map(
      (view) => [view, view._onAddAnnotation] as const,
    );
    cancel = () => {
      for (const [view, original] of originals)
        view._onAddAnnotation = original;
      internal.setTool(
        Components.utils.cloneInto(
          { type: previousTool },
          reader._iframeWindow!,
        ),
      );
      button.removeAttribute("aria-pressed");
      cancel = undefined;
    };
    for (const [view, original] of originals) {
      view._onAddAnnotation = Components.utils.exportFunction(
        (annotation: Annotation, select?: boolean) => {
          if (annotation.type !== "image")
            return original.call(view, annotation, select);
          cancel?.();
          busy = true;
          button.disabled = true;
          const current = () =>
            !disposed &&
            version === operation &&
            active() === target &&
            target.item.id === noteID &&
            target.getCurrentInstance() === instance;
          void (async () => {
            const image =
              await view._pdfRenderer._renderAnnotationImage(annotation);
            if (!current()) throw new Error(getString("clip-note-changed"));
            if (!image) throw new Error(getString("clip-unavailable"));
            const clipped = {
              ...JSON.parse(JSON.stringify(annotation)),
              image,
              attachmentItemID: reader.itemID,
            };
            // No annotation item is ever created: the note stores the PDF position itself.
            delete clipped.id;
            const kb = nativeNoteEditorWindow(target);
            if (kb) await kb.knowledgeBaseInsertAnnotations?.([clipped]);
            else await instance.insertAnnotations([clipped]);
          })()
            .catch(fail)
            .finally(() => {
              busy = false;
              if (!disposed) button.disabled = false;
            });
          return undefined;
        },
        reader._iframeWindow!,
        { allowCrossOriginArguments: true },
      );
    }
    internal.setTool(
      Components.utils.cloneInto({ type: "image" }, reader._iframeWindow!),
    );
    button.setAttribute("aria-pressed", "true");
  };
  const click = () => {
    void start().catch(fail);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && cancel) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      return;
    }
    if (
      !(Zotero.isMac ? event.metaKey : event.ctrlKey) ||
      !event.shiftKey ||
      event.altKey ||
      event.key.toLowerCase() !== "x"
    )
      return;
    if (
      (event.target as Element)?.closest?.(
        "input, textarea, [contenteditable=true]",
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    click();
  };
  button.addEventListener("click", click);
  void reader._initPromise
    .then(async () => {
      await reader._internalReader._primaryView.initializedPromise;
      if (disposed) return;
      for (const win of [
        doc.defaultView,
        reader._internalReader._primaryView?._iframeWindow,
        reader._internalReader._secondaryView?._iframeWindow,
      ]) {
        if (win && !keyWindows.has(win)) {
          keyWindows.add(win);
          win.addEventListener("keydown", key, true);
        }
      }
    })
    .catch(fail);
  const dispose = () => {
    disposed = true;
    operation++;
    cancel?.();
    for (const win of keyWindows) win.removeEventListener("keydown", key, true);
    doc.defaultView?.removeEventListener("unload", dispose);
    button.removeEventListener("click", click);
    const parent = button.parentElement;
    button.remove();
    if (parent?.classList.contains("section") && !parent.childNodes.length)
      parent.remove();
    if (controls.get(doc) === dispose) controls.delete(doc);
  };
  doc.defaultView?.addEventListener("unload", dispose, { once: true });
  controls.set(doc, dispose);
}

function render(event: _ZoteroTypes.Reader.EventParams<"renderToolbar">): void {
  attach(event.reader as unknown as ClipReader, event.doc, event.append);
}

export function registerReaderClipping(): void {
  if (registered) return;
  registered = true;
  const utilities = Zotero.EditorInstanceUtilities;
  const serialize = utilities.serializeAnnotations;
  const wrapped: typeof serialize = function (...args) {
    const result = serialize.apply(utilities, args);
    result.html = withoutAnnotationCitations(
      result.html,
      Zotero.getMainWindow().document,
    );
    return result;
  };
  utilities.serializeAnnotations = wrapped;
  restoreSerializer = () => {
    if (utilities.serializeAnnotations === wrapped)
      utilities.serializeAnnotations = serialize;
  };
  Zotero.Reader.registerEventListener("renderToolbar", render, config.addonID);
  for (const reader of Zotero.Reader._readers) {
    const doc = reader._iframeWindow?.document;
    const target = doc?.querySelector(".toolbar .custom-sections");
    if (!doc || !target) continue;
    attach(reader as unknown as ClipReader, doc, (button) => {
      const section = doc.createElement("div");
      section.className = "section";
      section.append(button);
      target.append(section);
    });
  }
}

export function unregisterReaderClipping(): void {
  registered = false;
  Zotero.Reader.unregisterEventListener("renderToolbar", render);
  for (const dispose of [...controls.values()]) dispose();
  restoreSerializer?.();
  restoreSerializer = undefined;
}
