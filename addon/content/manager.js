/* global Zotero, URLSearchParams */
"use strict";

let zettels = [];
let selectedId = null;
let searchTimer = null;
let detailVersion = 0;
let listVersion = 0;
let nextCursor = null;
let pageTimer = null;
let renderTimer = null;
const ROW_HEIGHT = 126;
const rowIndices = new Map();
let listScope = "";
let listReferences;
let navigationVersion = 0;
let managerLoaded = false;
const history = [];
let historyIndex = -1;
const scrollPositions = new Map();

/** @template {keyof import("../../typings/ui").ManagerElements} K
 * @param {K} id @returns {import("../../typings/ui").ManagerElements[K]} */
const $ = (id) =>
  /** @type {import("../../typings/ui").ManagerElements[K]} */ (
    document.getElementById(id)
  );

const args = /** @type {import("../../src/modules/api").ManagerArgs} */ (
  window.arguments?.[0] ||
    window.Zotero.ZoteroKnowledgeBase.api.getViewArguments(
      new URLSearchParams(window.location.search).get("context"),
    )
);

/* resolved after include.js provides Zotero */
/** @type {import("../../src/modules/api").KnowledgeBaseAPI} */
let api = null;

function updateActions() {
  for (const id of [
    "knowledge-base-btn-edit",
    "knowledge-base-btn-local-graph",
    "knowledge-base-btn-delete",
  ])
    document.getElementById(id).toggleAttribute("disabled", !selectedId);
}

function showError(error) {
  const msg = String(error?.message || error);
  const box = $("knowledge-base-error");
  box.hidden = false;
  box.textContent = "⚠ " + msg;
  try {
    Zotero.logError(error?.stack ? error : new Error(msg));
  } catch (e) {
    console.error(e);
  }
}

function wrap(fn) {
  return async function wrapped(...args) {
    try {
      return await fn.apply(this, args);
    } catch (e) {
      showError(e);
      throw e;
    }
  };
}

window.addEventListener("error", (ev) => {
  showError(ev.error || ev.message);
});

const load = wrap(async function () {
  api = /** @type {import("../../src/modules/api").KnowledgeBaseAPI} */ (
    new Proxy(
      {},
      { get: (_, key) => window.Zotero.ZoteroKnowledgeBase.api[key] },
    )
  );
  applyLocale();
  if (args.embedded) {
    document.getElementById("knowledge-base-root").classList.add("workbench");
    document.getElementById("knowledge-base-btn-edit").hidden = true;
  }
  updateActions();
  bindEvents();
  window.KnowledgeBasePanels.attach(
    $("knowledge-base-splitter"),
    $("knowledge-base-list-pane"),
    "manager",
    api,
  );
  await refreshDrafts();
  if (args.selectId) $("knowledge-base-entries").checked = false;
  $("knowledge-base-kind").value = "";
  await refresh();
  const wanted =
    args.selectId && (await api.getZettel(args.selectId))
      ? args.selectId
      : null;
  managerLoaded = true;
  if (args.embedded && args.editor) {
    await showInlineEditor(args.editor);
    if (args.editor.zettelId) select(args.editor.zettelId, true, true);
  } else if (wanted) select(wanted);
  else if (zettels.length) select(zettels[0].id);
  let changeRefresh = Promise.resolve();
  const unsubscribe = api.onDataChange(
    (change) =>
      (changeRefresh = changeRefresh.then(() =>
        safeCall(async () => {
          if (window.closed) return;
          const all = !change || change.all;
          if (
            !change ||
            !change.fields.length ||
            change.fields.some((field) => field !== "tags")
          ) {
            if (
              !all &&
              change.cardIDs.length &&
              change.cardIDs.length <= 500 &&
              !change.fields.includes("hierarchy") &&
              !change.fields.includes("source") &&
              $("knowledge-base-list").getAttribute("aria-busy") === "false" &&
              listScope === currentScope()
            )
              await refreshChanged(
                change.cardIDs,
                change.fields.includes("identity") ||
                  change.fields.includes("availability"),
              );
            else await refresh();
          }
          if (
            selectedId &&
            !args.embedded &&
            (all ||
              change.cardIDs.includes(selectedId) ||
              change.fields.includes("source"))
          )
            await renderDetail(selectedId);
        }),
      )),
  );
  window.addEventListener("unload", unsubscribe, { once: true });
  const unsubscribeStyle = api.onSourceStyleChange(() => {
    if (selectedId && !args.embedded) safeCall(() => renderDetail(selectedId));
  });
  window.addEventListener("unload", unsubscribeStyle, { once: true });
  window.knowledgeBaseRefreshNotes();
});

