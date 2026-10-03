/**
 * Rendering of highlight quotes and citation lines.
 *
 * Kept in one place so that the three entry points - reader context menu,
 * editor highlight picker and the batch importer - produce byte-identical
 * card bodies. That matters because these bodies are meant to survive a
 * round-trip through Markdown export later.
 */

import { getString } from "../utils/locale";

export interface HighlightLike {
  text: string;
  /** page label as shown in the reader; empty when unknown */
  page: string;
}

export interface SourceLike {
  itemKey: string;
  libraryID: number;
  title: string;
  /** e.g. "Smith 2020"; may be empty */
  creatorYear: string;
  selectURL?: string;
}

/** Collapse all whitespace runs into single spaces. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Card title derived from the highlight. Titles are deliberately short: the
 * full quote lives in the body, and the manager list stays scannable.
 */
export function titleFromHighlight(text: string, max = 60): string {
  const flat = collapse(text);
  if (!flat) return "";
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Quote every line of the highlight so it survives as a Markdown blockquote. */
export function quoteBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line.trim()}`)
    .join("\n")
    .trim();
}

/** Human-readable form of the source item, used in the citation line. */
export function describeSource(source: SourceLike): string {
  return source.creatorYear || source.title || source.itemKey;
}

/**
 * Citation line, e.g. `Source: Smith 2020, p. 12`. Page is omitted when the
 * annotation carries no page label (typical for notes and image annotations).
 */
export function citationLine(source: SourceLike, page = ""): string {
  const label = describeSource(source).replace(/([\\[\]`*_])/g, "\\$1");
  const ref = source.selectURL ? `[${label}](${source.selectURL})` : label;
  const p = page.trim();
  if (!p) return getString("citation-source", { args: { source: ref } });
  return getString("citation-source-page", {
    args: { source: ref, page: p },
  });
}

/** Inline page marker such as `（p.12）`, for quotes pasted into a body. */
export function pageNote(page: string): string {
  const p = page.trim();
  return p ? getString("citation-page-note", { args: { page: p } }) : "";
}

/** Body for a single-highlight card: quote, then its citation. */
export function bodyFromHighlight(
  source: SourceLike,
  highlight: HighlightLike,
): string {
  return `${quoteBlock(highlight.text)}\n\n${citationLine(source, highlight.page)}`;
}

/**
 * Body for a batch import from the same source: every highlight is a separate
 * card, so this only exists for the merged-preview case.
 */
export function bodyFromHighlights(
  source: SourceLike,
  highlights: HighlightLike[],
): string {
  return highlights
    .map((h) => bodyFromHighlight(source, h))
    .join("\n\n---\n\n");
}
