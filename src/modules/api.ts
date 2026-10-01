/**
 * Window-facing API. Chrome pages (manager.xhtml / editor.xhtml) call these
 * through `Zotero.ZettelKnowledgeBase.api.*` - only plain data crosses the boundary.
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { cardRefFromURL, renderMarkdown } from "./markdown";
import { importImage, pickImage, resolveAssetURL } from "./assets";
import { getGraphData } from "./graph";
import { onDataChange } from "./events";
import {
  createCardsFromAnnotations,
  type CreateCardsResult,
} from "./annotations";
import {
  countByAnnotationKeys,
  countByItem,
  deleteZettel,
  getBacklinks,
  getOutgoing,
  getUnresolvedRefs,
  getZettel,
  listByItem,
  listZettels,
  resolveRefs,
  parseLinks,
  saveZettel,
  type Backlink,
  type ResolvedLink,
  type Zettel,
} from "./zettel";
import {
  getHighlights,
  getItemSummary,
  getSelectedSource,
  searchItems,
  selectItem,
  type HighlightInfo,
  type ItemSummary,
} from "./zotero";

const MANAGER_URL = `chrome://${config.addonRef}/content/manager.xhtml`;
const EDITOR_URL = `chrome://${config.addonRef}/content/editor.xhtml`;
const ANNOTATIONS_URL = `chrome://${config.addonRef}/content/annotations.xhtml`;

/** A highlight plus the number of cards already created from it. */
export type HighlightWithCards = HighlightInfo & { cards: number };

export interface EditorArgs {
  zettelId?: string | null;
  prefillTitle?: string;
  /** preselect this Zotero item as the card's source */
  sourceItem?: { key: string; libraryID: number };
  onSaved?: (id: string) => void;
}

export interface ManagerArgs {
  /** card to select once the window is up */
  selectId?: string;
}

export interface AnnotationPickerArgs {
  itemKey: string;
  libraryID: number;
  itemTitle?: string;
}

function mainWindow(): Window {
  return Zotero.getMainWindow();
}

