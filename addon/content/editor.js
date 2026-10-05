/* global Zotero, URLSearchParams */
"use strict";

const api = /** @type {import("../../src/modules/api").KnowledgeBaseAPI} */ (
  new Proxy({}, { get: (_, key) => window.Zotero.ZoteroKnowledgeBase.api[key] })
);

const args = /** @type {import("../../src/modules/api").EditorArgs} */ (
  window.arguments?.[0] ||
    api.getViewArguments(
      new URLSearchParams(window.location.search).get("context"),
    )
);
const imageDraftId =
  args.imageDraftId || `editor-${Date.now()}-${Math.random()}`;
let zettelId = args.zettelId || null;
/** @type {import("../../src/modules/db").NoteKind} */
let noteKind = args.kind || "zettel";
let customKey = null;
let dirty = false;
let loaded = false;
let closing = false;
let allowClose = false;
let disposed = false;
let revision = 0;
let expectedUpdatedAt = null;
let autosaveTimer = null;
let draftTimer = null;
let draftWrite = Promise.resolve();
let saving = null;
const draftId = args.draftId || imageDraftId;
window.knowledgeBaseDraftId = draftId;
window.knowledgeBaseFlushDraft = persistDraft;
window.knowledgeBaseStopEditor = () => {
  richEditor?.destroy();
  $("knowledge-base-editor-body").destroy();
};
window.knowledgeBaseCardId = zettelId;
let richBody = null;
let hasSourceSelection = false;
let sourceSelection = { start: 0, end: 0, scroll: 0 };
let source = null; // {key, libraryID, title, creatorYear, selectURL}
let sourcePickMode = "source";
let referenceRange = null;
let searchTimer = null;
let sourceSearchVersion = 0;
let cardSearchVersion = 0;
let cardSearchTimer = null;
let linkRange = null;
let previewTimer = null;
let relationsTimer = null;
let relationsVersion = 0;
let unsubscribe = null;
let unsubscribeSourceStyle = null;
let sourceRenderVersion = 0;
/** @type {"visual" | "source"} */
let editorMode = "source";
let modeVersion = 0;
/** @type {Promise<void> | null} */
let richEditorInitialization = null;
/** @type {import("../../src/ui/native-editor").NativeEditorController | null} */
let richEditor = null;
let recoveryPending = false;
let noteUnavailable = false;
let libraryReadOnly = false;
let healthVersion = 0;
let recoveryHTML = null;
let recoverySourceDocument = undefined;
let nativeNoteID = null;
let expectedNoteHTML = null;
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
  await window.KnowledgeBaseMarkdownSource.create(
    /** @type {HTMLTextAreaElement} */ (
      document.getElementById("knowledge-base-editor-body")
    ),
    {
      citation: api.loc("markdown-node-citation"),
      annotation: api.loc("markdown-node-annotation"),
      notelink: api.loc("markdown-node-note-link"),
      image: api.loc("markdown-node-image"),
    },
  );
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
      noteKind = z.kind || "zettel";
      customKey = z.custom_key || null;
      expectedUpdatedAt = z.updated_at;
      $("knowledge-base-editor-title").value = z.title;
      $("knowledge-base-editor-body").value = z.body;
      parentId = (await api.getFamily(zettelId)).parent?.id || null;

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
  if (args.draftId) {
    const draft = await api.getEditorDraft(args.draftId);
    if (!draft) throw new Error(api.loc("editor-draft-missing"));
    noteKind = draft.kind || "zettel";
    customKey = draft.customKey || null;
    zettelId = draft.id || null;
    expectedUpdatedAt = draft.expectedUpdatedAt ?? null;
    revision = draft.draftRevision;
    nativeNoteID = draft.noteID || null;
    expectedNoteHTML = draft.expectedNoteHTML || null;
    recoverySourceDocument = draft.sourceDocument;
    parentId = draft.parentId || null;
    $("knowledge-base-editor-title").value = draft.title;
    $("knowledge-base-editor-body").value = draft.body;
    const summary = draft.itemKey
      ? await api.getItemSummary(draft.itemKey, draft.libraryID)
      : null;
    setSource(
      summary ||
        (draft.itemKey
          ? {
              key: draft.itemKey,
              libraryID: draft.libraryID,
              title: api.loc("manager-source-missing"),
              missing: true,
            }
          : null),
      false,
    );
    recoveryPending = true;
    recoveryHTML = draft.sourceMode ? null : draft.nativeHTML || null;
    dirty = true;
    setStatus(api.loc("editor-draft-restored"));
  }
  window.knowledgeBaseCardId = zettelId;
  updateNoteIdentity();
  loaded = true;
  if (dirty && !args.draftId) scheduleSave();
  updatePreview();
  await refreshRelations();
  await refreshHealth();
  await setEditorMode("visual", false);
  await refreshParentItem();
  await refreshNoteTags();
  unsubscribe = api.onDataChange(() => {
    if (editorMode !== "visual") updatePreview();
    run(refreshRelations);
    run(refreshHealth);
    run(refreshNoteTags);
  });
  unsubscribeSourceStyle = api.onSourceStyleChange(() =>
    run(refreshSourceDisplay),
  );
}

