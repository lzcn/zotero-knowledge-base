import { exec, getAll, getOne } from "./db";
import { getFamily } from "./hierarchy";
import { richTextToMarkdown } from "./rich-text";
import { renderMarkdown } from "./markdown";
import { getCitation, prepareCitations, resolveCitation } from "./references";
import { resolveAssetURL } from "./assets";
import { getCitationKey } from "./zotero";
import { getString } from "../utils/locale";
import { getZettel, saveEditorCard, type SaveCardInput } from "./zettel";

interface NoteMapping {
  card_id: string;
  note_key: string;
  library_id: number;
}
export interface NativeCardInput extends SaveCardInput {
  noteID?: number;
  nativeHTML?: string;
  expectedNoteHTML?: string;
  sourceMode?: boolean;
}

const activeNotes = new Set<number>();
let observerID: string | undefined;
let pending = Promise.resolve();
let stopping = false;
const previewImages = new Map<string, string>();

function parse(html: string): Document {
  const win = Zotero.getMainWindow() as Window & {
    DOMParser: typeof DOMParser;
  };
  return new win.DOMParser().parseFromString(html, "text/html");
}

/** A Markdown projection for search, links and the optional source view. */
export function projectNativeNote(html: string): {
  title: string;
  body: string;
} {
  const doc = parse(html);
  const root = doc.querySelector("div[data-schema-version]") || doc.body;
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
  const heading = root.firstElementChild;
  const title = heading?.textContent?.trim() || "";
  if (heading?.tagName === "H1") heading.remove();
  return { title, body: richTextToMarkdown(root as HTMLElement) };
}

export async function nativeNoteHTML(
  title: string,
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
  return `<div data-schema-version="2">${heading.outerHTML}${doc.body.innerHTML}</div>`;
}

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
  if (!note || !note.isNote() || note.deleted)
    throw new Error(getString("editor-note-missing"));
  await Zotero.Items.loadDataTypes([note], ["note", "itemData"]);
  return note;
}

/** Migration is lazy; the original Markdown is never replaced in the backup. */
export async function acquireNativeNote(
  input: SaveCardInput,
): Promise<{ noteID: number; html: string }> {
  if (input.id && !(await getZettel(input.id)))
    throw new Error("CARD_CONFLICT");
  let note = input.id ? await mappedNote(input.id) : null;
  if (!note) {
    note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    const original = input.id ? await getZettel(input.id) : null;
    note.setNote(
      await nativeNoteHTML(
        original?.title ?? input.title,
        original?.body ?? input.body,
      ),
    );
    await note.saveTx();
    if (input.id)
      await exec(
        "INSERT INTO card_notes (card_id, note_key, library_id, original_body) VALUES (?, ?, ?, ?)",
        [input.id, note.key, note.libraryID, original?.body ?? input.body],
      );
  }
  activeNotes.add(note.id);
  return { noteID: note.id, html: note.getNote() };
}

export async function saveNativeCard(
  input: NativeCardInput,
): Promise<{ id: string; updatedAt: number; html?: string; noteID?: number }> {
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
  if (!note || !note.isNote() || note.deleted)
    throw new Error(getString("editor-note-missing"));
  const previous = input.id ? await getZettel(input.id) : null;
  if (
    input.expectedUpdatedAt !== undefined &&
    (previous?.updated_at ?? null) !== input.expectedUpdatedAt
  )
    throw new Error("CARD_CONFLICT: card changed");
  const preparedHTML = input.sourceMode
    ? await nativeNoteHTML(input.title, input.body)
    : null;
  const projection = projectNativeNote(preparedHTML ?? note.getNote());
  const result = await saveEditorCard(
    { ...input, ...projection, draftRevision: undefined },
    async () => {
      if (preparedHTML === null) return;
      await Zotero.DB.executeTransaction(async () => {
        if (
          input.expectedNoteHTML !== note.getNote() &&
          JSON.stringify(projectNativeNote(input.expectedNoteHTML || "")) !==
            JSON.stringify(projectNativeNote(note.getNote()))
        )
          throw new Error("CARD_CONFLICT: note changed");
        note.setNote(preparedHTML);
        await note.save();
      });
    },
  );
  const html = note.getNote();
  await exec(
    "INSERT OR IGNORE INTO card_notes (card_id, note_key, library_id, original_body) VALUES (?, ?, ?, ?)",
    [result.id, note.key, note.libraryID, input.body],
  );
  if (input.draftId && input.draftRevision !== undefined)
    await exec("DELETE FROM editor_drafts WHERE id = ? AND revision <= ?", [
      input.draftId,
      input.draftRevision,
    ]);
  return { ...result, html, noteID: note.id };
}

