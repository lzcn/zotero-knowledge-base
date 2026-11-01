export interface MathSpan {
  start: number;
  end: number;
  latex: string;
  display: boolean;
}
export interface TextRange {
  from: number;
  to: number;
}

function escaped(text: string, position: number): boolean {
  let count = 0;
  while (position > 0 && text[--position] === "\\") count++;
  return count % 2 === 1;
}

/** Recognize complete delimiters; literal escapes, URLs and note IDs stay opaque. */
export function mathSpans(
  text: string,
  ranges: TextRange[] = [],
  dollars = false,
): MathSpan[] {
  const protectedRanges = [...ranges];
  for (const match of text.matchAll(
    /\[\[[^\]\n]+\]\]|\[@[^\]\n]+\]|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/gi,
  ))
    protectedRanges.push({
      from: match.index,
      to: match.index + match[0].length,
    });
  const spans: MathSpan[] = [];
  for (let start = 0; start < text.length; start++) {
    const protectedRange = protectedRanges.find(
      (range) => range.from <= start && start < range.to,
    );
    if (protectedRange) {
      start = protectedRange.to - 1;
      continue;
    }
    if (escaped(text, start)) continue;
    let open = "",
      close = "",
      display = false;
    if (text.startsWith("\\(", start)) {
      open = "\\(";
      close = "\\)";
    } else if (text.startsWith("\\[", start)) {
      open = "\\[";
      close = "\\]";
      display = true;
    } else if (dollars && text[start] === "$" && text[start - 1] !== "$") {
      display = text[start + 1] === "$";
      open = close = display ? "$$" : "$";
    } else continue;
    let depth = 0;
    for (let cursor = start + open.length; cursor < text.length; cursor++) {
      if (!display && /[\r\n]/.test(text[cursor])) break;
      if (
        depth === 0 &&
        text.startsWith(close, cursor) &&
        !escaped(text, cursor)
      ) {
        const raw = text.slice(start + open.length, cursor);
        const end = cursor + close.length;
        if (
          !raw.trim() ||
          (open === "$" &&
            (/^\s|\s$/.test(raw) || /[\d$]/.test(text[end] || "")))
        )
          break;
        if (
          protectedRanges.some((range) => range.from < end && start < range.to)
        )
          break;
        spans.push({ start, end, latex: raw.trim(), display });
        start = end - 1;
        break;
      }
      if (text[cursor] === "\\") {
        cursor++;
        continue;
      }
      if (text[cursor] === "{") depth++;
      if (text[cursor] === "}" && --depth < 0) break;
    }
  }
  return spans;
}

export function markdownMathEdits(
  text: string,
  ranges: TextRange[] = [],
  selection?: TextRange,
) {
  return mathSpans(text, ranges)
    .filter(
      (span) =>
        !selection ||
        (span.start >= selection.from && span.end <= selection.to),
    )
    .map((span) => {
      let replacement = "$" + span.latex + "$";
      if (span.display) {
        const before = text.slice(0, span.start),
          after = text.slice(span.end);
        const prefix =
          !before || /\n[ \t]*\n[ \t]*$/.test(before)
            ? ""
            : /\n[ \t]*$/.test(before)
              ? "\n"
              : "\n\n";
        const suffix =
          !after || /^[ \t]*\n[ \t]*\n/.test(after)
            ? ""
            : /^[ \t]*\n/.test(after)
              ? "\n"
              : "\n\n";
        replacement = prefix + "$$\n" + span.latex + "\n$$" + suffix;
      }
      return { start: span.start, end: span.end, replacement };
    });
}

/** Zotero owns these ProseMirror objects and the schema; no second editor is created. */
export interface RichTextView {
  state: any;
  dispatch(transaction: any): void;
  focus(): void;
}

function protectedText(node: any): boolean {
  return node.marks?.some((mark: any) =>
    ["code", "link", "annotation"].includes(mark.type.name),
  );
}
function runs(node: any): { start: number; text: string }[] {
  const result: { start: number; text: string }[] = [];
  let current: { start: number; text: string } | undefined;
  node.forEach((child: any, offset: number) => {
    // Native callbacks cross back into the privileged plugin with Xray wrappers.
    child = child.wrappedJSObject || child;
    const text =
      child.isText && !protectedText(child)
        ? child.text
        : child.type.name === "hardBreak"
          ? "\n"
          : null;
    if (text === null) {
      current = undefined;
      return;
    }
    if (!current || current.start + current.text.length !== offset)
      result.push((current = { start: offset, text: "" }));
    current.text += text;
  });
  return result;
}
function mathNode(schema: any, span: MathSpan) {
  return schema.nodes[span.display ? "math_display" : "math_inline"].create(
    null,
    schema.text(span.latex),
  );
}
function wholeDisplay(text: string) {
  return mathSpans(text, [], true).find(
    (span) =>
      span.display &&
      !text.slice(0, span.start).trim() &&
      !text.slice(span.end).trim(),
  );
}

