import { EditorState, Transaction, Compartment } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
} from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { configureNodeLabels, zNodeField } from "./markdown-nodes";
import { markdownMath } from "./markdown-math";
import { tags } from "@lezer/highlight";
import type { MarkdownParser } from "@lezer/markdown";
import { markdownMathEdits, type TextRange } from "./text-format";

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
  normalizeMath(): number;
  openSearch(replace?: boolean): void;
  toggleSearch(): void;
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
        search({ top: true }),
        EditorState.phrases.of(labels),
        EditorView.contentAttributes.of({
          "aria-label": textarea.getAttribute("aria-label") || "",
          spellcheck: "false",
        }),
        history(),
        markdown({ extensions: [markdownMath] }),
        EditorView.lineWrapping,
        syntaxHighlighting(sourceHighlightStyle),
        keymap.of([
          {
            key: "Mod-h",
            mac: "Mod-Alt-f",
            run: () => {
              root.openSearch(true);
              return true;
            },
            scope: "editor search-panel",
          },
          {
            key: "Mod-f",
            run: () => {
              root.openSearch();
              return true;
            },
            scope: "editor search-panel",
          },
          ...searchKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
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
          ".cm-search": {
            fontFamily: "system-ui, sans-serif",
            fontSize: "13px",
            lineHeight: "1.5",
            whiteSpace: "normal",
          },
          ".cm-search button, .cm-search input": {
            font: "inherit",
            boxSizing: "border-box",
            maxWidth: "100%",
          },
          ".cm-search button, .cm-search input[type=text]": {
            minHeight: "26px",
            padding: "2px 6px",
          },
          ".cm-search label": {
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
          },
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
      // Keep note search ahead of the outer workbench's search/close shortcuts.
      if (
        event instanceof KeyboardEvent &&
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        (((event.metaKey || event.ctrlKey) &&
          (["f", "h"].includes(event.key.toLowerCase()) ||
            event.code === "KeyF")) ||
          (event.key === "Escape" && view.dom.querySelector(".cm-search"))) &&
        runScopeHandlers(view, event, "editor")
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
      else if (event instanceof MouseEvent)
        forwarded = new MouseEvent(event.type, event);
      else return;
      if (!root.dispatchEvent(forwarded)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const types = ["keydown", "paste", "dragover", "drop", "mousedown"];
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
  root.openSearch = (replace = false) => {
    if (destroyed) return;
    openSearchPanel(view);
    const panel = view.dom.querySelector<HTMLElement>(".cm-search");
    if (!panel || view.state.readOnly) return;
    let toggle = panel.querySelector<HTMLInputElement>(
      'input[name="showReplace"]',
    );
    if (!toggle) {
      toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.name = "showReplace";
      const label = document.createElement("label");
      label.append(toggle, view.state.phrase("Replace"));
      panel.insertBefore(label, panel.querySelector("br"));
      const checkbox = toggle;
      checkbox.addEventListener("change", () => {
        for (const control of Array.from(
          panel.querySelectorAll('br, [name="replace"], [name="replaceAll"]'),
        ) as HTMLElement[])
          control.hidden = !checkbox.checked;
        view.requestMeasure();
      });
    }
    toggle.checked = replace;
    toggle.dispatchEvent(new Event("change"));
  };
  root.toggleSearch = () => {
    if (!destroyed && !closeSearchPanel(view)) root.openSearch();
  };
  root.normalizeMath = () => {
    if (destroyed || readOnly || disabled || composing) return 0;
    const text = root.value,
      ranges: TextRange[] = [];
    // Parse the complete source so fenced/inline code and links remain literal.
    (markdownLanguage.parser as MarkdownParser)
      .configure([markdownMath])
      .parse(text)
      .iterate({
        enter(node) {
          if (
            [
              "FencedCode",
              "CodeBlock",
              "InlineCode",
              "Link",
              "LinkReference",
              "Image",
              "Autolink",
              "HTMLTag",
              "HTMLBlock",
              "CommentBlock",
              "ProcessingInstructionBlock",
              "BlockMath",
              "InlineMath",
            ].includes(node.name)
          ) {
            ranges.push({ from: node.from, to: node.to });
            return false;
          }
        },
      });
    const selection =
      root.selectionStart !== root.selectionEnd
        ? { from: root.selectionStart, to: root.selectionEnd }
        : undefined;
    const edits = markdownMathEdits(text, ranges, selection);
    if (!edits.length) return 0;
    const changes = view.state.changes(
      edits.map((edit) => ({
        from: edit.start,
        to: edit.end,
        insert: edit.replacement,
      })),
    );
    view.dispatch({
      changes,
      effects: view.scrollSnapshot().map(changes),
      annotations: [
        Transaction.userEvent.of("input.format"),
        isolateHistory.of("full"),
      ],
    });
    return edits.length;
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
