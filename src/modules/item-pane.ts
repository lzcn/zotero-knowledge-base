/**
 * Zotero UI integration points:
 *  - "Zettel" column in the item tree (per-article card count)
 *  - "Zettel" section in the item pane (list of the article's cards)
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getItemCountSync, listByItem, listUnsourcedNotes } from "./zettel";
import { isPersonalKnowledgeItem } from "./zotero";
import { onDataChange } from "./events";

const subscriptions = new Map<HTMLElement, () => void>();

let sectionID: string | undefined;
let columnID: string | false;

export function unregisterItemPaneUI(): void {
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  sectionID = undefined;
  if (columnID) Zotero.ItemTreeManager.unregisterColumn(columnID);
  columnID = false;
  for (const unsubscribe of subscriptions.values()) unsubscribe();
  subscriptions.clear();
}

const HTML_NS = "http://www.w3.org/1999/xhtml";
const ICON_ROOT = `chrome://${config.addonRef}/content/icons`;

export async function registerItemPaneUI(): Promise<void> {
  if (sectionID) return;
  columnID = Zotero.ItemTreeManager.registerColumn({
    pluginID: config.addonID,
    dataKey: "zettelCount",
    label: getString("column-card-count"),
    dataProvider: (item: Zotero.Item) => {
      if (!item.isRegularItem()) return "";
      const n = getItemCountSync(item.key);
      return n ? String(n) : "";
    },
  });

  sectionID =
    Zotero.ItemPaneManager.registerSection({
      pluginID: config.addonID,
      paneID: `${config.addonRef}-zettel-section`,
      header: {
        l10nID: `${config.addonRef}-pane-header`,
        icon: `${ICON_ROOT}/icon-16.svg`,
      },
      sidenav: {
        l10nID: `${config.addonRef}-pane-sidenav`,
        icon: `${ICON_ROOT}/icon-20.svg`,
      },
      onInit: ({
        body,
        refresh,
      }: {
        body: HTMLElement;
        refresh: () => Promise<void>;
      }) => {
        subscriptions.set(
          body,
          onDataChange(() => {
            void refresh().catch((error: Error) => Zotero.logError(error));
          }),
        );
      },
      onDestroy: ({ body }: { body: HTMLElement }) => {
        subscriptions.get(body)?.();
        subscriptions.delete(body);
      },
      onRender: ({ body, item }: { body: HTMLElement; item: Zotero.Item }) => {
        renderSection(body, item);
      },
    }) || undefined;
}

function renderSection(body: HTMLElement, item?: Zotero.Item): void {
  body.classList.add("knowledge-base-section");
  body.textContent = "";

  if (!item || !item.isRegularItem?.()) {
    body.appendChild(muted(body, getString("section-no-item")));
    return;
  }
  body.dataset.itemKey = item.key;

  const container = el(body, "div");
  body.appendChild(container);
  container.appendChild(muted(body, getString("section-loading")));

  void fill(container, item).catch((error: Error) => {
    Zotero.logError(error);
    if (container.isConnected) {
      container.textContent = "";
      container.appendChild(muted(container, getString("section-load-error")));
    }
  });
}

async function fill(container: HTMLElement, item: Zotero.Item): Promise<void> {
  const personal = isPersonalKnowledgeItem(item);
  const notes = personal
    ? await listUnsourcedNotes(item.libraryID)
    : await listByItem(item.key, item.libraryID);
  const zettels = notes.filter((note) => note.kind !== "literature");
  if (
    !container.isConnected ||
    container.parentElement?.dataset.itemKey !== item.key
  ) {
    return;
  }
  container.textContent = "";

  if (!personal) {
    const literature = el(container, "button");
    literature.className = "knowledge-base-mini-btn";
    literature.textContent = getString("note-kind-literature");
    literature.addEventListener("click", () => {
      void addon.api
        .openLiteratureNote(item.key, item.libraryID)
        .catch((error: Error) => Zotero.logError(error));
    });
    container.appendChild(literature);
  }

  const head = el(container, "div");
  head.className = "knowledge-base-count";
  head.textContent = getString("section-count", {
    args: { count: zettels.length },
  });
  container.appendChild(head);

  const list = el(container, "ul");
  list.className = "knowledge-base-section-list";
  for (const z of zettels) {
    const li = el(list, "li");
    li.textContent = z.title || getString("manager-untitled");
    li.title = z.id;
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        addon.api.openEditor({ zettelId: z.id });
      }
    });
    li.addEventListener("click", () =>
      addon.api.openEditor({ zettelId: z.id }),
    );
    list.appendChild(li);
  }
  container.appendChild(list);

  const footer = el(container, "div");
  footer.className = "knowledge-base-section-footer";
  const newBtn = el(footer, "button");
  newBtn.className = "knowledge-base-mini-btn";
  newBtn.textContent = getString("section-new");
  newBtn.addEventListener("click", () =>
    addon.api.openEditor({
      sourceItem: personal
        ? undefined
        : { key: item.key, libraryID: item.libraryID },
    }),
  );
  footer.appendChild(newBtn);

  container.appendChild(footer);
}

function el(parent: HTMLElement, tag: string): HTMLElement {
  return parent.ownerDocument.createElementNS(HTML_NS, tag) as HTMLElement;
}

function muted(parent: HTMLElement, text: string): HTMLElement {
  const div = el(parent, "div");
  div.className = "knowledge-base-muted";
  div.textContent = text;
  return div;
}
