/* global Zotero */
"use strict";

const api = new Proxy(
  {},
  { get: (_, key) => window.Zotero.ZettelKnowledgeBase.api[key] },
);

const args = (window.arguments && window.arguments[0]) || {};
let zettelId = args.zettelId || null;
let dirty = false;
let source = null; // {key, libraryID, title, creatorYear, selectURL}
let searchTimer = null;
let sourceSearchVersion = 0;
let cardSearchVersion = 0;
let cardSearchTimer = null;
let linkRange = null;
let previewTimer = null;
let relationsTimer = null;
let relationsVersion = 0;
let unsubscribe = null;

const $ = (id) => document.getElementById(id);

window.addEventListener("error", (ev) => {
  try {
    Zotero.logError(ev.error || ev.message);
  } catch (e) {
    console.error(e);
  }
});

async function load() {
  applyLocale();
  bindEvents();
  setSource(null, false);
  if (!zettelId && args.prefillTitle) {
    $("zettel-knowledge-base-editor-title").value = args.prefillTitle;
    setDirty();
  }

  if (zettelId) {
    const z = await api.getZettel(zettelId);
    if (z) {
      $("zettel-knowledge-base-editor-title").value = z.title;
      $("zettel-knowledge-base-editor-body").value = z.body;
      setStatus(`# ${z.id}`);
      if (z.item_key) {
        const s = await api.getItemSummary(z.item_key, z.library_id);
        setSource(
          s || {
            key: z.item_key,
            libraryID: z.library_id,
            title: api.loc("manager-source-missing"),
            missing: true,
          },
          false,
        );
      }
    } else {
      zettelId = null;
    }
  }
  if (!source && args.sourceItem) {
    const s = await api.getItemSummary(
      args.sourceItem.key,
      args.sourceItem.libraryID,
    );
    if (s) setSource(s, false);
  }
  if (!zettelId && !source) {
    $("zettel-knowledge-base-editor-title").focus();
  }
  updatePreview();
  await refreshRelations();
  unsubscribe = api.onDataChange(() => run(refreshRelations));
}

function applyLocale() {
  document.title = zettelId
    ? api.loc("editor-title-edit")
    : api.loc("editor-title-new");
  $("zettel-knowledge-base-src-label").textContent = api.loc(
    "editor-source-label",
  );
  $("zettel-knowledge-base-src-pick").textContent = api.loc("editor-src-pick");
  $("zettel-knowledge-base-src-jump").textContent = api.loc("editor-src-jump");
  $("zettel-knowledge-base-src-anno").textContent = api.loc("editor-src-anno");
  $("zettel-knowledge-base-src-search").placeholder = api.loc(
    "editor-src-placeholder",
  );
  $("zettel-knowledge-base-editor-title").placeholder = api.loc(
    "editor-title-placeholder",
  );
  $("zettel-knowledge-base-anno-head").textContent = api.loc("editor-src-anno");
  $("zettel-knowledge-base-anno-empty").textContent =
    api.loc("editor-anno-empty");
  $("zettel-knowledge-base-anno-cancel").textContent =
    api.loc("editor-anno-cancel");
  $("zettel-knowledge-base-anno-insert").textContent =
    api.loc("editor-anno-insert");
  $("zettel-knowledge-base-editor-cancel").textContent =
    api.loc("editor-cancel");
  $("zettel-knowledge-base-editor-save").textContent = api.loc("editor-save");
  $("zettel-knowledge-base-src-selected").textContent = api.loc(
    "editor-src-selected",
  );
  $("zettel-knowledge-base-src-insert").textContent =
    api.loc("editor-src-insert");
  $("zettel-knowledge-base-link-pick").textContent =
    api.loc("editor-link-pick");
  $("zettel-knowledge-base-link-search").placeholder = api.loc(
    "editor-link-placeholder",
  );
  $("zettel-knowledge-base-preview-toggle").textContent =
    api.loc("editor-preview");
  $("zettel-knowledge-base-editor-body").placeholder = api.loc(
    "editor-body-placeholder",
  );
  $("zettel-knowledge-base-url-insert").textContent =
    api.loc("editor-url-insert");
  $("zettel-knowledge-base-image-insert").textContent = api.loc("editor-image");
  $("zettel-knowledge-base-editor-graph").textContent =
    api.loc("graph-local-one");
  $("zettel-knowledge-base-editor-outgoing-label").textContent =
    api.loc("manager-outgoing");
  $("zettel-knowledge-base-editor-backlinks-label").textContent =
    api.loc("manager-backlinks");
}

