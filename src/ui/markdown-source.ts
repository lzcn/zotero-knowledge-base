import { EditorState, Transaction, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { configureNodeLabels, zNodeField } from "./markdown-nodes";

/** The source surface keeps the existing editor's selection and insertion contract. */
export interface MarkdownSource extends HTMLElement {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  readOnly: boolean;
  disabled: boolean;
  spellcheck: boolean;
  placeholder: string;
  setSelectionRange(start: number, end: number): void;
  setRangeText(text: string, start?: number, end?: number, mode?: string): void;
  destroy(): void;
}

async function create(
  textarea: HTMLTextAreaElement,
  labels: Record<string, string> = {},
): Promise<MarkdownSource> {
  configureNodeLabels(labels);
  const root = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as unknown as MarkdownSource;
  root.id = textarea.id;
  root.className = textarea.className + " knowledge-base-markdown-source";
  root.style.cssText = textarea.style.cssText;
  root.hidden = textarea.hidden;
  root.setAttribute("aria-label", textarea.getAttribute("aria-label") || "");
  textarea.replaceWith(root);
  if (document.contentType !== "text/html") {
    const frame = document.createXULElement(
      "iframe",
    ) as unknown as HTMLIFrameElement;
    frame.setAttribute("type", "content");
    frame.style.cssText =
      "width: 100%; height: 100%; border: 0; display: block;";
    frame.setAttribute(
      "src",
      "chrome://knowledge-base/content/markdown-source.html",
    );
    const ready = new Promise<void>((resolve) =>
      frame.addEventListener("DOMContentLoaded", () => resolve(), {
        once: true,
      }),
    );
    const hidden = root.hidden;
    root.hidden = false;
    root.append(frame);
    await ready;
    root.hidden = hidden;
    return frame.contentWindow!.KnowledgeBaseMarkdownSource.mount(
      root,
      textarea,
      labels,
    );
  }
  return mount(root, textarea, labels);
}

function mount(
  root: MarkdownSource,
  textarea: HTMLTextAreaElement,
  labels: Record<string, string>,
): MarkdownSource {
  configureNodeLabels(labels);
  let destroyed = false;
  let writing = false;
  let readOnly = textarea.readOnly;
  let disabled = textarea.disabled;
  const editable = new Compartment();
  // Firefox XUL documents have no Selection. The HTML frame owns native
  // caret, composition and input; the outer surface keeps the editor contract.
  const view = new EditorView({
    parent: root.ownerDocument !== document ? document.body : root,
    root: document,
    state: EditorState.create({
      doc: textarea.value,
      extensions: [
        EditorView.contentAttributes.of({
          "aria-label": textarea.getAttribute("aria-label") || "",
          spellcheck: "false",
        }),
        history(),
        markdown(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        zNodeField,
        editable.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !writing)
            root.dispatchEvent(new Event("input", { bubbles: true }));
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            color: "inherit",
            backgroundColor: "inherit",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: "16px",
            lineHeight: "1.7",
            letterSpacing: "normal",
          },
          ".cm-content": {
            maxWidth: "820px",
            width: "100%",
            margin: "0 auto",
            padding: "28px 36px 48px",
            boxSizing: "border-box",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-line": { padding: "0" },
          ".cm-cursor": { borderLeftColor: "currentColor" },
          ".knowledge-base-md-node": {
            display: "inline-block",
            maxWidth: "100%",
            borderRadius: "4px",
            padding: "0 5px",
            color: "var(--fill-secondary, #576170)",
            backgroundColor: "var(--fill-quarternary, #edf0f4)",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            cursor: "default",
          },
        }),
      ],
    }),
  });
  // CodeMirror owns DOM input; publish one document change through the surface.
  view.dom.addEventListener("input", (event) => event.stopPropagation());
  const write = (action: () => void) => {
    writing = true;
    try {
      action();
    } finally {
      writing = false;
    }
  };
  const position = (n: number) =>
    Math.max(0, Math.min(n, view.state.doc.length));
  const changeEditable = () =>
    view.dispatch({
      effects: editable.reconfigure([
        EditorState.readOnly.of(readOnly || disabled),
        EditorView.editable.of(!readOnly && !disabled),
      ]),
    });
  Object.defineProperties(root, {
    value: {
      get: () => view.state.doc.toString(),
      set: (value: string) => {
        if (value === root.value) return;
        write(() =>
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
            annotations: Transaction.addToHistory.of(false),
          }),
        );
      },
    },
    selectionStart: {
      get: () => view.state.selection.main.from,
      set: (value: number) =>
        root.setSelectionRange(value, Math.max(value, root.selectionEnd)),
    },
    selectionEnd: {
      get: () => view.state.selection.main.to,
      set: (value: number) =>
        root.setSelectionRange(Math.min(root.selectionStart, value), value),
    },
    readOnly: {
      get: () => readOnly,
      set: (value: boolean) => {
        readOnly = value;
        changeEditable();
      },
    },
    disabled: {
      get: () => disabled,
      set: (value: boolean) => {
        disabled = value;
        changeEditable();
      },
    },
    scrollTop: {
      get: () => view.scrollDOM.scrollTop,
      set: (value: number) => {
        view.scrollDOM.scrollTop = value;
      },
    },
  });
  root.setSelectionRange = (start, end) =>
    view.dispatch({
      selection: { anchor: position(start), head: position(end) },
    });
  root.setRangeText = (
    text,
    start = root.selectionStart,
    end = root.selectionEnd,
    mode = "preserve",
  ) =>
    write(() => {
      start = position(start);
      end = Math.max(start, position(end));
      const after = start + text.length;
      view.dispatch({
        changes: { from: start, to: end, insert: text },
        selection: {
          anchor: mode === "select" || mode === "start" ? start : after,
          head: mode === "start" ? start : after,
        },
      });
    });
  let detachEvents = () => {};
  if (root.ownerDocument !== document) {
    const relay = (event: Event) => {
      let forwarded: Event;
      if (event instanceof KeyboardEvent)
        forwarded = new KeyboardEvent(event.type, event);
      else if (event instanceof ClipboardEvent)
        forwarded = new ClipboardEvent(event.type, {
          bubbles: true,
          cancelable: true,
          clipboardData: event.clipboardData,
        });
      else if (event instanceof DragEvent)
        forwarded = new DragEvent(event.type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: event.dataTransfer,
        });
      else return;
      if (!root.dispatchEvent(forwarded)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const types = ["keydown", "paste", "dragover", "drop"];
    for (const type of types) document.addEventListener(type, relay, true);
    detachEvents = () => {
      for (const type of types) document.removeEventListener(type, relay, true);
    };
  }
  root.focus = () => {
    window.focus();
    view.focus();
  };
  root.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    detachEvents();
    view.destroy();
  };
  return root;
}

window.KnowledgeBaseMarkdownSource = { create, mount };
