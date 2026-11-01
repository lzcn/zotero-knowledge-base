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
  const kb = Zotero.ZoteroKnowledgeBase;
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
      (await kb.api.getZettel(saved.id)).body === saved.body,
      "Saved close-time edits changed after restart",
    );
    assert(
      (await kb.api.listEditorDrafts()).some(
        (draft) =>
          draft.draftId === saved.draftId &&
          draft.body.includes("Keep this close draft"),
      ),
      "Close-time draft was lost after restart",
    );
    await kb.hooks.onShutdown();
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
    if (id) kb.api.openEditor({ zettelId: id });
    else kb.api.openManager();
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
  kb.api.openManager();
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
  assert(manager() && !main.closed, "The KB shortcut intercepted another tab");
  tabs.select(workbenchID);
  press(main);
  await closed();
  assert(!main.closed, "Closing KB closed the library window");
  const id = await kb.api.saveZettel({
    title: "Close shortcut",
    body: "Original body",
  });
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
      "Close shortcut did not ask about unsaved work",
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
  let draftId;
  try {
    let { view, editor } = await open(id);
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
    append(editor, "Save this close edit");
    await closeWith("accept");
    await closed();
    assert(
      (await kb.api.getZettel(id)).body.includes("Save this close edit"),
      "Save and close lost the latest source text",
    );
    ({ view, editor } = await open(id));
    await editor.setEditorMode("source");
    const beforeDraft = (await kb.api.getZettel(id)).body;
    append(editor, "Keep this close draft");
    draftId = editor.knowledgeBaseDraftId;
    await closeWith("extra1");
    await closed();
    assert(
      (await kb.api.getZettel(id)).body === beforeDraft,
      "Keep draft committed the unsaved edit",
    );
    await wait(
      async () =>
        (await kb.api.listEditorDrafts()).some(
          (draft) =>
            draft.draftId === draftId &&
            draft.body.includes("Keep this close draft"),
        ),
      "Keep draft did not retain the latest text",
    );
    ({ view, editor } = await open(id));
    await editor.setEditorMode("source");
    const pending = append(editor, "Retry after close failure");
    const save = kb.api.saveEditorCard;
    kb.api.saveEditorCard = async () => {
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
      kb.api.saveEditorCard = save;
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
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      id,
      draftId,
      body: (await kb.api.getZettel(id)).body,
    }),
  );
  quit();
}
