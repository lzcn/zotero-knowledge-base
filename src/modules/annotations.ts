/**
 * Creating cards from Zotero annotations.
 *
 * Single entry point shared by the reader context menu and the batch dialog,
 * so both apply the same rule: **one card per annotation**. The annotation key
 * is stored on the card (`zettels.annotation_key`), which is what makes the
 * de-duplication and the "already has a card" indicators possible.
 */

import {
  bodyFromHighlight,
  titleFromHighlight,
  type SourceLike,
} from "./citation";
import {
  annotationSourceItem,
  describeAnnotationIDs,
  summaryForItem,
  type HighlightInfo,
} from "./zotero";
import { countByAnnotationKeys, saveZettel } from "./zettel";
export interface CreateCardsResult {
  /** ids of the cards that were created */
  created: string[];
  /** annotation keys skipped because a card already existed */
  skipped: string[];
  /** annotation keys that could not be converted, with the reason */
  failed: { key: string; reason: string }[];
}

function sourceOf(item: Zotero.Item): SourceLike {
  const s = summaryForItem(item);
  return {
    itemKey: s.key,
    libraryID: s.libraryID,
    title: s.title,
    creatorYear: s.creatorYear,
    selectURL: s.selectURL,
  };
}

/** Drop repeated ids so a multi-select cannot create the same card twice. */
function uniqueHighlights(ids: (string | number)[]): HighlightInfo[] {
  const seen = new Set<number>();
  const out: HighlightInfo[] = [];
  for (const h of describeAnnotationIDs(ids)) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
  }
  return out;
}

/**
 * Create one card per annotation. Annotations that already have a card are
 * skipped rather than duplicated; callers surface `skipped` to the user so the
 * behaviour is never silent.
 */
export async function createCardsFromAnnotations(
  ids: (string | number)[],
): Promise<CreateCardsResult> {
  const result: CreateCardsResult = { created: [], skipped: [], failed: [] };
  const highlights = uniqueHighlights(ids);
  if (!highlights.length) return result;

  const existing = await countByAnnotationKeys(highlights.map((h) => h.key));

  for (const h of highlights) {
    if ((existing.get(h.key) ?? 0) > 0) {
      result.skipped.push(h.key);
      continue;
    }
    try {
      const parent = annotationSourceItem(h.id);
      if (!parent) {
        result.failed.push({ key: h.key, reason: "no-parent-item" });
        continue;
      }
      await Zotero.Items.loadDataTypes([parent], ["itemData"]);
      const source = sourceOf(parent);
      const id = await saveZettel({
        title: titleFromHighlight(h.text),
        body: bodyFromHighlight(source, h),
        itemKey: source.itemKey,
        libraryID: source.libraryID,
        annotationKey: h.key,
      });
      result.created.push(id);
    } catch (e) {
      result.failed.push({
        key: h.key,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
