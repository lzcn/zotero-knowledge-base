/** A read-only body in the existing note frame; its toolbar and writer stay intact. */
export function attachReadingView(
  frame: Window,
  label: string,
  onToggle: () => void,
  onOpenLink: (href: string) => void,
) {
  const doc = frame.document;
  const toolbar = doc.querySelector(".toolbar .start");
  const editor = doc.querySelector("#editor-container .editor");
  const primary = editor?.querySelector(".primary-editor");
  const button = doc.createElement("button");
  button.className = "toolbar-button knowledge-base-reading-toggle";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");
  button.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  const panel = doc.createElement("div");
  panel.className = "editor-core knowledge-base-reading-view";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", label);
  panel.tabIndex = 0;
  panel.hidden = true;
  editor?.append(panel);
  panel.addEventListener("click", (event) => {
    const link = (event.target as Element).closest("a[href]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenLink(link.getAttribute("href")!);
  });
  const style = doc.createElement("style");
  style.textContent = `
    #editor-container .editor .knowledge-base-reading-view {
      position: absolute; inset: var(--knowledge-base-reading-top, 40px) 0 0;
      z-index: 1; display: flex; user-select: text;
    }
    .knowledge-base-reading-view[hidden] { display: none !important; }
    #editor-container .editor .knowledge-base-reading-content {
      visibility: visible; pointer-events: auto; min-height: 100%;
    }
    .knowledge-base-reading-mode .editor-core:not(.knowledge-base-reading-view) .primary-editor {
      visibility: hidden; pointer-events: none;
    }
    .toolbar .knowledge-base-reading-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; padding: 5px; margin-right: 8px;
      box-sizing: border-box; border-radius: 5px; flex: 0 0 30px;
    }
    .knowledge-base-reading-toggle:hover, .knowledge-base-reading-toggle.active {
      background: var(--fill-quarternary, #e6e9ee);
    }
    .knowledge-base-reading-toggle:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    .knowledge-base-reading-mode .toolbar .middle,
    .knowledge-base-reading-mode .toolbar .center,
    .knowledge-base-reading-mode .knowledge-base-note-link {
      opacity: .5; pointer-events: none;
    }
    .knowledge-base-reading-content [data-type="block-math"] { display: block; }
    #editor-container .knowledge-base-reading-content img {
      max-width: 100%; width: auto; height: auto; object-fit: contain;
    }
  `;
  doc.head.append(style);
  const insert = () => {
    if (!toolbar || toolbar.contains(button)) return;
    const markdown = toolbar.querySelector(".knowledge-base-markdown-toggle");
    if (markdown) markdown.after(button);
    else toolbar.prepend(button);
  };
  const Observer = (
    frame as Window & { MutationObserver: typeof MutationObserver }
  ).MutationObserver;
  const toolbarObserver = new Observer(insert);
  if (toolbar) toolbarObserver.observe(toolbar, { childList: true });
  insert();
  let visible = false;
  let pending = 0;
  const render = (html?: string) => {
    const content =
      html === undefined && primary
        ? (primary.cloneNode(true) as HTMLElement)
        : doc.createElement("div");
    if (html !== undefined) content.innerHTML = html;
    content.classList.remove("ProseMirror", "ProseMirror-focused");
    content.classList.add("primary-editor", "knowledge-base-reading-content");
    for (const element of [
      content,
      ...(Array.from(
        content.querySelectorAll("[contenteditable], [id]"),
      ) as Element[]),
    ]) {
      element.removeAttribute("contenteditable");
      element.removeAttribute("id");
    }
    const scroll = panel.scrollTop;
    panel.replaceChildren(content);
    panel.scrollTop = scroll;
  };
  const documentObserver = new Observer(() => {
    if (pending) return;
    pending = frame.requestAnimationFrame(() => {
      pending = 0;
      if (visible) render();
    });
  });
  return {
    show(value: boolean, html?: string) {
      documentObserver.disconnect();
      frame.cancelAnimationFrame(pending);
      pending = 0;
      visible = value;
      panel.hidden = !value;
      button.classList.toggle("active", value);
      button.setAttribute("aria-pressed", String(value));
      doc.body.classList.toggle("knowledge-base-reading-mode", value);
      if (value) {
        const height =
          doc.querySelector(".toolbar")?.getBoundingClientRect().height || 40;
        panel.style.setProperty("--knowledge-base-reading-top", `${height}px`);
        render(html);
        if (html === undefined && primary)
          documentObserver.observe(primary, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
      }
    },
    focus() {
      panel.focus();
    },
    destroy() {
      toolbarObserver.disconnect();
      documentObserver.disconnect();
      frame.cancelAnimationFrame(pending);
      doc.body.classList.remove("knowledge-base-reading-mode");
      button.remove();
      panel.remove();
      style.remove();
    },
  };
}
