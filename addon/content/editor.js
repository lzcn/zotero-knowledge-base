/* global Zotero */
"use strict";

const api = /** @type {import("../../src/modules/api").KnowledgeBaseAPI} */ (
  new Proxy({}, { get: (_, key) => window.Zotero.ZoteroKnowledgeBase.api[key] })
);

const args = /** @type {import("../../src/modules/api").EditorArgs} */ (
  window.arguments[0] || {}
);
const imageDraftId =
  args.imageDraftId || `editor-${Date.now()}-${Math.random()}`;
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
let visualEditing = false;
/** @type {import("../../src/ui/rich-editor").RichEditorController | null} */
let richEditor = null;
let parentId = !zettelId ? args.prefillParentId || null : null;
let parentSearchTimer = null;
let parentSearchVersion = 0;
let commandRange = null;
let commandIndex = 0;
let commandFromSlash = false;

/** @template {keyof import("../../typings/ui").EditorElements} K
 * @param {K} id @returns {import("../../typings/ui").EditorElements[K]} */
const $ = (id) =>
  /** @type {import("../../typings/ui").EditorElements[K]} */ (
    document.getElementById(id)
  );

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
  $("knowledge-base-command-open").title = api.loc("command-menu");
  $("knowledge-base-command-open").setAttribute(
    "aria-label",
    api.loc("command-menu"),
  );
  $("knowledge-base-command-search").placeholder = api.loc("command-search");
  setSource(null, false);
  if (parentId) setDirty();
  if (!zettelId && args.prefillTitle) {
    $("knowledge-base-editor-title").value = args.prefillTitle;
    setDirty();
  }
  if (!zettelId && args.prefillBody !== undefined) {
    $("knowledge-base-editor-body").value = args.prefillBody;
    setDirty();
  }

  if (zettelId) {
    const z = await api.getZettel(zettelId);
    if (z) {
      $("knowledge-base-editor-title").value = z.title;
      $("knowledge-base-editor-body").value = z.body;
      parentId = (await api.getFamily(zettelId)).parent?.id || null;
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
    $("knowledge-base-editor-title").focus();
  }
  updatePreview();
  await refreshRelations();
  unsubscribe = api.onDataChange(() => {
    if (!visualEditing) updatePreview();
    run(refreshRelations);
  });
}

function applyLocale() {
  $("knowledge-base-parent-label").textContent = api.loc("parent");
  $("knowledge-base-parent-search").placeholder = api.loc("parent-search");
  $("knowledge-base-parent-root").textContent = api.loc("root");
  $("knowledge-base-parent-root").title = api.loc("root");
  $("knowledge-base-parent-root").setAttribute("aria-label", api.loc("root"));
  document.title = zettelId
    ? api.loc("editor-title-edit")
    : api.loc("editor-title-new");
  $("knowledge-base-src-label").textContent = api.loc("editor-source-label");
  $("knowledge-base-src-pick").textContent = api.loc("editor-src-pick");
  $("knowledge-base-src-jump").textContent = api.loc("editor-src-jump");
  $("knowledge-base-src-anno").textContent = api.loc("editor-src-anno");
  $("knowledge-base-src-search").placeholder = api.loc(
    "editor-src-placeholder",
  );
  $("knowledge-base-editor-title").placeholder = api.loc(
    "editor-title-placeholder",
  );
  $("knowledge-base-anno-head").textContent = api.loc("editor-src-anno");
  $("knowledge-base-anno-empty").textContent = api.loc("editor-anno-empty");
  $("knowledge-base-anno-cancel").textContent = api.loc("editor-anno-cancel");
  $("knowledge-base-anno-insert").textContent = api.loc("editor-anno-insert");
  $("knowledge-base-editor-cancel").textContent = api.loc("editor-cancel");
  $("knowledge-base-editor-save").textContent = api.loc("editor-save");
  $("knowledge-base-src-selected").textContent = api.loc("editor-src-selected");
  $("knowledge-base-src-insert").textContent = api.loc("editor-src-insert");
  $("knowledge-base-link-pick").textContent = api.loc("editor-link-pick");
  $("knowledge-base-link-search").placeholder = api.loc(
    "editor-link-placeholder",
  );
  $("knowledge-base-preview-toggle").textContent = api.loc("editor-preview");
  $("knowledge-base-editor-body").placeholder = api.loc(
    "editor-body-placeholder",
  );
  $("knowledge-base-url-insert").textContent = api.loc("editor-url-insert");
  $("knowledge-base-image-insert").textContent = api.loc("editor-image");
  $("knowledge-base-editor-relations-summary").textContent =
    api.loc("editor-relations");
  $("knowledge-base-editor-graph").textContent = api.loc("graph-local-one");
  $("knowledge-base-editor-outgoing-label").textContent =
    api.loc("manager-outgoing");
  $("knowledge-base-editor-backlinks-label").textContent =
    api.loc("manager-backlinks");
}

