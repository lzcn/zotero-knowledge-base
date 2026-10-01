/* global Zotero */
"use strict";

/**
 * Batch importer: pick highlights of one Zotero item and turn each of them
 * into its own card. Annotations that already have a card are shown as done
 * and cannot be re-imported, which keeps the one-card-per-highlight rule
 * visible in the UI rather than only enforced in the database.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";

const api = new Proxy(
  {},
  { get: (_, key) => window.Zotero.ZettelKnowledgeBase.api[key] },
);
const args = (window.arguments && window.arguments[0]) || {};

let highlights = [];
let busy = false;

const $ = (id) => document.getElementById(id);

window.addEventListener("error", (ev) => {
  showError(ev.error ? ev.error.stack || ev.error.message : ev.message);
});

function showError(msg) {
  const status = $("zettel-knowledge-base-pick-status");
  status.textContent = "⚠ " + msg;
  status.classList.add("error");
  try {
    Zotero.logError(new Error(String(msg)));
  } catch (e) {
    console.error(e);
  }
}

function setStatus(text) {
  const status = $("zettel-knowledge-base-pick-status");
  status.textContent = text;
  status.classList.remove("error");
}

function applyLocale() {
  document.title = api.loc("picker-title");
  $("zettel-knowledge-base-pick-close").textContent = api.loc("picker-close");
  $("zettel-knowledge-base-pick-empty").textContent = api.loc("picker-empty");
  $("zettel-knowledge-base-pick-source").textContent =
    args.itemTitle || args.itemKey || "";
}

function bindEvents() {
  $("zettel-knowledge-base-pick-toggle").addEventListener("click", toggleAll);
  $("zettel-knowledge-base-pick-close").addEventListener("click", () =>
    window.close(),
  );
  $("zettel-knowledge-base-pick-create").addEventListener(
    "click",
    () => void create(),
  );
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") window.close();
  });
}

async function load() {
  applyLocale();
  bindEvents();
  if (!args.itemKey) {
    $("zettel-knowledge-base-pick-empty").hidden = false;
    updateCreateButton();
    return;
  }
  await render();
}

async function render() {
  const rows = $("zettel-knowledge-base-pick-rows");
  rows.textContent = "";
  highlights = await api.getHighlights(args.itemKey, args.libraryID);
  $("zettel-knowledge-base-pick-empty").hidden = highlights.length > 0;

  for (const h of highlights) {
    rows.appendChild(row(h));
  }
  updateCreateButton();
}

function row(h) {
  const li = document.createElementNS(XHTML_NS, "li");
  li.className = "pick-row" + (h.cards ? " done" : "");

  const cb = document.createElementNS(XHTML_NS, "input");
  cb.type = "checkbox";
  cb.dataset.id = String(h.id);
  cb.checked = h.cards === 0;
  cb.disabled = h.cards > 0;
  cb.addEventListener("change", updateCreateButton);
  li.appendChild(cb);

  const main = document.createElementNS(XHTML_NS, "div");
  main.className = "pick-main";

  const text = document.createElementNS(XHTML_NS, "div");
  text.className = "pick-text";
  text.textContent = h.text.length > 200 ? h.text.slice(0, 200) + "…" : h.text;
  main.appendChild(text);

  const meta = document.createElementNS(XHTML_NS, "div");
  meta.className = "muted pick-meta";
  const bits = [];
  if (h.page) bits.push(`p.${h.page}`);
  bits.push(
    h.cards
      ? api.loc("picker-cards", { count: h.cards })
      : api.loc("picker-no-card"),
  );
  meta.textContent = bits.join(" · ");
  main.appendChild(meta);

  li.appendChild(main);

  if (h.color) {
    const dot = document.createElementNS(XHTML_NS, "span");
    dot.className = "pick-dot";
    dot.style.background = h.color;
    li.appendChild(dot);
  }
  return li;
}

function pendingBoxes() {
  return [
    ...$("zettel-knowledge-base-pick-rows").querySelectorAll(
      "input[type=checkbox]:not([disabled])",
    ),
  ];
}

function checkedBoxes() {
  return [
    ...$("zettel-knowledge-base-pick-rows").querySelectorAll(
      "input[type=checkbox]:checked",
    ),
  ];
}

function toggleAll() {
  const boxes = pendingBoxes();
  const allChecked = boxes.length > 0 && boxes.every((b) => b.checked);
  for (const box of boxes) box.checked = !allChecked;
  updateCreateButton();
}

function updateCreateButton() {
  const count = checkedBoxes().length;
  const button = $("zettel-knowledge-base-pick-create");
  button.disabled = busy || count === 0;
  button.textContent = count
    ? api.loc("picker-create-count", { count })
    : api.loc("picker-create");
  $("zettel-knowledge-base-pick-toggle").textContent = api.loc("picker-toggle");
}

async function create() {
  const ids = checkedBoxes().map((cb) => Number(cb.dataset.id));
  if (!ids.length || busy) return;
  busy = true;
  updateCreateButton();
  try {
    const result = await api.createCardsFromAnnotations(ids);
    const parts = [];
    if (result.created.length) {
      parts.push(api.loc("picker-created", { count: result.created.length }));
    }
    if (result.skipped.length) {
      parts.push(api.loc("picker-skipped", { count: result.skipped.length }));
    }
    if (result.failed.length) {
      parts.push(api.loc("picker-failed", { count: result.failed.length }));
    }
    await render();
    setStatus(parts.join("，") || api.loc("picker-nothing"));
  } catch (e) {
    showError(e && (e.stack || e.message) ? e.stack || e.message : String(e));
  } finally {
    busy = false;
    updateCreateButton();
  }
}

window.addEventListener("load", () => {
  load().catch((e) => showError((e && (e.stack || e.message)) || String(e)));
});
