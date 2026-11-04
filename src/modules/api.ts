import { getAll } from "./db";
import { getNewNoteBody } from "./preferences";
import { getNoteTemplate, setNoteTemplate } from "./preferences";
import { compareNoteSummaries } from "./note-sort";
import { getDOMWindow } from "../utils/dom";
import { getGraphTags, getOwnNoteTags, visibleNoteTags } from "./note-tags";
import { isAccelKey } from "../ui/platform";
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
  auditNativeNotes,
  acquireNativeNote,
  projectNativeNote,
  getMarkdownDocument,
  nativeNoteHTML,
  saveNativeCard,
  releaseNativeNote,
  trashNativeNote,
  getTrashNotes,
  permanentlyDeleteNotes,
  duplicateNativeNote,
  prepareNativePreview,
  nativePreviewHTML,
  isExternalNote,
  ensureLiteratureNote,
  ensureManagedNote,
  setNoteTag,
  getNoteHealth,
  getNoteTags,
  restoreNote,
  getMarkdownSource,
  markdownNoteHTML,
  markdownDocumentHTML,
} from "./native-notes";
import { richTextToMarkdown } from "./rich-text";
import {
  getNoteReferences,
  withNoteReferences,
  getNoteLinkTargets,
  getCachedNoteTarget,
} from "./note-references";
import { config } from "../../package.json";
import {
  openWorkbench,
  openWorkbenchWindow,
  mountEditor,
  clearEditor,
  getViewArguments,
} from "./workbench";
import {
  getSourceBibliography,
  getSourceStyle,
  getSourceStyles,
  setSourceStyle,
  onSourceStyleChange,
} from "./bibliography";
import { getString } from "../utils/locale";
import {
  cardRefFromURL,
  nativeNoteRefFromURL,
  renderMarkdown,
  noteSnippet,
} from "./markdown";
import { prepareCitations, getCitation, resolveCitation } from "./references";
import {
  importImage,
  pickImage,
  resolveAssetURL,
  updateImageDraft,
  releaseImageDraft,
} from "./assets";
import { getFamily, getParentCandidates, getZettelOutline } from "./hierarchy";
import { getGraphData, getParentItemNodes } from "./graph";
import {
  getGraphOptions,
  setGraphOption,
  getGraphLabelLength,
  setGraphLabelLength,
  getGraphLocalDepth,
  setGraphLocalDepth,
  getPanelWidth,
  setPanelWidth,
  onGraphOptionsChange,
  getNoteSort,
  setNoteSort,
  getNoteEditorMode,
  setNoteEditorMode,
  getWorkbenchMode,
  setWorkbenchMode,
  getGraphGroups,
  setGraphGroups,
  getLiteratureTemplateSettings,
  setLiteratureTemplate,
  createLiteratureTemplate,
  updateLiteratureTemplate,
  deleteLiteratureTemplate,
} from "./preferences";
import { onDataChange } from "./events";
import { onNativeNoteChange } from "./note-sessions";
import { mergeMarkdownDocuments } from "./document-merge";
import {
  createCardsFromAnnotations,
  type CreateCardsResult,
} from "./annotations";
import {
  countByAnnotationKeys,
  countByItem,
  getBacklinks,
  getOutgoing,
  getUnresolvedRefs,
  getUnresolvedSources,
  getZettel,
  listByItem,
  listZettels,
  searchZettels,
  resolveRefs,
  parseLinks,
  saveZettel,
  checkNoteKey,
  getAvailableNoteID,
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
  noteType?: import("./note-types").NoteType;
  window?: boolean;
  embedded?: boolean;
  onClose?: () => void;
  onNavigate?: (args: EditorArgs) => void;
  initialTags?: string[];
  editTags?: boolean;
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
  unresolvedRef?: string;
  editor?: EditorArgs;
  window?: boolean;
  embedded?: boolean;
  onClose?: () => void;
  /** card to select once the window is up */
  selectId?: string;
}

export interface AnnotationPickerArgs {
  itemKey: string;
  libraryID: number;
  itemTitle?: string;
}

function mainWindow(): Window {
  return getDOMWindow();
}

const editorWindows = new Map<string, Window>();