function bindEvents() {
  $("zettel-knowledge-base-src-pick").addEventListener(
    "click",
    toggleSourceDrop,
  );
  $("zettel-knowledge-base-src-jump").addEventListener("click", () => {
    if (source) run(() => api.selectItem(source.key, source.libraryID));
  });
  $("zettel-knowledge-base-src-clear").addEventListener("click", () => {
    setSource(null);
    setDirty();
  });
  $("zettel-knowledge-base-src-anno").addEventListener("click", () =>
    run(openAnnoPicker),
  );
  $("zettel-knowledge-base-src-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    sourceSearchVersion++;
    searchTimer = setTimeout(searchSources, 250);
  });
  $("zettel-knowledge-base-editor-title").addEventListener("input", () =>
    setDirty(),
  );
  $("zettel-knowledge-base-editor-body").addEventListener("input", () => {
    setDirty();
    const body = $("zettel-knowledge-base-editor-body");
    const match = /\[\[([^\]\n]*)$/.exec(
      body.value.slice(0, body.selectionStart),
    );
    if (match) {
      linkRange = {
        start: body.selectionStart - match[0].length,
        end: body.selectionStart,
      };
      $("zettel-knowledge-base-link-drop").hidden = false;
      $("zettel-knowledge-base-link-search").value = match[1];
      run(searchCards);
    } else {
      $("zettel-knowledge-base-link-drop").hidden = true;
      cardSearchVersion++;
    }
  });
  $("zettel-knowledge-base-editor-body").addEventListener(
    "keydown",
    editKeydown,
  );
  $("zettel-knowledge-base-editor-body").addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    const body = $("zettel-knowledge-base-editor-body");
    run(() =>
      insertImages(files, {
        start: body.selectionStart,
        end: body.selectionEnd,
      }),
    );
  });
  $("zettel-knowledge-base-editor-body").addEventListener(
    "dragover",
    (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    },
  );
  $("zettel-knowledge-base-editor-body").addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    const body = $("zettel-knowledge-base-editor-body");
    run(() =>
      insertImages(files, {
        start: body.selectionStart,
        end: body.selectionEnd,
      }),
    );
  });
  $("zettel-knowledge-base-editor-save").addEventListener("click", () =>
    save(true),
  );
  $("zettel-knowledge-base-editor-cancel").addEventListener("click", () =>
    closeIfClean(),
  );
  $("zettel-knowledge-base-anno-cancel").addEventListener(
    "click",
    closeAnnoPicker,
  );
  $("zettel-knowledge-base-anno-insert").addEventListener(
    "click",
    insertSelectedHighlights,
  );
  $("zettel-knowledge-base-src-selected").addEventListener("click", () =>
    run(useSelectedSource),
  );
  $("zettel-knowledge-base-src-insert").addEventListener(
    "click",
    insertSourceLink,
  );
  $("zettel-knowledge-base-link-pick").addEventListener("click", () =>
    openCardPicker(),
  );
  $("zettel-knowledge-base-url-insert").addEventListener("click", () => {
    const body = $("zettel-knowledge-base-editor-body");
    const text =
      body.value.slice(body.selectionStart, body.selectionEnd) ||
      api.loc("editor-format-text");
    const href = window.prompt(api.loc("editor-url-prompt"), "https://");
    if (href && /^(https?:\/\/|mailto:|zotero:\/\/)/i.test(href))
      insertText(`[${markdownLabel(text)}](<${href.replace(/[<>\n]/g, "")}>)`);
  });
  $("zettel-knowledge-base-image-insert").addEventListener("click", () => {
    const body = $("zettel-knowledge-base-editor-body");
    const range = { start: body.selectionStart, end: body.selectionEnd };
    run(async () => {
      const image = await api.pickImage();
      if (image)
        insertText(`![${markdownLabel(image.name)}](${image.url})`, range);
    });
  });
  $("zettel-knowledge-base-editor-graph").addEventListener("click", () =>
    api.openGraph({ centerId: zettelId || undefined }),
  );
  $("zettel-knowledge-base-link-search").addEventListener("input", () => {
    clearTimeout(cardSearchTimer);
    cardSearchVersion++;
    cardSearchTimer = setTimeout(() => run(searchCards), 200);
  });
  for (const button of document.querySelectorAll("[data-format]")) {
    button.addEventListener("click", () =>
      formatSelection(button.dataset.format),
    );
  }
  $("zettel-knowledge-base-preview-toggle").addEventListener("click", () => {
    const preview = $("zettel-knowledge-base-editor-preview");
    preview.hidden = !preview.hidden;
    $("zettel-knowledge-base-editor-workspace").classList.toggle(
      "edit-only",
      preview.hidden,
    );
    $("zettel-knowledge-base-preview-toggle").setAttribute(
      "aria-pressed",
      String(!preview.hidden),
    );
    if (!preview.hidden) updatePreview();
  });
  $("zettel-knowledge-base-editor-preview").addEventListener("click", (ev) => {
    if (ev.target.localName === "img") {
      api.openImage(ev.target.getAttribute("src"));
      return;
    }
    const link = ev.target.closest?.("a");
    if (!link) return;
    ev.preventDefault();
    run(() => api.openLink(link.getAttribute("href")));
  });
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      save(false);
    } else if (ev.key === "Escape") {
      if (!$("zettel-knowledge-base-link-drop").hidden)
        $("zettel-knowledge-base-link-drop").hidden = true;
      else if (!$("zettel-knowledge-base-anno-layer").hidden) closeAnnoPicker();
      else if (!$("zettel-knowledge-base-src-drop").hidden) toggleSourceDrop();
      else closeIfClean();
    }
  });
  window.addEventListener("beforeunload", (ev) => {
    if (dirty) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });
}