function updateNoteIdentity(note = null) {
  const select = $("knowledge-base-note-kind");
  select.replaceChildren();
  for (const kind of noteKind === "literature"
    ? ["literature"]
    : ["zettel", "thinking"]) {
    const option = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    );
    option.setAttribute("value", kind);
    option.textContent = api.loc("note-kind-" + kind);
    select.append(option);
  }
  select.value = noteKind;
  select.disabled =
    !!zettelId ||
    noteKind === "literature" ||
    recoveryPending ||
    libraryReadOnly;
  select.hidden = select.disabled;
  const kindText = $("knowledge-base-note-kind-text");
  kindText.hidden = !select.hidden;
  kindText.textContent = api.loc("note-kind-" + noteKind);
  const key = $("knowledge-base-editor-key");
  key.hidden = noteKind !== "thinking";
  key.disabled = recoveryPending || libraryReadOnly;
  if (document.activeElement !== key) key.value = customKey || zettelId || "";
  const reference = $("knowledge-base-editor-reference");
  reference.hidden = noteKind === "thinking";
  reference.textContent =
    note?.reference || zettelId || api.loc("editor-key-auto");
  reference.title = api.loc("note-reference-copy");
  reference.disabled = !zettelId;
  reference.onclick = () => api.copyNoteReference(note?.reference || zettelId);
  const convert = /** @type {HTMLButtonElement} */ (
    document.getElementById("knowledge-base-kind-convert")
  );
  convert.hidden = noteKind === "literature" || !zettelId;
  convert.disabled = recoveryPending || libraryReadOnly;
  convert.textContent = api.loc(
    noteKind === "thinking"
      ? "editor-convert-zettel"
      : "editor-convert-thinking",
  );
}

function closeParentPicker() {
  $("knowledge-base-parent-picker").hidden = true;
  $("knowledge-base-parent-search").hidden = true;
  $("knowledge-base-parent-results").hidden = true;
  $("knowledge-base-parent-change").setAttribute("aria-expanded", "false");
}
function toggleParentPicker() {
  const picker = $("knowledge-base-parent-picker");
  if (!picker.hidden) return closeParentPicker();
  picker.hidden = false;
  $("knowledge-base-parent-search").hidden = false;
  $("knowledge-base-parent-change").setAttribute("aria-expanded", "true");
  $("knowledge-base-parent-search").focus();
  $("knowledge-base-parent-search").dispatchEvent(new window.Event("input"));
}

function applyLocale() {
  $("knowledge-base-parent-label").textContent = api.loc(
    "editor-outline-parent",
  );
  $("knowledge-base-parent-search").placeholder = api.loc("parent-search");
  $("knowledge-base-kind-label").textContent = api.loc("note-kind");
  $("knowledge-base-key-label").textContent = api.loc("editor-key");
  $("knowledge-base-editor-key").placeholder = api.loc("editor-key-auto");
  for (const [id, key] of [
    ["knowledge-base-src-pick", "editor-change-source"],
    ["knowledge-base-parent-change", "editor-change-parent"],
  ]) {
    const button = document.getElementById(id);
    button.textContent = api.loc(key);
    button.title = api.loc(key);
    button.setAttribute("aria-label", api.loc(key));
  }
  document
    .getElementById("knowledge-base-editor-more-label")
    .setAttribute("aria-label", api.loc("editor-more"));
  document.title = zettelId
    ? api.loc("editor-title-edit")
    : api.loc("editor-title-new");
  const openWindow = document.getElementById("knowledge-base-open-window");
  openWindow.hidden = !args.embedded;
  openWindow.textContent = api.loc("editor-open-window");
  if (args.embedded) $("knowledge-base-editor-cancel").hidden = true;
  $("knowledge-base-src-label").textContent = api.loc("editor-source-label");
  $("knowledge-base-src-none").textContent = api.loc("editor-src-none");

  $("knowledge-base-src-search").placeholder = api.loc(
    "editor-src-placeholder",
  );
  $("knowledge-base-editor-title").placeholder = api.loc(
    "editor-title-placeholder",
  );
  $("knowledge-base-editor-cancel").setAttribute(
    "label",
    api.loc("editor-cancel"),
  );
  $("knowledge-base-editor-save").setAttribute("label", api.loc("editor-save"));
  document
    .getElementById("knowledge-base-editor-save-copy")
    .setAttribute("label", api.loc("editor-save-copy"));
  $("knowledge-base-src-selected").textContent = api.loc("editor-src-selected");
  $("knowledge-base-src-insert").setAttribute(
    "label",
    api.loc("editor-src-insert"),
  );
  $("knowledge-base-link-pick").setAttribute(
    "label",
    api.loc("editor-link-pick"),
  );
  $("knowledge-base-link-search").placeholder = api.loc(
    "editor-link-placeholder",
  );
  $("knowledge-base-editor-body").placeholder = api.loc(
    "editor-body-placeholder",
  );
  $("knowledge-base-url-insert").setAttribute(
    "label",
    api.loc("editor-url-insert"),
  );
  $("knowledge-base-image-insert").setAttribute(
    "label",
    api.loc("editor-image"),
  );
  $("knowledge-base-editor-relations-summary").textContent =
    api.loc("editor-relations");
  $("knowledge-base-editor-graph").setAttribute(
    "label",
    api.loc("graph-local-one"),
  );
  $("knowledge-base-editor-graph").setAttribute(
    "tooltiptext",
    api.loc("graph-local-one"),
  );
  $("knowledge-base-editor-outgoing-label").textContent =
    api.loc("manager-outgoing");
  $("knowledge-base-editor-backlinks-label").textContent =
    api.loc("manager-backlinks");
  $("knowledge-base-command-open").setAttribute(
    "label",
    api.loc("command-menu"),
  );
}

function navigateNote(id) {
  if (args.embedded) api.openManager({ selectId: id });
  else api.openEditor({ zettelId: id, window: true });
}

