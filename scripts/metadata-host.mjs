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
      editor.document.getElementById("knowledge-base-key-copy").textContent ===
        saved.reference &&
        editor.document.getElementById("knowledge-base-editor-key").hidden,
      "Restart reopened the ID input",
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
  await source.saveTx();
  const id = await knowledgeBase.api.saveZettel({
    sourceNote: true,
    customKey: "BetterDynamicGraphYu23",
    title: source.getField("title"),
    body: "## Insight\n\nA precise note with its original source.",
    itemKey: source.key,
    libraryID: source.libraryID,
  });
  await knowledgeBase.api.saveZettel({
    customKey: "OccupiedID",
    title: "Other note",
    body: "Do not change this note.",
  });
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
    for (const type of ["mousedown", "mouseup"])
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
    $("editor-more").open = true;
    pointer($("key-edit"));
    assert(
      !key.hidden && copy.hidden && editor.document.activeElement === key,
      "Edit ID did not focus the selected input",
    );
    assert(
      key.selectionEnd - key.selectionStart === key.value.length,
      "Edit ID did not select the full value",
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
    key.hidden &&
      copy.textContent === "BetterDynamicGraphYu23" &&
      display.querySelector(".csl-entry")?.textContent.includes("Yu"),
    "Metadata is not compact by default",
  );
  pointer(copy);
  await wait(
    () =>
      Zotero.Utilities.Internal.getClipboard("text/plain") ===
      "[[BetterDynamicGraphYu23]]",
    "Clicking the ID did not copy its reference",
  );
  assert(key.hidden, "Copy entered edit mode");
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
  assert(await editor.save(false), "Initial native editor did not settle");
  const originalHTML = (
    await Zotero.Items.getAsync(editor.eval("nativeNoteID"))
  ).getNote();
  edit();
  type("CancelledID");
  press("Escape");
  assert(
    key.hidden && copy.textContent === "BetterDynamicGraphYu23",
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
    () => key.hidden && copy.textContent === longID,
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
      for (const width of [1200, 700]) {
        main.resizeTo(width, 850);
        await pause(200);
        const sourceRect = display.getBoundingClientRect(),
          copyRect = copy.getBoundingClientRect();
        const sourceLabel = $("src-label").getBoundingClientRect(),
          keyLabel = $("key-label").getBoundingClientRect();
        assert(
          Math.abs(sourceRect.left - copyRect.left) < 1 &&
            Math.abs(sourceLabel.left - keyLabel.left) < 1,
          "Metadata columns are misaligned",
        );
        assert(
          Math.abs(copyRect.top - keyLabel.top) < 2,
          "ID label and value are not vertically aligned",
        );
        assert(
          copy.scrollWidth <= copy.clientWidth + 1 &&
            copy.scrollHeight <= copy.clientHeight + 1 &&
            copyRect.right <= editor.innerWidth &&
            sourceRect.right <= editor.innerWidth,
          "Long metadata is clipped",
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
          Math.abs(
            rect.left +
              parseFloat(style.borderLeftWidth) +
              parseFloat(style.paddingLeft) -
              copyRect.left,
          ) < 1,
          "Editing shifts the ID text column",
        );
        assert(
          key.scrollWidth <= key.clientWidth + 1 &&
            key.scrollHeight <= key.clientHeight + 1,
          "Edit field clips a long ID",
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