async function refreshNote(note: Zotero.Item): Promise<void> {
  if (!note.isNote() || note.deleted) return;
  await Zotero.Items.loadDataTypes([note], ["note", "itemData"]);
  const row = await getOne<NoteMapping>(
    "SELECT * FROM card_notes WHERE note_key = ? AND library_id = ?",
    [note.key, note.libraryID],
  );
  if (!row) return;
  const card = await getZettel(row.card_id);
  if (!card) return;
  await prepareCitations(card.body);
  const projection = projectNativeNote(note.getNote());
  if (card.title === projection.title && card.body === projection.body) return;
  await saveEditorCard({
    id: card.id,
    ...projection,
    itemKey: card.item_key,
    libraryID: card.library_id,
    parentId: (await getFamily(card.id)).parent?.id ?? null,
    expectedUpdatedAt: card.updated_at,
  });
}

export function releaseNativeNote(noteID: number): Promise<void> {
  activeNotes.delete(noteID);
  if (stopping) return Promise.resolve();
  pending = pending.then(async () => {
    const note = await Zotero.Items.getAsync(noteID);
    if (note) {
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

export async function initNativeNotes(): Promise<void> {
  if (observerID) return;
  stopping = false;
  observerID = Zotero.Notifier.registerObserver(
    {
      notify(event: string, _type: string, ids: number[] | string[]) {
        if (stopping || !["modify", "add"].includes(event)) return;
        pending = pending
          .then(async () => {
            for (const rawID of ids) {
              const id = Number(rawID);
              if (activeNotes.has(id)) continue;
              const note = await Zotero.Items.getAsync(id);
              if (note) await refreshNote(note);
            }
          })
          .catch((error) => Zotero.logError(error));
        // Do not await another Zotero transaction from within its notifier.
      },
    },
    ["item"],
    "knowledge-base-notes",
  );
  for (const row of await getAll<NoteMapping>("SELECT * FROM card_notes")) {
    const note = await Zotero.Items.getByLibraryAndKeyAsync(
      row.library_id,
      row.note_key,
    );
    if (note) await refreshNote(note);
  }
}

export function stopNativeNotes(): void {
  stopping = true;
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = undefined;
}

export async function closeNativeNotes(): Promise<void> {
  stopNativeNotes();
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
  if (note && !note.deleted) {
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
    const attachment = await Zotero.Items.getByLibraryAndKeyAsync(
      Zotero.Libraries.userLibraryID,
      key,
    );
    if (
      attachment &&
      attachment.isAttachment() &&
      (await attachment.fileExists())
    )
      previewImages.set(key, await attachment.attachmentDataURI);
  }
}

export function nativePreviewHTML(html: string): string {
  const doc = parse(html);
  for (const image of Array.from(
    doc.querySelectorAll("img[data-attachment-key]"),
  ) as Element[]) {
    const url = previewImages.get(image.getAttribute("data-attachment-key")!);
    if (url) image.setAttribute("src", url);
  }
  return doc.body.innerHTML;
}

export async function duplicateNativeNote(
  noteID: number,
  title: string,
  body: string,
): Promise<{ noteID: number; html: string }> {
  const previous = await Zotero.Items.getAsync(noteID);
  if (!previous?.isNote() || previous.deleted)
    throw new Error(getString("editor-note-missing"));
  const note = new Zotero.Item("note");
  note.libraryID = previous.libraryID;
  note.setNote(await nativeNoteHTML(title, body));
  await Zotero.DB.executeTransaction(async () => {
    await note.save();
    await Zotero.Notes.copyEmbeddedImages(previous, note);
  });
  activeNotes.add(note.id);
  return { noteID: note.id, html: note.getNote() };
}