function bindEvents() {
  $("knowledge-base-command-open").addEventListener("click", () => {
    if (!$("knowledge-base-command-menu").hidden) return closeCommands();
    const body = $("knowledge-base-editor-body");
    commandFromSlash = false;
    commandRange = { start: body.selectionStart, end: body.selectionEnd };
    openCommands("", true);
  });
  $("knowledge-base-command-search").addEventListener("input", () =>
    renderCommands(),
  );
  $("knowledge-base-command-menu").addEventListener("keydown", commandKeydown);
  document.addEventListener("click", (ev) => {
    const target = /** @type {Element} */ (ev.target);
    if (!target.closest(".parent-control")) {
      $("knowledge-base-parent-search").hidden = true;
      $("knowledge-base-parent-results").hidden = true;
      $("knowledge-base-parent-display").setAttribute("aria-expanded", "false");
    }
    if (
      !$("knowledge-base-command-menu").contains(target) &&
      !$("knowledge-base-command-open").contains(target) &&
      target !== $("knowledge-base-editor-body")
    )
      closeCommands();
  });
  for (const [id, iconName] of [
    ["knowledge-base-link-pick", "link"],
    ["knowledge-base-url-insert", "open-link"],
    ["knowledge-base-image-insert", "attachment"],
    ["knowledge-base-editor-graph", "related"],
  ]) {
    const button = document.getElementById(id);
    button.title = button.textContent;
    button.setAttribute("aria-label", button.title);
    const icon = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    icon.className = "kb-inline-icon";
    icon.dataset.kbIcon = iconName;
    icon.setAttribute("aria-hidden", "true");
    button.replaceChildren(icon);
    button.classList.add("icon-button");
  }
  $("knowledge-base-parent-root").addEventListener("click", () => {
    parentId = null;
    $("knowledge-base-parent-search").hidden = true;
    $("knowledge-base-parent-results").hidden = true;
    setDirty();
    run(refreshRelations);
  });
  $("knowledge-base-parent-display").addEventListener("click", () => {
    const search = $("knowledge-base-parent-search");
    search.hidden = !search.hidden;
    $("knowledge-base-parent-display").setAttribute(
      "aria-expanded",
      String(!search.hidden),
    );
    if (!search.hidden) {
      search.focus();
      search.dispatchEvent(new window.Event("input"));
    } else $("knowledge-base-parent-results").hidden = true;
  });
  $("knowledge-base-parent-search").addEventListener("input", () => {
    const version = ++parentSearchVersion;
    clearTimeout(parentSearchTimer);
    parentSearchTimer = setTimeout(
      () =>
        run(async () => {
          const results = await api.getParentCandidates(
            zettelId,
            $("knowledge-base-parent-search").value,
          );
          if (version !== parentSearchVersion) return;
          const list = $("knowledge-base-parent-results");
          list.replaceChildren();
          list.hidden = false;
          for (const card of results) {
            const row = document.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "li",
            );
            const button = document.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "button",
            );
            button.textContent = `${card.id} · ${card.title}`;
            button.addEventListener("click", () => {
              parentId = card.id;
              list.hidden = true;
              $("knowledge-base-parent-search").hidden = true;
              $("knowledge-base-parent-display").setAttribute(
                "aria-expanded",
                "false",
              );
              $("knowledge-base-parent-search").value = "";
              setDirty();
              run(refreshRelations);
            });
            row.appendChild(button);
            list.appendChild(row);
          }
        }),
      200,
    );
  });
  const preview = $("knowledge-base-editor-preview");
  const visualButton = document.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "toolbarbutton",
  );
  visualButton.id = "knowledge-base-visual-toggle";
  visualButton.classList.add("kb-native-tool");
  visualButton.setAttribute("tooltiptext", api.loc("editor-visual"));
  visualButton.setAttribute("aria-label", api.loc("editor-visual"));
  visualButton.setAttribute("aria-pressed", "false");
  $("knowledge-base-preview-toggle").after(visualButton);
  visualButton.addEventListener("click", () =>
    run(async () => {
      const frame = $("knowledge-base-rich-frame");
      if (!richEditor) {
        if (!frame.contentWindow.KnowledgeBaseRichEditor) {
          await new Promise((resolve) =>
            frame.addEventListener("load", resolve, { once: true }),
          );
        }
        if (window.closed) return;
        richEditor = frame.contentWindow.KnowledgeBaseRichEditor.create({
          html: api.renderMarkdown($("knowledge-base-editor-body").value),
          onChange(html) {
            $("knowledge-base-editor-body").value =
              api.richTextToMarkdown(html);
            setDirty();
          },
          async onImages(files) {
            const snippets = [];
            for (const file of files) {
              const bytes = Array.from(
                new Uint8Array(await file.arrayBuffer()),
              );
              const url = await api.importImage(bytes, file.type, imageDraftId);
              snippets.push(`![image](${url})`);
            }
            return api.renderMarkdown(snippets.join("\n\n"));
          },
          onError(message) {
            setStatus(message);
            $("knowledge-base-editor-status").classList.add("error");
          },
          onShortcut(key) {
            if (key === "s") run(() => save(false));
            if (key === "k") openCardPicker();
            if (key === "w") run(closeIfClean);
          },
        });
      }
      visualEditing = !visualEditing;
      visualButton.setAttribute("aria-pressed", String(visualEditing));
      frame.hidden = !visualEditing;
      preview.hidden = visualEditing;
      $("knowledge-base-editor-body").hidden = visualEditing;
      $("knowledge-base-editor-workspace").classList.toggle(
        "edit-only",
        visualEditing,
      );
      updatePreview();
      if (visualEditing) richEditor.focus();
    }),
  );
  $("knowledge-base-src-pick").addEventListener("click", toggleSourceDrop);
  $("knowledge-base-src-jump").addEventListener("click", () => {
    if (source) run(() => api.selectItem(source.key, source.libraryID));
  });
  $("knowledge-base-src-clear").addEventListener("click", () => {
    setSource(null);
    setDirty();
  });
  $("knowledge-base-src-anno").addEventListener("click", () =>
    run(openAnnoPicker),
  );
  $("knowledge-base-src-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    sourceSearchVersion++;
    searchTimer = setTimeout(searchSources, 250);
  });
  $("knowledge-base-editor-title").addEventListener("input", () => setDirty());
  $("knowledge-base-editor-body").addEventListener("input", () => {
    setDirty();
    const body = $("knowledge-base-editor-body");
    detectSlashCommand();
    const match = /\[\[([^\]\n]*)$/.exec(
      body.value.slice(0, body.selectionStart),
    );
    if (match) {
      linkRange = {
        start: body.selectionStart - match[0].length,
        end: body.selectionStart,
      };
      $("knowledge-base-link-drop").hidden = false;
      $("knowledge-base-link-search").value = match[1];
      run(searchCards);
    } else {
      $("knowledge-base-link-drop").hidden = true;
      cardSearchVersion++;
    }
  });
  $("knowledge-base-editor-body").addEventListener("keydown", editKeydown);
  $("knowledge-base-editor-body").addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    const body = $("knowledge-base-editor-body");
    run(() =>
      insertImages(files, {
        start: body.selectionStart,
        end: body.selectionEnd,
      }),
    );
  });
  $("knowledge-base-editor-body").addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  $("knowledge-base-editor-body").addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    const body = $("knowledge-base-editor-body");
    run(() =>
      insertImages(files, {
        start: body.selectionStart,
        end: body.selectionEnd,
      }),
    );
  });
  $("knowledge-base-editor-save").addEventListener("click", () => save(true));
  $("knowledge-base-editor-cancel").addEventListener("click", () =>
    closeIfClean(),
  );
  $("knowledge-base-anno-cancel").addEventListener("click", closeAnnoPicker);
  $("knowledge-base-anno-insert").addEventListener(
    "click",
    insertSelectedHighlights,
  );
  $("knowledge-base-src-selected").addEventListener("click", () =>
    run(useSelectedSource),
  );
  $("knowledge-base-src-insert").addEventListener("click", insertSourceLink);
  $("knowledge-base-link-pick").addEventListener("click", () =>
    openCardPicker(),
  );
  $("knowledge-base-url-insert").addEventListener("click", () => {
    const body = $("knowledge-base-editor-body");
    const text =
      body.value.slice(body.selectionStart, body.selectionEnd) ||
      api.loc("editor-format-text");
    const href = window.prompt(api.loc("editor-url-prompt"), "https://");
    if (href && /^(https?:\/\/|mailto:|zotero:\/\/)/i.test(href))
      insertText(`[${markdownLabel(text)}](<${href.replace(/[<>\n]/g, "")}>)`);
  });
  $("knowledge-base-image-insert").addEventListener("click", () => {
    const body = $("knowledge-base-editor-body");
    const range = { start: body.selectionStart, end: body.selectionEnd };
    run(async () => {
      const image = await api.pickImage(imageDraftId);
      if (image)
        insertText(`![${markdownLabel(image.name)}](${image.url})`, range);
    });
  });
  $("knowledge-base-editor-graph").addEventListener("click", () =>
    api.openGraph({ centerId: zettelId || undefined }),
  );
  $("knowledge-base-link-search").addEventListener("keydown", (ev) => {
    const first = $("knowledge-base-link-results").querySelector("li");
    if (first && (ev.key === "ArrowDown" || ev.key === "Enter")) {
      ev.preventDefault();
      if (ev.key === "Enter") first.click();
      else first.focus();
    }
  });
  $("knowledge-base-link-results").addEventListener("keydown", (ev) => {
    const row = document.activeElement;
    if (!row || !$("knowledge-base-link-results").contains(row)) return;
    const next =
      ev.key === "ArrowDown"
        ? row.nextElementSibling
        : ev.key === "ArrowUp"
          ? row.previousElementSibling
          : null;
    if (next instanceof window.HTMLElement) {
      ev.preventDefault();
      next.focus();
    }
  });
  $("knowledge-base-link-search").addEventListener("input", () => {
    clearTimeout(cardSearchTimer);
    cardSearchVersion++;
    cardSearchTimer = setTimeout(() => run(searchCards), 200);
  });
  for (const button of /** @type {HTMLButtonElement[]} */ (
    Array.from(document.querySelectorAll("[data-format]"))
  )) {
    button.addEventListener("click", () =>
      formatSelection(button.dataset.format),
    );
  }
  $("knowledge-base-preview-toggle").addEventListener("click", () => {
    if (visualEditing) return;
    const preview = $("knowledge-base-editor-preview");
    preview.hidden = !preview.hidden;
    $("knowledge-base-editor-workspace").classList.toggle(
      "edit-only",
      preview.hidden,
    );
    $("knowledge-base-preview-toggle").setAttribute(
      "aria-pressed",
      String(!preview.hidden),
    );
    if (!preview.hidden) updatePreview();
  });
  $("knowledge-base-editor-preview").addEventListener("click", (ev) => {
    if (visualEditing) return;
    const target = /** @type {Element} */ (ev.target);
    if (target.localName === "img") {
      api.openImage(target.getAttribute("src"));
      return;
    }
    const link = target.closest("a");
    if (!link) return;
    ev.preventDefault();
    run(() => api.openLink(link.getAttribute("href")));
  });
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      save(false);
    } else if (ev.key === "Escape") {
      if (!$("knowledge-base-command-menu").hidden) {
        closeCommands();
        $("knowledge-base-editor-body").focus();
      } else if (!$("knowledge-base-parent-search").hidden) {
        $("knowledge-base-parent-search").hidden = true;
        $("knowledge-base-parent-results").hidden = true;
        $("knowledge-base-parent-display").setAttribute(
          "aria-expanded",
          "false",
        );
      } else if (!$("knowledge-base-link-drop").hidden)
        $("knowledge-base-link-drop").hidden = true;
      else if (!$("knowledge-base-anno-layer").hidden) closeAnnoPicker();
      else if (!$("knowledge-base-src-drop").hidden) toggleSourceDrop();
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
  const drop = $("knowledge-base-src-drop");
  drop.hidden = !drop.hidden;
  if (!drop.hidden) {
    $("knowledge-base-src-search").value = "";
    $("knowledge-base-src-results").textContent = "";
    $("knowledge-base-src-search").focus();
    searchSources();
  } else {
    sourceSearchVersion++;
  }
}

