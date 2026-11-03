/** Classification and installed-format adoption, using disposable Zotero data. */
export default async function noteTypesHost({
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
  const wait = async (read, message) => {
    for (let i = 0; i < 300; i++) {
      const value = await read();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const restart = await IOUtils.exists(marker);
  for (const [id, body, type, source] of [
    ["legacy-reading", "Original reading body", "literature", 1],
    ["legacy-thinking", "Original thinking body", "thinking", 0],
    ["legacy-zettel", "Original idea body", "zettel", 0],
    ["legacy-ordinary", "Original unclassified body", "entity", 0],
  ]) {
    const card = await api.getZettel(id);
    assert(
      card?.note_type === type &&
        card.body === body &&
        card.source_note === source,
      "Type adoption changed a note or lost its classification: " + id,
    );
    const native = await api.acquireNativeNote({
      id,
      title: card.title,
      body: card.body,
    });
    const tags = await api.getOwnNoteTags(native.noteID, id);
    const expected =
      id === "legacy-reading"
        ? ["Existing tag", "Literature Note"]
        : id === "legacy-thinking"
          ? ["Thinking Note", "Topic retained"]
          : id === "legacy-zettel"
            ? ["Zettel"]
            : [];
    assert(
      JSON.stringify(tags) === JSON.stringify(expected),
      "Original tags changed: " + id,
    );
    await api.releaseNativeNote(native.noteID);
  }
  assert(
    (await api.getFamily("legacy-thinking")).parent?.id === "legacy-reading" &&
      (await api.resolveCardLink("knowledge-base://card/OldAlias")).targetId ===
        "legacy-thinking" &&
      (await api.getOutgoing("legacy-thinking"))[0]?.targetId ===
        "legacy-reading",
    "Type adoption lost a parent, alias or link",
  );
  const main = Zotero.getMainWindow();
  main.resizeTo(1250, 850);
  let manager;
  const open = async (id) => {
    api.openEditor({ zettelId: id });
    manager = await wait(
      () =>
        main.document.querySelector(".knowledge-base-workbench")?.contentWindow,
      "Workbench did not open",
    );
    const editor = await wait(() => {
      const editor = manager.document.getElementById(
        "knowledge-base-workbench-editor",
      )?.contentWindow;
      return (
        editor?.knowledgeBaseCardId === id &&
        editor.knowledgeBaseReady &&
        editor
      );
    }, "Note editor did not open");
    await editor.knowledgeBaseReady();
    await pause(150);
    await editor.eval("richEditor.flush()");
    assert(await editor.save(false), "Initial editor state did not settle");
    return editor;
  };
  const snapshot = async (name) => {
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
  if (restart) {
    const state = JSON.parse(await IOUtils.readUTF8(marker));
    for (const fixture of state.originals) {
      const native = await Zotero.Items.getAsync(fixture.id);
      const cardID = await api.ensureManagedNote(fixture.id);
      assert(
        native.getNote() === fixture.html &&
          native.parentItemID === fixture.parent &&
          cardID === fixture.cardID &&
          (await api.getZettel(cardID)).note_type === "entity",
        "Restart changed an automatically discovered original or created a duplicate",
      );
    }
    const card = await api.getZettel(state.id);
    assert(
      card.note_type === "entity" &&
        card.reference === "LEVIR" &&
        card.body === state.body &&
        (await api.getFamily(card.id)).parent?.id === "legacy-thinking",
      "Entity metadata or original identity changed after restart",
    );
    const editor = await open(state.id);
    assert(
      editor.document.getElementById("knowledge-base-note-type").value ===
        "entity",
      "Restart did not restore the selected type",
    );
    assert(
      !(await api.getOwnNoteTags(editor.eval("nativeNoteID"), state.id)).length,
      "Type switching created a native classification tag",
    );
    const cleared = await api.getZettel(state.cleared);
    assert(
      cleared.note_type === "entity",
      "An unclassified note acquired a default type after restart",
    );
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
    return;
  }
  const originals = Zotero.__knowledgeBaseDiscoveryFixtures;
  await wait(
    async () =>
      (await api.listZettels()).filter(
        (note) => note.title === "Native discovery fixture",
      ).length === 2,
    "Startup did not automatically discover every original note",
  );
  for (const fixture of originals) {
    const ids = await Promise.all([
      api.ensureManagedNote(fixture.id),
      api.ensureManagedNote(fixture.id),
    ]);
    fixture.cardID = ids[0];
    const card = await api.getZettel(ids[0]);
    const native = await Zotero.Items.getAsync(fixture.id);
    assert(
      ids[0] === ids[1] &&
        card.note_type === "entity" &&
        card.item_key === fixture.source &&
        native.getNote() === fixture.html &&
        native.parentItemID === fixture.parent &&
        JSON.stringify(await api.getOwnNoteTags(native.id, card.id)) ===
          '["Original topic"]',
      "Discovery changed an original, duplicated its mapping, or lost its source",
    );
  }
  const pane = main.ZoteroPane;
  const live = new Zotero.Item("note");
  live.libraryID = Zotero.Libraries.userLibraryID;
  live.parentItemID = originals[0].parent;
  live.setNote(
    '<div data-schema-version="9"><h1>Live discovery</h1><p>New native note.</p></div>',
  );
  await live.saveTx({ skipSelect: true });
  const liveCard = await wait(
    async () =>
      (await api.listZettels()).find((note) => note.title === "Live discovery"),
    "A newly created native note was not discovered automatically",
  );
  assert(
    liveCard.note_type === "entity" &&
      liveCard.item_key === originals[0].source,
    "Live discovery lost the default type or parent source",
  );
  live.parentItemID = false;
  live.setNote(
    '<div data-schema-version="9"><h1>Live discovery</h1><p>Edited in Zotero.</p></div>',
  );
  await live.saveTx({ skipSelect: true });
  await wait(async () => {
    const card = await api.getZettel(liveCard.id);
    return card.item_key === null && card.body.includes("Edited in Zotero.");
  }, "Native edits or a changed parent did not refresh the existing note mapping");
  originals.push({
    id: live.id,
    key: live.key,
    parent: false,
    source: null,
    html: live.getNote(),
    cardID: liveCard.id,
  });
  const nativeViewNote = pane.viewNote;
  const selectedItems = pane.getSelectedItems;
  const original = await Zotero.Items.getAsync(originals[0].id);
  pane.getSelectedItems = () => [original];
  const popup = main.document.getElementById("zotero-itemmenu");
  popup.dispatchEvent(new main.Event("popupshowing", { bubbles: true }));
  const openNote = main.document.getElementById(
    "knowledge-base-itemmenu-open-note",
  );
  assert(
    !openNote.hidden && openNote.getAttribute("label"),
    "Native-note context action is hidden or unnamed",
  );
  openNote.dispatchEvent(new main.Event("command"));
  await wait(() => {
    manager = main.document.querySelector(
      ".knowledge-base-workbench",
    )?.contentWindow;
    return (
      manager?.document.getElementById("knowledge-base-workbench-editor")
        ?.contentWindow?.knowledgeBaseCardId === originals[0].cardID
    );
  }, "Context action did not open the original note in Knowledge Base");
  pane.getSelectedItems = selectedItems;
  const originalEditor = manager.document.getElementById(
    "knowledge-base-workbench-editor",
  ).contentWindow;
  await originalEditor.knowledgeBaseReady();
  assert(
    originalEditor.document
      .getElementById("knowledge-base-rich-frame")
      .getCurrentInstance()._item.id === originals[0].id &&
      pane.viewNote === nativeViewNote,
    "Context action replaced the original or patched native double-click behavior",
  );
  assert(await originalEditor.save(false), "Original note did not settle");
  await snapshot("native-note-context-open");
  const paper = new Zotero.Item("journalArticle");
  paper.libraryID = Zotero.Libraries.userLibraryID;
  paper.setField("title", "Dataset evaluation paper");
  await paper.saveTx();
  const literature = await api.ensureLiteratureNote(paper.key, paper.libraryID);
  const source = await api.getZettel(literature);
  assert(
    source.note_type === "literature",
    "A dedicated literature action did not set its type",
  );
  const nativeSource = await api.acquireNativeNote({
    id: literature,
    title: source.title,
    body: source.body,
  });
  assert(
    !(await api.getOwnNoteTags(nativeSource.noteID, literature)).length,
    "Creating a Literature Note added a default tag",
  );
  await api.releaseNativeNote(nativeSource.noteID);
  const cleared = await api.saveZettel({
    title: "Still unclassified",
    body: "Keep this note unclassified.",
  });
  const id = await api.saveZettel({
    title: "LEVIR dataset",
    body: "A dataset record [[OldProject]].",
    customKey: "LEVIR",
    parentId: "legacy-thinking",
  });
  assert(
    (await api.getZettel(id)).note_type === "entity",
    "A new note did not default to Entity",
  );
  const editor = await open(id);
  const select = editor.document.getElementById("knowledge-base-note-type");
  assert(
    select.value === "entity" &&
      !select.disabled &&
      [...select.options].map((option) => option.value).join() ===
        "literature,zettel,thinking,entity",
    "Type control does not offer the four note types",
  );
  assert(
    select.getBoundingClientRect().width > 35 &&
      select.getBoundingClientRect().height > 15 &&
      select.getAttribute("aria-label"),
    "Type control is hidden or unnamed",
  );
  await snapshot("note-type-unclassified");
  for (const mode of ["visual", "source"]) {
    await editor.setEditorMode(mode, false);
    assert(await editor.save(false), "Editor mode did not settle");
    const before = await api.getZettel(id);
    const native = await Zotero.Items.getAsync(editor.eval("nativeNoteID"));
    const originalHTML = native.getNote();
    for (const type of [
      "entity",
      "zettel",
      "thinking",
      "literature",
      "entity",
    ]) {
      select.value = type;
      select.dispatchEvent(new editor.Event("change", { bubbles: true }));
      assert(
        await editor.save(false),
        "Type change could not be saved in " + mode,
      );
      const card = await api.getZettel(id);
      assert(
        card.note_type === type &&
          card.body === before.body &&
          card.reference === "LEVIR" &&
          card.item_key === before.item_key &&
          card.source_note === before.source_note &&
          native.getNote() === originalHTML &&
          (await api.getFamily(id)).parent?.id === "legacy-thinking" &&
          (await api.getOutgoing(id))[0]?.targetId === "legacy-thinking",
        "Type change modified content, source, aliases, native HTML or relationships: " +
          mode +
          "/" +
          type +
          JSON.stringify({
            before,
            card,
            htmlUnchanged: native.getNote() === originalHTML,
            family: await api.getFamily(id),
            outgoing: await api.getOutgoing(id),
          }),
      );
      assert(
        !(await api.getOwnNoteTags(native.id, id)).length,
        "Changing type created a native tag",
      );
    }
    await snapshot("note-type-entity-" + mode);
  }
  await manager.changeView("entity");
  await wait(
    () =>
      [...manager.document.querySelectorAll(".zettel-row")].some(
        (row) => row.dataset.id === id,
      ),
    "Entity filter did not include the new Entity",
  );
  assert(
    !manager.document.querySelector('[data-note-view="note"]') &&
      manager.document.querySelectorAll(
        "#knowledge-base-views [data-note-view]",
      ).length === 5,
    "The removed Note filter returned or a type is missing",
  );
  await snapshot("note-type-entity-filter");
  for (const fixture of originals) {
    const native = await Zotero.Items.getAsync(fixture.id);
    assert(
      JSON.stringify(api.projectNativeNote(native.getNote())) ===
        JSON.stringify(api.projectNativeNote(fixture.html)),
      "Opening an original changed its document content",
    );
    fixture.html = native.getNote();
  }
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      id,
      cleared,
      originals,
      body: (await api.getZettel(id)).body,
    }),
  );
  Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
}
