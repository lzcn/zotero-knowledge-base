import { attachReaderMath } from "./reader-math";
import { attachReaderToolbarLayout } from "./reader-toolbar-layout";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { isAccelKey } from "../ui/platform";
import { onDataChange } from "./events";

const buttons = new Map<
  Document,
  { button: HTMLButtonElement; refresh(): Promise<void>; dispose(): void }
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
  if (previous?.button.isConnected) {
    void previous.refresh().catch(Zotero.logError);
    return;
  }
  previous?.dispose();
  const win = doc.defaultView!;
  const button = doc.createElement("button");
  button.id = "knowledge-base-reader-button";
  button.className = "toolbar-button";
  button.type = "button";
  button.tabIndex = -1;
  const icon = doc.createElement("img");
  icon.src = iconURL;
  icon.width = icon.height = 20;
  icon.alt = "";
  icon.draggable = false;
  button.append(icon);
  const removeLayout = attachReaderToolbarLayout(doc);
  const removeMath = attachReaderMath(doc);
  let disposed = false;
  let stateVersion = 0;
  let sourceKey: string | undefined;
  const active = () => !disposed && registered;
  const report = (error: unknown) => {
    if (active())
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
  };
  const setState = (hasNote: boolean, canCreate = false) => {
    button.dataset.hasLiteratureNote = String(hasNote);
    icon.style.filter = hasNote ? "none" : "grayscale(1)";
    icon.style.opacity = hasNote ? "1" : "0.5";
    button.title = getString(
      hasNote ? "reader-open-literature" : "menu-open-manager",
    );
    if (canCreate && !hasNote)
      button.title +=
        "\n" +
        getString(
          Zotero.isMac
            ? "reader-create-literature-mac"
            : "reader-create-literature-ctrl",
        );
    button.setAttribute("aria-label", button.title);
  };
  const context = async () => {
    const attachment = reader.itemID
      ? await Zotero.Items.getAsync(reader.itemID)
      : undefined;
    const source = attachment?.parentItemID
      ? await Zotero.Items.getAsync(attachment.parentItemID)
      : attachment;
    if (!active() || !source?.isRegularItem() || source.deleted) return {};
    const note = (
      await addon.api.listByItem(source.key, source.libraryID)
    ).find((note) => note.source_note);
    return { source, note };
  };
  const refresh = async () => {
    const version = ++stateVersion;
    const { source, note } = await context();
    if (!active() || version !== stateVersion) return;
    sourceKey = source?.key;
    setState(!!note, !!source);
  };
  setState(false);
  const open = async (event: MouseEvent) => {
    if (event.button !== 0 || button.disabled || !active()) return;
    const version = ++openVersion;
    button.disabled = true;
    try {
      const { source, note } = await context();
      if (!active() || version !== openVersion) return;
      let id = note?.id;
      if (!id && source && isAccelKey(event))
        id = await addon.api.ensureLiteratureNote(
          source.key,
          source.libraryID,
          () => !active(),
        );
      if (!active()) return;
      ++stateVersion;
      sourceKey = source?.key;
      setState(!!id, !!source);
      if (version === openVersion)
        addon.api.openManager(id ? { selectId: id } : {});
    } catch (error) {
      report(error);
    } finally {
      if (!disposed) button.disabled = false;
    }
  };
  const unsubscribe = onDataChange((change) => {
    if (
      !change.all &&
      change.fields.length &&
      !change.fields.some(
        (field) => field === "source" || field === "availability",
      )
    )
      return;
    if (
      !change.all &&
      sourceKey &&
      change.itemKeys.length &&
      !change.itemKeys.includes(sourceKey)
    )
      return;
    void refresh().catch(report);
  });
  const dispose = () => {
    disposed = true;
    ++stateVersion;
    unsubscribe();
    removeLayout();
    removeMath();
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
  buttons.set(doc, { button, refresh, dispose });
  const pageNumber = doc.querySelector(".toolbar #pageNumber");
  if (pageNumber) pageNumber.before(button);
  else append(button);
  void refresh().catch(report);
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
