/** Close shortcuts and unsaved work, exercised in a disposable Zotero profile. */
export default async function workbenchHost({
  Zotero,
  IOUtils,
  Services,
  Components,
  setTimeout,
  marker,
  restartMarker,
}) {
  const knowledgeBase = Zotero.ZoteroKnowledgeBase;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (check, message) => {
    for (let n = 0; n < 200; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    assert(
      knowledgeBase.api.getNoteEditorMode() === saved.editorMode,
      "Restart lost the selected editor mode",
    );
    assert(
      (await knowledgeBase.api.getZettel(saved.id)).body === saved.body,
      "Saved close-time edits changed after restart",
    );
    assert(
      (await knowledgeBase.api.getZettel(saved.autosaveID)).body ===
        saved.autosaveBody,
      "Autosaved and recovered edits changed after restart",
    );
    const nativeSaved = await Zotero.Items.getByLibraryAndKeyAsync(
      Zotero.Libraries.userLibraryID,
      saved.nativeKey,
    );
    assert(
      nativeSaved?.getNote().includes("Native last keystroke"),
      "Native Markdown quit-time save was lost after restart",
    );
    assert(
      !("saveEditorDraft" in knowledgeBase.api) &&
        !("listEditorDrafts" in knowledgeBase.api),
      "Removed draft storage remains callable",
    );
    await knowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const main = Zotero.getMainWindow(),
    tabs = main.Zotero_Tabs;
  const manager = () =>
    main.document.querySelector(".knowledge-base-workbench")?.contentWindow;
  const open = async (id) => {
    if (id) knowledgeBase.api.openEditor({ zettelId: id });
    else knowledgeBase.api.openManager();
    const view = await wait(
      () => manager()?.document.readyState === "complete" && manager(),
      "Workbench did not open",
    );
    await wait(
      () =>
        view.document
          .getElementById("knowledge-base-list")
          .getAttribute("aria-busy") === "false",
      "Workbench list did not load",
    );
    assert(
      !view.document.getElementById("knowledge-base-drafts"),
      "The workbench still has a persistent recovery bar",
    );
    if (!id) return { view };
    const editor = await wait(() => {
      const editor = view.document.getElementById(
        "knowledge-base-workbench-editor",
      ).contentWindow;
      return (
        editor?.knowledgeBaseCardId === id &&
        editor.document.readyState === "complete" &&
        editor
      );
    }, "Workbench editor did not load");
    await editor.knowledgeBaseReady();
    assert(
      !view.document.getElementById("knowledge-base-basket") &&
        !editor.document.getElementById("knowledge-base-capture-idea") &&
        !editor.document.getElementById("knowledge-base-idea-papers") &&
        !("captureIdeaEvidence" in knowledgeBase.api) &&
        !("openIdeaPaperSearch" in knowledgeBase.api),
      "Removed capture, excerpts or cross-plugin controls remain available",
    );
    assert(
      !editor.document.getElementById("knowledge-base-editor-save") &&
        !editor.document.getElementById("knowledge-base-editor-apply-draft"),
      "Ordinary notes expose a manual Save action",
    );
    return { view, editor };
  };
  const press = (target, options = {}) => {
    const win = target.ownerDocument?.defaultView || main;
    target.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "w",
        code: "KeyW",
        metaKey: Zotero.isMac,
        ctrlKey: !Zotero.isMac,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  };
  const closed = () =>
    wait(() => !manager(), "Command-W did not close the workbench");
  await open();
  knowledgeBase.api.openManager();
  const workbenchID = tabs.selectedID;
  for (const options of [
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { shiftKey: true },
    { repeat: true },
    ...(Zotero.isMac ? [{ metaKey: false, ctrlKey: true }] : []),
  ])
    press(main, options);
  assert(
    tabs.selectedID === workbenchID && manager(),
    "A modified, repeated or composing shortcut closed the workbench",
  );
  tabs.select("zotero-pane");
  press(main);
  assert(
    manager() && !main.closed,
    "The Knowledge Base shortcut intercepted another tab",
  );
  tabs.select(workbenchID);
  press(main);
  await closed();
  assert(!main.closed, "Closing Knowledge Base closed the library window");
  const id = await knowledgeBase.api.saveZettel({
    title: "Close shortcut",
    body: "Original body",
  });
  const libraryNote = await knowledgeBase.api.acquireNativeNote({
    id,
    title: "Close shortcut",
    body: "Original body",
  });
  await knowledgeBase.api.releaseNativeNote(libraryNote.noteID);
  const originalNote = await Zotero.Items.getAsync(libraryNote.noteID);
  const personal = await Zotero.Items.getAsync(originalNote.parentItemID);
  const originalTitle = personal.getField("title");
  personal.setField("title", "My Personal Knowledge");
  await personal.saveTx();
  for (let repeat = 0; repeat < 2; repeat++) {
    knowledgeBase.api.openManager();
    const popup = tabs._openMenu(40, 60, tabs.selectedID);
    popup
      .querySelector(":scope > menuitem")
      .dispatchEvent(
        new main.Event("command", { bubbles: true, cancelable: true }),
      );
    await wait(
      () =>
        tabs.selectedID === "zotero-pane" &&
        main.ZoteroPane.getSelectedItems()[0]?.id === personal.id,
      "Show in Library selected something other than the managed Personal Knowledge item",
    );
    await wait(
      () =>
        main.ZoteroPane.itemsView.isContainerOpen(
          main.ZoteroPane.itemsView.getRowIndexByID(personal.id),
        ),
      "Show in Library did not expand the unsourced-note container",
    );
    assert(
      main.ZoteroPane.itemsView.getRowIndexByID(originalNote.id) >= 0,
      "The unsourced note is not visible under Personal Knowledge",
    );
  }
  assert(
    personal.getField("title") === "My Personal Knowledge",
    "Revealing Personal Knowledge replaced or renamed its existing container",
  );
  personal.setField("title", originalTitle);
  await personal.saveTx();
  const autosaveID = await knowledgeBase.api.saveZettel({
    title: "Automatic saving",
    body: "Original autosave body",
  });
  const searchID = await knowledgeBase.api.saveZettel({
    title: "Long search fixture",
    body:
      "Unrelated introduction.\n".repeat(400) +
      "Temporal neighborhoods preserve graph context.",
  });
  const matches =
    await knowledgeBase.api.searchZettelSummaries("context temporal");
  assert(
    matches.items.some(
      (note) =>
        note.id === searchID && note.body.includes("Temporal neighborhoods"),
    ) &&
      !(
        await knowledgeBase.api.searchZettelSummaries('"context temporal"')
      ).items.some((note) => note.id === searchID),
    "Keyword search or exact phrases lost their matching context",
  );
  const { editor: autosaveEditor } = await open(autosaveID);
  const nativeView = autosaveEditor.document
    .getElementById("knowledge-base-rich-frame")
    .getCurrentInstance()._iframeWindow.wrappedJSObject._currentEditorInstance
    ._editorCore.view;
  nativeView.dispatch(
    nativeView.state.tr.insertText(
      " Native autosave",
      nativeView.state.doc.content.size - 1,
    ),
  );
  await wait(
    async () =>
      (await knowledgeBase.api.getZettel(autosaveID)).body.includes(
        "Native autosave",
      ) && autosaveEditor.eval("!dirty && saving === null"),
    "Native editing did not save automatically",
  );
  await autosaveEditor.setEditorMode("source");
  const autoSource = autosaveEditor.document.getElementById(
    "knowledge-base-editor-body",
  );
  autoSource.value += "\n\nMarkdown autosave";
  autoSource.dispatchEvent(
    new autosaveEditor.Event("input", { bubbles: true }),
  );
  await wait(
    async () =>
      (await knowledgeBase.api.getZettel(autosaveID)).body.includes(
        "Markdown autosave",
      ) && autosaveEditor.eval("!dirty && saving === null"),
    "Markdown editing did not save automatically",
  );
  autoSource.value += "\n\nKeep the final navigation edit";
  autoSource.dispatchEvent(
    new autosaveEditor.Event("input", { bubbles: true }),
  );
  await open(id);
  assert(
    (await knowledgeBase.api.getZettel(autosaveID)).body.includes(
      "Keep the final navigation edit",
    ),
    "Switching notes lost the pending automatic save",
  );
  press(main);
  await closed();
  for (const scope of ["main", "list", "native", "source"]) {
    const { view, editor } = await open(id);
    await editor.save(false);
    let target = main;
    if (scope === "list")
      target = view.document.getElementById("knowledge-base-list");
    if (scope === "native")
      target = editor.document
        .getElementById("knowledge-base-rich-frame")
        .getCurrentInstance()
        ._iframeWindow.document.querySelector(".primary-editor");
    if (scope === "source") {
      await editor.setEditorMode("source");
      target = editor.document
        .getElementById("knowledge-base-editor-body")
        .querySelector("iframe")
        .contentDocument.querySelector(".cm-content");
    }
    target.focus?.();
    for (let count = 0; count < 2; count++) {
      press(target, {
        key: "Escape",
        code: "Escape",
        metaKey: false,
        ctrlKey: false,
      });
      await pause(100);
      assert(
        manager() && tabs.selectedID !== "zotero-pane",
        "Escape closed the workbench from " + scope,
      );
      assert(
        editor.knowledgeBaseCardId === id,
        "Escape navigated away from the note",
      );
    }
    press(target);
    await closed();
  }
  const choices = [],
    dialogs = [];
  let dialogError;
  const observer = {
    observe(win, topic) {
      if (topic !== "domwindowopened") return;
      win.addEventListener(
        "load",
        () => {
          if (
            win.document.documentURI !==
            "chrome://global/content/commonDialog.xhtml"
          )
            return;
          setTimeout(() => {
            try {
              const choice = choices.shift();
              assert(choice, "Unexpected close confirmation");
              win.document
                .getElementById("commonDialog")
                .getButton(choice)
                .click();
              dialogs.push(choice);
            } catch (error) {
              dialogError = String(error);
              win.close();
            }
          }, 100);
        },
        { once: true },
      );
    },
  };
  Services.ww.registerNotification(observer);
  const closeWith = async (choice) => {
    const count = dialogs.length;
    choices.push(choice);
    press(main);
    await wait(
      () => dialogError || dialogs.length > count,
      "Close shortcut did not ask about unsaved work: " + choice,
    );
    assert(!dialogError, dialogError);
    await pause(50);
  };
  const append = (editor, text) => {
    const source = editor.document.getElementById("knowledge-base-editor-body");
    source.setRangeText(
      "\n\n" + text,
      source.value.length,
      source.value.length,
      "end",
    );
    source.dispatchEvent(new editor.Event("input", { bubbles: true }));
    editor.eval("clearTimeout(autosaveTimer); autosaveTimer=null");
    return source;
  };
  try {
    let { view, editor } = await open(id);
    assert(await editor.save(false), "Native close fixture did not settle");
    const native = editor.document
      .getElementById("knowledge-base-rich-frame")
      .getCurrentInstance()._iframeWindow;
    const rich = native.wrappedJSObject._currentEditorInstance._editorCore.view;
    rich.dispatch(
      rich.state.tr.insertText(
        " Native pending",
        rich.state.doc.content.size - 1,
      ),
    );
    view.document.getElementById("knowledge-base-search").focus();
    await closeWith("cancel");
    assert(
      manager() && rich.state.doc.textContent.includes("Native pending"),
      "Cancel discarded an unreported native edit",
    );
    await editor.save(false);
    await editor.setEditorMode("source");
    const source = append(editor, "Save this close edit");
    press(
      source
        .querySelector("iframe")
        .contentDocument.querySelector(".cm-content"),
      {
        key: "Escape",
        code: "Escape",
        metaKey: false,
        ctrlKey: false,
      },
    );
    await pause(100);
    assert(
      !dialogError &&
        manager() &&
        editor.eval("dirty") &&
        source.value.includes("Save this close edit"),
      "Escape prompted to close or discarded an unsaved source edit",
    );
    await closeWith("accept");
    await closed();
    assert(
      (await knowledgeBase.api.getZettel(id)).body.includes(
        "Save this close edit",
      ),
      "Save and close lost the latest source text",
    );
    ({ view, editor } = await open(id));
    await editor.setEditorMode("source");
    const beforeDraft = (await knowledgeBase.api.getZettel(id)).body;
    append(editor, "Discard this close edit");
    await closeWith("extra1");
    await closed();
    assert(
      (await knowledgeBase.api.getZettel(id)).body === beforeDraft,
      "Discard committed the unsaved edit",
    );
    ({ view, editor } = await open(id));
    await editor.setEditorMode("source");
    const pending = append(editor, "Retry after close failure");
    const save = knowledgeBase.api.saveEditorCard;
    knowledgeBase.api.saveEditorCard = async () => {
      throw new Error("CARD_CONFLICT");
    };
    try {
      await closeWith("accept");
      await wait(
        () => editor.eval("saving === null && dirty && !closing"),
        "Failed save did not release close state",
      );
      assert(
        manager() && pending.value.includes("Retry after close failure"),
        "A failed close-time save discarded the editor",
      );
    } finally {
      knowledgeBase.api.saveEditorCard = save;
    }
    assert(
      await editor.save(false),
      "Close-time save did not recover after retry",
    );
    press(view.document.getElementById("knowledge-base-search"));
    await closed();
    assert(
      dialogs.join() === "cancel,accept,extra1,accept",
      "A shortcut showed duplicate close confirmations",
    );
  } finally {
    Services.ww.unregisterNotification(observer);
  }
  const standaloneID = await knowledgeBase.api.saveZettel({
    title: "Standalone escape",
    body: "Keep this note open.",
  });
  for (const mode of ["source", "visual"]) {
    knowledgeBase.api.openEditor({ zettelId: standaloneID, window: true });
    const standalone = await wait(
      () => Services.wm.getMostRecentWindow("knowledge-base:editor"),
      "Standalone note did not open",
    );
    await wait(
      () => standalone.knowledgeBaseReady,
      "Standalone editor did not load",
    );
    await standalone.knowledgeBaseReady();
    await standalone.setEditorMode(mode);
    await standalone.save(false);
    const target =
      mode === "source"
        ? standalone.document
            .getElementById("knowledge-base-editor-body")
            .querySelector("iframe")
            .contentDocument.querySelector(".cm-content")
        : standalone.document
            .getElementById("knowledge-base-rich-frame")
            .getCurrentInstance()
            ._iframeWindow.document.querySelector(".primary-editor");
    target.focus();
    press(target, {
      key: "Escape",
      code: "Escape",
      metaKey: false,
      ctrlKey: false,
    });
    await pause(100);
    assert(!standalone.closed, "Escape closed a standalone " + mode + " note");
    press(standalone);
    await wait(
      () => standalone.closed,
      "Command-W did not close the standalone note",
    );
  }
  const mode = (editor) =>
    editor.document.getElementById("knowledge-base-editor-root").dataset.mode;
  const toggleMode = async (editor, next) => {
    const frame = editor.document
      .getElementById("knowledge-base-rich-frame")
      .getCurrentInstance()._iframeWindow;
    assert(
      !frame.document.querySelector(
        ".knowledge-base-reading-toggle,.knowledge-base-reading-view",
      ),
      "Browsing mode is still exposed",
    );
    frame.document.querySelector(".knowledge-base-markdown-toggle").click();
    await wait(
      () =>
        mode(editor) === next && knowledgeBase.api.getNoteEditorMode() === next,
      "Toolbar did not retain the selected mode: " + next,
    );
  };
  let opened = await open(id);
  await toggleMode(opened.editor, "source");
  await opened.editor.save(false);
  opened = await open(standaloneID);
  assert(
    mode(opened.editor) === "source",
    "Switching notes left Markdown mode",
  );
  press(main);
  await closed();
  opened = await open(id);
  assert(
    mode(opened.editor) === "source",
    "Reopening the workbench left Markdown mode",
  );
  await toggleMode(opened.editor, "visual");
  await opened.editor.save(false);
  opened = await open(standaloneID);
  assert(mode(opened.editor) === "visual", "Switching notes left native mode");
  await toggleMode(opened.editor, "source");
  await opened.editor.save(false);
  press(main);
  await closed();
  await knowledgeBase.api.setNativeNoteTakeover(false);
  const native = new Zotero.Item("note");
  native.libraryID = Zotero.Libraries.userLibraryID;
  native.setNote(
    '<div data-schema-version="2"><h1>Native direct save</h1><p>Initial text</p></div>',
  );
  await native.saveTx({ skipSelect: true });
  const instance = await Zotero.Notes.open(native.id, null, {
    openInWindow: true,
  });
  const nativeWindow =
    instance._iframeWindow.browsingContext.embedderElement.ownerDocument
      .defaultView;
  const toggle = await wait(
    () =>
      instance._iframeWindow.document.querySelector(
        ".knowledge-base-markdown-toggle",
      ),
    "Native Markdown toggle did not load",
  );
  toggle.click();
  const nativeSource = await wait(() => {
    const source = nativeWindow.document.querySelector(
      ".knowledge-base-native-source",
    );
    return source?.setSelectionRange && !source.hidden && source;
  }, "Native Markdown source did not open");
  nativeSource.value =
    nativeSource.value.replace(
      "# Native direct save",
      "Native direct save\n==================",
    ) + "\n\nNative autosave text";
  const authorSource = nativeSource.value;
  nativeSource.dispatchEvent(new nativeWindow.Event("input"));
  await wait(
    () => native.getNote().includes("Native autosave text"),
    "Native Markdown did not save directly to Zotero",
  );
  await pause(150);
  assert(
    nativeSource.value === authorSource,
    "Autosave reformatted author Markdown",
  );
  opened = await open(autosaveID);
  await opened.editor.setEditorMode("source");
  append(opened.editor, "Saved directly when quitting");
  nativeSource.value += "\n\nNative last keystroke";
  nativeSource.dispatchEvent(new nativeWindow.Event("input"));
  const autosaveBody = opened.editor.eval("snapshot().body");
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      id,
      autosaveID,
      autosaveBody,
      nativeKey: native.key,
      body: (await knowledgeBase.api.getZettel(id)).body,
      editorMode: knowledgeBase.api.getNoteEditorMode(),
    }),
  );
  quit();
}
