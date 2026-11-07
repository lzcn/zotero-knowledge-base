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
const ROW_HEIGHT = 120;
let unresolvedVersion = 0;
const rowIndices = new Map();
let listScope = "";
let listReferences;
let navigationVersion = 0;
let managerLoaded = false;
let activeView = "all";
let viewVersion = 0;
/** @type {Record<string, { label: string; noteType?: import("../../src/modules/note-types").NoteType }>} */
const NOTE_VIEWS = {
  all: { label: "manager-view-all" },
  literature: { label: "manager-view-literature", noteType: "literature" },
  zettel: { label: "manager-view-zettel", noteType: "zettel" },
  thinking: { label: "manager-view-thinking", noteType: "thinking" },
  entity: { label: "manager-view-entity", noteType: "entity" },
  trash: { label: "trash-title" },
};
let deleting = false;
let purging = false;
let purgeCancelled = false;
let trashVersion = 0;
let menuVersion = 0;
/** @type {import("../../src/modules/native-notes").TrashNote[]} */
let trashNotes = [];
const navigationHistory = [];
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

window.knowledgeBaseRequestClose = () =>
  safeCall(async () => {
    const frame = /** @type {HTMLIFrameElement} */ (
      /** @type {unknown} */ (
        document.getElementById("knowledge-base-workbench-editor")
      )
    );
    if (!frame.hidden && frame.contentWindow?.knowledgeBaseRequestClose)
      await frame.contentWindow.knowledgeBaseRequestClose();
    else if (args.embedded) args.onClose?.();
    else window.close();
  });