async function searchSources() {
  const q = $("knowledge-base-src-search").value || "";
  const ul = $("knowledge-base-src-results");
  const version = ++sourceSearchVersion;
  ul.textContent = "";
  $("knowledge-base-src-status").textContent = api.loc("editor-searching");
  let results;
  try {
    results = await api.searchItems(q);
  } catch (error) {
    if (version === sourceSearchVersion) {
      $("knowledge-base-src-status").textContent =
        api.loc("editor-search-failed") + String(error.message || error);
    }
    return;
  }
  if (version !== sourceSearchVersion || $("knowledge-base-src-drop").hidden)
    return;
  $("knowledge-base-src-status").textContent = results.length
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
    $("knowledge-base-src-status").textContent = api.loc(
      "editor-src-no-selection",
    );
    return;
  }
  setSource(item, true);
  $("knowledge-base-src-drop").hidden = true;
}

function setSource(s, markDirty = false) {
  source = s;
  const display = $("knowledge-base-src-display");
  if (s) {
    display.textContent =
      s.title + (s.creatorYear ? ` (${s.creatorYear})` : "");
    display.classList.remove("placeholder");
  } else {
    display.textContent = api.loc("editor-src-none");
    display.classList.add("placeholder");
  }
  $("knowledge-base-src-jump").hidden = !s || !!s.missing;
  $("knowledge-base-src-anno").hidden = !s || !!s.missing;
  $("knowledge-base-src-insert").disabled = !s || !!s.missing;
  $("knowledge-base-src-clear").hidden = !s;
  $("knowledge-base-src-pick").textContent = api.loc(
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
      $("knowledge-base-editor-status").classList.add("error");
      Zotero.logError(error);
    });
}