window.knowledgeBaseRefreshNotes = () => {
  if (managerLoaded) safeCall(() => api.auditNativeNotes());
};

/**
 * Called from the reader / item pane when the window is already open, so that
 * "open the card" does not raise a second manager window.
 */
window.ZoteroKnowledgeBase_selectZettel = function (id) {
  if (!managerLoaded) {
    args.selectId = id;
    return;
  }
  const version = ++navigationVersion;
  safeCall(async () => {
    $("knowledge-base-search").value = "";
    $("knowledge-base-entries").checked = false;
    $("knowledge-base-kind").value = "";
    await refresh();
    const card = await api.getZettel(id);
    if (version === navigationVersion && card) select(id);
  });
};
window.ZoteroKnowledgeBase_editNote = function (options) {
  navigationVersion++;
  if (!managerLoaded) {
    args.editor = options;
    return;
  }
  safeCall(async () => {
    if (await showInlineEditor(options)) {
      if (options.zettelId) select(options.zettelId, true, true);
      else {
        selectedId = null;
        updateActions();
      }
    }
  });
};

function applyLocale() {
  $("knowledge-base-kind").setAttribute("aria-label", api.loc("note-kind"));
  for (const option of /** @type {HTMLOptionElement[]} */ (
    Array.from($("knowledge-base-kind").options)
  ))
    option.textContent = api.loc(
      option.value === "deleted"
        ? "manager-deleted-notes"
        : option.value
          ? "note-kind-" + option.value
          : "note-kind-all",
    );
  for (const [id, key] of [
    ["knowledge-base-back", "manager-back"],
    ["knowledge-base-forward", "manager-forward"],
    ["knowledge-base-restore-draft", "manager-restore-draft"],
  ]) {
    const element = document.getElementById(id);
    element.setAttribute("label", api.loc(key));
    element.setAttribute("tooltiptext", api.loc(key));
  }
  document
    .getElementById("knowledge-base-drafts-label")
    .setAttribute("value", api.loc("manager-drafts"));
  $("knowledge-base-entries-label").textContent = api.loc("entries");
  document.title = api.loc("manager-title");
  $("knowledge-base-search").placeholder = api.loc(
    "manager-search-placeholder",
  );
  $("knowledge-base-detail-empty").textContent = api.loc(
    "manager-empty-detail",
  );
  $("knowledge-base-outgoing-head").textContent = api.loc("manager-outgoing");
  $("knowledge-base-backlinks-head").textContent = api.loc("manager-backlinks");
  $("knowledge-base-preview-head").hidden = true;
  $("knowledge-base-unresolved-head").textContent =
    api.loc("manager-unresolved");
  $("knowledge-base-btn-child").textContent = api.loc("new-child");
  for (const [id, key] of [
    ["knowledge-base-btn-new", "manager-new"],
    ["knowledge-base-btn-graph", "graph-title"],
    ["knowledge-base-btn-edit", "manager-edit"],
    ["knowledge-base-btn-local-graph", "manager-show-graph"],
    ["knowledge-base-btn-delete", "manager-delete"],
  ]) {
    const button = document.getElementById(id);
    const label = api.loc(key);
    button.setAttribute("label", label);
    button.setAttribute("tooltiptext", label);
    button.setAttribute("aria-label", label);
  }
}

