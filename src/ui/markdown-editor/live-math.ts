import { InputRule, Node } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import katex from "katex";

function latexFromSource(source: string, block: boolean): string | null {
  const match = block
    ? /^ {0,3}\$\$\s*([\s\S]*?)\s*\$\$$/.exec(source)
    : /^\$(?!\$)([^\n]*?)\$$/.exec(source);
  return match?.[1] ?? null;
}

// The delimiters and LaTeX are ordinary document text. The preview is only a
// node view, so editing, composition and undo share the editor's transaction history.
function mathNode(block: boolean) {
  const kind = block ? "block-math" : "inline-math";
  return Node.create({
    name: block ? "blockMath" : "inlineMath",
    group: block ? "block" : "inline",
    inline: !block,
    content: "text*",
    marks: "",
    code: true,
    isolating: true,
    parseHTML() {
      return [
        {
          tag: `[data-type="${kind}"]`,
          preserveWhitespace: "full" as const,
          getContent(domNode, schema) {
            const element = domNode as HTMLElement;
            const source =
              element.getAttribute("data-math-source") ??
              element.querySelector(".math-source")?.textContent ??
              (block
                ? `$$\n${element.getAttribute("data-latex") || ""}\n$$`
                : `$${element.getAttribute("data-latex") || ""}$`);
            return source ? Fragment.from(schema.text(source)) : Fragment.empty;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return [
        block ? "div" : "span",
        {
          "data-type": kind,
          "data-math-source": node.textContent,
          "data-latex": latexFromSource(node.textContent, block) ?? "",
        },
        0,
      ];
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement(block ? "div" : "span");
        dom.className = `live-math ${kind}`;
        dom.dataset.type = kind;
        const preview = document.createElement("span");
        preview.className = "math-render";
        preview.contentEditable = "false";
        const contentDOM = document.createElement("span");
        contentDOM.className = "math-source";
        contentDOM.spellcheck = false;
        dom.append(preview, contentDOM);
        function render(source: string) {
          const latex = latexFromSource(source, block);
          if (latex === null) preview.textContent = source;
          else
            preview.innerHTML = katex.renderToString(latex, {
              displayMode: block,
              throwOnError: false,
              trust: false,
              maxExpand: 1000,
            });
        }
        render(node.textContent);
        preview.addEventListener("mousedown", (event) => {
          event.preventDefault();
          const pos = getPos();
          if (typeof pos === "number") {
            editor.commands.setTextSelection(pos + 1 + (block ? 3 : 1));
            editor.view.focus();
          }
        });
        return {
          dom,
          contentDOM,
          update(next) {
            if (next.type !== node.type) return false;
            node = next;
            render(node.textContent);
            return true;
          },
          ignoreMutation(mutation) {
            return (
              mutation.type !== "selection" &&
              !contentDOM.contains(mutation.target)
            );
          },
        };
      };
    },
    addInputRules() {
      return [
        new InputRule({
          find: block
            ? /^\$\$(?: |\n)$/
            : /(?<![\\$])\$(?!\$)([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$$/,
          handler: ({ state, range, match }) => {
            const source = block ? "$$\n\n$$" : match[0];
            const node = this.type.create(null, state.schema.text(source));
            const from = block
              ? state.doc.resolve(range.from).before()
              : range.from;
            const to = block ? state.doc.resolve(range.to).after() : range.to;
            state.tr.replaceWith(from, to, node);
            state.tr.setSelection(
              TextSelection.create(
                state.tr.doc,
                from + 1 + (block ? 3 : source.length),
              ),
            );
          },
        }),
      ];
    },
    addKeyboardShortcuts() {
      const exit = (direction: number) => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.parent.type !== this.type) return false;
        const pos = direction < 0 ? $from.before() : $from.after();
        const tr = state.tr;
        if (block && direction > 0 && pos === state.doc.content.size)
          tr.insert(pos, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos), direction));
        view.dispatch(tr);
        return true;
      };
      return {
        Escape: () => exit(1),
        "Mod-Enter": () => exit(1),
        Enter: () => {
          if (this.editor.state.selection.$from.parent.type !== this.type)
            return false;
          if (!block) return exit(1);
          this.editor.view.dispatch(this.editor.state.tr.insertText("\n"));
          return true;
        },
        ArrowRight: () => {
          const { $from, empty } = this.editor.state.selection;
          if (!empty) return false;
          if (
            $from.parent.type === this.type &&
            $from.parentOffset === $from.parent.content.size
          )
            return exit(1);
          if ($from.nodeAfter?.type === this.type)
            return this.editor.commands.setTextSelection($from.pos + 1);
          return false;
        },
        ArrowLeft: () => {
          const { $from, empty } = this.editor.state.selection;
          if (!empty) return false;
          if ($from.parent.type === this.type && $from.parentOffset === 0)
            return exit(-1);
          if ($from.nodeBefore?.type === this.type)
            return this.editor.commands.setTextSelection($from.pos - 1);
          return false;
        },
      };
    },
    addProseMirrorPlugins() {
      const type = this.type;
      return [
        new Plugin({
          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (
                  node.type === type &&
                  state.selection.from > pos &&
                  state.selection.to < pos + node.nodeSize
                )
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                      class: "math-editing",
                    }),
                  );
              });
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}

export const InlineMath = mathNode(false);
export const BlockMath = mathNode(true);