function inTrash() {
  return activeView === "trash";
}
function syncViewButtons() {
  for (const button of /** @type {Element[]} */ (
    Array.from(document.querySelectorAll("[data-note-view]"))
  )) {
    const view = button.getAttribute("data-note-view");
    button.setAttribute("aria-pressed", String(activeView === view));
    button.toggleAttribute("disabled", deleting);
  }
}
function setView(view) {
  if (!NOTE_VIEWS[view]) throw new Error("Invalid note view");
  ++viewVersion;
  activeView = view;
  syncViewButtons();
}
function viewType() {
  return NOTE_VIEWS[activeView].noteType;
}
function setActionLabel(id, key) {
  const element = document.getElementById(id),
    text = api.loc(key);
  for (const attribute of ["label", "tooltiptext", "aria-label"])
    element.setAttribute(attribute, text);
}
function updateActions() {
  const trash = inTrash();
  const editable =
    !trash || !!trashNotes.find((note) => note.id === selectedId)?.editable;
  for (const id of [
    "knowledge-base-btn-edit",
    "knowledge-base-btn-local-graph",
    "knowledge-base-btn-delete",
  ])
    document
      .getElementById(id)
      .toggleAttribute(
        "disabled",
        !selectedId ||
          deleting ||
          !editable ||
          (trash && id !== "knowledge-base-btn-delete"),
      );
  for (const id of [
    "knowledge-base-btn-new",
    "knowledge-base-btn-graph",
    "knowledge-base-btn-copy-zettels",
  ])
    document.getElementById(id).toggleAttribute("disabled", trash || deleting);
  document.getElementById("knowledge-base-btn-local-graph").hidden = trash;
  document.getElementById("knowledge-base-btn-restore").hidden = !trash;
  document
    .getElementById("knowledge-base-btn-restore")
    .toggleAttribute("disabled", !selectedId || !editable || deleting);
  document.getElementById("knowledge-base-empty-trash").hidden =
    !trash || purging;
  document
    .getElementById("knowledge-base-empty-trash")
    .toggleAttribute(
      "disabled",
      deleting || !trashNotes.some((note) => note.editable),
    );
  document.getElementById("knowledge-base-trash-cancel").hidden = !purging;
  syncViewButtons();
  $("knowledge-base-search").disabled = purging;
  $("knowledge-base-sort").disabled = purging;
  setActionLabel(
    "knowledge-base-btn-delete",
    trash ? "trash-delete" : "manager-delete",
  );
  $("knowledge-base-detail-empty").textContent = api.loc(
    trash ? "trash-select-note" : "manager-empty-detail",
  );
}
async function refreshTrashState() {
  const version = ++trashVersion;
  const notes = await api.getTrashNotes();
  if (window.closed || version !== trashVersion) return;
  trashNotes = notes;
  updateActions();
}
function setTrashStatus(message = "") {
  const status = document.getElementById("knowledge-base-trash-status");
  status.textContent = message;
  status.hidden = !message;
}
async function closeSelectedEditor(version = viewVersion) {
  const frame = /** @type {HTMLIFrameElement} */ (
    /** @type {unknown} */ (
      document.getElementById("knowledge-base-workbench-editor")
    )
  );
  const current = frame.contentWindow;
  const editorDocument = current?.document;
  if (args.embedded && current?.knowledgeBaseReady) {
    await current.knowledgeBaseReady();
    if (window.closed || frame.contentWindow?.document !== editorDocument)
      return false;
  }
  if (
    args.embedded &&
    frame.contentWindow?.knowledgeBasePrepareNavigation &&
    !(await frame.contentWindow.knowledgeBasePrepareNavigation())
  )
    return false;
  if (
    window.closed ||
    version !== viewVersion ||
    frame.contentWindow?.document !== editorDocument
  )
    return false;
  if (args.embedded) {
    api.clearEditor(frame);
    frame.hidden = true;
  }
  selectedId = null;
  $("knowledge-base-detail").hidden = true;
  $("knowledge-base-detail-empty").hidden = false;
  return true;
}
async function changeView(view) {
  if (deleting || view === activeView) return;
  if (!NOTE_VIEWS[view]) throw new Error("Invalid note view");
  const version = ++viewVersion;
  const wasTrash = inTrash();
  if (!(await closeSelectedEditor(version)) || version !== viewVersion) return;
  setView(view);
  const request = viewVersion;
  setTrashStatus();
  if (wasTrash !== inTrash()) {
    await api.auditNativeNotes(true);
    if (window.closed || request !== viewVersion) return;
    await refreshTrashState();
  }
  if (request !== viewVersion) return;
  await refresh(false);
  if (request !== viewVersion) return;
  await refreshDrafts();
  if (request !== viewVersion) return;
  if (zettels.length) await select(zettels[0].id);
  else {
    $("knowledge-base-detail").hidden = true;
    $("knowledge-base-detail-empty").hidden = false;
  }
}
async function restoreSelected(id = selectedId) {
  if (!inTrash() || deleting || !id) return;
  deleting = true;
  updateActions();
  try {
    await api.restoreNote(id);
    if (window.closed) return;
    if (!(await closeSelectedEditor())) return;
    await refreshTrashState();
    await refresh(false);
    if (zettels.length) await select(zettels[0].id);
    setTrashStatus(api.loc("trash-restored"));
  } finally {
    deleting = false;
    if (!window.closed) updateActions();
  }
}
async function purgeNotes(ids) {
  if (deleting || !ids.length) return;
  deleting = true;
  purging = true;
  purgeCancelled = false;
  updateActions();
  try {
    if (!(await closeSelectedEditor())) return;
    setTrashStatus(api.loc("trash-progress", { done: 0, total: ids.length }));
    const result = await api.permanentlyDeleteNotes(
      ids,
      () =>
        window.closed ||
        !!window.knowledgeBaseStopping ||
        purgeCancelled ||
        !inTrash(),
      (done, total) => {
        if (!window.closed)
          setTrashStatus(api.loc("trash-progress", { done, total }));
      },
    );
    if (window.closed) return;
    await refreshTrashState();
    await refresh(false);
    if (zettels.length) await select(zettels[0].id);
    let message = api.loc(
      result.cancelled ? "trash-delete-cancelled" : "trash-delete-done",
      { count: result.deleted },
    );
    if (result.skipped)
      message +=
        " " + api.loc("trash-delete-skipped", { count: result.skipped });
    setTrashStatus(message);
  } finally {
    deleting = false;
    purging = false;
    if (!window.closed) updateActions();
  }
}
async function emptyTrash() {
  if (!inTrash() || deleting) return;
  const notes = (await api.getTrashNotes()).filter((note) => note.editable);
  if (window.closed || !inTrash() || deleting || !notes.length) return;
  if (!window.confirm(api.loc("trash-confirm-empty", { count: notes.length })))
    return;
  await purgeNotes(notes.map((note) => note.id));
}

