import { config } from "../../package.json";
import { getString } from "../utils/locale";

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
type ClipReader = Omit<
  _ZoteroTypes.ReaderInstance,
  "_window" | "_internalReader"
> & {
  _window: Window;
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

function attach(reader: ClipReader, doc: Document): void {
  if (!registered || reader.type !== "pdf") return;
  controls.get(doc)?.();
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
  const start = async () => {
    if (disposed || busy) return;
    if (cancel) {
      cancel();
      return;
    }
    await reader._initPromise;
    if (disposed || busy || cancel) return;
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
      cancel = undefined;
    };
    for (const [view, original] of originals) {
      view._onAddAnnotation = Components.utils.exportFunction(
        (annotation: Annotation, select?: boolean) => {
          if (annotation.type !== "image")
            return original.call(view, annotation, select);
          cancel?.();
          busy = true;
          const current = () => !disposed && version === operation;
          void (async () => {
            const image =
              await view._pdfRenderer._renderAnnotationImage(annotation);
            if (!current()) return;
            if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image))
              throw new Error(getString("clip-unavailable"));
            if (!reader.itemID) throw new Error(getString("clip-unavailable"));
            const attachment = await Zotero.Items.getAsync(reader.itemID);
            if (!current()) return;
            if (!attachment) throw new Error(getString("clip-unavailable"));
            const img = doc.createElement("img");
            img.src = image;
            img.setAttribute(
              "data-annotation",
              encodeURIComponent(
                JSON.stringify({
                  attachmentURI: Zotero.URI.getItemURI(attachment),
                  position: annotation.position,
                  pageLabel: annotation.pageLabel,
                }),
              ),
            );
            const rect = annotation.position.rects[0];
            if (rect)
              img.width = Math.max(1, Math.round(Math.abs(rect[2] - rect[0])));
            const clipped = {
              ...JSON.parse(JSON.stringify(annotation)),
              image,
              attachmentItemID: reader.itemID,
            };
            delete clipped.id;
            const bytes = Uint8Array.from(
              doc.defaultView!.atob(image.split(",")[1]),
              (char) => char.charCodeAt(0),
            );
            const nativeImage = Components.classes["@mozilla.org/image/tools;1"]
              .getService(Components.interfaces.imgITools)
              .decodeImageFromArrayBuffer(bytes.buffer, "image/png");
            let copied = false;
            const copy = (event: ClipboardEvent) => {
              if (!event.clipboardData) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              event.clipboardData.setData(
                "text/html",
                `<p>${img.outerHTML}</p>`,
              );
              event.clipboardData.setData(
                "zotero/annotation",
                JSON.stringify([clipped]),
              );
              event.clipboardData.mozSetDataAt(
                "application/x-moz-nativeimage",
                nativeImage,
                0,
              );
              copied = true;
            };
            // A native copy event serializes custom flavors for subsequent paste events.
            const copyDoc = doc;
            const focused = copyDoc.activeElement as HTMLElement | null;
            const selection = copyDoc.createElement("textarea");
            selection.value = " ";
            selection.style.cssText = "position:fixed;left:-10000px;top:0";
            copyDoc.body.append(selection);
            copyDoc.defaultView!.addEventListener("copy", copy, true);
            try {
              copyDoc.defaultView!.focus();
              selection.focus({ preventScroll: true });
              selection.select();
              copyDoc.execCommand("copy");
            } finally {
              copyDoc.defaultView!.removeEventListener("copy", copy, true);
              selection.remove();
              focused?.focus({ preventScroll: true });
            }
            if (!copied) throw new Error(getString("clip-unavailable"));
          })()
            .catch((error) => {
              if (current()) fail(error);
            })
            .finally(() => {
              busy = false;
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
  };
  const click = () => {
    void start().catch(fail);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (cancel || busy)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      operation++;
      cancel?.();
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
    if (controls.get(doc) === dispose) controls.delete(doc);
  };
  doc.defaultView?.addEventListener("unload", dispose, { once: true });
  controls.set(doc, dispose);
}

function render(event: _ZoteroTypes.Reader.EventParams<"renderToolbar">): void {
  attach(event.reader as unknown as ClipReader, event.doc);
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
    if (doc) attach(reader as unknown as ClipReader, doc);
  }
}

export function unregisterReaderClipping(): void {
  registered = false;
  Zotero.Reader.unregisterEventListener("renderToolbar", render);
  for (const dispose of [...controls.values()]) dispose();
  restoreSerializer?.();
  restoreSerializer = undefined;
}