function bindEvents() {
  $("knowledge-base-list").setAttribute("role", "listbox");
  $("knowledge-base-list").tabIndex = 0;
  $("knowledge-base-list-pane").addEventListener("scroll", scheduleListRender, {
    passive: true,
  });
  window.addEventListener("resize", scheduleListRender);
  window.addEventListener(
    "unload",
    () => {
      invalidatePages();
      clearTimeout(searchTimer);
      clearTimeout(renderTimer);
    },
    { once: true },
  );
  $("knowledge-base-kind").addEventListener("change", () => {
    invalidatePages();
    if (!args.embedded) selectedId = null;
    updateActions();
    safeCall(refresh);
    $("knowledge-base-detail").hidden = true;
    $("knowledge-base-detail-empty").hidden = false;
  });
  window.addEventListener("keydown", (event) => {
    if (
      !event.defaultPrevented &&
      api.isAccelKey(event) &&
      event.key.toLowerCase() === "w"
    ) {
      event.preventDefault();
      if (args.embedded) args.onClose?.();
      else window.close();
    }
  });
  $("knowledge-base-list").addEventListener("mousedown", (event) => {
    if (event.detail > 1) event.preventDefault();
    window.getSelection()?.removeAllRanges();
  });
  document
    .getElementById("knowledge-base-back")
    .addEventListener("command", () => safeCall(navigateHistory, -1));
  document
    .getElementById("knowledge-base-forward")
    .addEventListener("command", () => safeCall(navigateHistory, 1));
  document
    .getElementById("knowledge-base-restore-draft")
    .addEventListener("command", () => {
      const menu = /** @type {XULMenuListElement} */ (
        /** @type {unknown} */ (
          document.getElementById("knowledge-base-draft-list")
        )
      );
      if (menu.value) {
        if (args.embedded)
          safeCall(() => showInlineEditor({ draftId: menu.value }));
        else api.openEditor({ draftId: menu.value });
      }
    });
  window.addEventListener("focus", () => safeCall(refreshDrafts));
  $("knowledge-base-list").addEventListener("keydown", (event) => {
    if (
      event.isComposing ||
      !["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(
        event.key,
      )
    )
      return;
    const focused = /** @type {HTMLElement} */ (document.activeElement);
    let index = zettels.findIndex(
      (row) => row.id === (focused?.dataset?.id || selectedId),
    );
    const pageSize = Math.max(
      1,
      Math.floor($("knowledge-base-list-pane").clientHeight / ROW_HEIGHT),
    );
    index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? zettels.length - 1
          : index +
            ({
              ArrowDown: 1,
              ArrowUp: -1,
              PageDown: pageSize,
              PageUp: -pageSize,
            }[event.key] || 0);
    const next = zettels[Math.max(0, Math.min(index, zettels.length - 1))];
    if (next) {
      event.preventDefault();
      revealRow(next.id);
      getRenderedRow(next.id)?.focus();
      select(next.id);
    }
  });
  $("knowledge-base-btn-child").addEventListener("click", () => {
    if (!selectedId) return;
    if (args.embedded) {
      safeCall(() => showInlineEditor({ prefillParentId: selectedId }));
      return;
    }
    api.openEditor({
      prefillParentId: selectedId,
      onSaved: (id) =>
        safeCall(async () => {
          $("knowledge-base-entries").checked = false;
          $("knowledge-base-kind").value = "";
          await refresh();
          select(id);
        }),
    });
  });
  $("knowledge-base-entries").addEventListener("change", () => {
    invalidatePages();
    selectedId = null;
    updateActions();
    $("knowledge-base-detail").hidden = true;
    $("knowledge-base-detail-empty").hidden = false;
    safeCall(refresh);
  });
  $("knowledge-base-btn-graph").addEventListener("click", () =>
    api.openGraph(),
  );
  $("knowledge-base-btn-local-graph").addEventListener("click", () =>
    api.openGraph({ centerId: selectedId }),
  );
  $("knowledge-base-preview").addEventListener("click", (ev) => {
    const target = /** @type {Element} */ (ev.target);
    if (target.localName === "img") {
      api.openImage(target.getAttribute("src"));
      return;
    }
    const link = target.closest("a");
    if (!link) return;
    ev.preventDefault();
    safeCall(async () => {
      const href = link.getAttribute("href");
      const card = await api.resolveCardLink(href);
      if (card?.targetId) {
        $("knowledge-base-search").value = "";
        await refresh();
        select(card.targetId);
      } else if (card) newZettel(card.ref);
      else await api.openLink(href);
    });
  });
  $("knowledge-base-btn-new").addEventListener("click", () => newZettel());
  $("knowledge-base-search").addEventListener("input", () => {
    invalidatePages();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(wrap(refresh), 200);
  });
  $("knowledge-base-btn-edit").addEventListener("click", () => {
    if (selectedId) openEditor(selectedId);
  });
  $("knowledge-base-btn-delete").addEventListener("click", () => {
    if (selectedId) removeZettel(selectedId);
  });
}

