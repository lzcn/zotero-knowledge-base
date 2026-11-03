/** Note category controls, exercised only with disposable Zotero data. */
export default async function viewsHost({
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
  const api = Zotero.ZoteroKnowledgeBase.api;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (check, message) => {
    for (let n = 0; n < 400; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const main = Zotero.getMainWindow();
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  let manager;
  const open = async () => {
    api.openManager();
    manager = await wait(
      () =>
        main.document.querySelector(".knowledge-base-workbench")?.contentWindow
          ?.ZoteroKnowledgeBase_selectZettel &&
        main.document.querySelector(".knowledge-base-workbench").contentWindow,
      "Views workbench did not load",
    );
    await wait(
      () =>
        manager.document
          .getElementById("knowledge-base-list")
          .getAttribute("aria-busy") === "false",
      "Note list did not settle",
    );
    const editor = await wait(() => {
      const editor = manager.document.getElementById(
        "knowledge-base-workbench-editor",
      ).contentWindow;
      return editor?.knowledgeBaseReady && editor.knowledgeBaseCardId && editor;
    }, "Initial note did not load");
    await editor.knowledgeBaseReady();
    assert(await editor.save(false), "Initial note did not settle");
  };
  const rows = () =>
    [...manager.document.querySelectorAll(".zettel-row")]
      .map((row) => row.dataset.id)
      .sort();
  const expectRows = async (ids) =>
    wait(
      () => JSON.stringify(rows()) === JSON.stringify([...ids].sort()),
      "View returned the wrong notes: " + ids.join(","),
    );
  const control = (view) =>
    manager.document.querySelector('[data-note-view="' + view + '"]');
  const choose = async (view, ids) => {
    const button = control(view),
      rect = button.getBoundingClientRect();
    assert(
      rect.width >= 26 && rect.height >= 26,
      "View icon has no pointer target",
    );
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    const hit = manager.document.elementFromPoint(x, y);
    assert(button === hit || button.contains(hit), "View icon is covered");
    const host = manager.browsingContext.embedderElement;
    const offset = host.getBoundingClientRect();
    for (const type of ["mousedown", "mouseup"])
      host.ownerDocument.defaultView.windowUtils.sendMouseEvent(
        type,
        offset.x + x,
        offset.y + y,
        0,
        1,
        0,
      );
    await wait(
      () => button.getAttribute("aria-pressed") === "true",
      "View click did not activate " + view,
    );
    await expectRows(ids);
    if (ids.length && view !== "trash") {
      const editor = await wait(() => {
        const editor = manager.document.getElementById(
          "knowledge-base-workbench-editor",
        ).contentWindow;
        return (
          ids.includes(editor?.knowledgeBaseCardId) &&
          editor.knowledgeBaseReady &&
          editor
        );
      }, "Filtered note did not open");
      await editor.knowledgeBaseReady();
      assert(await editor.save(false), "Filtered note did not settle");
    }
  };
  const shot = async (name) => {
    if (!screenshots) return;
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
    const bitmap = await main.browsingContext.currentWindowGlobal.drawSnapshot(
      undefined,
      1,
      "white",
    );
    const canvas = main.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    await IOUtils.write(
      PathUtils.join(screenshots, name + ".png"),
      new Uint8Array(await blob.arrayBuffer()),
    );
  };
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    await open();
    assert(
      control("all").getAttribute("aria-pressed") === "true",
      "Restart did not default to All",
    );
    await expectRows(saved.active);
    assert(
      (await api.getZettel(saved.thinking)).body === "A thinking note.",
      "View changes altered note content",
    );
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const literature = await api.saveZettel({
    title: "View Fixture Literature",
    body: "A literature note.",
    noteType: "literature",
  });
  const zettel = await api.saveZettel({
    title: "View Fixture Zettel",
    body: "A related claim.",
    noteType: "zettel",
    parentId: literature,
  });
  const thinking = await api.saveZettel({
    title: "View Fixture Thinking",
    body: "A thinking note.",
    noteType: "thinking",
  });
  const plain = await api.saveZettel({
    title: "View Fixture Untagged",
    body: "Keep an unclassified note.",
  });
  const entity = await api.saveZettel({
    noteType: "entity",
    title: "LEVIR dataset",
    body: "A dataset record.",
  });
  const active = [literature, zettel, thinking, plain, entity];
  main.resizeTo(1200, 850);
  await open();
  await expectRows(active);
  assert(
    control("all").getAttribute("aria-pressed") === "true",
    "All is not selected by default",
  );
  assert(
    manager.document.querySelectorAll("#knowledge-base-views [data-note-view]")
      .length === 6 &&
      !manager.document
        .getElementById("knowledge-base-views")
        .contains(control("trash")),
    "Trash is not separate from All and the five types",
  );
  const before = [...manager.document.querySelectorAll("[data-note-view]")].map(
    (button) => button.getBoundingClientRect().x,
  );
  await shot("all");
  await choose("note", [plain]);
  await shot("note");
  await choose("literature", [literature]);
  await shot("literature");
  await choose("zettel", [zettel]);
  await shot("zettel");
  await choose("entity", [entity]);
  await shot("entity");
  await choose("thinking", [thinking]);
  await shot("thinking");
  const thinkingEditor = manager.document.getElementById(
    "knowledge-base-workbench-editor",
  ).contentWindow;
  const noteID = thinkingEditor.document
    .getElementById("knowledge-base-rich-frame")
    .getCurrentInstance()._item.id;
  await api.setNoteTag(noteID, thinking, "Thinking Note", false);
  await expectRows([thinking]);
  await api.setNoteTag(noteID, thinking, "Thinking Note", true);
  await expectRows([thinking]);
  const previous = await api.getZettel(thinking);
  await api.saveZettel({
    id: thinking,
    noteType: "entity",
    title: previous.title,
    body: previous.body,
  });
  await expectRows([]);
  await api.saveZettel({
    id: thinking,
    noteType: "thinking",
    title: previous.title,
    body: previous.body,
  });
  await expectRows([thinking]);
  const search = manager.document.getElementById("knowledge-base-search");
  search.value = "does not match";
  search.dispatchEvent(new manager.Event("input", { bubbles: true }));
  await expectRows([]);
  search.value = "";
  search.dispatchEvent(new manager.Event("input", { bubbles: true }));
  await expectRows([thinking]);
  await choose("all", active);
  await api.deleteZettel(thinking);
  await choose("trash", [thinking]);
  const after = [...manager.document.querySelectorAll("[data-note-view]")].map(
    (button) => button.getBoundingClientRect().x,
  );
  assert(
    before.every((x, i) => Math.abs(x - after[i]) < 1),
    "View changes shift the toolbar",
  );
  assert(
    manager.getComputedStyle(control("trash")).listStyleImage !==
      manager.getComputedStyle(
        manager.document.getElementById("knowledge-base-btn-delete"),
      ).listStyleImage,
    "Trash and Delete use the same icon",
  );
  for (const bear of [false, true]) {
    Zotero.Prefs.set("extensions.zotero.plugin-ui.bear", bear, true);
    for (const width of [1200, 700]) {
      main.resizeTo(width, 850);
      await pause(150);
      for (const button of manager.document.querySelectorAll(
        "[data-note-view]",
      )) {
        const rect = button.getBoundingClientRect();
        assert(
          rect.right <= manager.innerWidth &&
            rect.width >= 26 &&
            rect.height >= 26 &&
            button.getAttribute("aria-label") &&
            manager.getComputedStyle(button).listStyleImage !== "none",
          "A view icon is clipped or unnamed",
        );
      }
      await shot((bear ? "bear" : "minimal") + "-" + width);
    }
  }
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      active: [literature, zettel, plain, entity],
      thinking,
    }),
  );
  quit();
}
