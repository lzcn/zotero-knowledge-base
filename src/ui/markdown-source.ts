import { EditorState, Transaction, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { configureNodeLabels, zNodeField } from "./markdown-nodes";
import { markdownMath } from "./markdown-math";
import { tags } from "@lezer/highlight";

// Markdown punctuation is syntax, not an error. Keep prose/math in the host text color.
const sourceHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "bold", fontSize: "1.2em" },
  { tag: tags.heading2, fontWeight: "bold", fontSize: "1.1em" },
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, textDecoration: "underline" },
]);

/** The source surface keeps the existing editor's selection and insertion contract. */
export interface MarkdownSource extends HTMLElement {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  readonly isComposing: boolean;
  readOnly: boolean;
  disabled: boolean;
  spellcheck: boolean;
  placeholder: string;
  setSelectionRange(start: number, end: number): void;
  setRangeText(text: string, start?: number, end?: number, mode?: string): void;
  setTypography(properties: Record<string, string>): void;
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
        markdown({ extensions: [markdownMath] }),
        EditorView.lineWrapping,
        syntaxHighlighting(sourceHighlightStyle),
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
            color: "var(--knowledge-base-color, inherit)",
            backgroundColor: "var(--knowledge-base-background, inherit)",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily:
              'var(--knowledge-base-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
            fontSize: "var(--knowledge-base-font-size, 16px)",
            lineHeight: "var(--knowledge-base-line-height, 1.7)",
            letterSpacing: "var(--knowledge-base-letter-spacing, normal)",
            fontVariantLigatures: "none",
          },
          ".cm-content": {
            maxWidth: "var(--knowledge-base-max-width, calc(70ch + 60px))",
            width: "100%",
            margin: "0 auto",
            padding:
              "var(--knowledge-base-padding-block, 20px) var(--knowledge-base-padding-inline, 30px) max(var(--knowledge-base-padding-block, 20px), 50vh)",
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
  let composing = false;
  view.dom.addEventListener(
    "compositionstart",
    () => {
      composing = true;
      root.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    },
    true,
  );
  view.dom.addEventListener(
    "compositionend",
    () => {
      composing = false;
      window.setTimeout(() => {
        if (!destroyed)
          root.dispatchEvent(new Event("compositionend", { bubbles: true }));
      }, 0);
    },
    true,
  );
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
    isComposing: { get: () => composing || view.composing },
    value: {
      get: () => view.state.doc.toString(),
      set: (value: string) => {
        if (value === root.value) return;
        // Rebase just the changed span, as Better Notes does, so saves and external
        // updates map the existing cursor instead of replacing the whole document.
        const previous = root.value;
        let from = 0,
          oldEnd = previous.length,
          newEnd = value.length;
        while (
          from < Math.min(oldEnd, newEnd) &&
          previous[from] === value[from]
        )
          from++;
        while (
          oldEnd > from &&
          newEnd > from &&
          previous[oldEnd - 1] === value[newEnd - 1]
        ) {
          oldEnd--;
          newEnd--;
        }
        const changes = view.state.changes({
          from,
          to: oldEnd,
          insert: value.slice(from, newEnd),
        });
        write(() =>
          view.dispatch({
            changes,
            effects: view.scrollSnapshot().map(changes),
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
  root.setTypography = (properties) => {
    for (const [name, value] of Object.entries(properties))
      if (value) view.dom.style.setProperty(`--knowledge-base-${name}`, value);
    view.requestMeasure();
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