/* ---------------- source item picker ---------------- */

function toggleSourceDrop() {
  const drop = $("zettel-knowledge-base-src-drop");
  drop.hidden = !drop.hidden;
  if (!drop.hidden) {
    $("zettel-knowledge-base-src-search").value = "";
    $("zettel-knowledge-base-src-results").textContent = "";
    $("zettel-knowledge-base-src-search").focus();
    searchSources();
  } else {
    sourceSearchVersion++;
  }
}

async function searchSources() {
  const q = $("zettel-knowledge-base-src-search").value || "";
  const ul = $("zettel-knowledge-base-src-results");
  const version = ++sourceSearchVersion;
  ul.textContent = "";
  $("zettel-knowledge-base-src-status").textContent =
    api.loc("editor-searching");
  let results;
  try {
    results = await api.searchItems(q);
  } catch (error) {
    if (version === sourceSearchVersion) {
      $("zettel-knowledge-base-src-status").textContent =
        api.loc("editor-search-failed") + String(error.message || error);
    }
    return;
  }
  if (
    version !== sourceSearchVersion ||
    $("zettel-knowledge-base-src-drop").hidden
  )
    return;
  $("zettel-knowledge-base-src-status").textContent = results.length
    ? ""
    : api.loc("editor-search-empty");
  for (const it of results) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    const title = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    title.className = "sr-title";
    title.textContent = it.title || it.key;
    li.appendChild(title);
    if (it.creatorYear) {
      const meta = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      meta.className = "muted";
      meta.textContent = ` ${it.creatorYear} · ${it.libraryName || ""}`;
      li.appendChild(meta);
    }
    li.addEventListener("click", () => {
      setSource(it);
      setDirty();
      toggleSourceDrop();
    });
    ul.appendChild(li);
  }
}

async function useSelectedSource() {
  const item = await api.getSelectedSource();
  if (!item) {
    $("zettel-knowledge-base-src-status").textContent = api.loc(
      "editor-src-no-selection",
    );
    return;
  }
  setSource(item, true);
  $("zettel-knowledge-base-src-drop").hidden = true;
}