function invalidatePages() {
  listVersion++;
  clearTimeout(pageTimer);
  pageTimer = null;
  nextCursor = null;
  $("knowledge-base-list").setAttribute("aria-busy", "false");
}

function currentScope() {
  return JSON.stringify([
    $("knowledge-base-search").value,
    $("knowledge-base-kind").value,
    $("knowledge-base-entries").checked,
  ]);
}

async function refreshChanged(cardIDs, referencesChanged) {
  const version = ++listVersion;
  const query = $("knowledge-base-search").value || "";
  const page = await api.searchZettelSummaries(
    query,
    {
      cardIDs,
      limit: 500,
      entriesOnly: $("knowledge-base-entries").checked,
      kind: /** @type {import("../../src/modules/db").NoteKind | undefined} */ (
        $("knowledge-base-kind").value === "deleted"
          ? undefined
          : $("knowledge-base-kind").value || undefined
      ),
      availability:
        $("knowledge-base-kind").value === "deleted" ? "deleted" : "active",
    },
    referencesChanged ? undefined : listReferences,
  );
  if (version !== listVersion || window.closed) return;
  listReferences = page.references;
  const changed = new Set(cardIDs);
  zettels = zettels
    .filter((row) => !changed.has(row.id))
    .concat(
      page.items.map((row) => ({
        ...row,
        body: "",
        snippet: summarize(row.body, query),
      })),
    );
  zettels.sort(
    (a, b) =>
      (a.searchRank || 0) - (b.searchRank || 0) ||
      b.updated_at - a.updated_at ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  rowIndices.clear();
  zettels.forEach((row, index) => rowIndices.set(row.id, index));
  renderList();
  $("knowledge-base-stats").textContent = api.loc("manager-count", {
    count: zettels.length,
  });
  if (selectedId && !rowIndices.has(selectedId)) {
    selectedId = null;
    updateActions();
    $("knowledge-base-detail").hidden = true;
    $("knowledge-base-detail-empty").hidden = false;
  }
  await refreshUnresolved();
}

const refresh = wrap(async function () {
  invalidatePages();
  const version = listVersion;
  listScope = currentScope();
  listReferences = undefined;
  const options = {
    entriesOnly: $("knowledge-base-entries").checked,
    kind: /** @type {import("../../src/modules/db").NoteKind | undefined} */ (
      $("knowledge-base-kind").value === "deleted"
        ? undefined
        : $("knowledge-base-kind").value || undefined
    ),
    availability:
      $("knowledge-base-kind").value === "deleted" ? "deleted" : "active",
    limit: 100,
  };
  const query = $("knowledge-base-search").value || "";
  $("knowledge-base-list").setAttribute("aria-busy", "true");
  await loadPage(version, query, options, false);
  if (version === listVersion) await refreshUnresolved();
});

async function loadPage(version, query, options, append) {
  try {
    const page = await api.searchZettelSummaries(
      query,
      {
        ...options,
        cursor: append ? nextCursor : null,
      },
      listReferences,
    );
    if (version !== listVersion || window.closed) return;
    listReferences = page.references;
    const rows = page.items.map((row) => ({
      ...row,
      body: "",
      snippet: summarize(row.body, query),
    }));
    if (!append) {
      zettels = [];
      rowIndices.clear();
    }
    for (const row of rows) {
      const index = rowIndices.get(row.id);
      if (index !== undefined) zettels[index] = row;
      else {
        rowIndices.set(row.id, zettels.length);
        zettels.push(row);
      }
    }
    nextCursor = page.cursor;
    if (!append) $("knowledge-base-list-pane").scrollTop = 0;
    renderList();
    $("knowledge-base-stats").textContent = api.loc("manager-count", {
      count: zettels.length,
    });
    $("knowledge-base-list").setAttribute("aria-busy", String(!!nextCursor));
    if (nextCursor) {
      pageTimer = setTimeout(() => {
        pageTimer = null;
        safeCall(loadPage, version, query, options, true);
      }, 16);
    } else if (selectedId && !zettels.some((row) => row.id === selectedId)) {
      selectedId = null;
      updateActions();
      $("knowledge-base-detail").hidden = true;
      $("knowledge-base-detail-empty").hidden = false;
    }
  } catch (error) {
    if (version !== listVersion || window.closed) return;
    $("knowledge-base-list").setAttribute("aria-busy", "false");
    throw error;
  }
}

function summarize(body, query) {
  const summary = new window.DOMParser().parseFromString(
    body || "",
    "text/html",
  );
  for (const node of summary.querySelectorAll("script, style"))
    node.parentNode?.removeChild(node);
  const plain = (summary.body.textContent || "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, id, alias) => alias || `[[${id}]]`,
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*`>_$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = query
    ? plain.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : 0;
  const start = Math.max(0, match - 30);
  return (
    (start ? "…" : "") +
    plain.slice(start, start + 110) +
    (plain.length > start + 110 ? "…" : "")
  );
}

function scheduleListRender() {
  if (renderTimer !== null) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderList();
  }, 16);
}

function revealRow(id) {
  const index = zettels.findIndex((row) => row.id === id);
  if (index < 0) return;
  const pane = $("knowledge-base-list-pane");
  const top = index * ROW_HEIGHT;
  const height = pane.clientHeight || 600;
  if (top < pane.scrollTop) pane.scrollTop = top;
  else if (top + ROW_HEIGHT > pane.scrollTop + height)
    pane.scrollTop = top + ROW_HEIGHT - height;
  renderList();
}

function getRenderedRow(id) {
  return /** @type {HTMLLIElement[]} */ (
    Array.from($("knowledge-base-list").querySelectorAll("li.zettel-row"))
  ).find((row) => row.dataset.id === id);
}

function renderList() {
  const list = $("knowledge-base-list");
  const pane = $("knowledge-base-list-pane");
  const focusedID = /** @type {HTMLElement} */ (document.activeElement)?.dataset
    ?.id;
  const maxScroll = Math.max(
    0,
    zettels.length * ROW_HEIGHT - (pane.clientHeight || 600) + 8,
  );
  if (pane.scrollTop > maxScroll) pane.scrollTop = maxScroll;
  const start = Math.max(0, Math.floor(pane.scrollTop / ROW_HEIGHT) - 4);
  const end = Math.min(
    zettels.length,
    start + Math.ceil((pane.clientHeight || 600) / ROW_HEIGHT) + 8,
  );
  list.textContent = "";
  const spacer = (height) => {
    if (!height) return;
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.className = "list-spacer";
    li.style.height = height + "px";
    li.setAttribute("aria-hidden", "true");
    list.appendChild(li);
  };
  spacer(start * ROW_HEIGHT);
  for (const [offset, z] of zettels.slice(start, end).entries()) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.className = "zettel-row" + (z.id === selectedId ? " active" : "");
    li.dataset.id = z.id;
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-posinset", String(start + offset + 1));
    li.setAttribute("aria-setsize", String(zettels.length));
    li.setAttribute("aria-selected", String(z.id === selectedId));
    li.title = z.title;
    li.setAttribute("aria-current", z.id === selectedId ? "true" : "false");
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        safeCall(select, z.id);
      }
    });

    const title = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    title.className = "title";
    title.textContent = z.title || api.loc("manager-untitled");
    li.appendChild(title);
    const snippet = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    snippet.className = "card-snippet";
    snippet.textContent = z.snippet;
    li.appendChild(snippet);

    const badges = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    badges.className = "badges";
    badges.title = `${api.loc("manager-outgoing")} ${z.outgoing} · ${api.loc("manager-backlinks")} ${z.incoming}`;
    badges.setAttribute("aria-label", badges.title);
    badges.textContent = `↗ ${z.outgoing} · ↙ ${z.incoming}`;
    li.appendChild(badges);

    const id = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    id.className = "zid muted";
    id.textContent = `${api.loc("note-kind-" + (z.kind || "zettel"))} · ${z.reference || z.id}`;
    id.title = z.id;
    li.appendChild(id);

    li.addEventListener("click", () => safeCall(select, z.id));
    li.addEventListener("dblclick", () => safeCall(openEditor, z.id));
    list.appendChild(li);
  }
  spacer((zettels.length - end) * ROW_HEIGHT);
  if (focusedID) getRenderedRow(focusedID)?.focus({ preventScroll: true });
}

function safeCall(fn, ...args) {
  return Promise.resolve(fn.apply(null, args)).catch((e) => {
    showError(e);
  });
}

const refreshUnresolved = wrap(async function () {
  const refs = await api.getUnresolvedRefs();
  const box = $("knowledge-base-unresolved");
  const ul = $("knowledge-base-unresolved-list");
  ul.textContent = "";
  box.hidden = refs.length === 0;
  for (const r of refs.slice(0, 20)) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.textContent = `${r.ref} (${r.count})`;
    li.addEventListener("click", () => newZettel(r.ref));
    ul.appendChild(li);
  }
});

function select(id, record = true, mounted = false) {
  if (!mounted) navigationVersion++;
  if (args.embedded && !mounted)
    return safeCall(async () => {
      if (await showInlineEditor({ zettelId: id })) select(id, record, true);
    });
  if (selectedId)
    scrollPositions.set(selectedId, $("knowledge-base-preview").scrollTop);
  if (record && history[historyIndex] !== id) {
    history.splice(historyIndex + 1);
    history.push(id);
    historyIndex = history.length - 1;
  }
  document
    .getElementById("knowledge-base-back")
    .toggleAttribute("disabled", historyIndex <= 0);
  document
    .getElementById("knowledge-base-forward")
    .toggleAttribute("disabled", historyIndex >= history.length - 1);
  selectedId = id;
  revealRow(id);
  updateActions();
  for (const li of /** @type {HTMLLIElement[]} */ (
    Array.from($("knowledge-base-list").children)
  )) {
    li.classList.toggle("active", li.dataset.id === id);
    li.setAttribute("aria-current", li.dataset.id === id ? "true" : "false");
    li.setAttribute("aria-selected", String(li.dataset.id === id));
  }
  safeCall(async () => {
    if (!args.embedded) await renderDetail(id);
    if (selectedId === id)
      $("knowledge-base-preview").scrollTop = scrollPositions.get(id) || 0;
  });
}

async function navigateHistory(direction) {
  const index = historyIndex + direction;
  if (index < 0 || index >= history.length) return;
  const card = await api.getZettel(history[index]);
  if (!card) return;
  historyIndex = index;
  $("knowledge-base-search").value = "";
  $("knowledge-base-entries").checked = false;
  $("knowledge-base-kind").value = "";
  await refresh();
  select(card.id, false);
}

async function refreshDrafts() {
  if (!api) return;
  const drafts = await api.listEditorDrafts();
  if (window.closed) return;
  const popup = document.getElementById("knowledge-base-draft-menu");
  popup.replaceChildren();
  for (const draft of drafts) {
    const item = document.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuitem",
    );
    item.setAttribute("value", draft.draftId);
    item.setAttribute("label", draft.title || api.loc("manager-untitled"));
    popup.appendChild(item);
  }
  const menu = /** @type {XULMenuListElement} */ (
    /** @type {unknown} */ (
      document.getElementById("knowledge-base-draft-list")
    )
  );
  menu.value = drafts[0]?.draftId || "";
  document.getElementById("knowledge-base-drafts").hidden = !drafts.length;
}

const renderDetail = wrap(async function (id) {
  const version = ++detailVersion;
  const [z, family, outgoing, backlinks, health] = await Promise.all([
    api.getZettel(id),
    api.getFamily(id),
    api.getOutgoing(id),
    api.getBacklinks(id),
    api.getNoteHealth(id),
  ]);
  if (!z || version !== detailVersion || selectedId !== id) return;
  await api.prepareMarkdown(z.body);
  const source = z.item_key
    ? await api.getItemSummary(z.item_key, z.library_id)
    : null;
  if (version !== detailVersion || selectedId !== id) return;
  $("knowledge-base-detail-empty").hidden = true;
  $("knowledge-base-detail").hidden = false;

  $("knowledge-base-detail-id").textContent = api.loc(
    "note-kind-" + (z.kind || "zettel"),
  );
  window.ZoteroKnowledgeBaseMarkdown.reference(
    $("knowledge-base-detail-reference"),
    z.reference || z.id,
    api,
  );
  $("knowledge-base-detail-title").title = z.id;
  $("knowledge-base-detail-title").textContent =
    z.title || api.loc("manager-untitled");
  $("knowledge-base-detail-meta").textContent =
    `${api.loc("manager-updated")} ${new Date(z.updated_at).toLocaleString()}`;

  renderHealth(
    document.getElementById("knowledge-base-detail-health"),
    health,
    id,
  );
  const srcBox = $("knowledge-base-detail-source");
  srcBox.textContent = "";
  if (z.item_key) {
    const label = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    label.className = "source-item-label";
    label.textContent = api.loc("manager-source-item");
    srcBox.appendChild(label);
    if (source) {
      const link = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      link.className = "source-link";
      srcBox.appendChild(link);
      safeCall(() =>
        window.ZoteroKnowledgeBaseMarkdown.source(link, source, api),
      );
    } else {
      const gone = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      gone.className = "muted";
      gone.textContent = api.loc("manager-source-missing");
      srcBox.appendChild(gone);
    }
  }

  window.ZoteroKnowledgeBaseMarkdown.renderFamily(
    $("knowledge-base-family"),
    family,
    api,
  );
  const chips = $("knowledge-base-outgoing");
  chips.textContent = "";
  chips.hidden = outgoing.length === 0;
  $("knowledge-base-outgoing-head").textContent =
    `${api.loc("manager-outgoing")} · ${outgoing.length}`;
  for (const link of outgoing) {
    const chip = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    chip.className = "relation-link" + (link.targetId ? "" : " unresolved");
    window.ZoteroKnowledgeBaseMarkdown.identity(
      chip,
      link.targetId || link.ref,
      link.display,
      link.reference,
    );
    if (!link.targetId) chip.title = api.loc("manager-unresolved-tip");
    chip.addEventListener("click", () => {
      if (link.targetId) select(link.targetId);
      else newZettel(link.ref);
    });
    chips.appendChild(chip);
  }

  const ul = $("knowledge-base-backlinks");
  ul.textContent = "";
  $("knowledge-base-backlinks-head").textContent =
    `${api.loc("manager-backlinks")} · ${backlinks.length}`;
  ul.hidden = backlinks.length === 0;
  for (const b of backlinks) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    const button = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    button.className = "relation-link";
    window.ZoteroKnowledgeBaseMarkdown.identity(
      button,
      b.sourceId,
      b.sourceTitle || "",
      b.reference,
    );
    button.addEventListener("click", () => select(b.sourceId));
    li.appendChild(button);
    ul.appendChild(li);
  }

  window.ZoteroKnowledgeBaseMarkdown.render(
    $("knowledge-base-preview"),
    z.body,
  );
});

async function showInlineEditor(options) {
  const frame = document.getElementById("knowledge-base-workbench-editor");
  if (
    !(await api.mountEditor(frame, {
      ...options,
      onClose: args.onClose,
      onNavigate: (note) => {
        if (note.zettelId)
          window.ZoteroKnowledgeBase_selectZettel(note.zettelId);
        else window.ZoteroKnowledgeBase_editNote(note);
      },
      onSaved: (id) =>
        safeCall(async () => {
          selectedId = id;
          await refresh();
          updateActions();
          options.onSaved?.(id);
        }),
    }))
  )
    return false;
  frame.hidden = false;
  $("knowledge-base-error").hidden = true;
  for (const id of [
    "knowledge-base-detail",
    "knowledge-base-detail-empty",
    "knowledge-base-unresolved",
  ])
    document.getElementById(id).hidden = true;
  return true;
}

function openEditor(id) {
  if (args.embedded) return safeCall(() => showInlineEditor({ zettelId: id }));
  api.openEditor({
    zettelId: id,
    onSaved: () =>
      safeCall(async () => {
        await refresh();
        if (selectedId === id) await renderDetail(id);
      }),
  });
}

function newZettel(title = "") {
  navigationVersion++;
  if (args.embedded)
    return safeCall(() =>
      showInlineEditor({
        kind:
          $("knowledge-base-kind").value === "thinking" ? "thinking" : "zettel",
        prefillTitle: title,
      }),
    );
  api.openEditor({
    kind: $("knowledge-base-kind").value === "thinking" ? "thinking" : "zettel",
    prefillTitle: title,
    onSaved: (id) =>
      safeCall(async () => {
        await refresh();
        select(id);
      }),
  });
}

const removeZettel = wrap(async function (id) {
  const z = await api.getZettel(id);
  const ok = window.confirm(
    api.loc(
      (await api.isExternalNote(id))
        ? "manager-confirm-remove"
        : "manager-confirm-delete",
      { title: (z && z.title) || id },
    ),
  );
  if (!ok) return;
  await api.deleteZettel(id);
  if (args.embedded) {
    const frame = document.getElementById("knowledge-base-workbench-editor");
    frame.hidden = true;
    api.clearEditor(frame);
  }
  selectedId = null;
  updateActions();
  $("knowledge-base-detail").hidden = true;
  $("knowledge-base-detail-empty").hidden = false;
  await refresh();
});

window.addEventListener("load", load);

function renderHealth(box, health, id) {
  box.replaceChildren();
  const unavailable = ["missing", "trashed"].includes(health.note);
  box.hidden = !unavailable && !["missing", "trashed"].includes(health.source);
  if (box.hidden) return;
  const label = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  );
  label.textContent = api.loc(
    unavailable
      ? `health-note-${health.note}`
      : `health-source-${health.source}`,
  );
  box.appendChild(label);
  if (health.note === "missing") return;
  const action = document.createXULElement("button");
  if (health.note === "trashed" || health.source === "trashed") {
    action.setAttribute("label", api.loc("health-restore"));
    action.toggleAttribute("disabled", !health.editable);
    action.addEventListener("command", () =>
      safeCall(() => api.restoreNote(id)),
    );
  } else {
    action.setAttribute("label", api.loc("editor-src-pick"));
    action.addEventListener("command", () => api.openEditor({ zettelId: id }));
  }
  box.appendChild(action);
}
