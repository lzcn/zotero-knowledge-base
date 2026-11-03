/**
 * Zotero UI integration points:
 *  - Note count column in the item tree
 *  - One source note and related ideas in the item pane
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getItemCountSync, listByItem, listUnsourcedNotes } from "./zettel";
import { isPersonalKnowledgeItem } from "./zotero";
import { onDataChange } from "./events";

const subscriptions = new Map<HTMLElement, () => void>();
const sectionItems = new WeakMap<HTMLElement, Zotero.Item>();
const tagRequests = new WeakMap<HTMLElement, object>();
const tagWrites = new WeakMap<HTMLElement, object>();

let sectionID: string | undefined;
let columnID: string | false;

export function unregisterItemPaneUI(): void {
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  sectionID = undefined;
  if (columnID) Zotero.ItemTreeManager.unregisterColumn(columnID);
  columnID = false;
  for (const [body, unsubscribe] of subscriptions) {
    tagRequests.delete(ensureLayout(body).tags);
    unsubscribe();
  }
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

  const similar = libraryRuntime.getItemPaneCallbacks();
  const similarProps = new WeakMap<HTMLElement, Record<string, any>>();
  const prepare = (props: Record<string, any>) => {
    const layout = ensureLayout(props.body);
    const source =
      props.item?.isAttachment?.() && props.item.parentItemID
        ? Zotero.Items.get(props.item.parentItemID)
        : props.item;
    sectionItems.set(props.body, source);
    const sourceKey = source ? `${source.libraryID}/${source.key}` : "";
    if (layout.tags.dataset.itemKey !== sourceKey) {
      tagRequests.delete(layout.tags);
      layout.tags.dataset.itemKey = sourceKey;
      layout.tags.replaceChildren();
    }
    const childProps = {
      ...props,
      body: layout.body,
      setEnabled: (enabled: boolean) => {
        layout.similarTab.hidden =
          !enabled || isPersonalKnowledgeItem(props.item);
        if (layout.similarTab.hidden && props.body.dataset.view === "similar")
          selectView(props.body, "notes");
      },
    };
    similarProps.set(props.body, childProps);
    similar.onItemChange(childProps);
    layout.tabs.onclick = (event) => {
      const target = (event.target as Element).closest<HTMLButtonElement>(
        "button[data-view]",
      );
      if (!target || target.hidden) return;
      const previous = props.body.dataset.view;
      if (previous === target.dataset.view) return;
      selectView(props.body, target.dataset.view!);
      if (previous === "similar" && target.dataset.view !== "similar")
        similar.onCollapse(childProps);
      if (target.dataset.view === "tags") renderTags(layout.tags, source);
      if (target.dataset.view === "notes") renderSection(layout.notes, source);
      if (target.dataset.view === "similar") {
        void similar.onAsyncRender(childProps);
      }
    };
    layout.tabs.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      const tabs = (
        Array.from(
          layout.tabs.querySelectorAll("[role=tab]"),
        ) as HTMLButtonElement[]
      ).filter((tab) => !tab.hidden);
      const current = tabs.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      event.preventDefault();
      tabs[index].focus();
      tabs[index].click();
    };
    layout.refresh.onclick = () => {
      void similar.onRefresh(childProps);
    };
    return childProps;
  };
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
        const unsubscribeData = onDataChange((change) => {
          if (change?.fields.includes("tag-visibility")) {
            const tags = ensureLayout(body).tags;
            if (body.dataset.view === "tags" && !tagWrites.has(tags))
              renderTags(tags, sectionItems.get(body), true);
            if (change.fields.every((field) => field === "tag-visibility"))
              return;
          }
          const item = sectionItems.get(body);
          if (
            change &&
            !change.all &&
            (!change.fields.some((field) =>
              ["identity", "source", "availability"].includes(field),
            ) ||
              (!(item && isPersonalKnowledgeItem(item)) &&
                !change.itemKeys.includes(item?.key || "")))
          )
            return;
          void refresh().catch((error: Error) => Zotero.logError(error));
        });
        const observer = Zotero.Notifier.registerObserver(
          {
            notify: (_event, type, ids) => {
              const item = sectionItems.get(body);
              const tags = ensureLayout(body).tags;
              if (body.dataset.view !== "tags" || tagWrites.has(tags)) return;
              if (
                type === "item-tag" &&
                !ids.some((id) => String(id).split("-")[0] === String(item?.id))
              )
                return;
              renderTags(tags, item, true);
            },
          },
          ["item-tag", "tag"],
          "knowledge-base-item-tags",
        );
        subscriptions.set(body, () => {
          unsubscribeData();
          Zotero.Notifier.unregisterObserver(observer);
        });
      },
      onDestroy: ({ body }: { body: HTMLElement }) => {
        tagRequests.delete(ensureLayout(body).tags);
        subscriptions.get(body)?.();
        subscriptions.delete(body);
        const child = similarProps.get(body);
        if (child) similar.onDestroy(child);
        similarProps.delete(body);
      },
      onItemChange: (props: Record<string, any>) => {
        prepare(props);
        return true;
      },
      onRender: (props: Record<string, any>) => {
        const child = prepare(props);
        const layout = ensureLayout(props.body);
        if (props.body.dataset.view === "notes")
          renderSection(layout.notes, sectionItems.get(props.body));
        if (props.body.dataset.view === "tags")
          renderTags(layout.tags, sectionItems.get(props.body));
        similar.onRender(child);
      },
      onAsyncRender: (props: Record<string, any>) => {
        const child = prepare(props);
        if (!child.body.hidden) return similar.onAsyncRender(child);
      },
      onToggle: (props: Record<string, any>) => {
        const child = prepare(props);
        const section = props.body.closest("collapsible-section");
        if (section?.open === false) {
          tagRequests.delete(ensureLayout(props.body).tags);
          return similar.onCollapse(child);
        }
        if (props.body.dataset.view === "tags")
          renderTags(
            ensureLayout(props.body).tags,
            sectionItems.get(props.body),
          );
        if (!child.body.hidden) return similar.onToggle(child);
      },
    }) || undefined;
  libraryRuntime.setItemPaneID(sectionID);
}

let layoutID = 0;

function ensureLayout(root: HTMLElement) {
  if (!root.querySelector(".knowledge-base-tabs")) {
    root.classList.add("knowledge-base-section");
    const tabs = el(root, "div");
    tabs.className = "knowledge-base-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", config.addonName);
    const panels: HTMLElement[] = [];
    const prefix = `knowledge-base-pane-${++layoutID}`;
    for (const [view, label] of [
      ["notes", "section-notes"],
      ["tags", "section-tags"],
      ["similar", "section-similar"],
    ]) {
      const tab = el(tabs, "button");
      tab.type = "button";
      tab.dataset.view = view;
      tab.id = `${prefix}-${view}-tab`;
      tab.textContent = getString(label as Parameters<typeof getString>[0]);
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `${prefix}-${view}`);
      tabs.append(tab);
      const panel = el(root, "div");
      panel.id = `${prefix}-${view}`;
      panel.className = `knowledge-base-${view === "notes" ? "note" : view}-body`;
      panel.dataset.view = view;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panels.push(panel);
    }
    const refresh = el(root, "button");
    refresh.type = "button";
    refresh.className = "knowledge-base-similar-refresh";
    refresh.title = getString("section-similar-refresh");
    refresh.setAttribute("aria-label", refresh.title);
    const icon = root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.75");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    const path = root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path.setAttribute("d", "M19 8a8 8 0 1 0 1 8M19 3v5h-5");
    icon.append(path);
    refresh.append(icon);
    const header = el(root, "div");
    header.className = "knowledge-base-pane-tabs";
    header.append(tabs, refresh);
    root.replaceChildren(header, ...panels);
    selectView(root, "notes");
  }
  return {
    tabs: root.querySelector<HTMLElement>(".knowledge-base-tabs")!,
    notes: root.querySelector<HTMLElement>(".knowledge-base-note-body")!,
    tags: root.querySelector<HTMLElement>(".knowledge-base-tags-body")!,
    body: root.querySelector<HTMLElement>(".knowledge-base-similar-body")!,
    similarTab: root.querySelector<HTMLButtonElement>(
      'button[data-view="similar"]',
    )!,
    refresh: root.querySelector<HTMLButtonElement>(
      ".knowledge-base-similar-refresh",
    )!,
  };
}

function selectView(root: HTMLElement, view: string): void {
  if (view !== "tags") {
    const tags = root.querySelector<HTMLElement>(".knowledge-base-tags-body");
    if (tags) tagRequests.delete(tags);
  }
  root.dataset.view = view;
  for (const tab of Array.from(
    root.querySelectorAll('[role="tab"]'),
  ) as HTMLButtonElement[]) {
    const selected = tab.dataset.view === view;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of Array.from(
    root.querySelectorAll('[role="tabpanel"]'),
  ) as HTMLElement[])
    panel.hidden = panel.dataset.view !== view;
  root.querySelector<HTMLButtonElement>(
    ".knowledge-base-similar-refresh",
  )!.hidden = view !== "similar";
}

function renderTags(
  body: HTMLElement,
  item?: Zotero.Item,
  force = false,
): void {
  const key = item ? `${item.libraryID}/${item.key}` : "";
  if (!force && body.dataset.itemKey === key && tagRequests.has(body)) return;
  body.dataset.itemKey = key;
  const request = {};
  tagRequests.set(body, request);
  const section = body.closest("collapsible-section") as
    | (Element & { open?: boolean })
    | null;
  const active = () =>
    body.isConnected &&
    !body.hidden &&
    section?.open !== false &&
    tagRequests.get(body) === request &&
    body.dataset.itemKey === key;
  if (!body.querySelector(".knowledge-base-tag-option"))
    body.replaceChildren(muted(body, getString("section-loading")));
  if (!item) return;
  void (async () => {
    await item.loadDataType("tags");
    if (!active()) return;
    const suggestions = await libraryRuntime.suggestTags(item, active);
    if (!active()) return;
    const selectedNames = new Set(
      (
        Array.from(body.querySelectorAll("input:checked")) as HTMLInputElement[]
      ).map((input) => input.value),
    );
    const content: HTMLElement[] = [];
    const controls: HTMLInputElement[] = [];
    const apply = el(body, "button");
    apply.type = "button";
    apply.className = "knowledge-base-apply-tags";
    apply.textContent = getString("section-tags-add");
    apply.disabled = true;
    for (const tag of suggestions) {
      const label = el(body, "label");
      label.className = "knowledge-base-tag-option";
      const check = el(body, "input");
      check.type = "checkbox";
      check.value = tag.name;
      check.checked = selectedNames.has(tag.name);
      check.disabled = !item.isEditable();
      check.onchange = () => {
        apply.disabled = !controls.some(
          (input) => input.checked && !input.disabled,
        );
      };
      controls.push(check);
      const name = el(body, "span");
      name.textContent = tag.name;
      const origin = el(body, "small");
      origin.className = tag.isNew
        ? "knowledge-base-tag-new"
        : "knowledge-base-tag-existing";
      origin.textContent = getString(
        tag.isNew ? "section-tags-new" : "section-tags-existing",
      );
      label.append(check, name, origin);
      content.push(label);
    }
    const message = muted(
      body,
      suggestions.length ? "" : getString("section-tags-empty"),
    );
    message.setAttribute("role", "status");
    apply.disabled = !controls.some(
      (input) => input.checked && !input.disabled,
    );
    apply.onclick = () => {
      if (!active() || apply.disabled) return;
      apply.disabled = true;
      for (const control of controls) control.disabled = true;
      const selected = suggestions.filter((_, i) => controls[i].checked);
      tagWrites.set(body, request);
      void libraryRuntime
        .addSuggestedTags(item, selected, active)
        .then(() => {
          if (active()) renderTags(body, item, true);
        })
        .catch((error: Error) => {
          Zotero.logError(error);
          if (!active()) return;
          message.textContent = getString("section-tags-add-error");
          for (const control of controls) control.disabled = !item.isEditable();
          apply.disabled = !item.isEditable();
        })
        .finally(() => {
          if (tagWrites.get(body) === request) tagWrites.delete(body);
        });
    };
    content.push(message);
    const manage = el(body, "button");
    manage.type = "button";
    manage.className = "knowledge-base-manage-tags";
    manage.textContent = getString("section-tags-manage");
    manage.disabled = item.isEditable() === false;
    manage.onclick = () => {
      try {
        libraryRuntime.openTagManager(
          body.ownerDocument.defaultView!,
          item.libraryID,
        );
      } catch (error) {
        Zotero.logError(error as Error);
      }
    };
    const actions = el(body, "div");
    actions.className = "knowledge-base-tag-actions";
    if (suggestions.length) actions.append(apply);
    actions.append(manage);
    body.replaceChildren(actions, ...content);
  })().catch((error: Error) => {
    Zotero.logError(error);
    if (active())
      body.replaceChildren(muted(body, getString("section-tags-load-error")));
  });
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
  const sourceNote = personal
    ? undefined
    : notes.find((note) => note.source_note);
  const zettels = personal ? notes : notes.filter((note) => !note.source_note);
  if (
    !container.isConnected ||
    container.parentElement?.dataset.itemKey !== item.key
  ) {
    return;
  }
  container.textContent = "";

  if (!personal) {
    const source = el(container, "div");
    source.className = "knowledge-base-section-head";
    const label = el(source, "span");
    label.className = "knowledge-base-count";
    label.textContent = getString("section-source-note");
    source.appendChild(label);
    const literature = el(source, "button");
    literature.className =
      "knowledge-base-source-note knowledge-base-section-action";
    literature.textContent = sourceNote ? "↗" : "+";
    literature.title = getString(
      sourceNote ? "section-source-note-open" : "section-source-note-new",
    );
    literature.setAttribute("aria-label", literature.title);
    literature.addEventListener("click", () => {
      void addon.api
        .openLiteratureNote(item.key, item.libraryID)
        .catch((error: Error) => Zotero.logError(error));
    });
    source.appendChild(literature);
    container.appendChild(source);
  }

  const head = el(container, "div");
  head.className = "knowledge-base-section-head";
  const count = el(head, "span");
  count.className = "knowledge-base-count";
  count.textContent = getString(
    personal ? "section-count" : "section-zettels",
    {
      args: { count: zettels.length },
    },
  );
  head.appendChild(count);
  const newBtn = el(head, "button");
  newBtn.className = "knowledge-base-add-note knowledge-base-section-action";
  newBtn.textContent = "+";
  const label = getString(personal ? "section-new" : "section-new-zettel");
  newBtn.title = label;
  newBtn.setAttribute("aria-label", label);
  newBtn.addEventListener("click", () =>
    addon.api.openEditor({
      sourceItem: personal
        ? undefined
        : { key: item.key, libraryID: item.libraryID },
    }),
  );
  head.appendChild(newBtn);
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
}

function el<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
): HTMLElementTagNameMap[K] {
  return parent.ownerDocument.createElementNS(
    HTML_NS,
    tag,
  ) as HTMLElementTagNameMap[K];
}

function muted(parent: HTMLElement, text: string): HTMLElement {
  const div = el(parent, "div");
  div.className = "knowledge-base-muted";
  div.textContent = text;
  return div;
}
