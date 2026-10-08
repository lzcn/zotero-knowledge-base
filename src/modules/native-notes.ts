import { exec, getAll, getOne, transaction, type NoteKind } from "./db";
import { notifyDataChange } from "./events";
import { getTagInheritance } from "./preferences";
import { getFamily } from "./hierarchy";
import { richTextToMarkdown } from "./rich-text";
import { renderMarkdown } from "./markdown";
import { getCitation, prepareCitations, resolveCitation } from "./references";
import { resolveAssetURL } from "./assets";
import { getCitationKey } from "./zotero";
import { getString } from "../utils/locale";
import { writeNativeNote } from "./note-sessions";
import {
  prepareNoteOperation,
  completeNoteOperation,
  abandonNoteOperation,
  listNoteOperations,
} from "./note-operations";
import {
  getZettel,
  deleteZettel,
  saveEditorCard,
  refreshItemCount,
  type SaveCardInput,
  resolveUnresolvedLinks,
} from "./zettel";

interface NoteMapping {
  card_id: string;
  note_key: string;
  library_id: number;
  external: number;
}
export interface NativeCardInput extends SaveCardInput {
  noteID?: number;
  nativeHTML?: string;
  expectedNoteHTML?: string;
  sourceMode?: boolean;
  sourceDocument?: string;
  restoreDraft?: boolean;
  isCurrent?: () => boolean;
}

const activeNotes = new Set<number>();
let observerID: string | undefined;
let pending = Promise.resolve();
const refreshIDs = new Set<number>();
let refreshQueued = false;
let stopping = false;
let auditing: Promise<void> | undefined;
let auditRequested = false;
const indexedHTML = new Map<number, string>();
const previewImages = new Map<string, string>();

function parse(html: string): Document {
  const win = Zotero.getMainWindow() as Window & {
    DOMParser: typeof DOMParser;
  };
  return new win.DOMParser().parseFromString(html, "text/html");
}

function replaceSimpleCitations(doc: Document, root: Element): void {
  for (const node of Array.from(
    root.querySelectorAll("span[data-citation]"),
  ) as Element[]) {
    const citation = JSON.parse(
      decodeURIComponent(node.getAttribute("data-citation")!),
    );
    if (
      citation.citationItems?.length !== 1 ||
      Object.keys(citation.properties || {}).length
    )
      continue;
    const cited = citation.citationItems[0];
    if (Object.keys(cited).some((key) => !["uris", "itemData"].includes(key)))
      continue;
    const itemID = cited.uris
      ?.map((uri: string) => Zotero.URI.getURIItemID(uri))
      .find(Boolean);
    const item = itemID ? Zotero.Items.get(itemID) : null;
    const key = item ? getCitationKey(item) : "";
    if (item && key && getCitation(key)?.selectURL.endsWith(item.key)) {
      const link = doc.createElement("a");
      link.setAttribute(
        "href",
        "knowledge-base://cite/" + encodeURIComponent(key),
      );
      link.setAttribute("data-citation-key", key);
      link.textContent = node.textContent;
      node.replaceWith(link);
    }
  }
}

/** A Markdown projection for search, links and the optional source view. */
export function projectNativeNote(html: string): {
  title: string;
  body: string;
} {
  const doc = parse(html);
  const root = doc.querySelector("div[data-schema-version]") || doc.body;
  replaceSimpleCitations(doc, root);
  const stored = JSON.parse(
    decodeURIComponent(root.getAttribute("data-citation-items") || "%5B%5D"),
  );
  for (const node of Array.from(
    root.querySelectorAll("[data-citation], [data-annotation]"),
  ) as Element[]) {
    const attribute = node.hasAttribute("data-citation")
      ? "data-citation"
      : "data-annotation";
    const data = JSON.parse(decodeURIComponent(node.getAttribute(attribute)!));
    const items =
      data.citationItems || (data.citationItem ? [data.citationItem] : []);
    for (const item of items) {
      if (!item.itemData)
        item.itemData = stored.find((entry: { uris: string[] }) =>
          entry.uris.some((uri) => item.uris?.includes(uri)),
        )?.itemData;
    }
    node.setAttribute(attribute, encodeURIComponent(JSON.stringify(data)));
  }
  for (const node of Array.from(
    root.querySelectorAll("table, thead, tbody, tfoot, tr"),
  ) as Element[]) {
    for (const child of Array.from(node.childNodes) as ChildNode[])
      if (child.nodeType === 3 && !child.textContent?.trim()) child.remove();
  }
  for (const paragraph of Array.from(
    root.querySelectorAll("td > p, th > p"),
  ) as Element[]) {
    const next = paragraph.nextElementSibling;
    if (next) paragraph.appendChild(doc.createElement("br"));
    paragraph.replaceWith(...(Array.from(paragraph.childNodes) as ChildNode[]));
  }
  const heading = Array.from(root.children).find((element) =>
    element.textContent?.trim(),
  );
  const title = heading?.textContent?.trim() || "";
  if (heading?.tagName === "H1") heading.remove();
  return { title, body: richTextToMarkdown(root as HTMLElement) };
}