export const api = {
  getNoteTemplate,
  setNoteTemplate,
  async getNoteCounts(): Promise<Record<string, number>> {
    const rows = await getAll<{ note_type: string; count: number }>(
      "SELECT note_type, COUNT(*) AS count FROM zettels z WHERE NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id=z.id) GROUP BY note_type",
    );
    const counts: Record<string, number> = {
      literature: 0,
      zettel: 0,
      thinking: 0,
      entity: 0,
      total: 0,
    };
    for (const row of rows) {
      counts[row.note_type] = row.count;
      counts.total += row.count;
    }
    return counts;
  },
  getLibraryState: () => libraryRuntime.state,
  getLibraryStatus: () => libraryRuntime.getStatus(),
  checkNoteKey,
  getAvailableNoteID,
  ensureLiteratureNote,
  getNoteHealth,
  getNoteTags,
  getOwnNoteTags,
  visibleNoteTags,
  setNoteTag,
  getNewNoteBody,
  restoreNote,
  getTrashNotes,
  permanentlyDeleteNotes,
  getMarkdownSource,
  markdownNoteHTML,
  markdownDocumentHTML,
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
        getCachedNoteTarget,
      ),
    );
  },

  noteSnippet(body: string, query = "", formula = "∑") {
    return noteSnippet(body, query, formula, getCachedNoteTarget);
  },

  async prepareMarkdown(body: string): Promise<void> {
    await Promise.all([
      prepareCitations(body),
      prepareNativePreview(body),
      getNoteLinkTargets(),
    ]);
  },

  async getNoteLink(ref: string) {
    await getNoteLinkTargets();
    const target = getCachedNoteTarget(ref);
    return target?.href
      ? {
          id: target.id,
          reference: target.reference,
          href: target.href,
          label: target.label || target.reference,
        }
      : null;
  },

  saveEditorDraft,
  discardEditorDraft,
  getEditorDraft,
  listEditorDrafts,
  saveEditorCard: saveNativeCard,
  getMarkdownDocument,
  acquireNativeNote,
  ensureManagedNote,
  duplicateNativeNote,
  projectNativeNote,
  nativeNoteHTML,
  releaseNativeNote,
  importImage,
  pickImage,
  updateImageDraft,
  releaseImageDraft,
  async getGraph() {
    const graph = await getGraphData();
    const cards = await withNoteReferences(
      graph.nodes.filter((node) => node.kind === "card"),
    );
    const refs = new Map(cards.map((card) => [card.id, card.reference]));
    graph.nodes.forEach((node) => {
      node.reference = refs.get(node.id);
    });
    return graph;
  },
  getParentItems: getParentItemNodes,
  getItemGraphSnapshot(keys: string[], active: () => boolean) {
    return libraryRuntime.getItemGraphSnapshot(keys, active);
  },
  async getFamily(id: string) {
    const family = await getFamily(id);
    const identities = [family.parent, ...family.children]
      .filter((card): card is NonNullable<typeof card> => !!card)
      .map((card) => ({ id: card.id, title: card.title }));
    const cards = new Map(
      (await withNoteReferences(identities)).map((card) => [card.id, card]),
    );
    return {
      parent: family.parent ? cards.get(family.parent.id)! : null,
      children: family.children.map((card) => cards.get(card.id)!),
    };
  },
  async getParentCandidates(id: string | null, query = "") {
    const cards = await getParentCandidates(id, query);
    return withNoteReferences(cards);
  },
  copyNoteReference(reference: string): void {
    Zotero.Utilities.Internal.copyTextToClipboard(`[[${reference}]]`);
  },
  async copyZettelList(shouldStop: () => boolean): Promise<number | null> {
    await auditNativeNotes();
    if (shouldStop()) return null;
    const rows = await getZettelOutline();
    if (shouldStop()) return null;
    if (rows.length)
      Zotero.Utilities.Internal.copyTextToClipboard(
        rows.map((row) => `- ${JSON.stringify(row)}`).join("\n"),
      );
    return rows.length;
  },
  onDataChange,
  onNativeNoteChange,
  mergeMarkdownDocuments,
  isAccelKey,
  getNoteSort,
  setNoteSort,
  compareNoteSummaries,
  mountEditor,
  clearEditor,
  getViewArguments,
  getSourceBibliography,
  getSourceStyle,
  getSourceStyles,
  setSourceStyle,
  onSourceStyleChange,
  getGraphOptions,
  setGraphOption,
  getGraphLabelLength,
  setGraphLabelLength,
  getGraphLocalDepth,
  setGraphLocalDepth,
  getPanelWidth,
  setPanelWidth,
  onGraphOptionsChange,
  getGraphGroups,
  setGraphGroups,
  getGraphTags,
  getNoteEditorMode,
  setNoteEditorMode,
  getLiteratureTemplateSettings,
  setLiteratureTemplate,
  createLiteratureTemplate,
  updateLiteratureTemplate,
  deleteLiteratureTemplate,

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
    const { byID } = await getNoteReferences();
    return links
      .filter(
        (link) => !link.ref.startsWith("zotero://") || resolved.has(link.ref),
      )
      .map((link) => ({
        ...link,
        targetId: resolved.get(link.ref) ?? null,
        reference:
          byID.get(resolved.get(link.ref) || "") ||
          resolved.get(link.ref) ||
          link.ref,
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

  auditNativeNotes,

  async listZettels(query = ""): Promise<Zettel[]> {
    return withNoteReferences(await listZettels(query));
  },
  async searchZettels(
    query = "",
    options: Parameters<typeof searchZettels>[1] = {},
  ) {
    const page = await searchZettels(query, options);
    return { ...page, items: await withNoteReferences(page.items) };
  },

  async searchZettelSummaries(
    query = "",
    options: Parameters<typeof searchZettels>[1] = {},
    references?: Map<string, string>,
  ) {
    await getNoteLinkTargets();
    const page = await searchZettels(query, { ...options, summary: true });
    references ??= (await getNoteReferences()).byID;
    return {
      ...page,
      references,
      items: page.items.map((row) => ({
        ...row,
        reference: references!.get(row.id) || row.id,
      })),
    };
  },

  async listByItem(itemKey: string, libraryID?: number): Promise<Zettel[]> {
    return withNoteReferences(await listByItem(itemKey, libraryID));
  },

  countByItem(itemKey: string): Promise<number> {
    return countByItem(itemKey);
  },

  async getZettel(id: string): Promise<Zettel | null> {
    const note = await getZettel(id);
    return note ? (await withNoteReferences([note]))[0] : null;
  },

  async getOutgoing(id: string): Promise<ResolvedLink[]> {
    const links = await getOutgoing(id);
    const { byID } = await getNoteReferences();
    return links.map((link) => ({
      ...link,
      reference: link.targetId
        ? byID.get(link.targetId) || link.targetId
        : link.ref,
    }));
  },

  async getBacklinks(id: string): Promise<Backlink[]> {
    const links = await getBacklinks(id);
    const { byID } = await getNoteReferences();
    return links.map((link) => ({
      ...link,
      reference: byID.get(link.sourceId) || link.sourceId,
    }));
  },

  getUnresolvedRefs,
  async getUnresolvedSources(ref: string) {
    return withNoteReferences(await getUnresolvedSources(ref));
  },

  saveZettel(input: Parameters<typeof saveZettel>[0]): Promise<string> {
    return saveZettel(input);
  },

  async deleteZettel(id: string): Promise<void> {
    await trashNativeNote(id);
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

  openWorkbenchWindow,
  getWorkbenchMode,
  setWorkbenchMode,

  openTemplateManager(): Window {
    const existing = Services.wm.getMostRecentWindow(
      "knowledge-base:templates",
    ) as Window | null;
    if (existing && !existing.closed) {
      existing.focus();
      return existing;
    }
    const opened = mainWindow().openDialog(
      `chrome://${config.addonRef}/content/templates.xhtml`,
      "knowledge-base:templates",
      "chrome,centerscreen,resizable=yes,width=880,height=580",
    );
    if (!opened) throw new Error("Could not open template manager");
    return opened;
  },

  openManager(args: ManagerArgs = {}): void {
    if (!args.window)
      return getWorkbenchMode() === "window"
        ? openWorkbenchWindow(args)
        : openWorkbench(args);
    const existing = Services.wm.getMostRecentWindow(
      "knowledge-base:manager",
    ) as Window | null;
    if (existing) {
      existing.focus();
      existing.knowledgeBaseRefreshNotes?.();
      if (args.selectId)
        existing.ZoteroKnowledgeBase_selectZettel?.(args.selectId);
      if (args.unresolvedRef)
        existing.knowledgeBaseShowUnresolved?.(args.unresolvedRef);
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
    if (!args.window)
      return api.openManager({
        editor: args,
        selectId: args.zettelId || undefined,
      });
    const key = args.zettelId
      ? `note:${args.zettelId}`
      : args.draftId
        ? `draft:${args.draftId}`
        : null;
    const pending = key ? editorWindows.get(key) : null;
    const focus = (editor: Window) => {
      editor.focus();
      if (!args.editTags) return;
      const edit = () => {
        void editor
          .knowledgeBaseEditTags?.()
          .catch((error) => Zotero.logError(error));
      };
      if (editor.knowledgeBaseEditTags) edit();
      else editor.addEventListener("load", edit, { once: true });
    };
    if (pending && !pending.closed) {
      focus(pending);
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
        focus(editor);
        return;
      }
    }
    const opened = mainWindow().openDialog(
      EDITOR_URL,
      "_blank",
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
