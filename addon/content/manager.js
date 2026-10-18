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
const ROW_HEIGHT = 112;
let unresolvedVersion = 0;
const rowIndices = new Map();
let listScope = "";
let listReferences;
let navigationVersion = 0;
let managerLoaded = false;
let deleting = false;
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
    document
      .getElementById(id)
      .toggleAttribute("disabled", !selectedId || deleting);
}

function showError(error) {
  const msg = String(error?.message || error);
  if (!window.closed) {
    const box = $("knowledge-base-error");
    box.hidden = false;
    box.textContent = "⚠ " + msg;
  }
  try {
    Zotero.logError(error?.stack ? error : new Error(msg));
  } catch (e) {
    console.error(e);
  }
}

window.addEventListener("error", (ev) => {
  showError(ev.error || ev.message);
});

async function load() {
  api = /** @type {import("../../src/modules/api").KnowledgeBaseAPI} */ (
    new Proxy(
      {},
      { get: (_, key) => window.Zotero.ZoteroKnowledgeBase.api[key] },
    )
  );
  $("knowledge-base-sort").value = api.getNoteSort();
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
  const initialEditor = args.editor;
  if (args.embedded && initialEditor) {
    if ((await showInlineEditor(initialEditor)) && initialEditor.zettelId)
      select(initialEditor.zettelId, true, true);
  } else if (wanted) select(wanted);
  else if (zettels.length) select(zettels[0].id);
  if (args.unresolvedRef)
    window.knowledgeBaseShowUnresolved(args.unresolvedRef);
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
              $("knowledge-base-list").getAttribute("aria-busy") === "false" &&
              listScope === currentScope()
            )
              await refreshChanged(
                change.cardIDs,
                change.fields.includes("identity") ||
                  change.fields.includes("availability") ||
                  change.fields.includes("source"),
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
}

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
  $("knowledge-base-sort").setAttribute("aria-label", api.loc("manager-sort"));
  for (const option of /** @type {HTMLOptionElement[]} */ (
    Array.from($("knowledge-base-sort").options)
  ))
    option.textContent = api.loc("manager-sort-" + option.value);

  $("knowledge-base-kind").setAttribute("aria-label", api.loc("note-kind"));
  for (const option of /** @type {HTMLOptionElement[]} */ (
    Array.from($("knowledge-base-kind").options)
  ))
    option.textContent = api.loc(
      option.value ? "note-kind-" + option.value : "note-kind-all",
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
    ["knowledge-base-btn-graph", "graph-global"],
    ["knowledge-base-btn-edit", "manager-edit"],
    ["knowledge-base-btn-local-graph", "graph-local"],
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
    if (!args.embedded) selectedId = null;
    updateActions();
    safeCall(refresh);
    $("knowledge-base-detail").hidden = true;
    $("knowledge-base-detail-empty").hidden = false;
  });
  $("knowledge-base-sort").addEventListener("change", () => {
    api.setNoteSort($("knowledge-base-sort").value);
    safeCall(refresh, true);
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = /** @type {HTMLElement} */ (
      event.target instanceof window.Element
        ? event.target
        : document.activeElement
    );
    const listFocused = $("knowledge-base-list").contains(target);
    const editable = target.closest?.(
      'input, textarea, select, [contenteditable="true"], browser',
    );
    if (
      !editable &&
      !event.repeat &&
      !event.altKey &&
      !event.shiftKey &&
      ((api.isAccelKey(event) && ["Backspace", "Delete"].includes(event.key)) ||
        (listFocused &&
          event.key === "Delete" &&
          !event.metaKey &&
          !event.ctrlKey))
    ) {
      if (selectedId) {
        event.preventDefault();
        safeCall(removeZettel, selectedId);
      }
      return;
    }
    if (api.isAccelKey(event) && !event.altKey && !event.shiftKey) {
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        $("knowledge-base-search").focus();
        $("knowledge-base-search").select();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newZettel();
        return;
      }
    }
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
  $("knowledge-base-btn-new").addEventListener("click", () =>
    safeCall(newZettel),
  );
  const search = $("knowledge-base-search");
  let composing = false;
  const searchChanged = (event) => {
    invalidatePages();
    clearTimeout(searchTimer);
    if (composing || event.isComposing) return;
    searchTimer = setTimeout(() => safeCall(refresh), 200);
  };
  search.addEventListener("compositionstart", () => {
    composing = true;
    clearTimeout(searchTimer);
    invalidatePages();
  });
  search.addEventListener("compositionend", (event) => {
    composing = false;
    searchChanged(event);
  });
  search.addEventListener("input", searchChanged);
  $("knowledge-base-btn-edit").addEventListener("click", () => {
    if (selectedId) safeCall(openEditor, selectedId);
  });
  $("knowledge-base-btn-delete").addEventListener("click", () => {
    if (selectedId) safeCall(removeZettel, selectedId);
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
    $("knowledge-base-sort").value,
  ]);
}