export async function nativeNoteHTML(
  title: string | null,
  body: string,
): Promise<string> {
  await prepareCitations(body);
  const win = Zotero.getMainWindow();
  const doc = parse(
    renderMarkdown(
      body,
      win as unknown as Parameters<typeof renderMarkdown>[1],
      resolveAssetURL,
      getCitation,
    ),
  );
  for (const image of Array.from(
    doc.querySelectorAll("img[src]"),
  ) as Element[]) {
    const match =
      /^resource:\/\/knowledge-base-assets\/([a-zA-Z0-9-]+\.(png|jpg|gif|webp|avif))$/.exec(
        image.getAttribute("src") || "",
      );
    if (!match) continue;
    const type = match[2] === "jpg" ? "jpeg" : match[2];
    image.setAttribute(
      "src",
      await Zotero.File.generateDataURI(
        PathUtils.join(
          Zotero.DataDirectory.dir,
          "knowledge-base",
          "assets",
          match[1],
        ),
        `image/${type}`,
      ),
    );
  }
  for (const node of Array.from(
    doc.querySelectorAll("[data-type$='-math']"),
  ) as Element[]) {
    const block = node.getAttribute("data-type") === "block-math";
    const math = doc.createElement(block ? "pre" : "span");
    math.className = "math";
    const delimiter = block ? "$$" : "$";
    math.textContent =
      delimiter + (node.getAttribute("data-latex") || "") + delimiter;
    node.replaceWith(math);
  }
  for (const link of Array.from(
    doc.querySelectorAll("a[data-citation-key]"),
  ) as Element[]) {
    const summary = await resolveCitation(
      link.getAttribute("data-citation-key")!,
    );
    if (!summary) continue;
    const item = await Zotero.Items.getByLibraryAndKeyAsync(
      summary.libraryID,
      summary.key,
    );
    if (!item) continue;
    const citation = {
      citationItems: [
        {
          uris: [Zotero.URI.getItemURI(item)],
          itemData: Zotero.Utilities.Item.itemToCSLJSON(item),
        },
      ],
      properties: {},
    };
    const span = doc.createElement("span");
    span.className = "citation";
    span.setAttribute(
      "data-citation",
      encodeURIComponent(JSON.stringify(citation)),
    );
    span.textContent = link.textContent;
    link.replaceWith(span);
  }
  const heading = doc.createElement("h1");
  heading.textContent = title;
  // Schema 2 is understood by Zotero 7+; the host handles later upgrades.
  return `<div data-schema-version="2">${title === null ? "" : heading.outerHTML}${doc.body.innerHTML}</div>`;
}