/** Replace only recognized prose spans, retaining every unrelated node and mark. */
export function normalizeRichMath(view: RichTextView): number {
  const { state } = view;
  if (!state.schema.nodes.math_inline || !state.schema.nodes.math_display)
    throw new Error("The note editor does not support math nodes.");
  const scope = state.selection.empty
    ? null
    : { from: state.selection.from, to: state.selection.to };
  const blocks: { node: any; pos: number; parent: any; index: number }[] = [];
  state.doc.descendants(
    (node: any, pos: number, parent: any, index: number) => {
      node = node.wrappedJSObject || node;
      parent = parent?.wrappedJSObject || parent;
      if (node.type.spec.code || (node.isAtom && !node.isText)) return false;
      if (node.isTextblock) {
        blocks.push({ node, pos, parent, index });
        return false;
      }
    },
  );
  const edits: { from: number; to: number; fragment: any; count: number }[] =
    [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index],
      { node, pos, parent } = block;
    const segments = runs(node);
    // A pasted display formula can occupy several consecutive paragraphs.
    if (
      node.type.name === "paragraph" &&
      segments.length === 1 &&
      segments[0].text.length === node.content.size &&
      !wholeDisplay(segments[0].text) &&
      /^\s*(?:\\\[|\$\$)/.test(segments[0].text)
    ) {
      let text = segments[0].text;
      let consumed = false;
      for (let end = index + 1; end < blocks.length; end++) {
        const next = blocks[end],
          nextRuns = runs(next.node);
        if (
          next.parent !== parent ||
          next.index !== block.index + end - index ||
          next.node.type.name !== "paragraph" ||
          nextRuns.length !== 1 ||
          nextRuns[0].text.length !== next.node.content.size
        )
          break;
        text += "\n" + nextRuns[0].text;
        const span = mathSpans(text, [], true).find(
          (span) =>
            span.display &&
            !text.slice(0, span.start).trim() &&
            !text.slice(span.end).trim(),
        );
        if (!span) continue;
        const from = pos,
          to = next.pos + next.node.nodeSize;
        const fragment = node.content
          .cut(0, 0)
          .addToEnd(mathNode(state.schema, span));
        if (
          (!scope || (from >= scope.from - 1 && to <= scope.to + 1)) &&
          parent.canReplace(block.index, next.index + 1, fragment)
        )
          edits.push({ from, to, fragment, count: 1 });
        index = end;
        consumed = true;
        break;
      }
      if (consumed) continue;
    }
    const spans = segments
      .flatMap((segment) =>
        mathSpans(segment.text, [], true).map((span) => ({
          ...span,
          start: span.start + segment.start,
          end: span.end + segment.start,
        })),
      )
      .filter(
        (span) =>
          !scope ||
          (pos + 1 + span.start >= scope.from &&
            pos + 1 + span.end <= scope.to),
      );
    if (!spans.length) continue;
    let content = node.content.cut(0, 0),
      fragment = node.content.cut(0, 0),
      cursor = 0;
    for (const span of spans) {
      content = content.append(node.content.cut(cursor, span.start));
      const math = mathNode(state.schema, span);
      if (span.display) {
        if (content.size) fragment = fragment.addToEnd(node.copy(content));
        fragment = fragment.addToEnd(math);
        content = node.content.cut(0, 0);
      } else content = content.addToEnd(math);
      cursor = span.end;
    }
    content = content.append(node.content.cut(cursor));
    if (content.size) fragment = fragment.addToEnd(node.copy(content));
    if (parent.canReplace(block.index, block.index + 1, fragment))
      edits.push({
        from: pos,
        to: pos + node.nodeSize,
        fragment,
        count: spans.length,
      });
  }
  if (!edits.length) return 0;
  // The native history key separates this command from preceding/following typing.
  const transaction = state.tr.setMeta("closeHistory$", true);
  for (const edit of edits.reverse())
    transaction.replaceWith(edit.from, edit.to, edit.fragment);
  view.dispatch(transaction);
  view.dispatch(view.state.tr.setMeta("closeHistory$", true));
  return edits.reduce((count, edit) => count + edit.count, 0);
}
