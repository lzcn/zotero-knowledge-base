import { getString } from "../utils/locale";

/** Keep native controls and their handlers in place, disclosing tools only on overflow. */
export function attachReaderToolbarLayout(doc: Document): () => void {
  const toolbar = doc.querySelector<HTMLElement>(".toolbar");
  const start = toolbar?.querySelector<HTMLElement>(":scope > .start");
  const center = toolbar?.querySelector<HTMLElement>(":scope > .center");
  const end = toolbar?.querySelector<HTMLElement>(":scope > .end");
  if (!toolbar || !start || !center || !end) return () => {};
  const win = doc.defaultView!;
  const more = doc.createElement("button");
  more.id = "knowledge-base-reader-more";
  more.className = "toolbar-button";
  more.type = "button";
  more.title = getString("reader-more-tools");
  more.setAttribute("aria-label", more.title);
  more.setAttribute("aria-expanded", "false");
  const endID = end.id;
  if (!endID) end.id = "knowledge-base-reader-tools";
  more.setAttribute("aria-controls", end.id);
  more.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>';
  const style = doc.createElement("style");
  style.id = "knowledge-base-reader-layout";
  style.textContent = `
    .toolbar .toolbar-button, .toolbar .custom-sections > .section { flex-shrink: 0; }
    .toolbar > .start, .toolbar > .center, .toolbar > .end { flex-shrink: 0; }
    .toolbar #numPages div { position: static; white-space: nowrap; }
    .toolbar > #knowledge-base-reader-more { display: none; align-self: center; flex: 0 0 28px; }
    .toolbar.knowledge-base-compact {
      display: grid; grid-template-columns: minmax(0, 1fr) 28px;
      grid-template-rows: 40px min-content min-content; column-gap: 8px;
    }
    .toolbar.knowledge-base-compact > .start {
      grid-column: 1; grid-row: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin;
    }
    .toolbar.knowledge-base-compact > .start > * { flex-shrink: 0; }
    .toolbar.knowledge-base-compact > #knowledge-base-reader-more {
      grid-column: 2; grid-row: 1; display: flex;
    }
    .toolbar.knowledge-base-compact > .center,
    .toolbar.knowledge-base-compact > .end {
      display: none; grid-column: 1 / -1; padding: 8px; gap: 8px;
      flex-wrap: wrap; justify-content: flex-start;
      background: var(--material-toolbar); border: var(--material-panedivider);
    }
    .toolbar.knowledge-base-compact > .center { grid-row: 2; border-bottom: 0; border-radius: 6px 6px 0 0; }
    .toolbar.knowledge-base-compact > .end { grid-row: 3; border-top: 0; border-radius: 0 0 6px 6px; box-shadow: 0 4px 8px #0002; }
    .toolbar.knowledge-base-tools-open > .center,
    .toolbar.knowledge-base-tools-open > .end { display: flex; }
    .toolbar.knowledge-base-compact .custom-sections,
    .toolbar.knowledge-base-compact .custom-sections > .section {
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
    }
  `;
  doc.head.append(style);
  toolbar.append(more);
  let disposed = false;
  let pending = 0;
  const close = () => {
    toolbar.classList.remove("knowledge-base-tools-open");
    more.setAttribute("aria-expanded", "false");
  };
  const update = () => {
    pending = 0;
    if (disposed) return;
    // Measure the actual native/plugin controls, not an assumed button count.
    const open = toolbar.classList.contains("knowledge-base-tools-open");
    toolbar.classList.remove(
      "knowledge-base-compact",
      "knowledge-base-tools-open",
    );
    const needed =
      start.scrollWidth + center.scrollWidth + end.scrollWidth + 28;
    const compact = needed > toolbar.clientWidth;
    toolbar.classList.toggle("knowledge-base-compact", compact);
    toolbar.classList.toggle("knowledge-base-tools-open", compact && open);
    more.setAttribute("aria-expanded", String(compact && open));
  };
  const schedule = () => {
    if (!pending && !disposed) pending = win.requestAnimationFrame(update);
  };
  const toggle = () => {
    const open = toolbar.classList.toggle("knowledge-base-tools-open");
    more.setAttribute("aria-expanded", String(open));
  };
  const outside = (event: Event) => {
    if (!toolbar.contains(event.target as Node)) close();
  };
  const action = (event: Event) => {
    if ((event.target as Element).closest?.("#knowledge-base-reader-button"))
      close();
  };
  const key = (event: KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      more.getAttribute("aria-expanded") === "true"
    ) {
      close();
      more.focus();
      event.preventDefault();
    }
  };
  const resize = new (Zotero.getMainWindow().ResizeObserver)(schedule);
  resize.observe(toolbar);
  const mutations = new (Zotero.getMainWindow().MutationObserver)(schedule);
  mutations.observe(toolbar, { childList: true, subtree: true });
  more.addEventListener("click", toggle);
  toolbar.addEventListener("click", action);
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", key);
  win.addEventListener("blur", close);
  schedule();
  return () => {
    disposed = true;
    win.cancelAnimationFrame(pending);
    resize.disconnect();
    mutations.disconnect();
    more.removeEventListener("click", toggle);
    toolbar.removeEventListener("click", action);
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", key);
    win.removeEventListener("blur", close);
    close();
    toolbar.classList.remove("knowledge-base-compact");
    if (!endID) end.removeAttribute("id");
    more.remove();
    style.remove();
  };
}
