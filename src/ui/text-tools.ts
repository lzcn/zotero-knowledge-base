import { normalizeRichMath, type RichTextView } from "./text-format";
import { isAccelKey } from "./platform";
import type { MarkdownSource } from "./markdown-source";

type Localize = (key: string, args?: Record<string, string | number>) => string;
export function textToolLabels(loc: Localize) {
  const phrases = {
    Find: "find",
    Replace: "replace",
    next: "next",
    previous: "previous",
    all: "all",
    "match case": "case",
    regexp: "regexp",
    "by word": "word",
    replace: "replace",
    "replace all": "replace-all",
    close: "close",
    "Go to line": "line",
    go: "go",
    "current match": "current",
    "on line": "on-line",
    "replaced match on line $": "replaced-line",
    "replaced $ matches": "replaced-count",
  };
  return {
    normalize: loc("text-tools-normalize"),
    find: loc("text-tools-find"),
    unchanged: loc("text-tools-unchanged"),
    failed: loc("text-tools-failed"),
    done: (count: number) => loc("text-tools-done", { count }),
    phrases: Object.fromEntries(
      Object.entries(phrases).map(([phrase, key]) => [
        phrase,
        loc("text-search-" + key),
      ]),
    ),
  };
}

interface Options {
  labels: ReturnType<typeof textToolLabels>;
  source(): MarkdownSource | undefined;
  canEdit(): boolean;
  report(error: unknown): void;
}
interface EditorCore {
  view: RichTextView & { composing?: boolean };
  pluginState: { search: { openFindbar(): void } };
}
function editorCore(frame: Window): EditorCore | undefined {
  return (
    frame as Window & {
      wrappedJSObject: {
        _currentEditorInstance?: { _editorCore?: EditorCore };
      };
    }
  ).wrappedJSObject?._currentEditorInstance?._editorCore;
}

/** Direct toolbar actions; the editors retain their own search and undo history. */
export function attachTextTools(frame: Window, options: Options): () => void {
  const doc = frame.document,
    toolbar = doc.querySelector(".toolbar .start");
  if (!toolbar) return () => {};
  let disposed = false,
    findTimer = 0;
  let findObserver: MutationObserver | undefined;
  const stopFind = () => {
    frame.clearTimeout(findTimer);
    findObserver?.disconnect();
    findObserver = undefined;
  };
  const wrapper = doc.createElement("div");
  wrapper.className = "knowledge-base-text-tools";
  const button = (action: string, label: string, path: string) => {
    const button = doc.createElement("button");
    button.className = "toolbar-button knowledge-base-text-action";
    button.type = "button";
    button.dataset.textAction = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    wrapper.append(button);
    return button;
  };
  const normalize = button(
    "normalize",
    options.labels.normalize,
    '<path d="M3 6h12M9 6v13M6 19h6M16 11h5m-2.5-3v11m-2 0h4"/>',
  );
  const find = button(
    "find",
    options.labels.find,
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  );
  const findTitle =
    options.labels.find + (Zotero.isMac ? " (⌘⌥F)" : " (Ctrl+H)");
  find.title = findTitle;
  find.setAttribute(
    "aria-keyshortcuts",
    Zotero.isMac ? "Meta+Alt+f" : "Control+h",
  );
  const status = doc.createElement("span");
  status.className = "knowledge-base-text-status";
  status.setAttribute("role", "status");
  wrapper.append(status);
  const style = doc.createElement("style");
  style.textContent = [
    ".toolbar .knowledge-base-text-tools{display:inline-flex;flex:none;}",
    ".toolbar .knowledge-base-text-action{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:5px;margin:0;border-radius:5px;box-sizing:border-box;}",
    ".toolbar .knowledge-base-text-action svg{display:block;width:18px;height:18px;}",
    ".toolbar .knowledge-base-text-action[data-error]{color:var(--fill-error,#b63742);}",
    ".knowledge-base-text-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}",
    // The final direct button in Zotero's formatting group is its find action.
    ".toolbar .middle>.toolbar-button:last-child{display:none;}",
  ].join("\n");
  doc.head.append(style);
  const available = () =>
    !disposed &&
    options.canEdit() &&
    !options.source()?.isComposing &&
    !editorCore(frame)?.view.composing;
  const insert = () => {
    if (disposed) return;
    if (!toolbar.contains(wrapper)) toolbar.append(wrapper);
    normalize.disabled = find.disabled = !available();
  };
  const run = (button: HTMLButtonElement, action: () => void) => {
    if (!available()) return;
    button.removeAttribute("data-error");
    button.title = button === find ? findTitle : options.labels.normalize;
    status.textContent = "";
    try {
      action();
    } catch (error) {
      status.textContent = options.labels.failed;
      button.title = options.labels.failed;
      button.setAttribute("data-error", "true");
      options.report(error);
    }
  };
  const openSearch = () => {
    const source = options.source();
    if (source) {
      source.openSearch();
      return;
    }
    const core = editorCore(frame);
    if (!core?.pluginState.search)
      throw new Error("The note editor search is not ready.");
    stopFind();
    const revealReplace = () => {
      if (!available()) {
        stopFind();
        return;
      }
      const replace = doc.querySelector<HTMLInputElement>("#replace-checkbox");
      if (!replace) return;
      stopFind();
      if (!replace.checked) replace.click();
    };
    findObserver = new (frame as Window & typeof globalThis).MutationObserver(
      revealReplace,
    );
    findObserver.observe(doc.body, { childList: true, subtree: true });
    findTimer = frame.setTimeout(stopFind, 2000);
    core.pluginState.search.openFindbar();
    revealReplace();
  };
  normalize.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    run(normalize, () => {
      const source = options.source();
      const core = editorCore(frame);
      if (!source && !core?.view)
        throw new Error("The note editor is not ready.");
      const count = source
        ? source.normalizeMath()
        : normalizeRichMath(core!.view);
      const message = count
        ? options.labels.done(count)
        : options.labels.unchanged;
      status.textContent = message;
      normalize.title = options.labels.normalize + "\n" + message;
    });
  });
  find.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    run(find, openSearch);
  });
  const keydown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.shiftKey
    )
      return;
    const key = event.key.toLowerCase();
    const replace = Zotero.isMac
      ? event.metaKey &&
        !event.ctrlKey &&
        event.altKey &&
        (key === "f" || event.code === "KeyF")
      : event.ctrlKey && !event.metaKey && !event.altKey && key === "h";
    if (!replace && !(options.source() && isAccelKey(event) && key === "f"))
      return;
    if (!available()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    run(find, openSearch);
  };
  doc.addEventListener("keydown", keydown, true);
  const observer = new (frame as Window & typeof globalThis).MutationObserver(
    insert,
  );
  observer.observe(toolbar, { childList: true });
  observer.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  insert();
  return () => {
    disposed = true;
    observer.disconnect();
    stopFind();
    doc.removeEventListener("keydown", keydown, true);
    wrapper.remove();
    style.remove();
  };
}
