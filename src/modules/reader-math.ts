import { renderPreviewMath } from "./note-preview";

/** Decorate a separate preview so native annotation editing never sees MathML. */
export function attachReaderMath(doc: Document): () => void {
  const win = doc.defaultView! as Window & typeof globalThis;
  const preference = "extensions.zotero.knowledge-base.mathPreview";
  const selector = ".annotation-popup .comment .editor > .content";
  const previews = new Map<
    HTMLElement,
    { preview: HTMLElement; html: string }
  >();
  const style = doc.createElement("style");
  style.textContent = `
    .knowledge-base-math-preview > .content:not(.knowledge-base-annotation-preview) { display: none; }
    .knowledge-base-annotation-preview { overflow-wrap: anywhere; }
    .knowledge-base-annotation-preview math { max-width: 100%; }
  `;
  doc.head.append(style);
  let disposed = false;
  let pending = false;
  const remove = (source: HTMLElement) => {
    previews.get(source)?.preview.remove();
    source.parentElement?.classList.remove("knowledge-base-math-preview");
    previews.delete(source);
  };
  const render = () => {
    const enabled = Zotero.Prefs.get(preference, true) !== false;
    for (const [source, { preview, html }] of previews) {
      if (
        !enabled ||
        !source.isConnected ||
        !preview.isConnected ||
        !source.matches(selector) ||
        source.innerHTML !== html ||
        source.contains(doc.activeElement)
      )
        remove(source);
    }
    if (!enabled) return;
    for (const source of Array.from(
      doc.querySelectorAll(selector),
    ) as HTMLElement[]) {
      if (
        source.classList.contains("knowledge-base-annotation-preview") ||
        previews.has(source) ||
        source.contains(doc.activeElement)
      )
        continue;
      const preview = source.cloneNode(true) as HTMLElement;
      for (const element of [
        preview,
        ...(Array.from(preview.querySelectorAll("*")) as Element[]),
      ]) {
        for (const attribute of [
          "id",
          "contenteditable",
          "tabindex",
          "data-tabstop",
        ])
          element.removeAttribute(attribute);
      }
      preview.classList.add("knowledge-base-annotation-preview");
      preview.setAttribute("aria-readonly", "true");
      const walker = doc.createTreeWalker(preview, win.NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.parentElement?.closest("code, pre, math"))
          textNodes.push(node);
      }
      let rendered = false;
      for (const node of textNodes) {
        const span = doc.createElement("span");
        span.textContent = node.textContent;
        if (renderPreviewMath(span)) {
          node.replaceWith(span);
          rendered = true;
        }
      }
      if (!rendered) continue;
      if (source.getAttribute("contenteditable") === "true") {
        const edit = () => {
          source.parentElement?.classList.remove("knowledge-base-math-preview");
          source.focus();
          remove(source);
        };
        preview.tabIndex = -1;
        preview.setAttribute("data-tabstop", "1");
        // The reader cancels pointerdown on non-editable content, suppressing mousedown.
        preview.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          edit();
        });
        preview.addEventListener("focusin", (event) => {
          // Removing the preview must not let its stale focus event deselect the annotation.
          event.stopPropagation();
          edit();
        });
      }
      previews.set(source, { preview, html: source.innerHTML });
      source.after(preview);
      source.parentElement!.classList.add("knowledge-base-math-preview");
    }
  };
  const schedule = () => {
    if (pending || disposed) return;
    pending = true;
    void Promise.resolve()
      .then(() => {
        pending = false;
        if (!disposed) render();
      })
      .catch(Zotero.logError);
  };
  const observer = new (Zotero.getMainWindow().MutationObserver)(schedule);
  observer.observe(doc, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  doc.addEventListener("focusin", schedule);
  doc.addEventListener("focusout", schedule);
  const preferenceObserver = Zotero.Prefs.registerObserver(
    preference,
    schedule,
    true,
  );
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    doc.removeEventListener("focusin", schedule);
    doc.removeEventListener("focusout", schedule);
    Zotero.Prefs.unregisterObserver(preferenceObserver);
    for (const source of previews.keys()) remove(source);
    style.remove();
  };
}