function updatePreview() {
  api.updateImageDraft(imageDraftId, $("knowledge-base-editor-body").value);
  try {
    if (visualEditing && richEditor) {
      richEditor.setHTML(
        api.renderMarkdown($("knowledge-base-editor-body").value),
      );
    } else {
      window.ZoteroKnowledgeBaseMarkdown.render(
        $("knowledge-base-editor-preview"),
        $("knowledge-base-editor-body").value,
      );
    }
  } catch (error) {
    $("knowledge-base-editor-preview").textContent = String(
      error.message || error,
    );
  }
}

async function insertImages(files, range) {
  const snippets = [];
  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const url = await api.importImage(bytes, file.type, imageDraftId);
    snippets.push(
      `![${markdownLabel(file.name || api.loc("editor-image"))}](${url})`,
    );
  }
  insertText(snippets.join("\n\n"), range);
}

async function refreshRelations() {
  const version = ++relationsVersion;
  const [outgoing, backlinks, family, parent] = await Promise.all([
    api.getDraftLinks($("knowledge-base-editor-body").value),
    zettelId ? api.getBacklinks(zettelId) : [],
    zettelId ? api.getFamily(zettelId) : { parent: null, children: [] },
    parentId ? api.getZettel(parentId) : null,
  ]);
  if (version !== relationsVersion) return;
  $("knowledge-base-parent-root").hidden = !parentId;
  $("knowledge-base-parent-display").title = api.loc("parent-search");
  $("knowledge-base-parent-display").textContent = parent
    ? `${parent.id} · ${parent.title}`
    : api.loc("root");
  window.ZoteroKnowledgeBaseMarkdown.renderFamily(
    $("knowledge-base-editor-family"),
    { parent, children: family.children },
    api,
  );
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
      const button = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      button.className = "relation-link";
      window.ZoteroKnowledgeBaseMarkdown.identity(
        button,
        targetId || link.ref,
        inbound ? link.sourceTitle || "" : link.display,
      );
      row.appendChild(button);
      row.classList.toggle("unresolved", !targetId);
      const open = () =>
        targetId
          ? api.openManager({ selectId: targetId })
          : api.openEditor({ prefillTitle: link.ref });
      button.addEventListener("click", open);
      list.appendChild(row);
    }
  };
  $("knowledge-base-editor-outgoing-label").textContent =
    `${api.loc("manager-outgoing")} · ${outgoing.length}`;
  $("knowledge-base-editor-backlinks-label").textContent =
    `${api.loc("manager-backlinks")} · ${backlinks.length}`;
  renderList("knowledge-base-editor-outgoing", outgoing, false);
  renderList("knowledge-base-editor-backlinks", backlinks, true);
}

