/**
 * Window-facing API. Chrome pages (manager.xhtml / editor.xhtml) call these
 * through `Zotero.ZoteroKnowledgeBase.api.*` - only plain data crosses the boundary.
 */

import {
  getEditorDraft,
  listEditorDrafts,
  saveEditorDraft,
  discardEditorDraft,
} from "./editor-drafts";
import {
  acquireNativeNote,
  projectNativeNote,
  nativeNoteHTML,
  saveNativeCard,
  releaseNativeNote,
  trashNativeNote,
  duplicateNativeNote,
  prepareNativePreview,
  nativePreviewHTML,
  isExternalNote,
  ensureLiteratureNote,
  getNoteHealth,
  restoreNote,
  getMarkdownSource,
  markdownNoteHTML,
} from "./native-notes";
import { richTextToMarkdown } from "./rich-text";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  cardRefFromURL,
  nativeNoteRefFromURL,
  renderMarkdown,
} from "./markdown";
import { prepareCitations, getCitation, resolveCitation } from "./references";
import {
  importImage,
  pickImage,
  resolveAssetURL,
  updateImageDraft,
  releaseImageDraft,
} from "./assets";
import { getFamily, getParentCandidates } from "./hierarchy";
import { getGraphData } from "./graph";
import {
  getGraphOptions,
  setGraphOption,
  getPanelWidth,
  setPanelWidth,
  onGraphOptionsChange,
} from "./preferences";
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
  getItemMetadata,
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
  kind?: import("./db").NoteKind;
  zettelId?: string | null;
  draftId?: string;
  prefillTitle?: string;
  prefillBody?: string;
  prefillParentId?: string;
  imageDraftId?: string;
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

const editorWindows = new Map<string, Window>();

