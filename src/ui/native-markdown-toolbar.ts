/** A persistent mode toggle at the left of Zotero's note toolbar. */
export function attachMarkdownToggle(
  frame: Window,
  label: string,
  onToggle: () => void,
): (() => void) & {
  setMode(source: boolean): void;
  setDisabled(value: boolean): void;
} {
  const toolbar = frame.document.querySelector(".toolbar .start");
  const button = frame.document.createElement("button");
  button.className = "toolbar-button knowledge-base-markdown-toggle";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");
  button.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17V7l4 5 4-5v10M16 7v10m-3-3 3 3 3-3"/></svg>';
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  const style = frame.document.createElement("style");
  style.textContent = `
    .toolbar .knowledge-base-markdown-toggle,
    .toolbar .knowledge-base-note-link {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; padding: 5px; margin: 0;
      box-sizing: border-box; border-radius: 5px; flex: 0 0 30px;
    }
    .toolbar .knowledge-base-markdown-toggle { margin-right: 8px; }
    .toolbar .knowledge-base-markdown-toggle svg,
    .toolbar .knowledge-base-note-link svg { display: block; width: 18px; height: 18px; }
    .toolbar .knowledge-base-markdown-toggle:hover,
    .toolbar .knowledge-base-note-link:hover { background: var(--fill-quarternary, #e6e9ee); }
    .toolbar .knowledge-base-markdown-toggle:focus-visible,
    .toolbar .knowledge-base-note-link:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    .knowledge-base-markdown-toggle.active { background: var(--fill-quarternary, #e6e9ee); border-radius: 4px; }
    .knowledge-base-source-mode .primary-editor { visibility: hidden; pointer-events: none; }
    .knowledge-base-source-mode .toolbar .middle,
    .knowledge-base-source-mode .toolbar .center { visibility: hidden; pointer-events: none; }
  `;
  frame.document.head.append(style);
  const insert = () => {
    if (toolbar && !toolbar.contains(button)) toolbar.prepend(button);
  };
  const Observer = (
    frame as Window & { MutationObserver: typeof MutationObserver }
  ).MutationObserver;
  const observer = new Observer(insert);
  if (toolbar) observer.observe(toolbar, { childList: true });
  insert();
  return Object.assign(
    () => {
      observer.disconnect();
      button.remove();
      style.remove();
      frame.document.body.classList.remove("knowledge-base-source-mode");
    },
    {
      setMode(source: boolean) {
        button.classList.toggle("active", source);
        button.setAttribute("aria-pressed", String(source));
        frame.document.body.classList.toggle(
          "knowledge-base-source-mode",
          source,
        );
      },
      setDisabled(value: boolean) {
        button.disabled = value;
      },
    },
  );
}
