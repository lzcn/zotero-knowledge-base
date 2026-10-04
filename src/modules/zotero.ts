/**
 * Zotero item integration: search source items, read highlights,
 * jump to items in the main window.
 */

import { getString } from "../utils/locale";

export interface ItemSummary {
  key: string;
  libraryID: number;
  title: string;
  creatorYear: string;
  publication?: string;
  selectURL: string;
  libraryName: string;
  citationKey?: string;
  isNote?: boolean;
}

export interface HighlightInfo {
  /** annotation item id */
  id: number;
  /** annotation item key, used as the card's provenance marker */
  key: string;
  text: string;
  page: string;
  color: string;
}

function selectURL(item: Zotero.Item): string {
  const lib = Zotero.Libraries.get(item.libraryID);
  if (lib && lib.libraryType === "group") {
    return `zotero://select/groups/${lib.libraryTypeID}/items/${item.key}`;
  }
  return `zotero://select/library/items/${item.key}`;
}

function creatorYear(item: Zotero.Item): string {
  const creator = item.getField("firstCreator", false, true) || "";
  const date = String(item.getField("date", false, true) || "");
  const year = date.match(/\d{4}/)?.[0] ?? "";
  return `${creator}${creator && year ? " " : ""}${year}`.trim();
}

function summary(item: Zotero.Item): ItemSummary {
  const library = Zotero.Libraries.get(item.libraryID);
  return {
    key: item.key,
    libraryID: item.libraryID,
    title: item.isNote()
      ? item.getNoteTitle()
      : item.getField("title", false, true) || "",
    creatorYear: creatorYear(item),
    publication: String(
      item.getField("publicationTitle", false, true) ||
        item.getField("conferenceName", false, true) ||
        item.getField("publisher", false, true) ||
        item.getField("repository", false, true) ||
        "",
    ),
    selectURL: selectURL(item),
    libraryName: library ? library.name : "",
    citationKey: item.isRegularItem() ? getCitationKey(item) : undefined,
    isNote: item.isNote(),
  };
}

interface CitekeyRecord {
  itemID: number;
  libraryID: number;
  citationKey: string;
}

function keyManager() {
  return (
    Zotero as unknown as {
      BetterBibTeX?: {
        KeyManager?: {
          get(id: number): CitekeyRecord | undefined;
          all(query: (record: CitekeyRecord) => boolean): CitekeyRecord[];
        };
      };
    }
  ).BetterBibTeX?.KeyManager;
}

export function getCitationKey(item: Zotero.Item): string {
  const native = Zotero.ItemFields.getID("citationKey")
    ? String(item.getField("citationKey", false, true) || "").trim()
    : "";
  return (
    native ||
    keyManager()?.get(item.id)?.citationKey ||
    /^Citation Key:\s*(\S+)\s*$/im.exec(
      String(item.getField("extra", false, true) || ""),
    )?.[1] ||
    ""
  );
}

/** Citation keys can be duplicated across libraries; never silently pick one. */
export async function findCitationItems(key: string): Promise<ItemSummary[]> {
  const ids = new Set(
    keyManager()
      ?.all((record) => record.citationKey === key)
      .map((record) => record.itemID) || [],
  );
  for (const library of Zotero.Libraries.getAll()) {
    if (!["user", "group"].includes(library.libraryType)) continue;
    const search = new Zotero.Search({ libraryID: library.libraryID });
    search.addCondition("deleted", "false");
    search.addCondition("joinMode", "any");
    if (Zotero.ItemFields.getID("citationKey"))
      search.addCondition("citationKey", "is", key);
    search.addCondition("extra", "contains", `Citation Key: ${key}`);
    for (const id of await search.search()) ids.add(id);
  }
  const items = await Zotero.Items.getAsync([...ids]);
  await Zotero.Items.loadDataTypes(items, ["itemData"]);
  return items
    .filter(
      (item) =>
        !item.deleted && item.isRegularItem() && getCitationKey(item) === key,
    )
    .map(summary);
}

