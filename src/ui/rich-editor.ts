import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Mathematics from "@tiptap/extension-mathematics";

export interface RichEditorOptions {
  html: string;
  onChange(html: string): void;
  onImages(files: File[]): Promise<string>;
  onShortcut(key: string): void;
  onError(message: string): void;
}
export interface RichEditorController {
  setHTML(html: string): void;
  getHTML(): string;
  insertHTML(html: string): void;
  format(kind: string): void;
  focus(): void;
  destroy(): void;
}

function prepareHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const input of Array.from(
    doc.querySelectorAll('li > input[type="checkbox"]'),
  ) as HTMLInputElement[]) {
    const item = input.parentElement!;
    item.dataset.type = "taskItem";
    item.dataset.checked = String(
      input.checked || input.hasAttribute("checked"),
    );
    item.parentElement!.dataset.type = "taskList";
    input.remove();
    const content = doc.createElement("div");
    content.append(...(Array.from(item.childNodes) as Node[]));
    item.appendChild(content);
  }
  return doc.body.innerHTML;
}

// Normalize the library's presentation wrappers for the existing GFM serializer.
function markdownHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const group of Array.from(
    doc.querySelectorAll("colgroup"),
  ) as HTMLElement[])
    group.remove();
  for (const item of Array.from(
    doc.querySelectorAll('li[data-type="taskItem"]'),
  ) as HTMLElement[]) {
    item.querySelector("label")?.remove();
    const checkbox = doc.createElement("input") as HTMLInputElement;
    checkbox.type = "checkbox";
    if (item.dataset.checked === "true")
      checkbox.setAttribute("checked", "checked");
    item.prepend(checkbox);
  }
  for (const cell of Array.from(
    doc.querySelectorAll("th, td"),
  ) as HTMLElement[]) {
    for (const paragraph of Array.from(
      cell.querySelectorAll(":scope > p"),
    ) as HTMLElement[]) {
      if (paragraph.previousSibling) paragraph.before(doc.createElement("br"));
      paragraph.replaceWith(...(Array.from(paragraph.childNodes) as Node[]));
    }
  }
  return doc.body.innerHTML;
}

export function createRichEditor(
  element: HTMLElement,
  options: RichEditorOptions,
): RichEditorController {
  let disposed = false;
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, protocols: ["knowledge-base", "zotero"] },
      }),
      Image.configure({ inline: true }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Mathematics.configure({
        inlineOptions: {
          onClick: (node, pos) => {
            const latex = window.prompt("LaTeX", node.attrs.latex);
            if (latex !== null)
              editor.commands.updateInlineMath({ latex, pos });
          },
        },
        blockOptions: {
          onClick: (node, pos) => {
            const latex = window.prompt("LaTeX", node.attrs.latex);
            if (latex !== null) editor.commands.updateBlockMath({ latex, pos });
          },
        },
        katexOptions: { throwOnError: false, trust: false, maxExpand: 1000 },
      }),
    ],
    content: prepareHTML(options.html),
    onUpdate: ({ editor }) => options.onChange(markdownHTML(editor.getHTML())),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          ["s", "k", "w"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          options.onShortcut(event.key.toLowerCase());
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        void options
          .onImages(files)
          .then((html) => {
            if (!disposed) editor.commands.insertContent(prepareHTML(html));
          })
          .catch((error) => {
            if (!disposed) options.onError(String(error));
          });
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        void options
          .onImages(files)
          .then((html) => {
            if (!disposed) editor.commands.insertContent(prepareHTML(html));
          })
          .catch((error) => {
            if (!disposed) options.onError(String(error));
          });
        return true;
      },
    },
  });
  return {
    setHTML: (html) => {
      editor.commands.setContent(prepareHTML(html), { emitUpdate: false });
      editor.commands.setTextSelection(editor.state.doc.content.size);
    },
    getHTML: () => markdownHTML(editor.getHTML()),
    insertHTML: (html) => {
      editor.commands.insertContent(prepareHTML(html));
    },
    format(kind) {
      const chain = editor.chain().focus();
      switch (kind) {
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "strike":
          chain.toggleStrike().run();
          break;
        case "code":
          chain.toggleCode().run();
          break;
        case "heading":
          chain.toggleHeading({ level: 2 }).run();
          break;
        case "quote":
          chain.toggleBlockquote().run();
          break;
        case "bullet":
          chain.toggleBulletList().run();
          break;
        case "task":
          chain.toggleTaskList().run();
          break;
        case "codeblock":
          chain.toggleCodeBlock().run();
          break;
        case "table":
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
      }
    },
    focus: () => {
      editor.commands.focus();
    },
    destroy: () => {
      disposed = true;
      editor.destroy();
    },
  };
}

window.KnowledgeBaseRichEditor = {
  create: (options) =>
    createRichEditor(document.getElementById("editor")!, options),
};