function showError(error) {
  const code = String(error?.message || error);
  const msg =
    code === "SEARCH_QUERY_TOO_LONG" ? api.loc("search-query-too-long") : code;
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
  await refreshTrashState();
  window.KnowledgeBasePanels.attach(
    $("knowledge-base-splitter"),
    $("knowledge-base-list-pane"),
    "manager",
    api,
  );
  await refreshDrafts();
  await refresh();
  const wanted =
    args.selectId && (await api.getZettel(args.selectId))
      ? args.selectId
      : null;
  managerLoaded = true;
  const initialEditor = args.editor;
  if (args.embedded && initialEditor) {
    if ((await showInlineEditor(initialEditor)) && initialEditor.zettelId)
      select(initialEditor.zettelId, { mounted: true });
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
          if (all || change.fields.includes("availability"))
            await refreshTrashState();
          if (
            all ||
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
  if (!inTrash() && rowIndices.has(id)) {
    safeCall(select, id);
    return;
  }
  const version = ++navigationVersion;
  safeCall(async () => {
    $("knowledge-base-search").value = "";
    setView("all");
    updateActions();
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
      if (options.zettelId) select(options.zettelId, { mounted: true });
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
  $("knowledge-base-views").setAttribute("aria-label", api.loc("manager-view"));
  for (const [view, options] of Object.entries(NOTE_VIEWS))
    setActionLabel("knowledge-base-view-" + view, options.label);
  syncViewButtons();
  for (const [id, key] of [
    ["knowledge-base-btn-restore", "trash-restore"],
    ["knowledge-base-empty-trash", "trash-empty"],
    ["knowledge-base-trash-cancel", "trash-cancel"],
  ])
    setActionLabel(id, key);
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
    ["knowledge-base-btn-copy-zettels", "manager-copy-zettels"],
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
  const pane = $("knowledge-base-list-pane");
  const menu = noteMenu();
  pane.addEventListener("contextmenu", (event) => {
    if (
      event.target instanceof window.Element &&
      event.target.closest("input, select")
    )
      return;
    event.preventDefault();
    safeCall(() => showNoteMenu(event));
  });
  $("knowledge-base-list").addEventListener("keydown", (event) => {
    if (event.isComposing || event.repeat) return;
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    safeCall(() => showNoteMenu(event, true));
  });
  menu.addEventListener("popuphidden", (event) => {
    if (event.target !== menu) return;
    for (const row of document.querySelectorAll(".zettel-row.context-target"))
      if (row instanceof window.Element) row.classList.remove("context-target");
  });
  window.addEventListener(
    "unload",
    () => {
      menuVersion++;
      menu.hidePopup();
    },
    { once: true },
  );
  const copyButton = document.getElementById("knowledge-base-btn-copy-zettels");
  copyButton.addEventListener("command", () =>
    safeCall(async () => {
      if (copyButton.hasAttribute("disabled")) return;
      copyButton.setAttribute("disabled", "true");
      const status = document.getElementById("knowledge-base-copy-status");
      status.hidden = true;
      $("knowledge-base-error").hidden = true;
      try {
        const count = await api.copyZettelList(() => Boolean(window.closed));
        if (window.closed || count === null) return;
        status.textContent = api.loc(
          count ? "manager-copy-zettels-done" : "manager-copy-zettels-empty",
          { count },
        );
        status.hidden = false;
      } finally {
        if (!window.closed) copyButton.removeAttribute("disabled");
      }
    }),
  );
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
      void window.knowledgeBaseRequestClose?.();
    }
  });
  $("knowledge-base-list").addEventListener("mousedown", (event) => {
    if (event.detail > 1) event.preventDefault();
    window.getSelection()?.removeAllRanges();
  });
  let clickedNoteID = null;
  $("knowledge-base-list").addEventListener("click", (event) => {
    if (deleting || event.detail > 1) return;
    const row = /** @type {Element} */ (event.target).closest(".zettel-row");
    if (!row) return;
    clickedNoteID = row.getAttribute("data-id");
    safeCall(select, clickedNoteID, { reveal: false });
  });
  $("knowledge-base-list").addEventListener("dblclick", (event) => {
    if (deleting || inTrash()) return;
    const row = /** @type {Element} */ (event.target).closest(".zettel-row");
    const id = event.detail > 1 ? clickedNoteID : row?.getAttribute("data-id");
    if (id && rowIndices.has(id)) safeCall(openNoteWindow, id);
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
    if (deleting) return;
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
    if (selectedId) safeCall(() => newChildNote(selectedId));
  });
  for (const button of /** @type {Element[]} */ (
    Array.from(document.querySelectorAll("[data-note-view]"))
  ))
    button.addEventListener("command", () =>
      safeCall(changeView, button.getAttribute("data-note-view")),
    );
  document
    .getElementById("knowledge-base-btn-restore")
    .addEventListener("click", () => safeCall(restoreSelected));
  document
    .getElementById("knowledge-base-empty-trash")
    .addEventListener("command", () => safeCall(emptyTrash));
  document
    .getElementById("knowledge-base-trash-cancel")
    .addEventListener("command", () => {
      purgeCancelled = true;
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
        window.ZoteroKnowledgeBase_selectZettel(card.targetId);
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

function noteMenu() {
  return /** @type {XULPopupElement} */ (
    /** @type {unknown} */ (document.getElementById("knowledge-base-note-menu"))
  );
}

async function showNoteMenu(event, keyboard = false) {
  const menu = noteMenu();
  menu.hidePopup();
  const version = ++menuVersion;
  if (deleting || window.knowledgeBaseStopping) return;
  const row =
    event.target.closest?.(".zettel-row") ||
    (keyboard ? getRenderedRow(selectedId) : null);
  const id = row?.dataset.id;
  const scope = currentScope();
  const navigation = navigationVersion;
  const trash = inTrash();
  const card = id ? await api.getZettel(id) : null;
  const health = card ? await api.getNoteHealth(id) : null;
  if (
    window.closed ||
    window.knowledgeBaseStopping ||
    deleting ||
    version !== menuVersion ||
    navigation !== navigationVersion ||
    scope !== currentScope() ||
    (id && (!card || !rowIndices.has(id)))
  )
    return;
  const editable =
    health?.editable && !["trashed", "missing"].includes(health.note);
  const trashed = trashNotes.find((note) => note.id === id);
  const editableTrash =
    !!trashed?.editable && !!health?.editable && health.note === "trashed";
  menu.replaceChildren();
  const add = (action, label, run, disabled = false) => {
    const item = document.createXULElement("menuitem");
    item.setAttribute("data-action", action);
    item.setAttribute("label", api.loc(label));
    item.toggleAttribute("disabled", disabled);
    item.addEventListener("command", () => {
      if (
        disabled ||
        deleting ||
        window.knowledgeBaseStopping ||
        scope !== currentScope() ||
        (id && !rowIndices.has(id))
      )
        return;
      safeCall(run);
    });
    menu.append(item);
  };
  const separator = () =>
    menu.append(document.createXULElement("menuseparator"));
  if (card) {
    add("open", "manager-open-note", () => select(id));
    add("window", "manager-open-note-window", () => openNoteWindow(id));
    separator();
    add("copy", "manager-copy-note-link", async () => {
      const current = await api.getZettel(id);
      if (current) api.copyNoteReference(current.reference || current.id);
    });
    if (trash) {
      separator();
      add(
        "restore",
        "trash-restore",
        () => restoreSelected(id),
        !editableTrash,
      );
      add("delete", "trash-delete", () => removeZettel(id), !editableTrash);
    } else {
      add("graph", "manager-show-graph", () => api.openGraph({ centerId: id }));
      separator();
      add("child", "new-child", () => newChildNote(id), !editable);
      add(
        "tags",
        "note-tags-edit",
        async () => {
          if (args.embedded) {
            if (await showInlineEditor({ zettelId: id, editTags: true }))
              select(id, { mounted: true });
          } else api.openEditor({ zettelId: id, editTags: true });
        },
        !editable,
      );
      separator();
      add("delete", "manager-delete", () => removeZettel(id), !editable);
    }
    const target = getRenderedRow(id);
    target?.focus({ preventScroll: true });
    target?.classList.add("context-target");
  } else if (trash) {
    add(
      "empty",
      "trash-empty",
      emptyTrash,
      !trashNotes.some((note) => note.editable),
    );
  } else add("new", "manager-new", () => newZettel());
  if (keyboard)
    menu.openPopup(
      getRenderedRow(id) || $("knowledge-base-list"),
      "after_start",
      0,
      0,
      true,
      false,
    );
  else menu.openPopupAtScreen(event.screenX, event.screenY, true);
}

function newChildNote(id) {
  if (deleting || inTrash()) return;
  if (args.embedded) return showInlineEditor({ prefillParentId: id });
  api.openEditor({
    prefillParentId: id,
    onSaved: (savedID) =>
      safeCall(async () => {
        setView("all");
        await refresh();
        select(savedID);
      }),
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
    activeView,
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
      availability: inTrash() ? "trash" : "active",
      noteType: viewType(),
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
    $("knowledge-base-detail-empty").hidden =
      args.embedded &&
      !document.getElementById("knowledge-base-workbench-editor").hidden;
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
    availability: inTrash() ? "trash" : "active",
    noteType: viewType(),
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
      $("knowledge-base-detail-empty").hidden =
        args.embedded &&
        !document.getElementById("knowledge-base-workbench-editor").hidden;
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
  return $("knowledge-base-sort").parentElement.offsetHeight || 48;
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
  const before = pane.scrollTop;
  if (top < pane.scrollTop + listHeaderHeight())
    pane.scrollTop = top - listHeaderHeight();
  else if (top + ROW_HEIGHT > pane.scrollTop + height)
    pane.scrollTop = top + ROW_HEIGHT - height;
  if (pane.scrollTop !== before || !getRenderedRow(id)) renderList();
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
      if (deleting) return;
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
    const type = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    type.className = "note-type-label";
    if (z.note_type) {
      type.textContent = api.loc("note-type-" + z.note_type);
      badges.prepend(type);
    }
    li.appendChild(badges);

    const id = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    id.className = "zid muted";
    const reference = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    reference.className = "note-row-reference";
    reference.textContent = z.reference || z.id;
    id.append(reference);
    id.title = z.id;
    li.appendChild(id);

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
  if (inTrash()) {
    $("knowledge-base-unresolved").hidden = true;
    return;
  }
  $("knowledge-base-unresolved").hidden = false;
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

function select(id, { record = true, mounted = false, reveal = true } = {}) {
  if (!mounted) navigationVersion++;
  if (args.embedded && !mounted)
    return safeCall(async () => {
      if (await showInlineEditor({ zettelId: id }))
        select(id, { record, mounted: true, reveal });
    });
  if (selectedId)
    scrollPositions.set(selectedId, $("knowledge-base-preview").scrollTop);
  if (record && navigationHistory[historyIndex] !== id) {
    navigationHistory.splice(historyIndex + 1);
    navigationHistory.push(id);
    historyIndex = navigationHistory.length - 1;
  }
  document
    .getElementById("knowledge-base-back")
    .toggleAttribute("disabled", historyIndex <= 0);
  document
    .getElementById("knowledge-base-forward")
    .toggleAttribute("disabled", historyIndex >= navigationHistory.length - 1);
  selectedId = id;
  if (reveal) revealRow(id);
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
  if (deleting) return;
  let index = historyIndex + direction;
  let card;
  while (index >= 0 && index < navigationHistory.length) {
    card = await api.getZettel(navigationHistory[index]);
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
  setView("all");
  updateActions();
  await refresh();
  select(card.id, { record: false });
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
  document.getElementById("knowledge-base-drafts").hidden =
    inTrash() || !drafts.length;
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

  $("knowledge-base-detail-id").textContent = api.loc("editor-key");
  window.ZoteroKnowledgeBaseMarkdown.reference(
    $("knowledge-base-detail-reference"),
    z.reference || z.id,
    api,
  );
  $("knowledge-base-detail-title").title = z.id;
  $("knowledge-base-detail-title").textContent =
    z.title || api.loc("manager-untitled");
  $("knowledge-base-detail-meta").textContent = [
    z.note_type ? api.loc("note-type-" + z.note_type) : "",
    `${api.loc("manager-updated")} ${new Date(z.updated_at).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

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
  const frame = /** @type {HTMLIFrameElement} */ (
    /** @type {unknown} */ (
      document.getElementById("knowledge-base-workbench-editor")
    )
  );
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
  if (options.editTags) await frame.contentWindow.knowledgeBaseEditTags?.();
  $("knowledge-base-error").hidden = true;
  for (const id of ["knowledge-base-detail", "knowledge-base-detail-empty"])
    document.getElementById(id).hidden = true;
  return true;
}

async function openNoteWindow(id) {
  const frame = /** @type {HTMLIFrameElement} */ (
    document.getElementById("knowledge-base-workbench-editor")
  );
  const editor = frame.contentWindow;
  if (
    args.embedded &&
    editor?.knowledgeBaseCardId === id &&
    !(await editor.save(false))
  )
    return;
  if (!window.closed && !window.knowledgeBaseStopping)
    api.openEditor({ zettelId: id, window: true });
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
  if (inTrash() || deleting) return;
  navigationVersion++;
  if (args.embedded)
    return safeCall(() =>
      showInlineEditor({
        prefillTitle: title,
      }),
    );
  api.openEditor({
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
  if (inTrash()) {
    const note = trashNotes.find((note) => note.id === id);
    if (
      !note?.editable ||
      !window.confirm(
        api.loc("trash-confirm-delete", { title: note.title || id }),
      )
    )
      return;
    return purgeNotes([id]);
  }
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
      $("knowledge-base-detail-empty").hidden =
        args.embedded &&
        !document.getElementById("knowledge-base-workbench-editor").hidden;
      $("knowledge-base-list").focus();
    }
  } finally {
    deleting = false;
    if (!window.closed) updateActions();
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