export async function searchItems(
  query: string,
  limit = 30,
): Promise<ItemSummary[]> {
  const q = query.trim();
  const libraries = Zotero.Libraries.getAll().filter(
    (lib) => lib.libraryType === "user" || lib.libraryType === "group",
  );
  const matches = await Promise.all(
    libraries.map(async (lib) => {
      const scope = new Zotero.Search({ libraryID: lib.libraryID });
      scope.addCondition("deleted", "false");
      scope.addCondition("itemType", "isNot", "attachment");
      const s = q ? new Zotero.Search({ libraryID: lib.libraryID }) : scope;
      if (q) {
        s.setScope(scope, false);
        s.addCondition("joinMode", "any");
        s.addCondition("title", "contains", q);
        s.addCondition("creator", "contains", q);
        s.addCondition("year", "contains", q);
        if (Zotero.ItemFields.getID("citationKey"))
          s.addCondition("citationKey", "contains", q);
        s.addCondition("extra", "contains", `Citation Key: ${q}`);
      }
      let noteIds: number[] = [];
      if (q) {
        const notes = new Zotero.Search({ libraryID: lib.libraryID });
        notes.addCondition("deleted", "false");
        notes.addCondition("itemType", "is", "note");
        notes.addCondition("note", "contains", q);
        noteIds = await notes.search();
      }
      const ids = [
        ...new Set([
          ...(await s.search()),
          ...noteIds,
          ...(q
            ? keyManager()
                ?.all(
                  (record) =>
                    record.libraryID === lib.libraryID &&
                    record.citationKey.toLowerCase().includes(q.toLowerCase()),
                )
                .map((record) => record.itemID) || []
            : []),
        ]),
      ];
      // Search IDs are not necessarily in Items' cache (especially group items).
      const items = await Zotero.Items.getAsync(ids.slice(0, limit));
      await Zotero.Items.loadDataTypes(items, ["itemData"]);
      return items
        .filter(
          (item) => !item.deleted && (item.isRegularItem() || item.isNote()),
        )
        .map(summary);
    }),
  );
  return matches.flat().slice(0, limit);
}

export async function getItemSummary(
  key: string,
  libraryID: number | null,
): Promise<ItemSummary | null> {
  if (libraryID == null) return null;
  const id = Zotero.Items.getIDFromLibraryAndKey(libraryID, key);
  if (!id) return null;
  const item = await Zotero.Items.getAsync(id);
  if (!item || item.isInTrash() || (!item.isRegularItem() && !item.isNote()))
    return null;
  await Zotero.Items.loadDataTypes([item], ["itemData"]);
  return summary(item);
}

export async function getItemMetadata(key: string, libraryID: number | null) {
  const item = libraryID
    ? await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key)
    : null;
  if (!item || !item.isRegularItem() || item.isInTrash()) return null;
  await Zotero.Items.loadDataTypes([item], ["itemData", "creators", "tags"]);
  const fields = [
    "title",
    "date",
    "publicationTitle",
    "conferenceName",
    "publisher",
    "DOI",
    "url",
  ]
    .map((key) => ({
      key,
      label: Zotero.ItemFields.getLocalizedString(key),
      value: String(item.getField(key, false, true) || ""),
    }))
    .filter((field) => field.value);
  fields.splice(1, 0, {
    key: "creator",
    label: getString("metadata-creators"),
    value: item
      .getCreators()
      .map((creator) =>
        [creator.firstName, creator.lastName].filter(Boolean).join(" "),
      )
      .join("; "),
  });
  return {
    ...summary(item),
    fields,
    tags: item.getTags().map((tag) => tag.tag),
    editable: (Zotero.Libraries.get(item.libraryID) || null)?.editable ?? false,
  };
}

/** Page label of an annotation, falling back to its 1-based page index. */
export function annotationPage(ann: Zotero.Item): string {
  const label = (ann.annotationPageLabel || "").trim();
  if (label) return label;
  try {
    const pos = JSON.parse(ann.annotationPosition || "{}");
    const pageIndex = pos?.position?.pageIndex;
    return typeof pageIndex === "number" ? String(pageIndex + 1) : "";
  } catch {
    return "";
  }
}