async function refreshChanged(cardIDs, referencesChanged) {
  if (
    $("knowledge-base-list").getAttribute("aria-busy") !== "false" ||
    listScope !== currentScope()
  )
    return refresh();
  const position = captureListPosition();
  const version = ++listVersion;
  const query = $("knowledge-base-search").value || "";
  const page = await api.searchZettelSummaries(
    query,
    {
      cardIDs,
      limit: 500,
      entriesOnly: $("knowledge-base-entries").checked,
      kind: /** @type {import("../../src/modules/db").NoteKind | undefined} */ (
        $("knowledge-base-kind").value || undefined
      ),
      availability: "active",
      sort: /** @type {import("../../src/modules/note-sort").NoteSort} */ (
        $("knowledge-base-sort").value
      ),
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
        snippet: api.noteSnippet(row.body, query, api.loc("manager-formula")),
      })),
    );
  zettels.sort((a, b) =>
    api.compareNoteSummaries(
      a,
      b,
      /** @type {import("../../src/modules/note-sort").NoteSort} */ (
        $("knowledge-base-sort").value
      ),
    ),
  );
  rowIndices.clear();
  zettels.forEach((row, index) => rowIndices.set(row.id, index));
  restoreListPosition(position);
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

async function refresh(preserve = listScope === currentScope()) {
  clearTimeout(searchTimer);
  searchTimer = null;
  const position = preserve ? captureListPosition() : null;
  invalidatePages();
  const version = listVersion;
  listScope = currentScope();
  listReferences = undefined;
  const options = {
    entriesOnly: $("knowledge-base-entries").checked,
    kind: /** @type {import("../../src/modules/db").NoteKind | undefined} */ (
      $("knowledge-base-kind").value || undefined
    ),
    availability: "active",
    sort: /** @type {import("../../src/modules/note-sort").NoteSort} */ (
      $("knowledge-base-sort").value
    ),
    limit: 100,
  };
  const query = $("knowledge-base-search").value || "";
  $("knowledge-base-list").setAttribute("aria-busy", "true");
  await loadPage(version, query, options, false, position);
  if (version === listVersion) await refreshUnresolved();
}

