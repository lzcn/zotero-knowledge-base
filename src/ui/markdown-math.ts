import type { MarkdownConfig } from "@lezer/markdown";

/** Keep LaTeX opaque to Markdown headings, emphasis and link syntax. */
export const markdownMath: MarkdownConfig = {
  defineNodes: [{ name: "BlockMath", block: true }, "InlineMath"],
  parseBlock: [
    {
      name: "BlockMath",
      before: "SetextHeading",
      endLeaf: (_context, line) => line.text.slice(line.pos).startsWith("$$"),
      parse(context, line) {
        if (
          line.indent - line.baseIndent >= 4 ||
          !line.text.slice(line.pos).startsWith("$$")
        )
          return false;
        const from = context.lineStart + line.pos;
        let to = context.lineStart + line.text.length;
        if (/\$\$[ \t]*$/.test(line.text.slice(line.pos + 2))) {
          context.nextLine();
        } else {
          while (context.nextLine()) {
            to = context.lineStart + line.text.length;
            if (/\$\$[ \t]*$/.test(line.text)) {
              context.nextLine();
              break;
            }
          }
        }
        context.addElement(context.elt("BlockMath", from, to));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "Emphasis",
      parse(context, next, position) {
        if (next !== 36 || context.char(position + 1) === 36) return -1;
        const match = /^\$(?!\$)((?:\\.|[^$\\\n])+?)\$(?![\d$])/.exec(
          context.slice(position, context.end),
        );
        if (!match || /^\s|\s$/.test(match[1])) return -1;
        return context.addElement(
          context.elt("InlineMath", position, position + match[0].length),
        );
      },
    },
  ],
};