/**
 * Quotable subset of an annotation item, or null when there is nothing worth
 * quoting. Highlight and underline both carry `annotationText`; underline
 * annotations created with the default tool leave it empty and are skipped.
 */
export function describeAnnotation(
  ann: Zotero.Item | null | undefined,
): HighlightInfo | null {
  if (!ann) return null;
  const type = ann.annotationType;
  if (type !== "highlight" && type !== "underline") return null;
  const text = (ann.annotationText || "").trim();
  if (!text) return null;
  return {
    id: ann.id,
    key: ann.key,
    text,
    page: annotationPage(ann),
    color: ann.annotationColor || "",
  };
}

/** Walk annotation -> attachment -> regular item; null if none found. */
export function regularItemOf(item: Zotero.Item | null): Zotero.Item | null {
  let current = item;
  for (let hops = 0; current && hops < 5; hops++) {
    if (current.isRegularItem?.()) return current;
    const parentID = current.parentItemID;
    current = parentID ? (Zotero.Items.get(parentID) ?? null) : null;
  }
  return null;
}

export function summaryForItem(item: Zotero.Item): ItemSummary {
  return summary(item);
}

/**
 * Highlights (and coloured underlines) of a regular item's attachments.
 * `cards` is filled in by the API layer, which owns the database import.
 */
export async function getHighlights(
  key: string,
  libraryID: number,
): Promise<HighlightInfo[]> {
  const id = Zotero.Items.getIDFromLibraryAndKey(libraryID, key);
  if (!id) return [];
  const item = await Zotero.Items.getAsync(id);
  if (!item) return [];
  await Zotero.Items.loadDataTypes([item], ["childItems"]);
  const attachments = item.isRegularItem()
    ? await Zotero.Items.getAsync(item.getAttachments())
    : [item];
  await Zotero.Items.loadDataTypes(attachments, ["childItems"]);
  const anns = attachments
    .filter((attachment) => attachment.isFileAttachment())
    .flatMap((attachment) => attachment.getAnnotations());
  const result: HighlightInfo[] = [];
  for (const raw of anns) {
    const ann =
      raw && typeof (raw as unknown as number) !== "number"
        ? raw
        : Zotero.Items.get(raw as unknown as number);
    const info = describeAnnotation(ann);
    if (info) result.push(info);
  }
  return result;
}

/** Resolve annotation item ids (as strings, from the reader) to highlights. */
export function describeAnnotationIDs(
  ids: (string | number)[],
): HighlightInfo[] {
  const result: HighlightInfo[] = [];
  for (const raw of ids) {
    const id = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (!Number.isFinite(id)) continue;
    const info = describeAnnotation(Zotero.Items.get(id));
    if (info) result.push(info);
  }
  return result;
}

/** Regular item an annotation belongs to, given the annotation item id. */
export function annotationSourceItem(
  annotationItemID: number,
): Zotero.Item | null {
  return regularItemOf(Zotero.Items.get(annotationItemID) || null);
}

export async function selectItem(
  key: string,
  libraryID: number | null,
): Promise<void> {
  const item = await getItemSummary(key, libraryID);
  if (!item) throw new Error(`Source item not found: ${key}`);
  const id = Zotero.Items.getIDFromLibraryAndKey(item.libraryID, key);
  if (!id) throw new Error(`Source item not found: ${key}`);
  const win = Zotero.getMainWindow();
  win.focus();
  const pane = (win as unknown as { ZoteroPane?: ZoteroPaneStubs }).ZoteroPane;
  if (!pane) throw new Error("Zotero item pane is unavailable");
  await pane.selectItem(id, { inLibraryRoot: true });
  win.focus();
}

// Minimal structural stubs to keep TS happy without full zotero-types coverage
interface ZoteroPaneStubs {
  selectItem(id: number, options: { inLibraryRoot: boolean }): Promise<unknown>;
}

export async function getSelectedSource(): Promise<ItemSummary | null> {
  const selected = Zotero.getActiveZoteroPane()?.getSelectedItems?.()[0];
  const item = selected?.isNote() ? selected : regularItemOf(selected ?? null);
  if (item) await Zotero.Items.loadDataTypes([item], ["itemData"]);
  return item ? summary(item) : null;
}