function setSource(s, markDirty = false) {
  source = s;
  const display = $("zettel-knowledge-base-src-display");
  if (s) {
    display.textContent =
      s.title + (s.creatorYear ? ` (${s.creatorYear})` : "");
    display.classList.remove("placeholder");
  } else {
    display.textContent = api.loc("editor-src-none");
    display.classList.add("placeholder");
  }
  $("zettel-knowledge-base-src-jump").hidden = !s || !!s.missing;
  $("zettel-knowledge-base-src-anno").hidden = !s || !!s.missing;
  $("zettel-knowledge-base-src-insert").disabled = !s || !!s.missing;
  $("zettel-knowledge-base-src-clear").hidden = !s;
  $("zettel-knowledge-base-src-pick").textContent = api.loc(
    s ? "editor-src-change" : "editor-src-pick",
  );
  if (markDirty) setDirty();
}

/* ---------------- Markdown editing and card links ---------------- */

function run(fn) {
  Promise.resolve()
    .then(fn)
    .catch((error) => {
      setStatus(
        api.loc("editor-action-failed") + String(error.message || error),
      );
      $("zettel-knowledge-base-editor-status").classList.add("error");
      Zotero.logError(error);
    });
}

function updatePreview() {
  try {
    window.ZettelKnowledgeBaseMarkdown.render(
      $("zettel-knowledge-base-editor-preview"),
      $("zettel-knowledge-base-editor-body").value,
    );
  } catch (error) {
    $("zettel-knowledge-base-editor-preview").textContent = String(
      error.message || error,
    );
  }
}

async function insertImages(files, range) {
  const snippets = [];
  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const url = await api.importImage(bytes, file.type);
    snippets.push(
      `![${markdownLabel(file.name || api.loc("editor-image"))}](${url})`,
    );
  }
  insertText(snippets.join("\n\n"), range);
}

async function refreshRelations() {
  const version = ++relationsVersion;
  const [outgoing, backlinks] = await Promise.all([
    api.getDraftLinks($("zettel-knowledge-base-editor-body").value),
    zettelId ? api.getBacklinks(zettelId) : [],
  ]);
  if (version !== relationsVersion) return;
  const renderList = (id, links, inbound) => {
    const list = $(id);
    list.textContent = "";
    if (!links.length) {
      const empty = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "li",
      );
      empty.textContent = api.loc("editor-relations-empty");
      empty.className = "muted";
      list.appendChild(empty);
    }
    for (const link of links) {
      const targetId = inbound ? link.sourceId : link.targetId;
      const row = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "li",
      );
      row.tabIndex = 0;
      row.textContent =
        (inbound ? "← " : "→ ") +
        (inbound ? link.sourceTitle || link.sourceId : link.display);
      row.classList.toggle("unresolved", !targetId);
      const open = () =>
        targetId
          ? api.openManager({ selectId: targetId })
          : api.openEditor({ prefillTitle: link.ref });
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter") open();
      });
      list.appendChild(row);
    }
  };
  renderList("zettel-knowledge-base-editor-outgoing", outgoing, false);
  renderList("zettel-knowledge-base-editor-backlinks", backlinks, true);
}

function insertText(text, range = null) {
  const body = $("zettel-knowledge-base-editor-body");
  const start = range ? range.start : body.selectionStart;
  const end = range ? range.end : body.selectionEnd;
  body.setRangeText(text, start, end, "end");
  body.focus();
  setDirty();
  updatePreview();
}

