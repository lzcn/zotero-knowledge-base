/** Expose native popups above the sibling Markdown frame without blocking its body. */
function attachToolbarPopupLayer(frame: Window): () => void {
  const host = (
    frame as Window & { browsingContext?: { embedderElement: HTMLElement } }
  ).browsingContext?.embedderElement;
  const toolbar = frame.document.querySelector(".toolbar");
  if (!host || !toolbar) return () => {};
  const previous = {
    position: host.style.position,
    zIndex: host.style.zIndex,
    clipPath: host.style.clipPath,
  };
  let raised = false;
  let pending = 0;
  const restore = () => {
    if (!raised) return;
    Object.assign(host.style, previous);
    raised = false;
  };
  const update = () => {
    pending = 0;
    const body = frame.document.body;
    if (!body.classList.contains("knowledge-base-source-mode")) {
      restore();
      return;
    }
    const popups = (Array.from(toolbar.querySelectorAll(".popup")) as Element[])
      .map((popup) => popup.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (!popups.length) {
      restore();
      return;
    }
    const top = toolbar.getBoundingClientRect().bottom;
    const left = Math.max(0, Math.min(...popups.map((rect) => rect.left)));
    const right = Math.min(
      frame.innerWidth,
      Math.max(...popups.map((rect) => rect.right)),
    );
    const bottom = Math.min(
      frame.innerHeight,
      Math.max(...popups.map((rect) => rect.bottom)),
    );
    if (
      host.ownerDocument!.defaultView!.getComputedStyle(host)?.position ===
      "static"
    )
      host.style.position = "relative";
    host.style.zIndex = "3";
    // The native iframe is a separate paint surface. Clip its raised layer to the
    // toolbar and menu so the source remains visible and clickable elsewhere.
    host.style.clipPath = `polygon(0 0, 100% 0, 100% ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px, 0 ${top}px)`;
    raised = true;
  };
  const schedule = () => {
    if (!pending) pending = frame.requestAnimationFrame(update);
  };
  const onOutsideMouseDown = (event: MouseEvent) => {
    // The source frame relays mouse down to its outer host. Dismiss through
    // Zotero's existing blur handler without moving the Markdown caret.
    if (raised && !host.contains(event.target as Node))
      frame.dispatchEvent(
        new (frame as Window & typeof globalThis).Event("blur"),
      );
  };
  const Observer = (
    frame as Window & { MutationObserver: typeof MutationObserver }
  ).MutationObserver;
  const observer = new Observer(schedule);
  observer.observe(toolbar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  observer.observe(frame.document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  frame.addEventListener("resize", schedule);
  host.ownerDocument!.addEventListener("mousedown", onOutsideMouseDown, true);
  return () => {
    observer.disconnect();
    frame.cancelAnimationFrame(pending);
    frame.removeEventListener("resize", schedule);
    host.ownerDocument!.removeEventListener(
      "mousedown",
      onOutsideMouseDown,
      true,
    );
    restore();
  };
}

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
    .toolbar .start { width: auto; flex: 0 0 auto; }
    /* Keep the last line within reach without adding saved document nodes. */
    #editor-container .editor .editor-core .primary-editor {
      padding-block-end: max(var(--editor-padding-block, 20px), 50vh);
    }
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
    .knowledge-base-source-mode .toolbar .center { opacity: .5; pointer-events: none; }
  `;
  frame.document.head.append(style);
  const insert = () => {
    if (toolbar && !toolbar.contains(button)) toolbar.prepend(button);
  };
  const Observer = (
    frame as Window & { MutationObserver: typeof MutationObserver }
  ).MutationObserver;
  const observer = new Observer(insert);
  const removePopupLayer = attachToolbarPopupLayer(frame);
  if (toolbar) observer.observe(toolbar, { childList: true });
  insert();
  return Object.assign(
    () => {
      observer.disconnect();
      removePopupLayer();
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

/** Match the user's actual Zotero note font, zoom and comfortable/compact width. */
export function getNativeTypography(frame: Window): Record<string, string> {
  const primary = frame.document.querySelector(".primary-editor");
  if (!primary) return {};
  const style = frame.getComputedStyle(primary);
  const paragraph = primary.querySelector("p") || primary;
  const paragraphStyle = frame.getComputedStyle(paragraph);
  const parentStyle = frame.getComputedStyle(primary.parentElement!);
  if (!style || !paragraphStyle || !parentStyle) return {};
  return {
    "font-family": style.fontFamily,
    "font-size": style.fontSize,
    "line-height": paragraphStyle.lineHeight,
    "letter-spacing": style.letterSpacing,
    color: style.color,
    background: parentStyle.backgroundColor,
    "padding-inline": style.paddingInlineStart,
    "padding-block": style.paddingBlockStart,
    "max-width": style.maxWidth,
  };
}