export const api = {
  loc(key: string, args?: Record<string, unknown>): string {
    return getString(key, { args });
  },

  renderMarkdown(body: string): string {
    return renderMarkdown(
      body,
      mainWindow() as unknown as Parameters<typeof renderMarkdown>[1],
      resolveAssetURL,
    );
  },

  importImage,
  pickImage,
  getGraph: getGraphData,
  onDataChange,

  openImage(url: string): void {
    if (
      !/^(https?:\/\/|resource:\/\/zettel-knowledge-base-assets\/[a-zA-Z0-9-]+\.(?:png|jpg|gif|webp|avif)$|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(
        url,
      )
    )
      return;
    mainWindow().openDialog(
      `chrome://${config.addonRef}/content/imageViewer.xhtml`,
      "zettel-knowledge-base:image",
      "chrome,centerscreen,resizable=yes,width=900,height=700",
      { url },
    );
  },

  async getDraftLinks(body: string): Promise<ResolvedLink[]> {
    const links = parseLinks(body);
    const resolved = await resolveRefs(links.map((link) => link.ref));
    return links.map((link) => ({
      ...link,
      targetId: resolved.get(link.ref) ?? null,
    }));
  },

  async resolveCardLink(
    href: string,
  ): Promise<{ ref: string; targetId: string | null } | null> {
    const ref = cardRefFromURL(href);
    if (!ref) return null;
    const resolved = await resolveRefs([ref]);
    return { ref, targetId: resolved.get(ref) ?? null };
  },

  async openLink(href: string): Promise<void> {
    const card = await api.resolveCardLink(href);
    if (card) {
      if (card.targetId) api.openManager({ selectId: card.targetId });
      else api.openEditor({ prefillTitle: card.ref });
      return;
    }
    const source =
      /^zotero:\/\/select\/(library|groups\/(\d+))\/items\/([A-Z0-9]{8})$/i.exec(
        href,
      );
    if (source) {
      const library = source[2]
        ? Zotero.Libraries.getAll().find(
            (lib) =>
              lib.libraryType === "group" &&
              lib.libraryTypeID === Number(source[2]),
          )
        : Zotero.Libraries.userLibrary;
      if (!library) throw new Error("Source library not found");
      await selectItem(source[3], library.libraryID);
      return;
    }
    if (/^(https?:|mailto:|zotero:\/\/)/i.test(href)) Zotero.launchURL(href);
  },

  /* ---------------- data ---------------- */

  listZettels(query = ""): Promise<Zettel[]> {
    return listZettels(query);
  },

  listByItem(itemKey: string): Promise<Zettel[]> {
    return listByItem(itemKey);
  },

  countByItem(itemKey: string): Promise<number> {
    return countByItem(itemKey);
  },

  getZettel(id: string): Promise<Zettel | null> {
    return getZettel(id);
  },

  getOutgoing(id: string): Promise<ResolvedLink[]> {
    return getOutgoing(id);
  },

  getBacklinks(id: string): Promise<Backlink[]> {
    return getBacklinks(id);
  },

  getUnresolvedRefs(): Promise<{ ref: string; count: number }[]> {
    return getUnresolvedRefs();
  },

  saveZettel(input: {
    id?: string;
    title: string;
    body: string;
    itemKey?: string | null;
    libraryID?: number | null;
  }): Promise<string> {
    return saveZettel(input);
  },

  deleteZettel(id: string): Promise<void> {
    return deleteZettel(id);
  },

  /* ---------------- zotero integration ---------------- */

  searchItems(query: string): Promise<ItemSummary[]> {
    return searchItems(query);
  },

  getItemSummary(
    key: string,
    libraryID: number | null,
  ): Promise<ItemSummary | null> {
    return getItemSummary(key, libraryID);
  },

  getSelectedSource(): Promise<ItemSummary | null> {
    return getSelectedSource();
  },

  /** Highlights of an item, each annotated with its existing card count. */
  async getHighlights(
    key: string,
    libraryID: number,
  ): Promise<HighlightWithCards[]> {
    const highlights = await getHighlights(key, libraryID);
    if (!highlights.length) return [];
    const counts = await countByAnnotationKeys(highlights.map((h) => h.key));
    return highlights.map((h) => ({
      ...h,
      cards: counts.get(h.key) ?? 0,
    }));
  },

  /**
   * Create one card per annotation. Already-imported annotations are reported
   * in `skipped` rather than duplicated.
   */
  createCardsFromAnnotations(
    ids: (string | number)[],
  ): Promise<CreateCardsResult> {
    return createCardsFromAnnotations(ids);
  },

  selectItem(key: string, libraryID: number | null): Promise<void> {
    return selectItem(key, libraryID);
  },

  /* ---------------- windows ---------------- */

  openManager(args: ManagerArgs = {}): void {
    const existing = Services.wm.getMostRecentWindow(
      "zettel-knowledge-base:manager",
    ) as
      | (Window & { ZettelKnowledgeBase_selectZettel?: (id: string) => void })
      | null;
    if (existing) {
      existing.focus();
      if (args.selectId)
        existing.ZettelKnowledgeBase_selectZettel?.(args.selectId);
      return;
    }
    mainWindow().openDialog(
      MANAGER_URL,
      "zettel-knowledge-base:manager",
      "chrome,centerscreen,resizable=yes,width=980,height=640",
      args,
    );
  },

  openEditor(args: EditorArgs = {}): void {
    mainWindow().openDialog(
      EDITOR_URL,
      "zettel-knowledge-base:editor",
      "chrome,centerscreen,resizable=yes,width=1000,height=720",
      args,
    );
  },

  openGraph(args: { centerId?: string } = {}): void {
    const existing = Services.wm.getMostRecentWindow(
      "zettel-knowledge-base:graph",
    ) as
      | (Window & { ZettelKnowledgeBase_showGraph?: (id?: string) => void })
      | null;
    if (existing) {
      existing.focus();
      existing.ZettelKnowledgeBase_showGraph?.(args.centerId);
      return;
    }
    mainWindow().openDialog(
      `chrome://${config.addonRef}/content/graph.xhtml`,
      "zettel-knowledge-base:graph",
      "chrome,centerscreen,resizable=yes,width=1100,height=760",
      args,
    );
  },

  openAnnotationPicker(args: AnnotationPickerArgs): void {
    const existing = Services.wm.getMostRecentWindow(
      "zettel-knowledge-base:annotations",
    );
    if (existing) {
      (existing as unknown as Window).focus();
      return;
    }
    mainWindow().openDialog(
      ANNOTATIONS_URL,
      "zettel-knowledge-base:annotations",
      "chrome,centerscreen,resizable=yes,width=720,height=600",
      args,
    );
  },
};
