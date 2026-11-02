import { config } from "../../package.json";
import { getString } from "../utils/locale";

const buttons = new Map<
  Document,
  { button: HTMLButtonElement; dispose(): void }
>();
let registered = false;
let iconURL = "";
let openVersion = 0;

function addButton(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
  append: (button: HTMLButtonElement) => void,
): void {
  if (!registered) return;
  const previous = buttons.get(doc);
  if (previous?.button.isConnected) return;
  previous?.dispose();
  const win = doc.defaultView!;
  const button = doc.createElement("button");
  button.id = "knowledge-base-reader-button";
  button.className = "toolbar-button";
  button.type = "button";
  button.tabIndex = -1;
  button.title = getString("menu-open-manager");
  button.setAttribute("aria-label", button.title);
  const icon = doc.createElement("img");
  icon.src = iconURL;
  icon.width = icon.height = 20;
  icon.alt = "";
  icon.draggable = false;
  button.append(icon);
  let disposed = false;
  const open = async () => {
    if (button.disabled || disposed) return;
    const version = ++openVersion;
    button.disabled = true;
    try {
      const attachment = reader.itemID
        ? await Zotero.Items.getAsync(reader.itemID)
        : undefined;
      const source = attachment?.parentItemID
        ? await Zotero.Items.getAsync(attachment.parentItemID)
        : attachment;
      if (disposed || !registered || version !== openVersion) return;
      const note = source?.isRegularItem()
        ? (await addon.api.listByItem(source.key, source.libraryID)).find(
            (note) => note.source_note,
          )
        : undefined;
      if (!disposed && registered && version === openVersion)
        addon.api.openManager(note ? { selectId: note.id } : {});
    } catch (error) {
      if (!disposed)
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
    } finally {
      if (!disposed) button.disabled = false;
    }
  };
  const dispose = () => {
    disposed = true;
    button.removeEventListener("click", open);
    win.removeEventListener("unload", dispose);
    const section = button.parentElement;
    button.remove();
    if (section?.classList.contains("section") && !section.childNodes.length)
      section.remove();
    if (buttons.get(doc)?.button === button) buttons.delete(doc);
  };
  button.addEventListener("click", open);
  win.addEventListener("unload", dispose, { once: true });
  buttons.set(doc, { button, dispose });
  append(button);
}

function renderToolbar(
  event: _ZoteroTypes.Reader.EventParams<"renderToolbar">,
): void {
  addButton(event.reader, event.doc, event.append);
}

export function registerReaderToolbar(): void {
  if (registered) return;
  // Reader content cannot load chrome images directly; keep its icon self-contained.
  iconURL =
    "data:image/svg+xml," +
    encodeURIComponent(
      Zotero.File.getContentsFromURL(
        `chrome://${config.addonRef}/content/icons/icon-20.svg`,
      ),
    );
  Zotero.Reader.registerEventListener(
    "renderToolbar",
    renderToolbar,
    config.addonID,
  );
  registered = true;
  // Already-open readers do not emit another toolbar render when a plugin starts.
  for (const reader of Zotero.Reader._readers) {
    const doc = reader._iframeWindow?.document;
    const target = doc?.querySelector(".toolbar .custom-sections");
    if (!doc || !target) continue;
    addButton(reader, doc, (button) => {
      const section = doc.createElement("div");
      section.className = "section";
      section.append(button);
      target.append(section);
    });
  }
}

export function unregisterReaderToolbar(): void {
  ++openVersion;
  if (registered) {
    registered = false;
    Zotero.Reader.unregisterEventListener("renderToolbar", renderToolbar);
  }
  for (const entry of [...buttons.values()]) entry.dispose();
}
