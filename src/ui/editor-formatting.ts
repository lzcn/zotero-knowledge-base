export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
  selection?: { start: number; end: number };
}

/** Pure Markdown edits; DOM selection and saving belong to the editor. */
export function formatEdit(
  body: string,
  start: number,
  end: number,
  kind: string,
  placeholder: string,
): TextEdit | null {
  const text = body.slice(start, end);
  const sample = text || placeholder;
  if (kind === "table")
    return {
      start,
      end,
      replacement: `\n\n| ${sample} | ${placeholder} |\n| --- | --- |\n|  |  |\n`,
    };
  const wrappers: Record<string, [string, number]> = {
    bold: [`**${sample}**`, 2],
    italic: [`*${sample}*`, 1],
    code: text.includes("\n")
      ? [`\n\`\`\`\n${sample}\n\`\`\`\n`, 5]
      : [`\`${sample}\``, 1],
  };
  if (wrappers[kind]) {
    const [replacement, offset] = wrappers[kind];
    return {
      start,
      end,
      replacement,
      selection: { start: start + offset, end: start + offset + sample.length },
    };
  }
  const prefix = (
    { heading: "## ", quote: "> ", list: "- ", task: "- [ ] " } as Record<
      string,
      string
    >
  )[kind];
  if (!prefix) return null;
  const lineStart = start === 0 ? 0 : body.lastIndexOf("\n", start - 1) + 1;
  const nextLine = body.indexOf("\n", end);
  const lineEnd = nextLine === -1 ? body.length : nextLine;
  return {
    start: lineStart,
    end: lineEnd,
    replacement: (body.slice(lineStart, lineEnd) || sample)
      .split("\n")
      .map((line) => prefix + line)
      .join("\n"),
  };
}

export function continueList(body: string, cursor: number): TextEdit | null {
  const before = body.slice(0, cursor);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const match = /^(\s*)([-*+] |\d+\. )(\[[ xX]\] )?(.*)$/.exec(line);
  if (!match) return null;
  if (!match[4].trim())
    return { start: cursor - line.length, end: cursor, replacement: "\n" };
  const marker = /^\d/.test(match[2])
    ? `${parseInt(match[2], 10) + 1}. `
    : match[2];
  return {
    start: cursor,
    end: cursor,
    replacement: `\n${match[1]}${marker}${match[3] ? "[ ] " : ""}`,
  };
}

window.KnowledgeBaseEditing = { formatEdit, continueList };
