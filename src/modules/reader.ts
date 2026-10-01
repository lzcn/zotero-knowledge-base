/**
 * PDF reader integration, built on Zotero 10's reader event API
 * (`Zotero.Reader.registerEventListener`).
 *
 *  - createAnnotationContextMenu   -> turn the selected highlight(s) into cards
 *  - renderSidebarAnnotationHeader -> one-click create, or jump to the card
 *
 * Both paths hand off to `modules/annotations`, which owns de-duplication.
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  createCardsFromAnnotations,
  type CreateCardsResult,
} from "./annotations";
import { getAnnotationCountSync, getZettelByAnnotationKey } from "./zettel";
import { describeAnnotationIDs } from "./zotero";

type AnnotationMenuEvent =
  _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">;
type AnnotationHeaderEvent =
  _ZoteroTypes.Reader.EventParams<"renderSidebarAnnotationHeader">;

/** Inline style for the sidebar button; the reader document has no plugin CSS. */
const ANNO_BUTTON_STYLE =
  "font-size:11px;padding:0 6px;margin-inline-start:6px;cursor:pointer;";

export function registerReaderUI(): void {
  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    onAnnotationContextMenu,
    config.addonID,
  );
  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    onAnnotationHeader,
    config.addonID,
  );
}

export function unregisterReaderUI(): void {
  try {
    Zotero.Reader.unregisterEventListener(
      "createAnnotationContextMenu",
      onAnnotationContextMenu,
    );
  } catch (e) {
    // the reader may already be gone during shutdown
    Zotero.logError(e instanceof Error ? e : new Error(String(e)));
  }
  try {
    Zotero.Reader.unregisterEventListener(
      "renderSidebarAnnotationHeader",
      onAnnotationHeader,
    );
  } catch (e) {
    Zotero.logError(e instanceof Error ? e : new Error(String(e)));
  }
}

/* ------------------------------------------------------------------ */
/* annotation context menu                                              */
/* ------------------------------------------------------------------ */

/**
 * Zotero's `Reader._dispatchEvent` calls handlers without awaiting them, and
 * the reader iframe assembles the menu as soon as the handler returns - so
 * `append()` must run synchronously in this tick. Every asynchronous step
 * therefore lives in `onCommand`, and the counts come from the in-memory index
 * rather than from a database query.
 */
function onAnnotationContextMenu(event: AnnotationMenuEvent): void {
  const { params, append } = event;
  const ids: string[] = params.ids?.length
    ? params.ids
    : params.currentID
      ? [params.currentID]
      : [];
  const highlights = describeAnnotationIDs(ids);
  // Nothing quotable (ink, image or empty underline) - stay out of the menu.
  if (!highlights.length) return;

  const pending = highlights.filter((h) => getAnnotationCountSync(h.key) === 0);

  const label = pending.length
    ? getString("reader-menu-new-zettel", { args: { count: pending.length } })
    : getString("reader-menu-open-zettel", {
        args: { count: highlights.length },
      });

  append({
    label,
    onCommand: () => {
      if (pending.length) {
        void createAndReport(highlights.map((h) => h.id));
      } else {
        void openExistingCard(highlights[0].key);
      }
    },
  });
}

/* ------------------------------------------------------------------ */
/* sidebar annotation header                                            */
/* ------------------------------------------------------------------ */

/** Synchronous for the same reason as the annotation context menu above. */
function onAnnotationHeader(event: AnnotationHeaderEvent): void {
  const { params, append, doc } = event;
  const annotation = params.annotation;
  const text = (annotation?.text || "").trim();
  if (!annotation?.key || !text) return;

  const count = getAnnotationCountSync(annotation.key);

  const button = doc.createElement("button");
  button.className = "zettel-knowledge-base-anno-btn";
  button.setAttribute("style", ANNO_BUTTON_STYLE);
  button.textContent = count
    ? getString("reader-anno-open", { args: { count } })
    : getString("reader-anno-new");
  button.title = getString(
    count ? "reader-anno-open-tip" : "reader-anno-new-tip",
  );
  button.addEventListener("click", () => {
    if (count) {
      void openExistingCard(annotation.key);
    } else {
      void createAndReport([annotation.id]);
    }
  });
  append(button);
}

/* ------------------------------------------------------------------ */
/* shared actions                                                       */
/* ------------------------------------------------------------------ */

async function createAndReport(ids: (string | number)[]): Promise<void> {
  try {
    const result = await createCardsFromAnnotations(ids);
    report(result);
    if (result.created.length === 1) {
      // Let the user title it properly before it sinks into the pile.
      addon.api.openEditor({ zettelId: result.created[0] });
    } else if (result.created.length > 1) {
      addon.api.openManager({ selectId: result.created[0] });
    }
  } catch (e) {
    Zotero.logError(e instanceof Error ? e : new Error(String(e)));
    notify(getString("reader-create-failed"), "fail");
  }
}

async function openExistingCard(annotationKey: string): Promise<void> {
  const zettel = await getZettelByAnnotationKey(annotationKey);
  if (zettel) addon.api.openManager({ selectId: zettel.id });
}

function report(result: CreateCardsResult): void {
  const parts: string[] = [];
  if (result.created.length) {
    parts.push(
      getString("reader-created", { args: { count: result.created.length } }),
    );
  }
  if (result.skipped.length) {
    parts.push(
      getString("reader-skipped", { args: { count: result.skipped.length } }),
    );
  }
  if (result.failed.length) {
    parts.push(
      getString("reader-failed", { args: { count: result.failed.length } }),
    );
  }
  if (!parts.length) return;
  notify(parts.join("，"), result.created.length ? "success" : "default");
}

function notify(text: string, type: "default" | "success" | "fail"): void {
  new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true })
    .createLine({ text, type })
    .show();
}
