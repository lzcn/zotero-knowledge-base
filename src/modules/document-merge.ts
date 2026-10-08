interface Edit {
  start: number;
  end: number;
  lines: string[];
}

/** Bounded line diff; native objects remain atomic and large ambiguous edits retain drafts. */
function edits(base: string[], next: string[]): Edit[] | null {
  let start = 0;
  while (
    start < base.length &&
    start < next.length &&
    base[start] === next[start]
  )
    start++;
  let end = base.length,
    nextEnd = next.length;
  while (
    end > start &&
    nextEnd > start &&
    base[end - 1] === next[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  const a = base.slice(start, end),
    b = next.slice(start, nextEnd);
  if (!a.length || !b.length) return [{ start, end, lines: b }];
  if ((a.length + 1) * (b.length + 1) > 1_000_000) return null;
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  const result: Edit[] = [];
  let i = 0,
    j = 0,
    edit: Edit | undefined;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (edit) {
        result.push(edit);
        edit = undefined;
      }
      i++;
      j++;
    } else {
      edit ??= { start: start + i, end: start + i, lines: [] };
      if (
        j < b.length &&
        (i === a.length || lcs[i * width + j + 1] > lcs[(i + 1) * width + j])
      )
        edit.lines.push(b[j++]);
      else edit.end = start + ++i;
    }
  }
  if (edit) result.push(edit);
  return result;
}

export function mergeMarkdownDocuments(
  base: string,
  local: string,
  remote: string,
): string | null {
  if (local === remote || remote === base) return local;
  if (local === base) return remote;
  const lines = base.split("\n");
  const left = edits(lines, local.split("\n")),
    right = edits(lines, remote.split("\n"));
  if (!left || !right) return null;
  const combined = [...left];
  for (const incoming of right) {
    let identical = false;
    for (const existing of left) {
      if (
        incoming.start === existing.start &&
        incoming.end === existing.end &&
        incoming.lines.join("\n") === existing.lines.join("\n")
      ) {
        identical = true;
        break;
      }
      const insertion =
        incoming.start === incoming.end || existing.start === existing.end;
      const overlaps = insertion
        ? incoming.start <= existing.end && existing.start <= incoming.end
        : incoming.start < existing.end && existing.start < incoming.end;
      if (overlaps) return null;
    }
    if (!identical) combined.push(incoming);
  }
  combined.sort((a, b) => b.start - a.start);
  for (const edit of combined)
    lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return lines.join("\n");
}