export function getMarkdownSource(
  html: string,
  legacyFragments = false,
): {
  title: string;
  body: string;
  fragments: string[];
} {
  const doc = parse(html);
  const root = doc.querySelector("div[data-schema-version]") || doc.body;
  const fragments: string[] = [];
  let tokenPrefix = "knowledge-base-native-fragment-";
  while (html.includes(tokenPrefix)) tokenPrefix += "x";
  replaceSimpleCitations(doc, root);
  // Copied page defaults should not turn ordinary paragraphs into opaque objects.
  for (const node of Array.from(
    legacyFragments ? [] : root.querySelectorAll("[style]"),
  ) as HTMLElement[]) {
    for (const property of ["color", "background-color"]) {
      const value = node.style.getPropertyValue(property).replaceAll(" ", "");
      const neutral =
        property === "color"
          ? /^(?:black|#000(?:000)?|rgb\((?:0,0,0|17,17,17|34,34,34|32,33,36)\)|var\(--(?:tw-prose-bold|yb-md-td-color)\))$/i
          : /^(?:white|transparent|#fff(?:fff)?|rgb\(255,255,255\)|rgba\(255,255,255,(?:0|0\.7)\))$/i;
      if (neutral.test(value)) node.style.removeProperty(property);
    }
    if (!node.getAttribute("style")?.trim()) node.removeAttribute("style");
  }
  for (const node of Array.from(
    root.querySelectorAll(
      "img, [data-citation], [data-annotation], [style], table",
    ),
  ) as Element[]) {
    if (
      !root.contains(node) ||
      (node === root.firstElementChild && node.tagName === "H1")
    )
      continue;
    if (
      /^(TABLE|DIV|P|PRE|BLOCKQUOTE|UL|OL|H[1-6])$/.test(node.tagName) &&
      !node.hasAttribute("style") &&
      !node.querySelector(
        "[colspan], [rowspan], img, [data-citation], [data-annotation], [style]",
      )
    )
      continue;
    const index = fragments.push(node.outerHTML) - 1;
    const marker = doc.createElement("a");
    marker.setAttribute(
      "href",
      legacyFragments ? `knowledge-base://fragment/${index}` : `zkb:${index}`,
    );
    marker.textContent =
      node.getAttribute("alt") ||
      node.textContent?.trim() ||
      getString("editor-image");
    if (!legacyFragments) {
      const placeholder = doc.createElement("span");
      placeholder.textContent = `${tokenPrefix}${index}-end`;
      node.replaceWith(placeholder);
    } else node.replaceWith(marker);
  }
  const projected = projectNativeNote(root.outerHTML);
  if (!legacyFragments)
    fragments.forEach((fragment, index) => {
      projected.body = projected.body.replaceAll(
        `${tokenPrefix}${index}-end`,
        fragment,
      );
    });
  return { ...projected, fragments };
}

function restoreMarkdownFragments(
  html: string,
  original: string,
  fullDocument = false,
): string {
  const doc = parse(html);
  const originalDoc = parse(original);
  const fragments = getMarkdownSource(original).fragments;
  for (const marker of Array.from(
    doc.querySelectorAll(
      'a[href^="knowledge-base://fragment/"], a[href^="zkb:"]',
    ),
  ) as Element[]) {
    const match = /^(?:knowledge-base:\/\/fragment\/|zkb:)(\d+)$/.exec(
      marker.getAttribute("href") || "",
    );
    const available = marker.getAttribute("href")?.startsWith("knowledge-base:")
      ? getMarkdownSource(original, true).fragments
      : fragments;
    if (!match || !available[Number(match[1])])
      throw new Error("CARD_CONFLICT: native fragment unavailable");
    const fragment = parse(available[Number(match[1])]);
    const node = doc.importNode(
      fragment.body.firstElementChild!,
      true,
    ) as Element;
    if (
      /^(TABLE|DIV|P|PRE|BLOCKQUOTE|UL|OL|H[1-6])$/.test(node.tagName) &&
      marker.parentElement?.tagName === "P" &&
      marker.parentElement.childNodes.length === 1
    )
      marker.parentElement.replaceWith(node);
    else marker.replaceWith(node);
  }
  const root = doc.querySelector("div[data-schema-version]");
  const heading = originalDoc.querySelector(
    "div[data-schema-version] > h1:first-child",
  );
  const renderedHeading = root?.firstElementChild;
  if (heading && renderedHeading?.tagName === "H1")
    for (const attribute of Array.from(heading.attributes))
      renderedHeading.setAttribute(attribute.name, attribute.value);
  const originalRoot =
    originalDoc.querySelector("div[data-schema-version]") || originalDoc.body;
  const firstOriginal = Array.from(originalRoot.children).find((element) =>
    element.textContent?.trim(),
  );
  if (
    !fullDocument &&
    firstOriginal &&
    firstOriginal.tagName !== "H1" &&
    renderedHeading?.tagName === "H1" &&
    renderedHeading.textContent === getMarkdownSource(original).title
  )
    renderedHeading.remove();
  const data = originalDoc
    .querySelector("[data-citation-items]")
    ?.getAttribute("data-citation-items");
  if (root && data) root.setAttribute("data-citation-items", data);
  return root?.outerHTML || doc.body.innerHTML;
}

/** Restore unchanged native payloads after sanitizing the editable Markdown. */
function protectNativePayloads(source: string, original: string): string {
  getMarkdownSource(original).fragments.forEach((fragment, index) => {
    source = source.replaceAll(fragment, `[native](zkb:${index})`);
  });
  return source;
}

export async function markdownNoteHTML(
  title: string,
  body: string,
  original: string,
): Promise<string> {
  return restoreMarkdownFragments(
    await nativeNoteHTML(title, protectNativePayloads(body, original)),
    original,
  );
}

/** One complete Markdown document for ordinary Zotero notes, without a separate title. */
export function getMarkdownDocument(html: string): string {
  const doc = parse(html);
  const root = doc.querySelector("div[data-schema-version]") || doc.body;
  const first = Array.from(root?.children || []).find((node) =>
    node.textContent?.trim(),
  );
  const { title, body } = getMarkdownSource(html);
  return first?.tagName === "H1" ? `# ${title}\n\n${body}`.trimEnd() : body;
}

export async function markdownDocumentHTML(
  source: string,
  original: string,
): Promise<string> {
  return restoreMarkdownFragments(
    await nativeNoteHTML(null, protectNativePayloads(source, original)),
    original,
    true,
  );
}

export interface NoteHealth {
  note: "available" | "legacy" | "trashed" | "missing";
  source: "available" | "none" | "trashed" | "missing";
  editable: boolean;
}

/** Keep Trash mappings; remove cards only after confirming their original no longer exists. */
export function auditNativeNotes(): Promise<void> {
  auditRequested = true;
  if (auditing) return auditing;
  auditing = (async () => {
    while (auditRequested && !stopping) {
      auditRequested = false;
      const changed: string[] = [];
      const rows = await getAll<NoteMapping>("SELECT * FROM card_notes");
      for (let index = 0; index < rows.length && !stopping; index++) {
        const row = rows[index];
        const note =
          (await Zotero.Items.getByLibraryAndKeyAsync(
            row.library_id,
            row.note_key,
          )) || null;
        if (!note?.isNote()) {
          // A transient Items-cache miss must not destroy a recoverable association.
          const exists = await Zotero.DB.valueQueryAsync(
            "SELECT itemID FROM items WHERE libraryID = ? AND key = ?",
            [row.library_id, row.note_key],
          );
          if (!exists && !stopping) await deleteZettel(row.card_id);
          continue;
        }
        const state = note.isInTrash() ? "trashed" : null;
        const previous = await getOne<{ state: string }>(
          "SELECT state FROM unavailable_notes WHERE card_id = ?",
          [row.card_id],
        );
        if ((previous?.state ?? null) !== state) {
          if (state)
            await exec(
              "INSERT OR REPLACE INTO unavailable_notes(card_id, state) VALUES (?, ?)",
              [row.card_id, state],
            );
          else
            await exec("DELETE FROM unavailable_notes WHERE card_id = ?", [
              row.card_id,
            ]);
          changed.push(row.card_id);
        }
        if (!state && note && !activeNotes.has(note.id))
          await refreshNote(note);
        if (index % 20 === 19) await Zotero.Promise.delay(0);
      }
      if (changed.length && !stopping)
        notifyDataChange({ cardIDs: changed, fields: ["availability"] });
    }
  })().finally(() => {
    auditing = undefined;
  });
  return auditing;
}

export async function getNoteHealth(id: string): Promise<NoteHealth> {
  const card = await getZettel(id);
  const mapping = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE card_id = ?",
    [id],
  );
  const note = mapping
    ? (await Zotero.Items.getByLibraryAndKeyAsync(
        mapping.library_id,
        mapping.note_key,
      )) || null
    : null;
  const source =
    card?.item_key && card.library_id
      ? (await Zotero.Items.getByLibraryAndKeyAsync(
          card.library_id,
          card.item_key,
        )) || null
      : null;
  return {
    note: !card
      ? "missing"
      : !mapping
        ? "legacy"
        : !note?.isNote()
          ? "missing"
          : note.isInTrash()
            ? "trashed"
            : "available",
    source: !card?.item_key
      ? "none"
      : !source
        ? "missing"
        : source.isInTrash()
          ? "trashed"
          : "available",
    editable: !!(
      Zotero.Libraries.get(
        note?.libraryID ??
          mapping?.library_id ??
          card?.library_id ??
          Zotero.Libraries.userLibraryID,
      ) || null
    )?.editable,
  };
}

export async function restoreNote(id: string): Promise<void> {
  const mapping = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE card_id = ?",
    [id],
  );
  const card = await getZettel(id);
  const note = mapping
    ? (await Zotero.Items.getByLibraryAndKeyAsync(
        mapping.library_id,
        mapping.note_key,
      )) || null
    : null;
  const source =
    card?.item_key && card.library_id
      ? (await Zotero.Items.getByLibraryAndKeyAsync(
          card.library_id,
          card.item_key,
        )) || null
      : null;
  if (mapping && !note) throw new Error("NOTE_UNAVAILABLE");
  await Zotero.DB.executeTransaction(async () => {
    const restore = async (item: Zotero.Item | null) => {
      if (!item) return;
      if (!(Zotero.Libraries.get(item.libraryID) || null)?.editable)
        throw new Error("Library is read-only");
      if (item.parentItemID)
        await restore(await Zotero.Items.getAsync(item.parentItemID));
      if (item.deleted) {
        item.deleted = false;
        await item.save();
      }
    };
    await restore(source);
    await restore(note);
  });
  await auditNativeNotes();
  notifyDataChange({
    cardIDs: [id],
    noteIDs: note ? [note.id] : [],
    itemKeys: source ? [source.key] : [],
    fields: ["availability"],
  });
}