function closeEditor() {
  if (args.embedded) args.onClose?.();
  else window.close();
}

function bindEvents() {
  document
    .getElementById("knowledge-base-open-window")
    .addEventListener("click", () =>
      run(async () => {
        if (await save(false)) api.openEditor({ zettelId, window: true });
      }),
    );
  const more = /** @type {HTMLDetailsElement} */ (
    document.getElementById("knowledge-base-editor-more")
  );
  more.addEventListener("click", (event) => {
    if (/** @type {Element} */ (event.target).closest("button, toolbarbutton"))
      more.open = false;
  });
  document.addEventListener("click", (event) => {
    if (!more.contains(/** @type {Node} */ (event.target))) more.open = false;
  });
  more.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      more.open = false;
      document.getElementById("knowledge-base-editor-more-label").focus();
    }
  });
  document
    .getElementById("knowledge-base-kind-convert")
    .addEventListener("click", () => {
      if (noteKind === "literature" || recoveryPending || libraryReadOnly)
        return;
      noteKind = noteKind === "thinking" ? "zettel" : "thinking";
      if (noteKind !== "thinking") customKey = null;
      updateNoteIdentity();
      setDirty();
    });
  document
    .getElementById("knowledge-base-editor-format")
    .addEventListener("command", () =>
      run(() => setEditorMode(editorMode === "source" ? "visual" : "source")),
    );
  $("knowledge-base-editor-restore").addEventListener("command", () =>
    run(async () => {
      await api.restoreNote(zettelId);
      await refreshHealth();
      await setEditorMode("visual", false);
    }),
  );
  document
    .getElementById("knowledge-base-editor-save-copy")
    .addEventListener("command", () =>
      run(async () => {
        if (nativeNoteID && !noteUnavailable) {
          const input = snapshot();
          const copy = await api.duplicateNativeNote(
            nativeNoteID,
            input.title,
            input.body,
            input.sourceMode
              ? input.restoreDraft && input.nativeHTML
                ? input.nativeHTML
                : input.sourceDocument !== undefined
                  ? await api.markdownDocumentHTML(
                      input.sourceDocument,
                      input.expectedNoteHTML || "",
                    )
                  : await api.markdownNoteHTML(
                      input.title,
                      input.body,
                      input.expectedNoteHTML || "",
                    )
              : richEditor?.getHTML(),
          );
          await api.releaseNativeNote(nativeNoteID);
          nativeNoteID = copy.noteID;
          expectedNoteHTML = copy.html;
          if (recoveryPending) {
            recoveryHTML = copy.html;
            recoverySourceDocument = api.getMarkdownDocument(copy.html);
          } else
            $("knowledge-base-editor-body").value = api.getMarkdownDocument(
              copy.html,
            );
          richEditor?.destroy();
          richEditor = null;
          editorMode = "source";
        }
        if (noteUnavailable) {
          $("knowledge-base-editor-body").value =
            recoverySourceDocument ??
            `# ${$("knowledge-base-editor-title").value}\n\n${$("knowledge-base-editor-body").value}`;
          nativeNoteID = null;
          expectedNoteHTML = null;
          noteUnavailable = false;
          recoveryPending = false;
          editorMode = "source";
        }
        zettelId = null;
        customKey = null;
        if (noteKind === "literature") noteKind = "zettel";
        expectedUpdatedAt = null;
        window.knowledgeBaseCardId = null;
        document.getElementById("knowledge-base-editor-save-copy").hidden =
          true;
        if (await save(false)) {
          allowClose = true;
          closeEditor();
          api.openEditor({ zettelId, window: !args.embedded });
        }
      }),
    );
  $("knowledge-base-command-open").addEventListener("command", () => {
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
    if (
      !target.closest(".parent-control") &&
      !$("knowledge-base-parent-change").contains(target)
    ) {
      closeParentPicker();
    }
    if (
      !$("knowledge-base-command-menu").contains(target) &&
      !$("knowledge-base-command-open").contains(target) &&
      target !== $("knowledge-base-editor-body")
    )
      closeCommands();
  });
  $("knowledge-base-note-kind").addEventListener("change", () => {
    if ($("knowledge-base-note-kind").disabled) return;
    noteKind = /** @type {import("../../src/modules/db").NoteKind} */ (
      $("knowledge-base-note-kind").value
    );
    if (noteKind !== "thinking") customKey = null;
    updateNoteIdentity();
    setDirty();
  });
  $("knowledge-base-editor-key").addEventListener("input", () => {
    customKey = $("knowledge-base-editor-key").value.trim() || null;
    if (customKey === zettelId) customKey = null;
    setDirty();
    // Keep the draft while typing; commit the whole key on blur or explicit Save.
    clearTimeout(autosaveTimer);
  });
  $("knowledge-base-editor-key").addEventListener("change", () => {
    if (dirty && !recoveryPending) scheduleSave();
  });
  $("knowledge-base-editor-key").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("knowledge-base-editor-key").blur();
    }
  });
  $("knowledge-base-parent-display").addEventListener("click", () => {
    if (parentId) navigateNote(parentId);
    else toggleParentPicker();
  });
  $("knowledge-base-parent-change").addEventListener(
    "click",
    toggleParentPicker,
  );
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
          const clear = document.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "button",
          );
          clear.className = "metadata-clear";
          clear.textContent = api.loc("editor-parent-none");
          clear.addEventListener("click", () => {
            parentId = null;
            closeParentPicker();
            setDirty();
            run(refreshRelations);
          });
          const emptyRow = document.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "li",
          );
          emptyRow.append(clear);
          list.append(emptyRow);
          for (const card of results) {
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
              card.id,
              card.title,
              card.reference,
            );
            button.addEventListener("click", () => {
              parentId = card.id;
              closeParentPicker();
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
  $("knowledge-base-src-pick").addEventListener("click", () =>
    toggleSourceDrop(),
  );
  $("knowledge-base-src-none").addEventListener("click", () => {
    setSource(null, true);
    $("knowledge-base-src-drop").hidden = true;
  });
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
  $("knowledge-base-editor-save").addEventListener("command", () =>
    save(false),
  );
  $("knowledge-base-editor-cancel").addEventListener("command", () =>
    run(closeIfClean),
  );
  $("knowledge-base-src-selected").addEventListener("click", () =>
    run(useSelectedSource),
  );
  $("knowledge-base-src-insert").addEventListener("command", () =>
    run(insertSourceLink),
  );
  $("knowledge-base-link-pick").addEventListener("command", () =>
    openCardPicker(),
  );
  $("knowledge-base-url-insert").addEventListener("command", () => {
    const body = $("knowledge-base-editor-body");
    const text =
      body.value.slice(body.selectionStart, body.selectionEnd) ||
      api.loc("editor-format-text");
    const href = window.prompt(api.loc("editor-url-prompt"), "https://");
    if (href && /^(https?:\/\/|mailto:|zotero:\/\/)/i.test(href))
      insertText(`[${markdownLabel(text)}](<${href.replace(/[<>\n]/g, "")}>)`);
  });
  $("knowledge-base-image-insert").addEventListener("command", () => {
    const body = $("knowledge-base-editor-body");
    const range = { start: body.selectionStart, end: body.selectionEnd };
    run(async () => {
      const image = await api.pickImage(imageDraftId);
      if (image)
        insertText(`![${markdownLabel(image.name)}](${image.url})`, range);
    });
  });
  $("knowledge-base-editor-graph").addEventListener("command", () =>
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
  $("knowledge-base-editor-preview").addEventListener("click", (ev) => {
    if (!recoveryPending) return;
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
    if (ev.defaultPrevented) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      save(false);
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "e") {
      ev.preventDefault();
      run(toggleMarkdown);
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "w") {
      ev.preventDefault();
      run(closeIfClean);
    } else if (ev.key === "Escape") {
      if (!$("knowledge-base-command-menu").hidden) {
        closeCommands();
        $("knowledge-base-editor-body").focus();
      } else if (!$("knowledge-base-parent-search").hidden) {
        closeParentPicker();
      } else if (!$("knowledge-base-link-drop").hidden)
        $("knowledge-base-link-drop").hidden = true;
      else if (!$("knowledge-base-src-drop").hidden) toggleSourceDrop();
      else run(closeIfClean);
    }
  });
  window.addEventListener("beforeunload", () => {
    if (dirty && loaded && !window.knowledgeBaseStopping) {
      // The write starts before unload; the database shutdown blocker drains it.
      // Native window close retains a recovery draft without interrupting Zotero quit.
      persistDraft();
    }
  });
  window.addEventListener("close", (event) => {
    if ((dirty || saving) && !allowClose && !window.knowledgeBaseStopping) {
      event.preventDefault();
      run(closeIfClean);
    }
  });
}

/* ---------------- source item picker ---------------- */

function toggleSourceDrop(mode = "source") {
  const drop = $("knowledge-base-src-drop");
  drop.hidden = !drop.hidden && sourcePickMode === mode;
  sourcePickMode = mode;
  $("knowledge-base-src-none").hidden =
    mode !== "source" || noteKind === "literature";
  if (!drop.hidden) {
    const body = $("knowledge-base-editor-body");
    referenceRange = { start: body.selectionStart, end: body.selectionEnd };
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
      $("knowledge-base-src-drop").hidden = true;
      if (sourcePickMode === "reference")
        run(() => insertItemReference(it, referenceRange));
      else setSource(it, true);
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
  if (sourcePickMode === "reference")
    await insertItemReference(item, referenceRange);
  else setSource(item, true);
  $("knowledge-base-src-drop").hidden = true;
}

function setSource(s, markDirty = false) {
  source = s;
  $("knowledge-base-src-display")._sourceRender = null;
  $("knowledge-base-src-display").textContent =
    s?.title || api.loc("editor-src-none");
  run(refreshSourceDisplay);
  $("knowledge-base-src-insert").disabled = !s || !!s.missing;

  if (markDirty) setDirty();
  if (loaded) run(refreshParentItem);
}

async function refreshSourceDisplay() {
  const version = ++sourceRenderVersion;
  const display = $("knowledge-base-src-display");
  const current = source;
  display._sourceRender = null;
  display.onclick = null;
  display.onkeydown = null;
  display.classList.toggle("placeholder", !current || !!current.missing);
  if (!current || current.missing) {
    display.textContent = current?.title || api.loc("editor-src-none");
    display.removeAttribute("role");
    display.removeAttribute("tabindex");
    display.title = "";
    return;
  }
  try {
    await window.ZoteroKnowledgeBaseMarkdown.source(display, current, api);
  } catch (error) {
    if (version !== sourceRenderVersion || disposed) return;
    setStatus(
      api.loc("editor-source-format-failed") + String(error.message || error),
    );
    Zotero.logError(error);
  }
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

async function ensureRichEditor() {
  if (richEditor || noteUnavailable) return;
  if (!richEditorInitialization) {
    richEditorInitialization = (async () => {
      const note = await api.acquireNativeNote(snapshot());
      nativeNoteID = note.noteID;
      if (!recoveryPending || !expectedNoteHTML) expectedNoteHTML = note.html;
      richEditor = await window.KnowledgeBaseNativeEditor.create({
        element: $("knowledge-base-rich-frame"),
        item: await Zotero.Items.getAsync(nativeNoteID),
        readOnly: libraryReadOnly || recoveryPending,
        onChange(html) {
          if (disposed || recoveryPending || editorMode !== "visual") return;
          const content = api.projectNativeNote(html);
          $("knowledge-base-editor-title").value = content.title;
          $("knowledge-base-editor-body").value = content.body;
          richBody = content.body;
          setDirty();
        },
        onSavedHTML(html) {
          if (!recoveryPending && editorMode === "visual")
            expectedNoteHTML = html;
          if (!disposed && editorMode === "source" && dirty) scheduleSave();
        },
        onOpenLink(href) {
          run(() => api.openLink(href));
        },
        markdownLabel: api.loc("editor-format-markdown"),
        noteLinkLabel: api.loc("editor-link-pick"),
        onNoteLink: openCardPicker,
        onMarkdown() {
          run(toggleMarkdown);
        },
        onShortcut(key) {
          if (key === "s") run(() => save(false));
          if (key === "k") openCardPicker();
          if (key === "w") run(closeIfClean);
          if (key === "e") run(toggleMarkdown);
        },
      });
      const content = api.projectNativeNote(note.html);
      if (!args.draftId) {
        $("knowledge-base-editor-title").value = content.title;
        $("knowledge-base-editor-body").value = content.body;
      }
      richBody = $("knowledge-base-editor-body").value;
    })().finally(() => {
      richEditorInitialization = null;
    });
  }
  await richEditorInitialization;
}

/** @param {"visual" | "source"} mode */
async function setEditorMode(mode, focus = true) {
  const version = ++modeVersion;
  const body = $("knowledge-base-editor-body");
  const preview = $("knowledge-base-editor-preview");
  if (editorMode === "source" && richEditor) {
    hasSourceSelection = true;
    sourceSelection = {
      start: body.selectionStart,
      end: body.selectionEnd,
      scroll: body.scrollTop,
    };
  }
  if (editorMode !== "source" && !recoveryPending && richEditor) {
    await richEditor.flush();
    expectedNoteHTML = richEditor.getSavedHTML();
    const content =
      mode === "source"
        ? api.getMarkdownSource(expectedNoteHTML)
        : api.projectNativeNote(expectedNoteHTML);
    body.value =
      mode === "source"
        ? api.getMarkdownDocument(expectedNoteHTML)
        : content.body;
    $("knowledge-base-editor-title").value = content.title;
  }
  if (
    editorMode === "source" &&
    nativeNoteID &&
    dirty &&
    !recoveryPending &&
    mode !== "source"
  ) {
    if (!(await save(false))) return;
    if (richEditor) await richEditor.reload();
  }
  if (mode !== "source") await api.prepareMarkdown(body.value);
  if (!noteUnavailable) await ensureRichEditor();
  if (richEditor)
    await richEditor.setReadOnly(recoveryPending || libraryReadOnly);
  if (
    mode === "source" &&
    richEditor &&
    !recoveryPending &&
    editorMode !== "source"
  ) {
    expectedNoteHTML = richEditor.getSavedHTML();
    const content = api.getMarkdownSource(expectedNoteHTML);
    body.value = api.getMarkdownDocument(expectedNoteHTML);
    $("knowledge-base-editor-title").value = content.title;
  }
  if (disposed || window.closed || version !== modeVersion) return;
  richEditor?.setSourceMode(mode === "source" && !recoveryPending);
  editorMode = mode;
  $("knowledge-base-editor-root").setAttribute("data-mode", mode);
  body.hidden = mode !== "source" || noteUnavailable;
  body.readOnly = libraryReadOnly || noteUnavailable;
  const format = $("knowledge-base-editor-format");
  format.hidden = true;
  format.disabled = libraryReadOnly || noteUnavailable;
  format.setAttribute(
    "label",
    api.loc(
      mode === "source" ? "editor-format-native" : "editor-format-markdown",
    ),
  );
  preview.hidden = !recoveryPending;
  $("knowledge-base-rich-frame").hidden = recoveryPending || noteUnavailable;
  $("knowledge-base-editor-title").hidden = !recoveryPending;
  $("knowledge-base-editor-title").readOnly =
    recoveryPending || libraryReadOnly;
  for (const id of ["knowledge-base-command-open", "knowledge-base-link-pick"])
    document.getElementById(id).hidden = recoveryPending || libraryReadOnly;
  for (const id of [
    "knowledge-base-src-pick",
    "knowledge-base-parent-display",
    "knowledge-base-parent-change",
  ]) {
    const button = /** @type {HTMLButtonElement} */ (
      document.getElementById(id)
    );
    button.disabled = recoveryPending || libraryReadOnly;
  }
  closeCommands();
  $("knowledge-base-link-drop").hidden = true;
  $("knowledge-base-src-drop").hidden = true;
  $("knowledge-base-parent-search").hidden = true;
  $("knowledge-base-parent-results").hidden = true;
  cardSearchVersion++;
  sourceSearchVersion++;
  parentSearchVersion++;
  updatePreview();
  if (mode === "visual") {
    if (focus) richEditor?.focus();
  } else {
    if (focus) body.focus();
    if (!hasSourceSelection) {
      const start = /^# [^\n]*\n\n/.exec(body.value)?.[0].length || 0;
      sourceSelection = { start, end: start, scroll: 0 };
    }
    body.setSelectionRange(sourceSelection.start, sourceSelection.end);
    body.scrollTop = sourceSelection.scroll;
  }
}

function toggleMarkdown() {
  if (recoveryPending || noteUnavailable || libraryReadOnly) return;
  return setEditorMode(editorMode === "source" ? "visual" : "source");
}

function updatePreview() {
  api.updateImageDraft(imageDraftId, $("knowledge-base-editor-body").value);
  try {
    // Recovery previews stay read-only until Save applies the draft safely.
    if (recoveryPending)
      window.ZoteroKnowledgeBaseMarkdown.render(
        $("knowledge-base-editor-preview"),
        $("knowledge-base-editor-body").value,
      );
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
  const [outgoing, backlinks, family, parent, note] = await Promise.all([
    api.getDraftLinks($("knowledge-base-editor-body").value),
    zettelId ? api.getBacklinks(zettelId) : [],
    zettelId ? api.getFamily(zettelId) : { parent: null, children: [] },
    parentId ? api.getZettel(parentId) : null,
    zettelId ? api.getZettel(zettelId) : null,
  ]);
  const linkedTitles = new Map();
  await Promise.all(
    outgoing
      .filter((link) => link.targetId)
      .map(async (link) => {
        const card = await api.getZettel(link.targetId);
        if (card?.title) linkedTitles.set(link.targetId, card.title);
      }),
  );
  if (version !== relationsVersion) return;
  window.ZoteroKnowledgeBaseMarkdown.reference(
    $("knowledge-base-editor-reference"),
    note ? note.reference || note.id : "",
    api,
  );

  const display = $("knowledge-base-parent-display");
  display.replaceChildren();
  display.classList.toggle("placeholder", !parent);
  if (parent)
    window.ZoteroKnowledgeBaseMarkdown.identity(
      display,
      parent.id,
      parent.title,
      parent.reference,
    );
  else display.textContent = api.loc("editor-parent-none");
  $("knowledge-base-editor-family").replaceChildren();
  for (const child of family.children) {
    const button = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    button.className = "relation-link";
    window.ZoteroKnowledgeBaseMarkdown.identity(
      button,
      child.id,
      child.title,
      child.reference,
    );
    button.addEventListener("click", () => navigateNote(child.id));
    $("knowledge-base-editor-family").append(button);
  }
  $("knowledge-base-editor-children-label").textContent =
    `${api.loc("children")} · ${family.children.length}`;
  updateNoteIdentity(note);
  const renderList = (id, links, inbound) => {
    const list = $(id);
    list.textContent = "";
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
        inbound
          ? link.sourceTitle || ""
          : linkedTitles.get(targetId) || link.display,
        link.reference,
      );
      row.appendChild(button);
      row.classList.toggle("unresolved", !targetId);
      const open = () =>
        targetId
          ? navigateNote(targetId)
          : api.openEditor({ prefillTitle: link.ref });
      button.addEventListener("click", open);
      list.appendChild(row);
    }
  };
  $("knowledge-base-editor-outgoing-label").textContent =
    `${api.loc("manager-outgoing")} · ${outgoing.length}`;
  $("knowledge-base-editor-backlinks-label").textContent =
    `${api.loc("manager-backlinks")} · ${backlinks.length}`;
  const relationCount =
    family.children.length + outgoing.length + backlinks.length;
  $("knowledge-base-editor-relations-summary").textContent =
    `${api.loc("editor-relations")} · ${relationCount}`;
  $("knowledge-base-editor-relations").hidden = !relationCount;
  $("knowledge-base-editor-family").parentElement.hidden =
    !family.children.length;
  $("knowledge-base-editor-outgoing").parentElement.hidden = !outgoing.length;
  $("knowledge-base-editor-backlinks").parentElement.hidden = !backlinks.length;
  renderList("knowledge-base-editor-outgoing", outgoing, false);
  renderList("knowledge-base-editor-backlinks", backlinks, true);
}

function insertText(text, range = null) {
  if (recoveryPending || libraryReadOnly) return;
  if (editorMode === "visual" && richEditor) {
    run(async () => richEditor.insertHTML(await api.nativeNoteHTML("", text)));
    richEditor.focus();
    return;
  }
  const body = $("knowledge-base-editor-body");
  const start = range ? range.start : body.selectionStart;
  const end = range ? range.end : body.selectionEnd;
  body.setRangeText(text, start, end, "end");
  setDirty();
  updatePreview();
  body.focus();
}

function markdownLabel(text) {
  return text.replace(/([\\[\]`*_])/g, "\\$1").replace(/\n/g, " ");
}

async function insertSourceLink() {
  if (!source?.selectURL) return;
  const body = $("knowledge-base-editor-body");
  await insertItemReference(source, {
    start: body.selectionStart,
    end: body.selectionEnd,
  });
}

async function insertItemReference(item, range) {
  const text =
    item.citationKey && !item.isNote
      ? `[@${item.citationKey}]`
      : `[${markdownLabel(item.title || item.key)}](${item.selectURL})`;
  await api.prepareMarkdown(text);
  if (!disposed) insertText(text, range);
}

function formatSelection(kind) {
  if (recoveryPending || libraryReadOnly) return;
  if (editorMode === "visual" && richEditor) {
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
  if (ev.defaultPrevented) return;
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
  if (libraryReadOnly) return;
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
      card.reference,
    );
    li.tabIndex = 0;
    const insert = () => {
      insertText(`[[${card.reference || card.id}]]`, linkRange);
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

/* ---------------- save ---------------- */

function snapshot() {
  const fullSource =
    !recoveryPending && editorMode === "source"
      ? $("knowledge-base-editor-body").value
      : undefined;
  const projection =
    fullSource !== undefined
      ? api.projectNativeNote(api.renderMarkdown(fullSource))
      : null;
  return {
    kind: noteKind,
    customKey: noteKind === "thinking" ? customKey : null,
    id: zettelId || undefined,
    title: projection?.title || $("knowledge-base-editor-title").value.trim(),
    body: projection?.body ?? $("knowledge-base-editor-body").value,
    sourceDocument: fullSource ?? recoverySourceDocument,
    parentId,
    itemKey: source ? source.key : null,
    libraryID: source ? source.libraryID : null,
    expectedUpdatedAt,
    draftId,
    draftRevision: revision,
    noteID: nativeNoteID || undefined,
    expectedNoteHTML,
    nativeHTML: recoveryPending
      ? recoveryHTML || undefined
      : richEditor?.getHTML(),
    restoreDraft: recoveryPending,
    sourceMode: recoveryPending || editorMode === "source",
  };
}

function reportSaveError(error) {
  if (disposed) return;
  const message = String(error?.message || error);
  setStatus(
    message.includes("NOTE_KEY_INVALID")
      ? api.loc("editor-key-invalid")
      : message.includes("NOTE_KEY_EXISTS")
        ? api.loc("editor-key-exists")
        : message.includes("CARD_CONFLICT")
          ? api.loc("editor-save-conflict")
          : message.includes("LITERATURE_SOURCE_REQUIRED")
            ? api.loc("literature-source-required")
            : message.includes("NOTE_UNAVAILABLE")
              ? api.loc("health-note-missing")
              : message.includes("LITERATURE_EXISTS")
                ? api.loc("literature-exists")
                : api.loc("editor-save-failed") + " " + message,
  );
  $("knowledge-base-editor-status").classList.add("error");
  document.getElementById("knowledge-base-editor-save-copy").hidden =
    !message.includes("CARD_CONFLICT") && !message.includes("NOTE_UNAVAILABLE");
  if (message.includes("NOTE_UNAVAILABLE")) run(refreshHealth);
  Zotero.logError(error);
}

function persistDraft() {
  clearTimeout(draftTimer);
  if (!loaded || !dirty || disposed || window.knowledgeBaseStopping)
    return draftWrite;
  const input = snapshot();
  // Start the write now so Zotero's database shutdown blocker can drain it.
  draftWrite = api.saveEditorDraft(input);
  draftWrite.catch(reportSaveError);
  return draftWrite;
}

function scheduleSave() {
  if (noteUnavailable || libraryReadOnly) return;
  clearTimeout(draftTimer);
  clearTimeout(autosaveTimer);
  draftTimer = setTimeout(persistDraft, 250);
  autosaveTimer = setTimeout(() => save(false), 500);
}

function setDirty() {
  api.updateImageDraft(imageDraftId, $("knowledge-base-editor-body").value);
  dirty = true;
  revision++;
  $("knowledge-base-editor-save").classList.add("dirty");
  if (loaded) {
    setStatus(api.loc("editor-unsaved"));
    if (!recoveryPending) scheduleSave();
  }
  clearTimeout(previewTimer);
  if (editorMode !== "visual") previewTimer = setTimeout(updatePreview, 120);
  clearTimeout(relationsTimer);
  relationsTimer = setTimeout(() => run(refreshRelations), 180);
}

async function save(closeAfter) {
  clearTimeout(autosaveTimer);
  if (
    disposed ||
    window.knowledgeBaseStopping ||
    noteUnavailable ||
    libraryReadOnly
  )
    return false;
  if (saving) {
    await saving;
    if (dirty) return save(closeAfter);
    if (closeAfter) closeEditor();
    return true;
  }
  if (editorMode === "visual" && richEditor) await richEditor.flush();
  const input = snapshot();
  if (!input.title && !input.body.trim() && !zettelId) {
    clearTimeout(draftTimer);
    try {
      await draftWrite;
      await api.discardEditorDraft(draftId);
      if (revision !== input.draftRevision) return false;
      dirty = false;
      $("knowledge-base-editor-save").classList.remove("dirty");
      setStatus("");
      if (closeAfter) closeEditor();
      return true;
    } catch (error) {
      reportSaveError(error);
      return false;
    }
  }
  const savedRevision = revision;
  setStatus(api.loc("editor-saving"));
  saving = (async () => {
    try {
      await persistDraft();
      if (disposed || window.knowledgeBaseStopping) return false;
      const result = await api.saveEditorCard(input);
      zettelId = result.id;
      expectedUpdatedAt = result.updatedAt;
      if (result.html) expectedNoteHTML = result.html;
      if (result.noteID) nativeNoteID = result.noteID;
      updateNoteIdentity();
      if (recoveryPending) {
        recoveryPending = false;
        recoveryHTML = null;
        await richEditor?.reload();
        await richEditor?.setReadOnly(editorMode !== "visual");
        await setEditorMode("visual", false);
      }
      window.knowledgeBaseCardId = zettelId;
      document.getElementById("knowledge-base-editor-save-copy").hidden = true;
      if (disposed || window.knowledgeBaseStopping) return true;
      dirty = revision !== savedRevision;
      $("knowledge-base-editor-save").classList.toggle("dirty", dirty);
      document.title = api.loc("editor-title-edit");
      if (dirty) {
        await persistDraft();
        scheduleSave();
      } else setStatus(api.loc("editor-saved"));
      if (typeof args.onSaved === "function") args.onSaved(zettelId);
      run(refreshRelations);
      run(refreshParentItem);
      return true;
    } catch (error) {
      reportSaveError(error);
      return false;
    }
  })();
  const success = await saving;
  saving = null;
  if (success && closeAfter && !disposed) {
    if (dirty) return save(true);
    closeEditor();
  }
  return success;
}

async function closeIfClean() {
  if (closing || disposed) return;
  closing = true;
  clearTimeout(autosaveTimer);
  try {
    if (dirty || saving) {
      const prompt = Services.prompt;
      const choice = prompt.confirmEx(
        /** @type {Parameters<typeof Services.prompt.confirmEx>[0]} */ (
          /** @type {unknown} */ (window)
        ),
        api.loc("editor-title-edit"),
        api.loc("editor-close-unsaved"),
        prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING +
          prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_IS_STRING +
          prompt.BUTTON_POS_2 * prompt.BUTTON_TITLE_IS_STRING +
          prompt.BUTTON_POS_1_DEFAULT,
        api.loc("editor-save-close"),
        api.loc("editor-close-cancel"),
        api.loc("editor-draft-close"),
        null,
        { value: false },
      );
      if (choice === 1) {
        if (dirty) scheduleSave();
        return;
      }
      if (choice === 0) {
        allowClose = true;
        if (!(await save(true))) allowClose = false;
        return;
      }
      await persistDraft();
    }
    allowClose = true;
    closeEditor();
  } finally {
    closing = false;
  }
}

function setStatus(text) {
  const status = $("knowledge-base-editor-status");
  status.textContent = text;
  status.classList.remove("error");
}

window.addEventListener("load", () => run(load));
window.addEventListener("unload", () => {
  disposed = true;
  clearTimeout(autosaveTimer);
  clearTimeout(draftTimer);
  try {
    richEditor?.destroy();
    $("knowledge-base-editor-body").destroy();
    if (nativeNoteID)
      api
        .releaseNativeNote(nativeNoteID)
        .catch((error) => Zotero.logError(error));
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
  unsubscribeSourceStyle?.();
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
      key: "editor-reference-insert",
      icon: "note",
      aliases: "citation reference item note source 引用 条目 笔记 来源",
      action: () => toggleSourceDrop("reference"),
    },
    {
      key: "parent",
      icon: "related",
      aliases: "parent 父节点",
      action: toggleParentPicker,
    },
  ];
  commandIndex = 0;
  for (const command of commands) {
    if (editorMode !== "source" && command.text !== undefined) continue;
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
        if (command.action) command.action();
        else
          document
            .getElementById(command.target)
            .dispatchEvent(new window.Event("command", { bubbles: true }));
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

async function refreshNoteTags() {
  const noteID = nativeNoteID;
  const tags = await api.getNoteTags(noteID);
  if (disposed || noteID !== nativeNoteID) return;
  window.ZoteroKnowledgeBaseMarkdown.tags(
    document.getElementById("knowledge-base-note-tags"),
    tags,
  );
}

async function refreshParentItem() {
  const key = source?.key;
  const library = source?.libraryID;
  let summary = key ? await api.getItemSummary(key, library) : null;
  if (source?.key !== key || source?.libraryID !== library || disposed) return;
  if (zettelId) {
    const note = await api.getZettel(zettelId);
    if (disposed || source?.key !== key || source?.libraryID !== library)
      return;
    updateNoteIdentity(note);
  }
  if (summary) {
    source = summary;
    await refreshSourceDisplay();
  }
}

async function refreshHealth() {
  const version = ++healthVersion;
  if (!zettelId) {
    await refreshParentItem();
    return;
  }
  const health = await api.getNoteHealth(zettelId);
  if (version !== healthVersion || disposed) return;
  const unavailable = ["missing", "trashed"].includes(health.note);
  libraryReadOnly = !health.editable;
  const box = document.getElementById("knowledge-base-editor-health");
  box.hidden =
    !unavailable &&
    !["missing", "trashed"].includes(health.source) &&
    !libraryReadOnly;
  document.getElementById("knowledge-base-editor-health-text").textContent =
    api.loc(
      unavailable
        ? `health-note-${health.note}`
        : libraryReadOnly
          ? "health-read-only"
          : `health-source-${health.source}`,
    );
  const restore = $("knowledge-base-editor-restore");
  restore.setAttribute("label", api.loc("health-restore"));
  restore.hidden = health.note !== "trashed" && health.source !== "trashed";
  restore.disabled = !health.editable;
  $("knowledge-base-editor-save").disabled = unavailable || libraryReadOnly;
  if (unavailable && !noteUnavailable) {
    clearTimeout(autosaveTimer);
    if (dirty) await persistDraft();
    noteUnavailable = true;
    recoveryPending = true;
    recoveryHTML = null;
    if (richEditor) {
      richEditor.destroy();
      richEditor = null;
      const old = $("knowledge-base-rich-frame");
      old.replaceWith(old.cloneNode(false));
    }
    document.getElementById("knowledge-base-editor-save-copy").hidden =
      !health.editable;
    await setEditorMode("visual", false);
  } else if (!unavailable && noteUnavailable) {
    noteUnavailable = false;
    recoveryPending = !!dirty;
    nativeNoteID = null;
    expectedNoteHTML = null;
    document.getElementById("knowledge-base-editor-save-copy").hidden = true;
  } else if (richEditor && libraryReadOnly) await richEditor.setReadOnly(true);
  await refreshParentItem();
}