async function loadPage(version, query, options, append, position = null) {
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
      snippet: api.noteSnippet(row.body, query, api.loc("manager-formula")),
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
    if (!append && !position) $("knowledge-base-list-pane").scrollTop = 0;
    if (position) restoreListPosition(position);
    renderList();
    $("knowledge-base-stats").textContent = api.loc("manager-count", {
      count: zettels.length,
    });
    $("knowledge-base-list").setAttribute("aria-busy", String(!!nextCursor));
    if (nextCursor) {
      pageTimer = setTimeout(() => {
        pageTimer = null;
        safeCall(loadPage, version, query, options, true, position);
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

function scheduleListRender() {
  if (renderTimer !== null) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderList();
  }, 16);
}

function listHeaderHeight() {
  return $("knowledge-base-sort").parentElement.offsetHeight || 34;
}
function captureListPosition() {
  const pane = $("knowledge-base-list-pane");
  const first = Math.max(
    0,
    Math.floor((pane.scrollTop - listHeaderHeight()) / ROW_HEIGHT),
  );
  const selected = rowIndices.get(selectedId);
  const index =
    selected !== undefined &&
    selected >= first &&
    selected * ROW_HEIGHT < pane.scrollTop + (pane.clientHeight || 600)
      ? selected
      : first;
  return {
    id: zettels[index]?.id,
    offset: index * ROW_HEIGHT - pane.scrollTop,
    scroll: pane.scrollTop,
  };
}
function restoreListPosition(position) {
  const index = rowIndices.get(position.id);
  $("knowledge-base-list-pane").scrollTop =
    index === undefined
      ? position.scroll
      : Math.max(0, index * ROW_HEIGHT - position.offset);
}

function revealRow(id) {
  const index = zettels.findIndex((row) => row.id === id);
  if (index < 0) return;
  const pane = $("knowledge-base-list-pane");
  const top = index * ROW_HEIGHT + listHeaderHeight();
  const height = pane.clientHeight || 600;
  if (top < pane.scrollTop + listHeaderHeight())
    pane.scrollTop = top - listHeaderHeight();
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
    listHeaderHeight() +
      zettels.length * ROW_HEIGHT -
      (pane.clientHeight || 600) +
      8,
  );
  if (pane.scrollTop > maxScroll) pane.scrollTop = maxScroll;
  const start = Math.max(
    0,
    Math.floor((pane.scrollTop - listHeaderHeight()) / ROW_HEIGHT) - 4,
  );
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
    li.tabIndex = z.id === selectedId ? 0 : -1;
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
    badges.textContent = [
      z.outgoing ? `↗ ${z.outgoing}` : "",
      z.incoming ? `↙ ${z.incoming}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
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

async function safeCall(fn, ...args) {
  try {
    return await fn(...args);
  } catch (error) {
    showError(error);
  }
}

async function refreshUnresolved() {
  const version = ++unresolvedVersion;
  const refs = await api.getUnresolvedRefs();
  if (version !== unresolvedVersion || window.closed) return;
  const box = $("knowledge-base-unresolved");
  const ul = $("knowledge-base-unresolved-list");
  const expanded = new Set(
    /** @type {HTMLDetailsElement[]} */ (
      Array.from(ul.querySelectorAll("details[open]"))
    ).map((node) => node.dataset.ref),
  );
  ul.textContent = "";
  box.hidden = refs.length === 0;
  $("knowledge-base-unresolved-head").textContent =
    `${api.loc("manager-unresolved")} · ${refs.length}`;
  for (const r of refs) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    const details = /** @type {HTMLDetailsElement} */ (
      document.createElementNS("http://www.w3.org/1999/xhtml", "details")
    );
    details.dataset.ref = r.ref;
    const summary = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "summary",
    );
    const nativeKey = /^note-\d+-([A-Z0-9]{8})$/.exec(r.ref)?.[1];
    summary.textContent = `${r.title || (nativeKey ? api.loc("manager-unavailable-note", { key: nativeKey }) : r.ref)} · ${r.count}`;
    summary.title = r.ref;
    const status = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    status.className = "muted";
    status.textContent = api.loc(
      r.state === "trashed" ? "manager-link-trashed" : "manager-unresolved-tip",
    );
    const sources = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    details.append(summary, status, sources);
    let loaded = false;
    let loading = false;
    details.addEventListener("toggle", () => {
      if (!details.open || loaded || loading) return;
      loading = true;
      safeCall(async () => {
        try {
          const notes = await api.getUnresolvedSources(r.ref);
          if (version !== unresolvedVersion || window.closed) return;
          for (const note of notes) {
            const button = document.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "button",
            );
            button.className = "relation-link";
            window.ZoteroKnowledgeBaseMarkdown.identity(
              button,
              note.id,
              note.title,
              note.reference,
            );
            button.addEventListener("click", () =>
              window.ZoteroKnowledgeBase_selectZettel(note.id),
            );
            sources.append(button);
          }
          loaded = true;
        } finally {
          loading = false;
        }
      });
    });
    li.append(details);
    ul.appendChild(li);
    if (expanded.has(r.ref)) details.open = true;
  }
}

window.knowledgeBaseShowUnresolved = (ref) => {
  if (!managerLoaded) {
    args.unresolvedRef = ref;
    return;
  }
  safeCall(async () => {
    await api.auditNativeNotes();
    await refreshUnresolved();
    const row = /** @type {HTMLDetailsElement[]} */ (
      Array.from(
        $("knowledge-base-unresolved-list").querySelectorAll("details"),
      )
    ).find((node) => node.dataset.ref === ref);
    if (!row) return;
    $("knowledge-base-unresolved").open = true;
    row.open = true;
    row.querySelector("summary").focus();
    row.scrollIntoView?.({ block: "nearest" });
  });
};

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
    if (li.classList.contains("zettel-row"))
      li.tabIndex = li.dataset.id === id ? 0 : -1;
  }
  safeCall(async () => {
    if (!args.embedded) await renderDetail(id);
    if (selectedId === id)
      $("knowledge-base-preview").scrollTop = scrollPositions.get(id) || 0;
  });
}

async function navigateHistory(direction) {
  let index = historyIndex + direction;
  let card;
  while (index >= 0 && index < history.length) {
    card = await api.getZettel(history[index]);
    if (
      card &&
      !["trashed", "missing"].includes((await api.getNoteHealth(card.id)).note)
    )
      break;
    card = null;
    index += direction;
  }
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

async function renderDetail(id) {
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
    chip.addEventListener("click", () =>
      safeCall(async () => {
        const health = link.targetId
          ? await api.getNoteHealth(link.targetId)
          : null;
        if (health && !["trashed", "missing"].includes(health.note))
          select(link.targetId);
        else window.knowledgeBaseShowUnresolved(link.ref);
      }),
    );
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
}

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
          await refreshChanged([id], true);
          updateActions();
          options.onSaved?.(id);
        }),
    }))
  )
    return false;
  frame.hidden = false;
  $("knowledge-base-error").hidden = true;
  for (const id of ["knowledge-base-detail", "knowledge-base-detail-empty"])
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

async function removeZettel(id) {
  if (deleting) return;
  deleting = true;
  updateActions();
  try {
    const z = await api.getZettel(id);
    if (
      !z ||
      !window.confirm(
        api.loc("manager-confirm-delete", { title: z.title || id }),
      )
    )
      return;
    const index = rowIndices.get(id) ?? 0;
    const neighbor = zettels[index + 1]?.id || zettels[index - 1]?.id;
    const frame = /** @type {HTMLIFrameElement} */ (
      /** @type {unknown} */ (
        document.getElementById("knowledge-base-workbench-editor")
      )
    );
    if (
      args.embedded &&
      frame.contentWindow?.knowledgeBasePrepareNavigation &&
      !(await frame.contentWindow.knowledgeBasePrepareNavigation())
    )
      return;
    await api.deleteZettel(id);
    if (window.closed) return;
    if (selectedId && selectedId !== id) {
      await refreshChanged([id], true);
      return;
    }
    if (args.embedded) {
      frame.hidden = true;
      api.clearEditor(frame);
    }
    selectedId = null;
    await refreshChanged([id], true);
    const next =
      zettels.find((row) => row.id === neighbor) ||
      zettels[Math.min(index, zettels.length - 1)];
    if (next) {
      await select(next.id);
      getRenderedRow(next.id)?.focus({ preventScroll: true });
    } else {
      $("knowledge-base-detail").hidden = true;
      $("knowledge-base-detail-empty").hidden = false;
      $("knowledge-base-list").focus();
    }
  } finally {
    deleting = false;
    updateActions();
  }
}

window.addEventListener("load", () => safeCall(load));

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
  if (unavailable) return;
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
