/** Compact note metadata, exercised only with disposable Zotero data. */
export default async function metadataHost({
  Zotero,
  IOUtils,
  PathUtils,
  Services,
  Components,
  setTimeout,
  marker,
  restartMarker,
  screenshots,
}) {
  const knowledgeBase = Zotero.ZoteroKnowledgeBase;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (check, message) => {
    for (let n = 0; n < 600; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  const main = Zotero.getMainWindow();
  const open = async (id) => {
    knowledgeBase.api.openEditor({ zettelId: id });
    const editor = await wait(() => {
      const view = main.document.querySelector(
        ".knowledge-base-workbench",
      )?.contentWindow;
      const editor = view?.document.getElementById(
        "knowledge-base-workbench-editor",
      )?.contentWindow;
      return (
        editor?.knowledgeBaseCardId === id &&
        editor.document.readyState === "complete" &&
        editor
      );
    }, "Metadata editor did not open");
    await editor.knowledgeBaseReady();
    await wait(
      () => editor.document.documentElement.getBoundingClientRect().width > 0,
      "Metadata editor has not been shown",
    );
    return editor;
  };
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    const card = await knowledgeBase.api.getZettel(saved.id);
    assert(
      card.reference === saved.reference && card.body === saved.body,
      "ID or content changed after restart",
    );
    assert(
      (await knowledgeBase.api.getZettel(saved.independentID)).body ===
        saved.independentBody,
      "Independent-window edit changed after restart",
    );
    assert(
      (
        await knowledgeBase.api.resolveCardLink(
          "knowledge-base://card/BetterDynamicGraphYu23",
        )
      )?.targetId === saved.id,
      "Original ID alias was lost after restart",
    );
    const editor = await open(saved.id);
    assert(
      editor.document.getElementById("knowledge-base-editor-key").value ===
        saved.reference &&
        !editor.document.getElementById("knowledge-base-editor-key").hidden,
      "Restart lost the inline ID",
    );
    await knowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  await knowledgeBase.api.getSourceStyles();
  const source = new Zotero.Item("journalArticle");
  source.setField(
    "title",
    "Towards better dynamic graph learning: New architecture and unified library",
  );
  source.setField("date", "2023");
  source.setField(
    "publicationTitle",
    "Advances in Neural Information Processing Systems",
  );
  source.setCreators([
    { firstName: "Le", lastName: "Yu", creatorType: "author" },
  ]);
  source.addTag("Graph learning");
  source.addTag("Representation learning");
  await source.saveTx();
  const id = await knowledgeBase.api.saveZettel({
    sourceNote: true,
    customKey: "BetterDynamicGraphYu23",
    title: source.getField("title"),
    body:
      "## Insight\n\nA precise note with its original source.\n\n" +
      "This research record keeps the task, assumptions and evaluation criteria together. The comparison should explain which observations support the claim and which questions remain open. A concise account of the dataset, baselines and measurement procedure makes the result easier to revisit alongside related work.\n\n" +
      "## Next experiment\n\nCompare the proposed change against the same baseline and record the conditions of each run. Keep the evidence close to the conclusion, describe limitations explicitly and link the supporting notes so the reasoning remains readable when returning to this project.",
    itemKey: source.key,
    libraryID: source.libraryID,
  });
  await knowledgeBase.api.saveZettel({
    customKey: "OccupiedID",
    title: "Other note",
    body: "Do not change this note.",
  });
  const ancestorID = await knowledgeBase.api.saveZettel({
    title: "Navigation ancestor",
    body: "Keep this note.",
  });
  const parentID = await knowledgeBase.api.saveZettel({
    title: "Navigation parent",
    body: "A parent link.",
    parentId: ancestorID,
  });
  const childID = await knowledgeBase.api.saveZettel({
    title: "Navigation child",
    body: "A child link.",
    parentId: parentID,
  });
  main.resizeTo(1200, 850);
  let navigationEditor = await open(childID);
  await pause(100);
  const navigationManager = main.document.querySelector(
    ".knowledge-base-workbench",
  ).contentWindow;
  const currentNavigationEditor = () =>
    navigationManager.document.getElementById("knowledge-base-workbench-editor")
      .contentWindow;
  const waitNavigation = async (targetID) => {
    const next = await wait(() => {
      const next = currentNavigationEditor();
      return (
        next?.knowledgeBaseCardId === targetID &&
        next.knowledgeBaseReady &&
        next
      );
    }, "Note navigation did not reach " + targetID);
    await next.knowledgeBaseReady();
    await wait(
      () =>
        !navigationManager.document.getElementById(
          "knowledge-base-workbench-editor",
        ).hidden &&
        next.document.documentElement.getBoundingClientRect().width > 0,
      "Navigation editor has not been shown",
    );
    return next;
  };
  const clickAt = (view, x, y, count) => {
    for (const type of ["mousedown", "mouseup"])
      view.windowUtils.sendMouseEvent(type, x, y, 0, count, 0);
  };
  const parentBounds = navigationEditor.document
    .getElementById("knowledge-base-parent-display")
    .getBoundingClientRect();
  const navigationStarted = Date.now();
  clickAt(navigationEditor, parentBounds.x + 10, parentBounds.y + 10, 1);
  navigationEditor = await waitNavigation(parentID);
  const navigationMs = Date.now() - navigationStarted;
  clickAt(navigationEditor, parentBounds.x + 10, parentBounds.y + 10, 2);
  await pause(150);
  assert(
    currentNavigationEditor().knowledgeBaseCardId === parentID &&
      navigationEditor.document.getElementById("knowledge-base-parent-picker")
        .hidden,
    "The second parent-link click navigated to another note or opened the picker",
  );
  Zotero.debug(
    "Knowledge Base cached-list parent navigation: " + navigationMs + " ms",
  );
  const pencil = navigationEditor.document.getElementById(
    "knowledge-base-parent-edit",
  );
  pencil.click();
  assert(
    !navigationEditor.document.getElementById("knowledge-base-parent-picker")
      .hidden,
    "The parent pencil did not open its own picker",
  );
  navigationEditor.document
    .getElementById("knowledge-base-parent-search")
    .dispatchEvent(
      new navigationEditor.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
  await navigationEditor.save(false);
  await pause(100);
  const navigationPane = navigationManager.document.getElementById(
    "knowledge-base-list-pane",
  );
  navigationPane.style.flex = "none";
  navigationPane.style.height = "180px";
  navigationPane.scrollTop = 60;
  navigationPane.dispatchEvent(new navigationManager.Event("scroll"));
  await pause(50);
  const paneBounds = navigationPane.getBoundingClientRect();
  const partialRow = [
    ...navigationManager.document.querySelectorAll(".zettel-row"),
  ].find((row) => {
    const rect = row.getBoundingClientRect();
    return rect.top < paneBounds.bottom - 10 && rect.bottom > paneBounds.bottom;
  });
  assert(partialRow, "The navigation fixture has no partially visible note");
  const firstTarget = partialRow.dataset.id,
    firstScroll = navigationPane.scrollTop;
  const rowBounds = partialRow.getBoundingClientRect();
  const clickX = rowBounds.x + 30,
    clickY = paneBounds.bottom - 12;
  clickAt(navigationManager, clickX, clickY, 1);
  await waitNavigation(firstTarget);
  assert(
    navigationPane.scrollTop === firstScroll && partialRow.isConnected,
    "Single-clicking a partial note moved the list or replaced its row",
  );
  clickAt(navigationManager, clickX, clickY, 2);
  const rowEditor = await wait(
    () =>
      [...Services.wm.getEnumerator("knowledge-base:editor")].find(
        (win) =>
          win.knowledgeBaseCardId === firstTarget && win.knowledgeBaseReady,
      ),
    "The second list click lost its original note target",
  );
  await rowEditor.knowledgeBaseReady();
  assert(
    await rowEditor.save(false),
    "The list double-click editor did not settle",
  );
  await rowEditor.eval("closeIfClean()");
  await wait(
    () => rowEditor.closed,
    "The list double-click editor did not close",
  );
  navigationPane.style.flex = "";
  navigationPane.style.height = "";
  const editor = await open(id);
  const $ = (name) => editor.document.getElementById("knowledge-base-" + name);
  const key = $("editor-key"),
    copy = $("key-copy"),
    display = $("src-display");
  const pointer = (element) => {
    const rect = element.getBoundingClientRect();
    assert(
      rect.width > 0 && rect.height > 0,
      "Metadata control has no pointer target: " + element.id,
    );
    assert(
      element.contains(
        editor.document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      ),
      "Metadata control is obscured: " + element.id,
    );
    for (const type of ["mousemove", "mousedown", "mouseup"])
      editor.windowUtils.sendMouseEvent(
        type,
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        0,
        1,
        0,
      );
  };
  const edit = () => {
    pointer(key);
    assert(
      !key.hidden && editor.document.activeElement === key,
      "Edit ID did not focus the selected input",
    );
  };
  const type = (value) => {
    key.value = value;
    key.dispatchEvent(new editor.Event("input", { bubbles: true }));
  };
  const press = (name) =>
    key.dispatchEvent(
      new editor.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    );
  const shot = async (name) => {
    if (!screenshots) return;
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
    const image = await main.browsingContext.currentWindowGlobal.drawSnapshot(
      undefined,
      1,
      "white",
    );
    const canvas = main.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    image.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    await IOUtils.write(
      PathUtils.join(screenshots, name + ".png"),
      new Uint8Array(await blob.arrayBuffer()),
    );
  };
  main.resizeTo(1200, 850);
  await shot("initial");
  await wait(
    () => display.querySelector(".csl-entry")?.textContent.includes("2023"),
    "Full source citation did not load",
  );
  assert(
    !key.hidden &&
      key.value === "BetterDynamicGraphYu23" &&
      display.querySelector(".csl-entry")?.textContent.includes("Yu"),
    "Metadata is not compact by default",
  );
  const metadata = $("editor-metadata"),
    footer = $("editor-footer"),
    noteType = $("note-type");
  assert(
    metadata.contains(display) &&
      metadata.contains($("note-tags")) &&
      metadata.contains($("parent-display")) &&
      !metadata.contains(copy) &&
      footer.contains(copy) &&
      footer.contains(noteType),
    "Source and tags are not separated from footer identity",
  );
  await wait(
    () => $("note-tags").querySelectorAll(".note-tag").length === 2,
    "Source tags did not appear beside the Tags label",
  );
  pointer($("tags-edit"));
  await wait(
    () =>
      !$("tag-editor").hidden &&
      editor.document.activeElement === $("tag-input"),
    "Inline tag control did not open its input",
  );
  $("tag-input").value = "Research workflow";
  $("tag-input").dispatchEvent(
    new editor.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await wait(
    () =>
      [...$("own-tags").querySelectorAll("button")].some((button) =>
        button.textContent.includes("Research workflow"),
      ),
    "Inline tag addition did not save",
  );
  pointer($("tags-edit"));
  await wait(
    () =>
      $("tag-editor").hidden &&
      $("note-tags").querySelectorAll(".note-tag").length === 3,
    "Done did not restore the inline tag summary",
  );
  noteType.focus();
  noteType.value = "literature";
  noteType.dispatchEvent(new editor.Event("change", { bubbles: true }));
  assert(await editor.save(false), "Footer type change did not save");
  assert(
    (await knowledgeBase.api.getZettel(id)).note_type === "literature",
    "Footer type change was not persisted",
  );
  await shot("source-tags-footer");
  assert(!$("editor-more"), "The editor still exposes a redundant More menu");
  const listView = main.document.querySelector(
    ".knowledge-base-workbench",
  ).contentWindow;
  const noteRow = () =>
    [...listView.document.querySelectorAll(".zettel-row")].find(
      (row) => row.dataset.id === id,
    );
  await wait(noteRow, "The current note is missing from the list");
  noteRow().click();
  await pause(100);
  assert(
    ![...Services.wm.getEnumerator("knowledge-base:editor")].some(
      (win) => win.knowledgeBaseCardId === id,
    ),
    "Single-clicking a note opened a separate window",
  );
  noteType.value = "thinking";
  noteType.dispatchEvent(new editor.Event("change", { bubbles: true }));
  const bounds = noteRow().getBoundingClientRect();
  for (const count of [1, 2])
    for (const type of ["mousedown", "mouseup"])
      listView.windowUtils.sendMouseEvent(
        type,
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        0,
        count,
        0,
      );
  const separate = await wait(
    () =>
      [...Services.wm.getEnumerator("knowledge-base:editor")].find(
        (win) => win.knowledgeBaseCardId === id && win.knowledgeBaseReady,
      ),
    "Double-clicking the note list did not open a separate editor",
  );
  await separate.knowledgeBaseReady();
  assert(
    separate.document.getElementById("knowledge-base-note-type").value ===
      "thinking" && editor.knowledgeBaseCardId === id,
    "The separate window missed pending edits or replaced the current editor",
  );
  assert(await separate.save(false), "The separate note editor did not settle");
  await separate.eval("closeIfClean()");
  await wait(() => separate.closed, "The separate note editor did not close");
  noteType.value = "literature";
  noteType.dispatchEvent(new editor.Event("change", { bubbles: true }));
  assert(await editor.save(false), "Restoring the original type did not save");
  main.focus();
  pointer(copy);
  await wait(
    () =>
      Zotero.Utilities.Internal.getClipboard("text/plain") ===
      "[[BetterDynamicGraphYu23]]",
    "Clicking the ID did not copy its reference",
  );
  assert(!key.hidden, "Copy hid the inline ID field");
  copy.focus();
  await pause(25);
  assert(
    editor.getComputedStyle(copy).opacity === "1",
    "Focused copy action is invisible",
  );
  await shot("inline-id-copy");
  const originalSelect = knowledgeBase.api.selectItem;
  let selected;
  try {
    knowledgeBase.api.selectItem = async (...args) => {
      selected = args;
    };
    pointer(display);
    await wait(() => selected, "Source title did not open the source item");
    assert(
      selected[0] === source.key && selected[1] === source.libraryID,
      "Source opened the wrong item",
    );
  } finally {
    knowledgeBase.api.selectItem = originalSelect;
  }
  pointer($("src-pick"));
  assert(!$("src-drop").hidden, "Source label did not open the source picker");
  $("src-search").dispatchEvent(
    new editor.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert($("src-drop").hidden, "Source picker did not close without changes");
  assert(await editor.save(false), "Initial native editor did not settle");
  const originalHTML = (
    await Zotero.Items.getAsync(editor.eval("nativeNoteID"))
  ).getNote();
  pointer($("parent-edit"));
  const parentChoice = await wait(
    () =>
      [...$("parent-results").querySelectorAll(".relation-link")].find(
        (button) => button.textContent.includes("Other note"),
      ),
    "Header parent selector did not show notes",
  );
  await shot("inline-parent-picker");
  pointer(parentChoice);
  assert(await editor.save(false), "Inline parent selection did not save");
  assert(
    (await knowledgeBase.api.getFamily(id)).parent?.title === "Other note",
    "Inline parent selector chose the wrong note",
  );
  for (const [name, title] of [
    [
      "sentence",
      "Other strong evidence has been presented suggesting that unsupervised pre-training acts like a regularizer; when there is not enough capacity, it may instead hurt generalization. "
        .repeat(4)
        .trim(),
    ],
    ["unbroken", "ParentWithoutAnyWordBoundary".repeat(18)],
    [
      "chinese",
      "记录数据集定义、实验条件与证据之间的联系，保留完整的研究笔记标题。".repeat(
        12,
      ),
    ],
  ]) {
    const parentID = await knowledgeBase.api.saveZettel({
      title,
      body: "Long parent title fixture.",
    });
    pointer($("parent-edit"));
    const choice = await wait(
      () =>
        !$("parent-results").hidden &&
        [...$("parent-results").querySelectorAll(".relation-link")].find(
          (button) => button.textContent === title,
        ),
      "Long parent was missing from the picker",
    );
    choice.scrollIntoView({ block: "nearest" });
    pointer(choice);
    assert(await editor.save(false), "Long parent selection did not save");
    assert(
      (await knowledgeBase.api.getFamily(id)).parent?.id === parentID,
      "Long parent title changed its identity",
    );
    for (const width of [1800, 700]) {
      main.resizeTo(width, 850);
      await pause(100);
      const parent = $("parent-display"),
        rect = parent.getBoundingClientRect();
      const tags = $("note-tags").getBoundingClientRect();
      const fields = metadata.querySelector(".note-metadata-fields");
      const style = editor.getComputedStyle(parent);
      assert(
        rect.height <= 26 &&
          rect.bottom <= tags.top &&
          rect.right <= fields.getBoundingClientRect().right + 1 &&
          fields.scrollWidth <= fields.clientWidth + 1 &&
          style.textOverflow === "ellipsis" &&
          parent.title.includes(title),
        "Long parent overlaps tags, expands metadata or loses its complete title: " +
          name +
          "/" +
          width,
      );
      await shot("parent-" + name + "-" + width);
    }
  }
  main.resizeTo(1200, 850);
  pointer($("parent-edit"));
  const noParent = await wait(
    () =>
      !$("parent-results").hidden &&
      $("parent-results").querySelector(".metadata-clear"),
    "Parent selector has no clear action",
  );
  noParent.scrollIntoView({ block: "nearest" });
  pointer(noParent);
  assert(await editor.save(false), "Detaching the inline parent did not save");
  assert(
    !(await knowledgeBase.api.getFamily(id)).parent &&
      (await Zotero.Items.getAsync(editor.eval("nativeNoteID"))).getNote() ===
        originalHTML,
    "Parent selection changed the original document",
  );
  edit();
  type("CancelledID");
  press("Escape");
  assert(
    !key.hidden && key.value === "BetterDynamicGraphYu23",
    "Escape did not restore the original ID",
  );
  edit();
  type("OccupiedID");
  press("Enter");
  await wait(
    () => key.getAttribute("aria-invalid") === "true",
    "Occupied ID was accepted",
  );
  assert(
    !key.hidden && !$("key-feedback").hidden && !(await editor.save(false)),
    "Conflict lost its inline feedback or was saved",
  );
  press("Escape");
  const longID =
    "BetterDynamicGraphYu23" + "LongUnbrokenResearchReference".repeat(7);
  edit();
  type(longID);
  press("Enter");
  await wait(
    () => !key.hidden && key.value === longID && !editor.eval("keyEditing"),
    "Enter did not finish a valid ID",
  );
  assert(await editor.save(false), "Renamed ID did not save");
  assert(
    (await Zotero.Items.getAsync(editor.eval("nativeNoteID"))).getNote() ===
      originalHTML,
    "Renaming the ID changed the note body",
  );
  assert(
    (
      await knowledgeBase.api.resolveCardLink(
        "knowledge-base://card/BetterDynamicGraphYu23",
      )
    )?.targetId === id,
    "Renaming broke the previous ID",
  );
  for (const bear of [false, true]) {
    Zotero.Prefs.set("extensions.zotero.plugin-ui.bear", bear, true);
    for (const mode of ["visual", "source"]) {
      await editor.setEditorMode(mode);
      for (const width of [1800, 1200, 700]) {
        main.resizeTo(width, 850);
        await pause(200);
        const surface =
          mode === "visual"
            ? $("rich-frame").getCurrentInstance()._iframeWindow
            : $("editor-body").querySelector("iframe").contentWindow;
        const prose = surface.document.querySelector(
          mode === "visual" ? ".primary-editor" : ".cm-content",
        );
        const proseRect = prose.getBoundingClientRect();
        const pageWidth = surface.document.documentElement.clientWidth;
        assert(
          proseRect.left >= -1 &&
            proseRect.right <= pageWidth + 1 &&
            Math.abs((proseRect.left + proseRect.right) / 2 - pageWidth / 2) <=
              10 &&
            proseRect.width >= Math.min(pageWidth - 100, 1200) &&
            parseFloat(surface.getComputedStyle(prose).paddingBottom) <= 100,
          "Note width is narrow, uncentered or padded excessively: " +
            JSON.stringify({
              mode,
              width,
              pageWidth,
              prose: proseRect.toJSON(),
            }),
        );
        const sourceRect = display.getBoundingClientRect(),
          copyRect = key.getBoundingClientRect();
        const sourceLabel = $("src-pick").getBoundingClientRect(),
          tagsLabel = $("tags-label").getBoundingClientRect(),
          keyLabel = $("key-label").getBoundingClientRect();
        assert(
          Math.abs(
            sourceRect.left - $("note-tags").getBoundingClientRect().left,
          ) < 1 && Math.abs(sourceLabel.left - tagsLabel.left) < 1,
          "Source and Tags columns are misaligned",
        );
        assert(
          Math.abs(
            copyRect.top +
              copyRect.height / 2 -
              keyLabel.top -
              keyLabel.height / 2,
          ) < 1,
          "ID label and value are not vertically aligned",
        );
        assert(
          key.title.includes(longID) &&
            copy.scrollHeight <= copy.clientHeight + 1 &&
            copyRect.right <= editor.innerWidth &&
            sourceRect.right <= editor.innerWidth &&
            copyRect.top >= footer.getBoundingClientRect().top &&
            footer.getBoundingClientRect().bottom <= editor.innerHeight + 1 &&
            footer.getBoundingClientRect().height < 46,
          "Metadata overflowed or expanded the status bar: " +
            JSON.stringify({
              bear,
              mode,
              width,
              active: editor.document.activeElement?.id,
              overflow: editor.getComputedStyle(key).textOverflow,
              title: key.title.includes(longID),
              copyScroll: [copy.scrollHeight, copy.clientHeight],
              keyRight: copyRect.right,
              sourceRight: sourceRect.right,
              viewport: [editor.innerWidth, editor.innerHeight],
              keyTop: copyRect.top,
              footer: footer.getBoundingClientRect().toJSON(),
            }),
        );
        await shot((bear ? "bear" : "minimal") + "-" + mode + "-" + width);
        edit();
        await pause(25);
        const style = editor.getComputedStyle(key),
          rect = key.getBoundingClientRect();
        assert(
          style.boxShadow === "none" &&
            style.outlineStyle === "none" &&
            parseFloat(style.borderLeftWidth) === 1,
          "Editing restored the native heavy input frame",
        );
        assert(
          Math.abs(rect.left - copyRect.left) < 1,
          "Editing shifts the ID text column",
        );
        assert(
          key.localName === "input" &&
            key.value === longID &&
            key.scrollHeight <= key.clientHeight + 1 &&
            footer.getBoundingClientRect().height < 46,
          "Long ID editing lost its value or expanded the status bar",
        );
        await shot(
          (bear ? "bear" : "minimal") + "-" + mode + "-" + width + "-edit",
        );
        press("Escape");
      }
    }
  }
  for (const style of ["ieee", "apa"]) {
    knowledgeBase.api.setSourceStyle("http://www.zotero.org/styles/" + style);
    await wait(
      () =>
        style === "ieee"
          ? display.textContent.includes("[1]")
          : !display.textContent.includes("[1]"),
      "Full citation did not refresh with the selected style",
    );
  }
  source.setField("title", "Updated source title");
  await source.saveTx();
  await wait(
    () => display.textContent.includes("Updated source title"),
    "Source metadata did not refresh",
  );
  // Keep a standalone Knowledge Base window alive after the library window closes.
  knowledgeBase.api.openWorkbenchWindow({ selectId: id });
  const floating = await wait(
    () => Services.wm.getMostRecentWindow("knowledge-base:workbench"),
    "Standalone workbench did not open",
  );
  const manager = await wait(
    () =>
      floating.document.getElementById("knowledge-base-window-browser")
        ?.contentWindow?.ZoteroKnowledgeBase_selectZettel &&
      floating.document.getElementById("knowledge-base-window-browser")
        .contentWindow,
    "Standalone manager did not load",
  );
  const current = async (cardID) => {
    const frame = await wait(() => {
      const frame = manager.document.getElementById(
        "knowledge-base-workbench-editor",
      )?.contentWindow;
      return (
        frame?.knowledgeBaseCardId === cardID &&
        frame.knowledgeBaseReady &&
        frame
      );
    }, "Standalone note did not open: " + cardID);
    await frame.knowledgeBaseReady();
    return frame;
  };
  await current(id);
  main.close();
  await wait(() => !Zotero.getMainWindow(), "Library window did not close");
  const secondID = await knowledgeBase.api.saveZettel({
    title: "No library window",
    body: "A note created after the library window closed. $x^2$",
  });
  manager.ZoteroKnowledgeBase_selectZettel(secondID);
  let active = await current(secondID);
  await active.setEditorMode("source");
  const body = active.document.getElementById("knowledge-base-editor-body");
  body.value += "\n\nSaved from an independent window.";
  body.dispatchEvent(new active.Event("input", { bubbles: true }));
  assert(await active.save(false), "Saving without a library window failed");
  const savedBody = (await knowledgeBase.api.getZettel(secondID)).body;
  assert(
    savedBody.includes("Saved from an independent window."),
    "Independent edit was lost",
  );
  manager.ZoteroKnowledgeBase_selectZettel(id);
  active = await current(id);
  knowledgeBase.api.setSourceStyle("http://www.zotero.org/styles/ieee");
  await wait(
    () =>
      active.document
        .getElementById("knowledge-base-src-display")
        ?.querySelector(".csl-entry")
        ?.textContent.includes("[1]"),
    "Full citation did not render without a library window",
  );
  manager.ZoteroKnowledgeBase_selectZettel(secondID);
  active = await current(secondID);
  await active.setEditorMode("visual");
  assert(
    await active.save(false),
    "Native save without a library window failed",
  );
  assert(
    (await knowledgeBase.api.getZettel(secondID)).body === savedBody,
    "Switching notes changed the saved body",
  );
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      id,
      reference: longID,
      body: (await knowledgeBase.api.getZettel(id)).body,
      independentID: secondID,
      independentBody: savedBody,
    }),
  );
  await knowledgeBase.hooks.onShutdown();
  quit();
}
