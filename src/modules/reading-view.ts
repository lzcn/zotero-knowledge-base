import { getString } from "../utils/locale";
import { getZettel } from "./zettel";
import { acquireNativeNote } from "./native-notes";

/** Open the native PDF tab and select the corresponding note without an extra picker. */
export async function openReadingNote(id: string): Promise<void> {
  const note = await getZettel(id);
  const item =
    note?.item_key && note.library_id
      ? await Zotero.Items.getByLibraryAndKeyAsync(
          note.library_id,
          note.item_key,
        )
      : null;
  if (!note || !item || item.deleted)
    throw new Error(getString("reading-no-pdf"));
  await Zotero.Items.loadDataTypes([item], ["childItems"]);
  const best = await item.getBestAttachment();
  const attachments = await Zotero.Items.getAsync(item.getAttachments());
  const pdf = [best, ...attachments].find(
    (attachment) =>
      attachment && !attachment.deleted && attachment.isPDFAttachment(),
  );
  if (!pdf) throw new Error(getString("reading-no-pdf"));
  if (!(await pdf.getFilePathAsync()))
    throw new Error(getString("reading-file-missing"));
  const native = await acquireNativeNote({
    id,
    title: note.title,
    body: note.body,
  });
  if (!addon.data.alive) return;
  await Zotero.Reader.open(pdf.id);
  if (!addon.data.alive) return;
  const win = Zotero.getMainWindow() as unknown as Window & {
    Zotero_Tabs: { selectedID: string };
    ZoteroContextPane: {
      collapsed: boolean;
      activeEditor?: { item?: Zotero.Item };
      context: {
        mode: string;
        _setupNotesContext(tabID: string): Promise<void>;
        _getCurrentNotesContext(): { _setPinnedNote(note: Zotero.Item): void };
      };
    };
  };
  const pane = win.ZoteroContextPane;
  pane.collapsed = false;
  pane.context.mode = "notes";
  await pane.context._setupNotesContext(win.Zotero_Tabs.selectedID);
  const target = Zotero.Items.get(native.noteID);
  if (pane.activeEditor?.item?.id !== target.id)
    pane.context._getCurrentNotesContext()._setPinnedNote(target);
  win.focus();
}
