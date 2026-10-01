/* global Zotero */
"use strict";

let zettels = [];
let selectedId = null;
let searchTimer = null;

const $ = (id) => document.getElementById(id);

const args = (window.arguments && window.arguments[0]) || {};

/* resolved after include.js provides Zotero */
let api = null;

function showError(msg) {
  const box = $("zettel-knowledge-base-error");
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
  api = new Proxy(
    {},
    { get: (_, key) => window.Zotero.ZettelKnowledgeBase.api[key] },
  );
  applyLocale();
  bindEvents();
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
window.ZettelKnowledgeBase_selectZettel = function (id) {
  safeCall(async () => {
    $("zettel-knowledge-base-search").value = "";
    await refresh();
    if (await api.getZettel(id)) select(id);
  });
};

function applyLocale() {
  document.title = api.loc("manager-title");
  $("zettel-knowledge-base-btn-new").textContent = api.loc("manager-new");
  $("zettel-knowledge-base-search").placeholder = api.loc(
    "manager-search-placeholder",
  );
  $("zettel-knowledge-base-detail-empty").textContent = api.loc(
    "manager-empty-detail",
  );
  $("zettel-knowledge-base-outgoing-head").textContent =
    api.loc("manager-outgoing");
  $("zettel-knowledge-base-backlinks-head").textContent =
    api.loc("manager-backlinks");
  $("zettel-knowledge-base-preview-head").textContent =
    api.loc("manager-preview");
  $("zettel-knowledge-base-btn-edit").textContent = api.loc("manager-edit");
  $("zettel-knowledge-base-btn-delete").textContent = api.loc("manager-delete");
  $("zettel-knowledge-base-unresolved-head").textContent =
    api.loc("manager-unresolved");
  $("zettel-knowledge-base-btn-graph").textContent = api.loc("graph-title");
  $("zettel-knowledge-base-btn-local-graph").textContent =
    api.loc("graph-local-one");
}

function bindEvents() {
  $("zettel-knowledge-base-btn-graph").addEventListener("click", () =>
    api.openGraph(),
  );
  $("zettel-knowledge-base-btn-local-graph").addEventListener("click", () =>
    api.openGraph({ centerId: selectedId }),
  );
  $("zettel-knowledge-base-preview").addEventListener("click", (ev) => {
    if (ev.target.localName === "img") {
      api.openImage(ev.target.getAttribute("src"));
      return;
    }
    const link = ev.target.closest?.("a");
    if (!link) return;
    ev.preventDefault();
    safeCall(async () => {
      const href = link.getAttribute("href");
      const card = await api.resolveCardLink(href);
      if (card?.targetId) {
        $("zettel-knowledge-base-search").value = "";
        await refresh();
        select(card.targetId);
      } else if (card) newZettel(card.ref);
      else await api.openLink(href);
    });
  });
  $("zettel-knowledge-base-btn-new").addEventListener("click", () =>
    newZettel(),
  );
  $("zettel-knowledge-base-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(wrap(refresh), 200);
  });
  $("zettel-knowledge-base-btn-edit").addEventListener("click", () => {
    if (selectedId) openEditor(selectedId);
  });
  $("zettel-knowledge-base-btn-delete").addEventListener("click", () => {
    if (selectedId) removeZettel(selectedId);
  });
}

const refresh = wrap(async function () {
  const q = $("zettel-knowledge-base-search").value || "";
  zettels = await api.listZettels(q);
  const list = $("zettel-knowledge-base-list");
  list.textContent = "";
  for (const z of zettels) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.className = "zettel-row" + (z.id === selectedId ? " active" : "");
    li.dataset.id = z.id;

    const title = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    title.className = "title";
    title.textContent = z.title || api.loc("manager-untitled");
    li.appendChild(title);

    const badges = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    badges.className = "badges";
    badges.textContent = `↑${z.outgoing} ↓${z.incoming}`;
    li.appendChild(badges);

    const id = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    id.className = "zid muted";
    id.textContent = z.id;
    li.appendChild(id);

    li.addEventListener("click", () => safeCall(select, z.id));
    li.addEventListener("dblclick", () => safeCall(openEditor, z.id));
    list.appendChild(li);
  }
  $("zettel-knowledge-base-stats").textContent = api.loc("manager-count", {
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
  const box = $("zettel-knowledge-base-unresolved");
  const ul = $("zettel-knowledge-base-unresolved-list");
  ul.textContent = "";
  box.hidden = refs.length === 0;
  for (const r of refs.slice(0, 20)) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.textContent = `${r.ref} (${r.count})`;
    li.addEventListener("click", () => newZettel(r.ref));
    ul.appendChild(li);
  }
});

function select(id) {
  selectedId = id;
  for (const li of $("zettel-knowledge-base-list").children) {
    li.classList.toggle("active", li.dataset.id === id);
  }
  safeCall(renderDetail, id);
}

const renderDetail = wrap(async function (id) {
  const z = await api.getZettel(id);
  if (!z) return;
  $("zettel-knowledge-base-detail-empty").hidden = true;
  $("zettel-knowledge-base-detail").hidden = false;

  $("zettel-knowledge-base-detail-title").textContent =
    z.title || api.loc("manager-untitled");
  $("zettel-knowledge-base-detail-meta").textContent =
    `${z.id} · ${api.loc("manager-updated")} ${new Date(
      z.updated_at,
    ).toLocaleString()}`;

  const srcBox = $("zettel-knowledge-base-detail-source");
  srcBox.textContent = "";
  if (z.item_key) {
    const s = await api.getItemSummary(z.item_key, z.library_id);
    if (s) {
      const link = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      link.className = "source-link";
      link.textContent =
        api.loc("manager-source") +
        "：" +
        s.title +
        (s.creatorYear ? ` (${s.creatorYear})` : "");
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

  const outgoing = await api.getOutgoing(id);
  const chips = $("zettel-knowledge-base-outgoing");
  chips.textContent = "";
  chips.hidden = outgoing.length === 0;
  $("zettel-knowledge-base-outgoing-head").hidden = outgoing.length === 0;
  for (const link of outgoing) {
    const chip = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    chip.className = "chip" + (link.targetId ? "" : " unresolved");
    chip.textContent = link.display;
    chip.title = link.targetId || api.loc("manager-unresolved-tip");
    chip.addEventListener("click", () => {
      if (link.targetId) select(link.targetId);
      else newZettel(link.ref);
    });
    chips.appendChild(chip);
  }

  const backlinks = await api.getBacklinks(id);
  const ul = $("zettel-knowledge-base-backlinks");
  ul.textContent = "";
  $("zettel-knowledge-base-backlinks-head").hidden = backlinks.length === 0;
  ul.hidden = backlinks.length === 0;
  for (const b of backlinks) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.textContent = b.sourceTitle || b.sourceId;
    li.addEventListener("click", () => select(b.sourceId));
    ul.appendChild(li);
  }

  window.ZettelKnowledgeBaseMarkdown.render(
    $("zettel-knowledge-base-preview"),
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
  $("zettel-knowledge-base-detail").hidden = true;
  $("zettel-knowledge-base-detail-empty").hidden = false;
  await refresh();
});

window.addEventListener("load", load);