export { getEffectiveNoteTags as getNoteTags } from "./note-tags";

async function mappedNote(id: string): Promise<Zotero.Item | null> {
  const row = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE card_id = ?",
    [id],
  );
  if (!row) return null;
  const note = await Zotero.Items.getByLibraryAndKeyAsync(
    row.library_id,
    row.note_key,
  );
  if (!note || !note.isNote() || note.isInTrash())
    throw new Error("NOTE_UNAVAILABLE");
  await Zotero.Items.loadDataTypes([note], ["note", "itemData"]);
  return note;
}

async function organizeNativeNote(
  note: Zotero.Item,
  input: SaveCardInput,
  relocate = false,
): Promise<void> {
  // Opening existing user notes preserves placement; saving a source can relocate them.
  const mapping = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
    [note.key, note.libraryID],
  );
  if (mapping?.external && !relocate) return;
  const library = Zotero.Libraries.get(note.libraryID);
  if (!library || !library.editable) return;
  await Zotero.Items.loadDataTypes([note], ["collections"]);
  let source = input.itemKey
    ? await Zotero.Items.getByLibraryAndKeyAsync(
        input.libraryID ?? note.libraryID,
        input.itemKey,
      )
    : null;
  if (input.itemKey && (!source || source.isInTrash())) return;
  if (source && !source.isRegularItem() && source.parentItemID)
    source = await Zotero.Items.getAsync(source.parentItemID);
  if (input.itemKey && source && source.isInTrash()) return;
  const parent =
    source &&
    source.isRegularItem() &&
    !source.deleted &&
    source.libraryID === note.libraryID
      ? source.id
      : false;
  await Zotero.DB.executeTransaction(async () => {
    let destination = parent;
    if (!destination) {
      const pref = `extensions.zotero.knowledge-base.notes.parent.${note.libraryID}`;
      const key = Zotero.Prefs.get(pref, true);
      let personal =
        typeof key === "string"
          ? await Zotero.Items.getByLibraryAndKeyAsync(note.libraryID, key)
          : null;
      if (personal && !personal.isRegularItem())
        throw new Error("Personal knowledge parent is not a regular item");
      if (!personal) {
        personal = new Zotero.Item("document");
        personal.libraryID = note.libraryID;
        personal.setField("title", getString("personal-knowledge-title"));
        await personal.save({ skipSelect: true });
        Zotero.Prefs.set(pref, personal.key, true);
      } else if (personal.deleted) {
        personal.deleted = false;
        await personal.save({ skipSelect: true });
      }
      destination = personal.id;
    }
    if (note.parentItemID === destination) return;
    // Zotero otherwise moves a standalone note's collections onto its parent.
    if (note.getCollections().length) {
      note.setCollections([]);
      await note.save({ skipSelect: true });
    }
    note.parentItemID = destination;
    await note.save({ skipSelect: true });
  });
}

