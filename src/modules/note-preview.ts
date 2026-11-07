import katex from "katex";
import { mathSpans, type TextRange } from "../ui/text-format";

/** Keep literal code opaque even when the same formula also occurs in prose. */
export function previewCodeRanges(doc: Document, text: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (const code of Array.from(
    doc.querySelectorAll("code, pre:not(.math)"),
  ) as Element[]) {
    const block = code.closest("p,li,td,th,h1,h2,h3,h4,h5,h6,pre") || code;
    const start = (block.textContent || "").indexOf(text);
    if (start < 0) continue;
    const range = doc.createRange();
    range.selectNodeContents(block);
    if (block !== code) range.setEndBefore(code);
    const offset = block === code ? 0 : range.toString().length;
    const from = Math.max(0, offset - start);
    const to = Math.min(
      text.length,
      offset + (code.textContent?.length || 0) - start,
    );
    if (from < to) ranges.push({ from, to });
  }
  return ranges;
}

/** Native excerpts can end inside a formula; complete that formula for display. */
export function completePreviewMath(doc: Document, text: string): string {
  for (const block of Array.from(
    doc.querySelectorAll("p,li,td,th,h1,h2,h3,h4,h5,h6,pre"),
  ) as Element[]) {
    const full = (block.textContent || "").trim();
    if (full === text || !full.startsWith(text)) continue;
    const span = mathSpans(full, previewCodeRanges(doc, full), true).find(
      (span) => span.start < text.length && span.end > text.length,
    );
    if (span)
      return full.slice(0, span.end) + (span.end < full.length ? "…" : "");
  }
  return text;
}

/** Render native card text without changing the note or inserting authored HTML. */
export function renderPreviewMath(
  element: HTMLElement,
  ranges: TextRange[] = [],
  text = element.textContent || "",
): boolean {
  const spans = mathSpans(text, ranges, true);
  if (!spans.length) return false;
  const doc = element.ownerDocument;
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const span of spans) {
    fragment.append(doc.createTextNode(text.slice(cursor, span.start)));
    const math = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    math.className = "knowledge-base-note-math";
    math.innerHTML = katex.renderToString(span.latex, {
      output: "mathml",
      displayMode: false,
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
    });
    fragment.append(math);
    cursor = span.end;
  }
  fragment.append(doc.createTextNode(text.slice(cursor)));
  element.replaceChildren(fragment);
  return true;
}

/** Native note rows use textContent; decorate their visible excerpts after each render. */
export function attachNotePreviews(win: Window): () => void {
  const preference = "extensions.zotero.knowledge-base.mathPreview";
  const enabled = () => Zotero.Prefs.get(preference, true) !== false;
  const rendered = new Map<HTMLElement, { source: string; html: string }>();
  const queued = new Set<Element>();
  let disposed = false,
    pending = false;
  const render = (row: Element) => {
    const note = (
      row as Element & { note?: { id: number; parentItemType?: string } }
    ).note;
    if (!note) return;
    const fields = [
      row.querySelector<HTMLElement>(".note-content"),
      row.querySelector<HTMLElement>(
        note.parentItemType ? ".note-title" : ".parent-title",
      ),
    ];
    let sourceDoc: Document | undefined;
    for (const element of fields) {
      if (!element || rendered.get(element)?.html === element.innerHTML)
        continue;
      const source = element.textContent || "";
      if (!/\$|\\\(|\\\[/.test(source)) {
        rendered.delete(element);
        continue;
      }
      if (!sourceDoc) {
        const item = Zotero.Items.get(note.id);
        const html = item?.isNote() ? item.getNote() : "";
        sourceDoc = new (
          win as Window & typeof globalThis
        ).DOMParser().parseFromString(html, "text/html");
      }
      const complete = completePreviewMath(sourceDoc, source);
      if (
        renderPreviewMath(
          element,
          previewCodeRanges(sourceDoc, complete),
          complete,
        )
      )
        rendered.set(element, { source, html: element.innerHTML });
      else rendered.delete(element);
    }
  };
  const schedule = () => {
    if (pending || disposed) return;
    pending = true;
    void Promise.resolve()
      .then(() => {
        pending = false;
        if (disposed || !enabled()) return;
        for (const element of rendered.keys())
          if (!element.isConnected) rendered.delete(element);
        const rows = [...queued];
        queued.clear();
        for (const row of rows) if (row.isConnected) render(row);
      })
      .catch((error) => Zotero.logError(error));
  };
  const collect = (node: Node | null) => {
    if (!node) return;
    const element =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!element) return;
    const row = element.closest("note-row");
    if (row) queued.add(row);
    for (const child of Array.from(
      element.querySelectorAll("note-row"),
    ) as Element[])
      queued.add(child);
  };
  const observer = new (win as Window & typeof globalThis).MutationObserver(
    (records) => {
      for (const record of records) {
        collect(record.target);
        for (const node of record.addedNodes) collect(node);
      }
      if (queued.size) schedule();
    },
  );
  const restore = () => {
    for (const [element, previous] of rendered)
      if (element.innerHTML === previous.html)
        element.textContent = previous.source;
    rendered.clear();
  };
  const refresh = () => {
    observer.disconnect();
    queued.clear();
    if (!enabled()) {
      restore();
      return;
    }
    observer.observe(win.document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    collect(win.document.documentElement);
    schedule();
  };
  const preferenceObserver = Zotero.Prefs.registerObserver(
    preference,
    refresh,
    true,
  );
  refresh();
  return () => {
    disposed = true;
    observer.disconnect();
    queued.clear();
    Zotero.Prefs.unregisterObserver(preferenceObserver);
    restore();
  };
}