export const api = {
  ensureLiteratureNote,
  getNoteHealth,
  restoreNote,
  getMarkdownSource,
  markdownNoteHTML,
  getItemMetadata,
  isExternalNote,
  async openLiteratureNote(key: string, libraryID: number): Promise<void> {
    const id = await ensureLiteratureNote(key, libraryID);
    api.openEditor({ zettelId: id });
  },
  loc(key: string, args?: Record<string, string | number | null>): string {
    return getString(key, { args });
  },

  richTextToMarkdown(html: string): string {
    const win = mainWindow() as unknown as { DOMParser: typeof DOMParser };
    const doc = new win.DOMParser().parseFromString(html, "text/html");
    return richTextToMarkdown(doc.body);
  },

  renderMarkdown(body: string): string {
    return nativePreviewHTML(
      renderMarkdown(
        body,
        mainWindow() as unknown as Parameters<typeof renderMarkdown>[1],
        resolveAssetURL,
        getCitation,
      ),
    );
  },

  async prepareMarkdown(body: string): Promise<void> {
    await Promise.all([prepareCitations(body), prepareNativePreview(body)]);
  },

  saveEditorDraft,
  discardEditorDraft,
  getEditorDraft,
  listEditorDrafts,
  saveEditorCard: saveNativeCard,
  acquireNativeNote,
  duplicateNativeNote,
  projectNativeNote,
  nativeNoteHTML,
  releaseNativeNote,
  importImage,
  pickImage,
  updateImageDraft,
  releaseImageDraft,
  getGraph: getGraphData,
  getFamily,
  getParentCandidates,
  onDataChange,
  getGraphOptions,
  setGraphOption,
  getPanelWidth,
  setPanelWidth,
  onGraphOptionsChange,

  openImage(url: string): void {
    if (
      !/^(https?:\/\/|resource:\/\/knowledge-base-assets\/[a-zA-Z0-9-]+\.(?:png|jpg|gif|webp|avif)$|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(
        url,
      )
    )
      return;
    mainWindow().openDialog(
      `chrome://${config.addonRef}/content/image-viewer.xhtml`,
      "knowledge-base:image",
      "chrome,centerscreen,resizable=yes,width=900,height=700",
      { url },
    );
  },

  async getDraftLinks(body: string): Promise<ResolvedLink[]> {
    const links = parseLinks(body);
    const resolved = await resolveRefs(links.map((link) => link.ref));
    return links
      .filter(
        (link) => !link.ref.startsWith("zotero://") || resolved.has(link.ref),
      )
      .map((link) => ({
        ...link,
        targetId: resolved.get(link.ref) ?? null,
      }));
  },

  async resolveCardLink(
    href: string,
  ): Promise<{ ref: string; targetId: string | null } | null> {
    const ref = cardRefFromURL(href) || nativeNoteRefFromURL(href);
    if (!ref) return null;
    const resolved = await resolveRefs([ref]);
    if (ref.startsWith("zotero://") && !resolved.has(ref)) return null;
    return { ref, targetId: resolved.get(ref) ?? null };
  },

  async openLink(href: string): Promise<void> {
    const citation = /^knowledge-base:\/\/cite\/([^?#]+)$/.exec(href);
    if (citation) {
      const key = decodeURIComponent(citation[1]);
      const item = await resolveCitation(key);
      if (!item)
        throw new Error(getString("citation-unresolved", { args: { key } }));
      await selectItem(item.key, item.libraryID);
      return;
    }
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

  listZettels(
    query = "",
    entriesOnly = false,
    kind?: import("./db").NoteKind,
  ): Promise<Zettel[]> {
    return listZettels(query, entriesOnly, kind);
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

  saveZettel(input: Parameters<typeof saveZettel>[0]): Promise<string> {
    return saveZettel(input);
  },

  async deleteZettel(id: string): Promise<void> {
    await trashNativeNote(id);
    await deleteZettel(id);
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
      "knowledge-base:manager",
    ) as
      | (Window & { ZoteroKnowledgeBase_selectZettel?: (id: string) => void })
      | null;
    if (existing) {
      existing.focus();
      if (args.selectId)
        existing.ZoteroKnowledgeBase_selectZettel?.(args.selectId);
      return;
    }
    mainWindow().openDialog(
      MANAGER_URL,
      "knowledge-base:manager",
      "chrome,centerscreen,resizable=yes,width=980,height=640",
      args,
    );
  },

  openEditor(args: EditorArgs = {}): void {
    const key = args.zettelId
      ? `note:${args.zettelId}`
      : args.draftId
        ? `draft:${args.draftId}`
        : null;
    const pending = key ? editorWindows.get(key) : null;
    if (pending && !pending.closed) {
      pending.focus();
      return;
    }
    for (const win of Services.wm.getEnumerator("knowledge-base:editor")) {
      const editor = win as unknown as Window & {
        knowledgeBaseCardId?: string;
        knowledgeBaseDraftId?: string;
      };
      if (
        (args.zettelId && editor.knowledgeBaseCardId === args.zettelId) ||
        (args.draftId && editor.knowledgeBaseDraftId === args.draftId)
      ) {
        editor.focus();
        return;
      }
    }
    const opened = mainWindow().openDialog(
      EDITOR_URL,
      "knowledge-base:editor",
      "chrome,centerscreen,resizable=yes,width=1000,height=720",
      args,
    ) as Window & {
      knowledgeBaseCardId?: string;
      knowledgeBaseDraftId?: string;
    };
    if (key) {
      editorWindows.set(key, opened);
      opened.addEventListener(
        "unload",
        () => {
          if (editorWindows.get(key) === opened) editorWindows.delete(key);
        },
        { once: true },
      );
    }
    // Stamp identity before the window script loads, so rapid requests reuse it.
    if (args.zettelId) opened.knowledgeBaseCardId = args.zettelId;
    if (args.draftId) opened.knowledgeBaseDraftId = args.draftId;
  },

  openGraph(args: { centerId?: string } = {}): void {
    const existing = Services.wm.getMostRecentWindow("knowledge-base:graph") as
      | (Window & { ZoteroKnowledgeBase_showGraph?: (id?: string) => void })
      | null;
    if (existing) {
      existing.focus();
      existing.ZoteroKnowledgeBase_showGraph?.(args.centerId);
      return;
    }
    mainWindow().openDialog(
      `chrome://${config.addonRef}/content/graph.xhtml`,
      "knowledge-base:graph",
      "chrome,centerscreen,resizable=yes,width=1100,height=760",
      args,
    );
  },

  openAnnotationPicker(args: AnnotationPickerArgs): void {
    const existing = Services.wm.getMostRecentWindow(
      "knowledge-base:annotations",
    );
    if (existing) {
      (existing as unknown as Window).focus();
      return;
    }
    mainWindow().openDialog(
      ANNOTATIONS_URL,
      "knowledge-base:annotations",
      "chrome,centerscreen,resizable=yes,width=720,height=600",
      args,
    );
  },
};

export type KnowledgeBaseAPI = typeof api;