/** Create the native note on first edit and retain its initial body snapshot. */
export async function acquireNativeNote(
  input: NativeCardInput,
): Promise<{ noteID: number; html: string }> {
  if (input.id && !(await getZettel(input.id)))
    throw new Error("CARD_CONFLICT");
  let note = input.id ? await mappedNote(input.id) : null;
  if (input.noteID) {
    if (note && note.id !== input.noteID)
      throw new Error("CARD_CONFLICT: note mapping changed");
    note = note || (await Zotero.Items.getAsync(input.noteID)) || null;
    if (!note || !note.isNote() || note.isInTrash())
      throw new Error("NOTE_UNAVAILABLE");
    await Zotero.Items.loadDataTypes([note], ["note", "itemData"]);
  }
  const original = input.id ? await getZettel(input.id) : null;
  if (!note) {
    note = new Zotero.Item("note");
    note.libraryID =
      (original?.kind ?? input.kind) === "literature"
        ? (original?.library_id ??
          input.libraryID ??
          Zotero.Libraries.userLibraryID)
        : Zotero.Libraries.userLibraryID;
    note.setNote(
      await nativeNoteHTML(
        original?.title ?? input.title,
        original?.body ?? input.body,
      ),
    );
    // Avoid opening a second native editor while legacy images are imported.
    await note.saveTx({ skipSelect: true });
    if (input.id)
      await exec(
        "INSERT INTO card_notes (card_id, note_key, library_id, original_body) VALUES (?, ?, ?, ?)",
        [input.id, note.key, note.libraryID, original?.body ?? input.body],
      );
  }
  activeNotes.add(note.id);
  try {
    await organizeNativeNote(
      note,
      original
        ? {
            ...input,
            itemKey: original.item_key,
            libraryID: original.library_id,
          }
        : input,
    );
  } catch (error) {
    activeNotes.delete(note.id);
    throw error;
  }
  return { noteID: note.id, html: note.getNote() };
}

