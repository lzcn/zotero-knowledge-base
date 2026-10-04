/* global Zotero */
"use strict";

let zettels = [];
let selectedId = null;
let searchTimer = null;
let detailVersion = 0;
let listVersion = 0;
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
  window.arguments[0] || {}
);

/* resolved after include.js provides Zotero */
/** @type {import("../../src/modules/api").KnowledgeBaseAPI} */
let api = null;

function showError(msg) {
  const box = $("knowledge-base-error");
  box.hidden = false;
  box.textContent = "⚠ " + msg;
  try {
    Zotero.logError(new Error(String(msg)));
  } catch (e) {
    console.error(e);
  }
}

function wrap(fn) {
  return async function wrapped(...args) {
    try {
      return await fn.apply(this, args);
    } catch (e) {
      showError((e && (e.stack || e.message)) || String(e));
      throw e;
    }
  };
}

window.addEventListener("error", (ev) => {
  showError(ev.error ? ev.error.stack || ev.error.message : ev.message);
});

const load = wrap(async function () {
  api = /** @type {import("../../src/modules/api").KnowledgeBaseAPI} */ (
    new Proxy(
      {},
      { get: (_, key) => window.Zotero.ZoteroKnowledgeBase.api[key] },
    )
  );
  applyLocale();
  bindEvents();
  await refreshDrafts();
  if (args.selectId) $("knowledge-base-entries").checked = false;
  await refresh();
  const wanted =
    args.selectId && (await api.getZettel(args.selectId))
      ? args.selectId
      : null;
  if (wanted) select(wanted);
  else if (zettels.length) select(zettels[0].id);
  const unsubscribe = api.onDataChange(() =>
    safeCall(async () => {
      await refresh();
      if (selectedId) await renderDetail(selectedId);
    }),
  );
  window.addEventListener("unload", unsubscribe, { once: true });
});

/**
 * Called from the reader / item pane when the window is already open, so that
 * "open the card" does not raise a second manager window.
 */
window.ZoteroKnowledgeBase_selectZettel = function (id) {
  safeCall(async () => {
    $("knowledge-base-search").value = "";
    $("knowledge-base-entries").checked = false;
    await refresh();
    if (await api.getZettel(id)) select(id);
  });
};

function applyLocale() {
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
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      window.close();
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
      if (menu.value) api.openEditor({ draftId: menu.value });
    });
  window.addEventListener("focus", () => safeCall(refreshDrafts));
  $("knowledge-base-list").addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const rows = /** @type {HTMLLIElement[]} */ (
      Array.from($("knowledge-base-list").querySelectorAll("li"))
    );
    const index = rows.indexOf(
      /** @type {HTMLLIElement} */ (document.activeElement),
    );
    const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
      select(next.dataset.id);
    }
  });
  $("knowledge-base-btn-child").addEventListener("click", () => {
    if (!selectedId) return;
    api.openEditor({
      prefillParentId: selectedId,
      onSaved: (id) =>
        safeCall(async () => {
          $("knowledge-base-entries").checked = false;
          await refresh();
          select(id);
        }),
    });
  });
  $("knowledge-base-entries").addEventListener("change", () => {
    selectedId = null;
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

const refresh = wrap(async function () {
  const version = ++listVersion;
  const q = $("knowledge-base-search").value || "";
  const rows = await api.listZettels(q, $("knowledge-base-entries").checked);
  if (version !== listVersion || window.closed) return;
  zettels = rows;
  const list = $("knowledge-base-list");
  list.textContent = "";
  for (const z of zettels) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.className = "zettel-row" + (z.id === selectedId ? " active" : "");
    li.dataset.id = z.id;
    li.tabIndex = 0;
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
    const plain = (z.body || "")
      .replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_match, id, alias) => alias || `[[${id}]]`,
      )
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*`>_$]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const match = q
      ? plain.toLocaleLowerCase().indexOf(q.toLocaleLowerCase())
      : 0;
    const start = Math.max(0, match - 30);
    snippet.textContent =
      (start ? "…" : "") +
      plain.slice(start, start + 110) +
      (plain.length > start + 110 ? "…" : "");
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
    id.textContent = z.id;
    id.title = z.id;
    li.appendChild(id);

    li.addEventListener("click", () => safeCall(select, z.id));
    li.addEventListener("dblclick", () => safeCall(openEditor, z.id));
    list.appendChild(li);
  }
  $("knowledge-base-stats").textContent = api.loc("manager-count", {
    count: zettels.length,
  });
  await refreshUnresolved();
});

function safeCall(fn, ...args) {
  Promise.resolve(fn.apply(null, args)).catch((e) => {
    showError((e && (e.stack || e.message)) || String(e));
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

function select(id, record = true) {
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
  for (const li of /** @type {HTMLLIElement[]} */ (
    Array.from($("knowledge-base-list").children)
  )) {
    li.classList.toggle("active", li.dataset.id === id);
    li.setAttribute("aria-current", li.dataset.id === id ? "true" : "false");
  }
  safeCall(async () => {
    await renderDetail(id);
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
  const [z, family, outgoing, backlinks] = await Promise.all([
    api.getZettel(id),
    api.getFamily(id),
    api.getOutgoing(id),
    api.getBacklinks(id),
  ]);
  if (!z || version !== detailVersion || selectedId !== id) return;
  await api.prepareMarkdown(z.body);
  const source = z.item_key
    ? await api.getItemSummary(z.item_key, z.library_id)
    : null;
  if (version !== detailVersion || selectedId !== id) return;
  $("knowledge-base-detail-empty").hidden = true;
  $("knowledge-base-detail").hidden = false;

  $("knowledge-base-detail-id").textContent = z.id;
  $("knowledge-base-detail-title").title = z.id;
  $("knowledge-base-detail-title").textContent =
    z.title || api.loc("manager-untitled");
  $("knowledge-base-detail-meta").textContent =
    `${api.loc("manager-updated")} ${new Date(z.updated_at).toLocaleString()}`;

  const srcBox = $("knowledge-base-detail-source");
  srcBox.textContent = "";
  if (z.item_key) {
    const s = source;
    if (s) {
      const link = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      link.className = "source-link";
      link.textContent = s.title;
      const citation = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "small",
      );
      citation.textContent = [s.creatorYear, s.publication]
        .filter(Boolean)
        .join(" · ");
      link.appendChild(citation);
      link.title = api.loc("manager-source-open");
      link.addEventListener("click", () =>
        safeCall(() => api.selectItem(s.key, s.libraryID)),
      );
      srcBox.appendChild(link);
    } else {
      // The source item is gone (deleted, or in a detached library): say so
      // instead of silently showing nothing.
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

function openEditor(id) {
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
  api.openEditor({
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
    api.loc("manager-confirm-delete", { title: (z && z.title) || id }),
  );
  if (!ok) return;
  await api.deleteZettel(id);
  selectedId = null;
  $("knowledge-base-detail").hidden = true;
  $("knowledge-base-detail-empty").hidden = false;
  await refresh();
});

window.addEventListener("load", load);