function markdownLabel(text) {
  return text.replace(/([\\[\]`*_])/g, "\\$1").replace(/\n/g, " ");
}

function insertSourceLink() {
  if (!source?.selectURL) return;
  insertText(
    `[${markdownLabel(source.title || source.key)}](${source.selectURL})`,
  );
}

function formatSelection(kind) {
  const body = $("zettel-knowledge-base-editor-body");
  const start = body.selectionStart;
  const end = body.selectionEnd;
  const text = body.value.slice(start, end);
  const sample = text || api.loc("editor-format-text");
  if (kind === "table") {
    insertText(
      `\n\n| ${sample} | ${api.loc("editor-format-text")} |\n| --- | --- |\n|  |  |\n`,
    );
    return;
  }
  const wrapped = {
    bold: [`**${sample}**`, 2],
    italic: [`*${sample}*`, 1],
    code: text.includes("\n")
      ? [`\n\`\`\`\n${sample}\n\`\`\`\n`, 5]
      : [`\`${sample}\``, 1],
  };
  if (wrapped[kind]) {
    const [replacement, offset] = wrapped[kind];
    insertText(replacement);
    body.setSelectionRange(start + offset, start + offset + sample.length);
    return;
  }
  const prefix = { heading: "## ", quote: "> ", list: "- ", task: "- [ ] " }[
    kind
  ];
  if (!prefix) return;
  const lineStart = body.value.lastIndexOf("\n", start - 1) + 1;
  const nextLine = body.value.indexOf("\n", end);
  const lineEnd = nextLine === -1 ? body.value.length : nextLine;
  const lines = body.value.slice(lineStart, lineEnd) || sample;
  insertText(
    lines
      .split("\n")
      .map((line) => prefix + line)
      .join("\n"),
    { start: lineStart, end: lineEnd },
  );
}

function editKeydown(ev) {
  const body = $("zettel-knowledge-base-editor-body");
  if (
    (ev.ctrlKey || ev.metaKey) &&
    ["b", "i", "k"].includes(ev.key.toLowerCase())
  ) {
    ev.preventDefault();
    ev.stopPropagation();
    const kind = { b: "bold", i: "italic" }[ev.key.toLowerCase()];
    if (kind) formatSelection(kind);
    else openCardPicker();
  } else if (ev.key === "Tab") {
    ev.preventDefault();
    insertText("  ");
  } else if (
    ev.key === "Enter" &&
    body.selectionStart === body.selectionEnd &&
    !ev.shiftKey
  ) {
    const before = body.value.slice(0, body.selectionStart);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const match = /^(\s*)([-*+] |\d+\. )(\[[ xX]\] )?(.*)$/.exec(line);
    if (!match) return;
    ev.preventDefault();
    if (!match[4].trim()) {
      insertText("\n", {
        start: before.length - line.length,
        end: before.length,
      });
      return;
    }
    const marker = /^\d/.test(match[2])
      ? `${parseInt(match[2], 10) + 1}. `
      : match[2];
    insertText(`\n${match[1]}${marker}${match[3] ? "[ ] " : ""}`);
  }
}

function openCardPicker() {
  const body = $("zettel-knowledge-base-editor-body");
  linkRange = { start: body.selectionStart, end: body.selectionEnd };
  $("zettel-knowledge-base-link-drop").hidden = false;
  $("zettel-knowledge-base-link-search").value = "";
  $("zettel-knowledge-base-link-search").focus();
  run(searchCards);
}

async function searchCards() {
  const version = ++cardSearchVersion;
  const ul = $("zettel-knowledge-base-link-results");
  ul.textContent = "";
  $("zettel-knowledge-base-link-status").textContent =
    api.loc("editor-searching");
  let cards;
  try {
    cards = await api.listZettels($("zettel-knowledge-base-link-search").value);
  } catch (error) {
    if (version === cardSearchVersion)
      $("zettel-knowledge-base-link-status").textContent =
        api.loc("editor-search-failed") + String(error.message || error);
    return;
  }
  if (
    version !== cardSearchVersion ||
    $("zettel-knowledge-base-link-drop").hidden
  )
    return;
  cards = cards.filter((card) => card.id !== zettelId).slice(0, 30);
  $("zettel-knowledge-base-link-status").textContent = cards.length
    ? ""
    : api.loc("editor-link-empty");
  for (const card of cards) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    li.textContent = `${card.title || api.loc("manager-untitled")} · ${card.id}`;
    li.tabIndex = 0;
    const insert = () => {
      insertText(
        `[${markdownLabel(card.title || card.id)}](zkb://zettel/${encodeURIComponent(card.id)})`,
        linkRange,
      );
      $("zettel-knowledge-base-link-drop").hidden = true;
      cardSearchVersion++;
    };
    li.addEventListener("click", insert);
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") insert();
    });
    ul.appendChild(li);
  }
}

/* ---------------- highlight insertion ---------------- */