export async function saveNativeCard(
  input: NativeCardInput,
): Promise<{ id: string; updatedAt: number; html?: string; noteID?: number }> {
  const existing = input.id ? await getZettel(input.id) : null;
  const kind = input.kind ?? existing?.kind;
  if (kind === "literature") {
    const source =
      input.itemKey && input.libraryID
        ? await Zotero.Items.getByLibraryAndKeyAsync(
            input.libraryID,
            input.itemKey,
          )
        : null;
    if (
      (!source || !source.isRegularItem() || source.isInTrash()) &&
      !(
        existing?.kind === "literature" &&
        existing.item_key === input.itemKey &&
        existing.library_id === input.libraryID
      )
    )
      throw new Error("LITERATURE_SOURCE_REQUIRED");
  }
  if (!input.noteID) {
    if (input.sourceMode === undefined) return saveEditorCard(input);
    const acquired = await acquireNativeNote(input);
    input = {
      ...input,
      noteID: acquired.noteID,
      expectedNoteHTML: input.expectedNoteHTML ?? acquired.html,
    };
  }
  const note = await Zotero.Items.getAsync(input.noteID!);
  if (!note || !note.isNote() || note.isInTrash())
    throw new Error("NOTE_UNAVAILABLE");
  const mapping = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
    [note.key, note.libraryID],
  );
  if (mapping && mapping.card_id !== input.id)
    throw new Error("CARD_CONFLICT: note already belongs to another card");
  if (input.id) {
    const mapped = await mappedNote(input.id);
    if (mapped && mapped.id !== note.id)
      throw new Error("CARD_CONFLICT: note mapping changed");
  }
  const previous = input.id ? await getZettel(input.id) : null;
  if (
    input.expectedUpdatedAt !== undefined &&
    (previous?.updated_at ?? null) !== input.expectedUpdatedAt
  )
    throw new Error("CARD_CONFLICT: card changed");
  const preparedHTML = input.sourceMode
    ? input.restoreDraft && input.nativeHTML
      ? input.nativeHTML
      : input.sourceDocument !== undefined
        ? input.expectedNoteHTML &&
          getMarkdownDocument(input.expectedNoteHTML) === input.sourceDocument
          ? input.expectedNoteHTML
          : await markdownDocumentHTML(
              input.sourceDocument,
              input.expectedNoteHTML || "",
            )
        : input.expectedNoteHTML &&
            getMarkdownSource(input.expectedNoteHTML).title === input.title &&
            getMarkdownSource(input.expectedNoteHTML).body === input.body
          ? input.expectedNoteHTML
          : await markdownNoteHTML(
              input.title,
              input.body,
              input.expectedNoteHTML || "",
            )
    : null;
  const projection = projectNativeNote(preparedHTML ?? note.getNote());
  const operation = await prepareNoteOperation(
    { ...input, ...projection },
    note,
    preparedHTML ?? note.getNote(),
    previous?.updated_at ?? null,
  );
  input = { ...input, id: operation.input.id };
  let nativeCommitted = false;
  let result;
  try {
    result = await saveEditorCard(
      {
        ...input,
        ...projection,
        expectedUpdatedAt: operation.expectedVersion,
        draftRevision: undefined,
      },
      async () => {
        if (input.isCurrent && !input.isCurrent())
          throw new Error("NOTE_SESSION_CLOSED");
        nativeCommitted = preparedHTML === null;
        if (preparedHTML !== null) {
          try {
            const committed = await writeNativeNote(
              note,
              input.expectedNoteHTML || "",
              preparedHTML,
              undefined,
              input.isCurrent,
            );
            operation.intendedHTML = committed.html;
            nativeCommitted = true;
          } catch (error) {
            if (String(error).includes("NOTE_CONFLICT"))
              throw new Error("CARD_CONFLICT: note changed");
            throw error;
          }
        }
        await organizeNativeNote(
          note,
          input,
          !!input.itemKey ||
            (!!previous &&
              (previous.item_key !== (input.itemKey ?? null) ||
                previous.library_id !== (input.libraryID ?? null))),
        );
        await exec(
          "INSERT OR IGNORE INTO card_notes (card_id, note_key, library_id, original_body) VALUES (?, ?, ?, ?)",
          [operation.input.id!, note.key, note.libraryID, input.body],
        );
        await completeNoteOperation(operation);
      },
    );
  } catch (error) {
    if (!nativeCommitted) await abandonNoteOperation(operation);
    throw error;
  }
  const html = operation.intendedHTML;
  return { ...result, html, noteID: note.id };
}

/** Reconcile interrupted cross-database saves without overwriting an intervening edit. */
export async function recoverNativeSaves(
  shouldStop = () => false,
): Promise<void> {
  for (const operation of await listNoteOperations()) {
    if (shouldStop()) return;
    try {
      const note = await Zotero.Items.getByLibraryAndKeyAsync(
        operation.libraryID,
        operation.noteKey,
      );
      if (!note || !note.isNote() || note.isInTrash() || !note.isEditable())
        continue;
      await Zotero.Items.loadDataTypes([note], ["note"]);
      const html = note.getNote();
      if (
        getMarkdownDocument(html) !==
        getMarkdownDocument(operation.intendedHTML)
      ) {
        if (html === operation.expectedHTML)
          await abandonNoteOperation(operation);
        continue;
      }
      const card = await getZettel(operation.input.id!);
      if ((card?.updated_at ?? null) !== operation.expectedVersion) continue;
      const mapping = await getOne<NoteMapping>(
        "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
        [note.key, note.libraryID],
      );
      if (mapping && mapping.card_id !== operation.input.id) continue;
      await saveEditorCard(
        {
          ...operation.input,
          ...projectNativeNote(html),
          expectedUpdatedAt: operation.expectedVersion,
        },
        async () => {
          if (shouldStop()) throw new Error("NOTE_SESSION_CLOSED");
          // Compare inside Zotero's transaction; recovery never writes old note content.
          await writeNativeNote(
            note,
            html,
            html,
            undefined,
            () => !shouldStop(),
          );
          if (shouldStop()) throw new Error("NOTE_SESSION_CLOSED");
          await organizeNativeNote(
            note,
            operation.input,
            !!operation.input.itemKey || !!card?.item_key,
          );
          await exec(
            "INSERT OR IGNORE INTO card_notes (card_id, note_key, library_id, original_body) VALUES (?, ?, ?, ?)",
            [
              operation.input.id!,
              note.key,
              note.libraryID,
              operation.input.body,
            ],
          );
          await completeNoteOperation(operation);
        },
      );
    } catch (error) {
      Zotero.logError(
        new Error(
          `Knowledge Base interrupted save ${operation.id}: ${String(error)}`,
        ),
      );
    }
  }
}

