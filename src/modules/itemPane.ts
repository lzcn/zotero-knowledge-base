/**
 * Zotero UI integration points:
 *  - "Zettel" column in the item tree (per-article card count)
 *  - "Zettel" section in the item pane (list of the article's cards)
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getItemCountSync, listByItem } from "./zettel";
import { onDataChange } from "./events";

const subscriptions = new WeakMap<HTMLElement, () => void>();

let sectionID: string | undefined;

export function unregisterItemPaneUI(): void {
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  sectionID = undefined;
}

const HTML_NS = "http://www.w3.org/1999/xhtml";
const ICON = `chrome://${config.addonRef}/content/icons/zettel.svg`;

export async function registerItemPaneUI(): Promise<void> {
  Zotero.ItemTreeManager.registerColumns({
    pluginID: config.addonID,
    dataKey: "zettelCount",
    label: "Zettel",
    dataProvider: (item: Zotero.Item) => {
      if (!item.isRegularItem()) return "";
      const n = getItemCountSync(item.key);
      return n ? String(n) : "";
    },
  });

  // Recreate any section left behind by an older hot-updated version.
  const manager = Zotero.ItemPaneManager as typeof Zotero.ItemPaneManager & {
    customSectionData?: { options: { pluginID: string; paneID: string }[] };
  };
  for (const previous of manager.customSectionData?.options || []) {
    if (previous.pluginID === config.addonID)
      manager.unregisterSection(previous.paneID);
  }
  sectionID =
    Zotero.ItemPaneManager.registerSection({
      pluginID: config.addonID,
      paneID: `${config.addonRef}-zettel-section`,
      header: {
        l10nID: `${config.addonRef}-pane-header`,
        icon: ICON,
      },
      sidenav: {
        l10nID: `${config.addonRef}-pane-sidenav`,
        icon: ICON,
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
  body.classList.add("zettel-knowledge-base-section");
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
  const [zettels, highlights] = await Promise.all([
    listByItem(item.key),
    addon.api.getHighlights(item.key, item.libraryID).catch((error: Error) => {
      Zotero.logError(error);
      return [];
    }),
  ]);
  if (
    !container.isConnected ||
    container.parentElement?.dataset.itemKey !== item.key
  ) {
    return;
  }
  container.textContent = "";

  const head = el(container, "div");
  head.className = "zettel-knowledge-base-count";
  head.textContent = getString("section-count", {
    args: { count: zettels.length },
  });
  container.appendChild(head);

  const list = el(container, "ul");
  list.className = "zettel-knowledge-base-section-list";
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
  footer.className = "zettel-knowledge-base-section-footer";
  const newBtn = el(footer, "button");
  newBtn.className = "zettel-knowledge-base-mini-btn";
  newBtn.textContent = getString("section-new");
  newBtn.addEventListener("click", () =>
    addon.api.openEditor({
      sourceItem: { key: item.key, libraryID: item.libraryID },
    }),
  );
  footer.appendChild(newBtn);

  // Batch import only makes sense when the item actually has highlights.
  const pending = highlights.filter((h) => !h.cards).length;
  if (highlights.length) {
    const importBtn = el(footer, "button");
    importBtn.className = "zettel-knowledge-base-mini-btn";
    importBtn.textContent = pending
      ? getString("section-import-highlights", { args: { count: pending } })
      : getString("section-import-highlights-all-done");
    importBtn.title = getString("section-import-highlights-tip", {
      args: { total: highlights.length },
    });
    importBtn.addEventListener("click", () =>
      addon.api.openAnnotationPicker({
        itemKey: item.key,
        libraryID: item.libraryID,
        itemTitle: item.getField("title", false, true) || item.key,
      }),
    );
    footer.appendChild(importBtn);
  }
  container.appendChild(footer);
}

function el(parent: HTMLElement, tag: string): HTMLElement {
  return parent.ownerDocument.createElementNS(HTML_NS, tag) as HTMLElement;
}

function muted(parent: HTMLElement, text: string): HTMLElement {
  const div = el(parent, "div");
  div.className = "zettel-knowledge-base-muted";
  div.textContent = text;
  return div;
}