async function openAnnoPicker() {
  if (!source) return;
  $("zettel-knowledge-base-anno-layer").hidden = false;
  const ul = $("zettel-knowledge-base-anno-list");
  ul.textContent = "";
  $("zettel-knowledge-base-anno-empty").hidden = true;
  $("zettel-knowledge-base-anno-insert").disabled = true;

  const highlights = await api.getHighlights(source.key, source.libraryID);
  for (const h of highlights) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    const cb = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "input",
    );
    cb.type = "checkbox";
    cb.dataset.text = h.text;
    cb.dataset.page = h.page;
    cb.addEventListener("change", () => {
      $("zettel-knowledge-base-anno-insert").disabled = !ul.querySelector(
        "input[type=checkbox]:checked",
      );
    });
    li.appendChild(cb);
    const text = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    text.className = "anno-text";
    text.textContent =
      h.text.length > 220 ? h.text.slice(0, 220) + "…" : h.text;
    li.appendChild(text);
    if (h.page) {
      const page = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      page.className = "muted";
      page.textContent = ` p.${h.page}`;
      li.appendChild(page);
    }
    ul.appendChild(li);
  }
  if (!highlights.length) $("zettel-knowledge-base-anno-empty").hidden = false;
}

function closeAnnoPicker() {
  $("zettel-knowledge-base-anno-layer").hidden = true;
}

function insertSelectedHighlights() {
  const checked = [
    ...$("zettel-knowledge-base-anno-list").querySelectorAll(
      "input[type=checkbox]:checked",
    ),
  ];
  if (!checked.length) return;
  const body = $("zettel-knowledge-base-editor-body");
  const blocks = checked.map((cb) => {
    const page = cb.dataset.page
      ? api.loc("citation-page-note", { page: cb.dataset.page })
      : "";
    const citation = source?.selectURL
      ? `\n\n[${markdownLabel(source.creatorYear || source.title)}](${source.selectURL})`
      : "";
    return `> ${cb.dataset.text.replace(/\n+/g, " ")}${page}${citation}`;
  });
  const insert =
    (body.value && !body.value.endsWith("\n") ? "\n\n" : "") +
    blocks.join("\n\n") +
    "\n";
  const at = body.value.length;
  body.value += insert;
  body.selectionStart = body.selectionEnd = at + insert.length;
  body.focus();
  setDirty();
  closeAnnoPicker();
}

/* ---------------- save ---------------- */

function setDirty() {
  dirty = true;
  $("zettel-knowledge-base-editor-save").classList.add("dirty");
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 120);
  clearTimeout(relationsTimer);
  relationsTimer = setTimeout(() => run(refreshRelations), 180);
}

async function save(closeAfter) {
  const title = $("zettel-knowledge-base-editor-title").value.trim();
  const body = $("zettel-knowledge-base-editor-body").value;
  if (!title && !body.trim()) return;
  try {
    const id = await api.saveZettel({
      id: zettelId || undefined,
      title,
      body,
      itemKey: source ? source.key : null,
      libraryID: source ? source.libraryID : null,
    });
    zettelId = id;
    await refreshRelations();
    dirty = false;
    $("zettel-knowledge-base-editor-save").classList.remove("dirty");
    document.title = api.loc("editor-title-edit");
    setStatus(`# ${id} ✓ ${new Date().toLocaleTimeString()}`);
    if (typeof args.onSaved === "function") args.onSaved(id);
    if (closeAfter) window.close();
  } catch (e) {
    const msg =
      api.loc("editor-save-failed") + " " + (e && e.message ? e.message : e);
    const status = $("zettel-knowledge-base-editor-status");
    status.textContent = msg;
    status.classList.add("error");
    try {
      Zotero.logError(e);
    } catch (ignored) {
      console.error(ignored);
    }
  }
}

async function closeIfClean() {
  if (dirty) {
    const ok = window.confirm(api.loc("editor-confirm-discard"));
    if (!ok) return;
  }
  window.close();
}

function setStatus(text) {
  const status = $("zettel-knowledge-base-editor-status");
  status.textContent = text;
  status.classList.remove("error");
}

window.addEventListener("load", () => run(load));
window.addEventListener("unload", () => {
  unsubscribe?.();
  clearTimeout(previewTimer);
  clearTimeout(relationsTimer);
  clearTimeout(searchTimer);
  clearTimeout(cardSearchTimer);
});