async function refreshNote(note: Zotero.Item): Promise<void> {
  if (!note.isNote() || note.isInTrash()) return;
  await Zotero.Items.loadDataTypes([note], ["note", "itemData"]);
  const html = note.getNote();
  if (indexedHTML.get(note.id) === html) return;
  const row = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
    [note.key, note.libraryID],
  );
  if (!row) return;
  const card = await getZettel(row.card_id);
  if (!card) return;
  await prepareCitations(card.body);
  const projection = projectNativeNote(html);
  if (card.title === projection.title && card.body === projection.body) {
    indexedHTML.set(note.id, html);
    return;
  }
  await saveEditorCard({
    id: card.id,
    ...projection,
    itemKey: card.item_key,
    libraryID: card.library_id,
    parentId: (await getFamily(card.id)).parent?.id ?? null,
    expectedUpdatedAt: card.updated_at,
  });
  indexedHTML.set(note.id, html);
}

export function releaseNativeNote(noteID: number): Promise<void> {
  activeNotes.delete(noteID);
  if (stopping) return Promise.resolve();
  pending = pending.then(async () => {
    const note = await Zotero.Items.getAsync(noteID);
    if (note && !note.isInTrash()) {
      const projection = projectNativeNote(note.getNote());
      const mapped = await getOne<NoteMapping>(
        "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
        [note.key, note.libraryID],
      );
      if (
        !mapped &&
        !projection.title &&
        !projection.body.trim() &&
        !note.deleted
      ) {
        note.deleted = true;
        await note.saveTx();
      } else await refreshNote(note);
    }
  });
  return pending;
}

function reportAuditError(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}

export async function initNativeNotes(): Promise<void> {
  if (observerID) return;
  stopping = false;
  observerID = Zotero.Notifier.registerObserver(
    {
      notify(event: string, _type: string, ids: number[] | string[]) {
        if (!stopping && _type === "trash" && event === "refresh") {
          // Zotero restores emit refresh/trash rather than a restore/item event.
          void auditNativeNotes().catch(reportAuditError);
          return;
        }
        if (
          stopping ||
          !["modify", "add", "delete", "remove", "trash", "restore"].includes(
            event,
          )
        )
          return;
        if (_type === "setting") {
          notifyDataChange({ all: true, fields: ["tags"] });
          return;
        }
        const noteIDs = ids
          .map((id) => Number(String(id).split("-")[0]))
          .filter(Number.isSafeInteger);
        if (["delete", "trash", "restore"].includes(event)) {
          void auditNativeNotes().catch(reportAuditError);
          notifyDataChange({ noteIDs, fields: ["availability"] });
        }
        if (_type === "item-tag") {
          if (getTagInheritance()) {
            notifyDataChange({ all: true, fields: ["tags"] });
            return;
          }
          pending = pending
            .catch((error) => Zotero.logError(error))
            .then(async () => {
              for (const id of noteIDs) {
                if (stopping) return;
                const note = await Zotero.Items.getAsync(id);
                if (!note?.isNote()) continue;
                const row = await getOne<NoteMapping>(
                  "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
                  [note.key, note.libraryID],
                );
                if (row)
                  notifyDataChange({
                    cardIDs: [row.card_id],
                    noteIDs: [id],
                    fields: ["tags"],
                  });
              }
            })
            .catch((error) => Zotero.logError(error));
          return;
        }
        const eligibleIDs = ids.filter((id) => !activeNotes.has(Number(id)));
        if (!eligibleIDs.length) return;
        eligibleIDs.forEach((id) => refreshIDs.add(Number(id)));
        if (refreshQueued) return;
        refreshQueued = true;
        pending = pending
          .catch((error) => Zotero.logError(error))
          .then(async () => {
            try {
              while (refreshIDs.size && !stopping) {
                const batch = [...refreshIDs];
                refreshIDs.clear();
                for (const id of batch) {
                  if (stopping) return;
                  if (activeNotes.has(id)) continue;
                  const note = await Zotero.Items.getAsync(id);
                  if (!note) continue;
                  previewImages.delete(note.key);
                  if (note.isRegularItem()) {
                    const key = getCitationKey(note);
                    const affected = key
                      ? await resolveUnresolvedLinks(
                          () => stopping,
                          [`@${key}`],
                        )
                      : new Set<string>();
                    notifyDataChange({
                      cardIDs: [...affected],
                      itemKeys: [note.key],
                      fields: affected.size
                        ? ["source", "identity", "links"]
                        : ["source", "identity"],
                    });
                  } else await refreshNote(note);
                }
              }
            } finally {
              refreshQueued = false;
            }
          })
          .catch((error) => Zotero.logError(error));
        // Do not await another Zotero transaction from within its notifier.
      },
    },
    ["item", "item-tag", "setting", "trash"],
    "knowledge-base-notes",
  );
  await auditNativeNotes();
  for (const row of await getAll<NoteMapping>("SELECT * FROM card_notes")) {
    const note = await Zotero.Items.getByLibraryAndKeyAsync(
      row.library_id,
      row.note_key,
    );
    if (note && !note.isInTrash()) {
      activeNotes.add(note.id);
      try {
        const card = await getZettel(row.card_id);
        if (card)
          await organizeNativeNote(note, {
            title: card.title,
            body: card.body,
            itemKey: card.item_key,
            libraryID: card.library_id,
          });
        await refreshNote(note);
      } catch (error) {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        activeNotes.delete(note.id);
      }
    }
  }
}