function insertText(text, range = null) {
  if (visualEditing && richEditor) {
    richEditor.insertHTML(api.renderMarkdown(text));
    richEditor.focus();
    return;
  }
  const body = $("knowledge-base-editor-body");
  const start = range ? range.start : body.selectionStart;
  const end = range ? range.end : body.selectionEnd;
  body.setRangeText(text, start, end, "end");
  setDirty();
  updatePreview();
  if (visualEditing) $("knowledge-base-editor-preview").focus();
  else body.focus();
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
  if (visualEditing && richEditor) {
    richEditor.format(kind);
    return;
  }
  const body = $("knowledge-base-editor-body");
  const edit = window.KnowledgeBaseEditing.formatEdit(
    body.value,
    body.selectionStart,
    body.selectionEnd,
    kind,
    api.loc("editor-format-text"),
  );
  if (!edit) return;
  insertText(edit.replacement, edit);
  if (edit.selection)
    body.setSelectionRange(edit.selection.start, edit.selection.end);
}

function editKeydown(ev) {
  if (commandKeydown(ev)) return;
  const body = $("knowledge-base-editor-body");
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
    const edit = window.KnowledgeBaseEditing.continueList(
      body.value,
      body.selectionStart,
    );
    if (!edit) return;
    ev.preventDefault();
    insertText(edit.replacement, edit);
  }
}

function openCardPicker() {
  const body = $("knowledge-base-editor-body");
  linkRange = { start: body.selectionStart, end: body.selectionEnd };
  $("knowledge-base-link-drop").hidden = false;
  $("knowledge-base-link-search").value = "";
  $("knowledge-base-link-search").focus();
  run(searchCards);
}

async function searchCards() {
  const version = ++cardSearchVersion;
  const ul = $("knowledge-base-link-results");
  ul.textContent = "";
  $("knowledge-base-link-status").textContent = api.loc("editor-searching");
  let cards;
  try {
    cards = await api.listZettels($("knowledge-base-link-search").value);
  } catch (error) {
    if (version === cardSearchVersion)
      $("knowledge-base-link-status").textContent =
        api.loc("editor-search-failed") + String(error.message || error);
    return;
  }
  if (version !== cardSearchVersion || $("knowledge-base-link-drop").hidden)
    return;
  cards = cards.filter((card) => card.id !== zettelId).slice(0, 30);
  $("knowledge-base-link-status").textContent = cards.length
    ? ""
    : api.loc("editor-link-empty");
  for (const card of cards) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    window.ZoteroKnowledgeBaseMarkdown.identity(
      li,
      card.id,
      card.title || api.loc("manager-untitled"),
    );
    li.tabIndex = 0;
    const insert = () => {
      insertText(`[[${card.id}]]`, linkRange);
      $("knowledge-base-link-drop").hidden = true;
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
  $("knowledge-base-anno-layer").hidden = false;
  const ul = $("knowledge-base-anno-list");
  ul.textContent = "";
  $("knowledge-base-anno-empty").hidden = true;
  $("knowledge-base-anno-insert").disabled = true;

  const highlights = await api.getHighlights(source.key, source.libraryID);
  for (const h of highlights) {
    const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    const cb = /** @type {HTMLInputElement} */ (
      document.createElementNS("http://www.w3.org/1999/xhtml", "input")
    );
    cb.type = "checkbox";
    cb.dataset.text = h.text;
    cb.dataset.page = h.page;
    cb.addEventListener("change", () => {
      $("knowledge-base-anno-insert").disabled = !ul.querySelector(
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
  if (!highlights.length) $("knowledge-base-anno-empty").hidden = false;
}

function closeAnnoPicker() {
  $("knowledge-base-anno-layer").hidden = true;
}

function insertSelectedHighlights() {
  const checked = [
    .../** @type {HTMLInputElement[]} */ (
      Array.from(
        $("knowledge-base-anno-list").querySelectorAll(
          "input[type=checkbox]:checked",
        ),
      )
    ),
  ];
  if (!checked.length) return;
  const body = $("knowledge-base-editor-body");
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
  api.updateImageDraft(imageDraftId, $("knowledge-base-editor-body").value);
  dirty = true;
  $("knowledge-base-editor-save").classList.add("dirty");
  clearTimeout(previewTimer);
  if (!visualEditing) previewTimer = setTimeout(updatePreview, 120);
  clearTimeout(relationsTimer);
  relationsTimer = setTimeout(() => run(refreshRelations), 180);
}

async function save(closeAfter) {
  const title = $("knowledge-base-editor-title").value.trim();
  const body = $("knowledge-base-editor-body").value;
  if (!title && !body.trim()) return;
  try {
    const id = await api.saveZettel({
      id: zettelId || undefined,
      title,
      body,
      parentId,
      itemKey: source ? source.key : null,
      libraryID: source ? source.libraryID : null,
    });
    zettelId = id;
    await refreshRelations();
    dirty = false;
    $("knowledge-base-editor-save").classList.remove("dirty");
    document.title = api.loc("editor-title-edit");
    setStatus(`# ${id} ✓ ${new Date().toLocaleTimeString()}`);
    if (typeof args.onSaved === "function") args.onSaved(id);
    if (closeAfter) window.close();
  } catch (e) {
    const msg =
      api.loc("editor-save-failed") + " " + (e && e.message ? e.message : e);
    const status = $("knowledge-base-editor-status");
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
  const status = $("knowledge-base-editor-status");
  status.textContent = text;
  status.classList.remove("error");
}

window.addEventListener("load", () => run(load));
window.addEventListener("unload", () => {
  try {
    richEditor?.destroy();
  } catch (error) {
    console.error(error);
  }
  parentSearchVersion++;
  clearTimeout(parentSearchTimer);
  try {
    api
      .releaseImageDraft(imageDraftId)
      .catch((error) => Zotero.logError(error));
  } catch (error) {
    console.error(error);
  }
  unsubscribe?.();
  clearTimeout(previewTimer);
  clearTimeout(relationsTimer);
  clearTimeout(searchTimer);
  clearTimeout(cardSearchTimer);
});

// Commands only activate at the start of a Markdown line, outside code fences.
function detectSlashCommand() {
  const body = $("knowledge-base-editor-body");
  const prefix = body.value.slice(0, body.selectionStart);
  let fence = null;
  for (const line of prefix.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!marker) continue;
    if (!fence) fence = marker[1];
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
      fence = null;
  }
  const match = /(?:^|\n)[ \t]*\/([^\s/]*)$/.exec(prefix);
  if (!fence && match && body.selectionStart === body.selectionEnd) {
    commandFromSlash = true;
    commandRange = { start: prefix.lastIndexOf("/"), end: body.selectionStart };
    openCommands(match[1], false);
  } else closeCommands();
}
function openCommands(query, focus) {
  $("knowledge-base-command-menu").hidden = false;
  const root = $("knowledge-base-editor-root").getBoundingClientRect();
  const toolbar = $("knowledge-base-markdown-toolbar").getBoundingClientRect();
  $("knowledge-base-command-menu").style.top =
    `${toolbar.bottom - root.top + 4}px`;
  $("knowledge-base-command-open").setAttribute("aria-expanded", "true");
  $("knowledge-base-command-search").value = query;
  renderCommands();
  if (focus) $("knowledge-base-command-search").focus();
}
function closeCommands() {
  $("knowledge-base-command-menu").hidden = true;
  $("knowledge-base-command-open").setAttribute("aria-expanded", "false");
}
function renderCommands() {
  const query = $("knowledge-base-command-search").value.trim().toLowerCase();
  const list = $("knowledge-base-command-list");
  list.replaceChildren();
  const commands = [
    {
      key: "editor-link-pick",
      icon: "link",
      aliases: "link card reference 引用 卡片",
      target: "knowledge-base-link-pick",
    },
    {
      key: "command-heading",
      glyph: "#",
      aliases: "heading 标题",
      text: "## ",
    },
    { key: "command-list", glyph: "•", aliases: "list 列表", text: "- " },
    {
      key: "command-task",
      glyph: "☑",
      aliases: "task todo 待办",
      text: "- [ ] ",
    },
    { key: "command-quote", glyph: "❞", aliases: "quote 引用块", text: "> " },
    {
      key: "command-code",
      glyph: "⌘",
      aliases: "code 代码",
      text: "```\n\n```",
      caret: 4,
    },
    {
      key: "command-table",
      glyph: "▦",
      aliases: "table 表格",
      text: "|  |  |\n| --- | --- |\n|  |  |",
      caret: 2,
    },
    {
      key: "editor-url-insert",
      icon: "open-link",
      aliases: "url web 网页",
      target: "knowledge-base-url-insert",
    },
    {
      key: "editor-image",
      icon: "attachment",
      aliases: "image 图片",
      target: "knowledge-base-image-insert",
    },
    {
      key: "editor-src-insert",
      icon: "note",
      aliases: "source 来源",
      target: "knowledge-base-src-insert",
      disabled: !source?.selectURL,
    },
    {
      key: "parent",
      icon: "related",
      aliases: "parent 父节点",
      target: "knowledge-base-parent-display",
    },
  ];
  commandIndex = 0;
  for (const command of commands) {
    const label = api.loc(command.key);
    if (!(label + " " + command.aliases).toLowerCase().includes(query))
      continue;
    const button = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    button.className = "command-option";
    button.setAttribute("role", "menuitem");
    /** @type {HTMLButtonElement} */ (button).disabled = Boolean(
      command.disabled,
    );
    const icon = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    if (command.icon) {
      icon.className = "kb-inline-icon";
      icon.dataset.kbIcon = command.icon;
    } else icon.textContent = command.glyph;
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    name.textContent = label;
    button.append(icon, name);
    button.addEventListener("click", () => {
      closeCommands();
      const range = commandRange;
      commandRange = null;
      if (command.text !== undefined) {
        const body = $("knowledge-base-editor-body");
        const selected =
          !commandFromSlash && range
            ? body.value.slice(range.start, range.end)
            : "";
        const replacement =
          command.caret !== undefined
            ? command.text.slice(0, command.caret) +
              selected +
              command.text.slice(command.caret)
            : command.text + selected;
        insertText(replacement, range);
        if (command.caret !== undefined && range)
          $("knowledge-base-editor-body").setSelectionRange(
            range.start + command.caret + selected.length,
            range.start + command.caret + selected.length,
          );
      } else {
        if (range && commandFromSlash) insertText("", range);
        else if (range)
          $("knowledge-base-editor-body").setSelectionRange(
            range.start,
            range.end,
          );
        document.getElementById(command.target).click();
      }
    });
    list.appendChild(button);
  }
  const first = list.querySelector("button:not([disabled])");
  first?.classList.add("active");
  if (!list.children.length) {
    const empty = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
    empty.className = "muted";
    empty.textContent = api.loc("command-empty");
    list.appendChild(empty);
  }
}
function commandKeydown(ev) {
  if (
    $("knowledge-base-command-menu").hidden ||
    !["ArrowDown", "ArrowUp", "Enter"].includes(ev.key)
  )
    return false;
  const buttons = /** @type {HTMLButtonElement[]} */ (
    Array.from(
      $("knowledge-base-command-list").querySelectorAll(
        "button:not([disabled])",
      ),
    )
  );
  if (!buttons.length) return false;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === "Enter") buttons[commandIndex]?.click();
  else {
    commandIndex =
      (commandIndex + (ev.key === "ArrowDown" ? 1 : -1) + buttons.length) %
      buttons.length;
    buttons.forEach((button, index) =>
      button.classList.toggle("active", index === commandIndex),
    );
    buttons[commandIndex].scrollIntoView?.({ block: "nearest" });
  }
  return true;
}