export function stopNativeNotes(): void {
  stopping = true;
  refreshIDs.clear();
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = undefined;
}

export async function closeNativeNotes(): Promise<void> {
  stopNativeNotes();
  await auditing;
  indexedHTML.clear();
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = undefined;
  await pending;
  activeNotes.clear();
  previewImages.clear();
}

export async function trashNativeNote(id: string): Promise<void> {
  const row = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE card_id = ?",
    [id],
  );
  if (!row) return;
  const note = await Zotero.Items.getByLibraryAndKeyAsync(
    row.library_id,
    row.note_key,
  );
  if (!row.external && note && !note.deleted) {
    note.deleted = true;
    await note.saveTx();
  }
  await exec("DELETE FROM card_notes WHERE card_id = ?", [id]);
}

/** Native images have attachment keys, so previews resolve them through Zotero. */
export async function prepareNativePreview(body: string): Promise<void> {
  const keys = new Set(
    [...body.matchAll(/data-attachment-key="([A-Z0-9]{8})"/g)].map(
      (match) => match[1],
    ),
  );
  for (const key of keys) {
    if (previewImages.has(key)) continue;
    const matches = (
      await Promise.all(
        Zotero.Libraries.getAll().map(async (library) => {
          if (!["user", "group"].includes(library.libraryType)) return null;
          const item = await Zotero.Items.getByLibraryAndKeyAsync(
            library.libraryID,
            key,
          );
          return item &&
            item.isAttachment() &&
            !item.isInTrash() &&
            (await item.fileExists())
            ? item
            : null;
        }),
      )
    ).filter((item): item is Zotero.Item => !!item);
    if (matches.length === 1)
      previewImages.set(key, await matches[0].attachmentDataURI);
  }
}

export function nativePreviewHTML(html: string): string {
  const doc = parse(html);
  for (const image of Array.from(
    doc.querySelectorAll("img[data-attachment-key]"),
  ) as Element[]) {
    const url = previewImages.get(image.getAttribute("data-attachment-key")!);
    if (url) image.setAttribute("src", url);
    else {
      image.removeAttribute("src");
      image.setAttribute("alt", getString("preview-image-missing"));
    }
  }
  return doc.body.innerHTML;
}

export async function duplicateNativeNote(
  noteID: number,
  title: string,
  body: string,
  html?: string,
): Promise<{ noteID: number; html: string }> {
  const previous = await Zotero.Items.getAsync(noteID);
  if (!previous?.isNote()) throw new Error("NOTE_UNAVAILABLE");
  const note = new Zotero.Item("note");
  note.libraryID = previous.libraryID;
  note.setNote(html ?? (await nativeNoteHTML(title, body)));
  await Zotero.DB.executeTransaction(async () => {
    await note.save({ skipSelect: true });
    await Zotero.Notes.copyEmbeddedImages(previous, note);
  });
  activeNotes.add(note.id);
  return { noteID: note.id, html: note.getNote() };
}

export async function isExternalNote(id: string): Promise<boolean> {
  return !!(
    await getOne<NoteMapping>("SELECT * FROM card_notes WHERE card_id = ?", [
      id,
    ])
  )?.external;
}

/** Repeated requests open the same literature record, including before editing. */
export async function ensureLiteratureNote(
  itemKey: string,
  libraryID: number,
): Promise<string> {
  const source = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
  if (!source || !source.isRegularItem() || source.deleted)
    throw new Error("LITERATURE_SOURCE_REQUIRED");
  // Serialize discovery and creation on the plugin connection.
  const id = await transaction(async () => {
    const found = await getOne<{ id: string }>(
      "SELECT id FROM zettels WHERE kind = 'literature' AND item_key = ? AND library_id = ?",
      [itemKey, libraryID],
    );
    if (found) return found.id;
    const id = `literature-${libraryID}-${itemKey}`;
    const now = Date.now();
    await exec(
      "INSERT INTO zettels (id, title, title_folded, body, item_key, library_id, kind, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, 'literature', ?, ?)",
      [
        id,
        source.getField("title"),
        source.getField("title").toLowerCase(),
        itemKey,
        libraryID,
        now,
        now,
      ],
    );
    await exec(
      "INSERT INTO card_parents (card_id, parent_id) VALUES (?, NULL)",
      [id],
    );
    return id;
  });
  await refreshItemCount(itemKey);
  notifyDataChange({
    cardIDs: [id],
    itemKeys: [itemKey],
    fields: ["availability", "identity", "source"],
  });
  return id;
}
