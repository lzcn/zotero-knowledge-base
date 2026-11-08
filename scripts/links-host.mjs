/** Bidirectional linking in disposable native and Markdown note editors. */
export default async function linksHost({
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
    for (let n = 0; n < 300; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  const shot = async (win, name) => {
    if (!screenshots) return;
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
    await pause(100);
    const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(
      undefined,
      1,
      "white",
    );
    const canvas = win.document.createElementNS(
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
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    const note = await Zotero.Items.getAsync(saved.noteID);
    assert(note.getNote() === saved.html, "Restart changed the saved links");
    assert(
      (await api.getBacklinks(saved.primaryID)).filter(
        (link) => link.sourceId === saved.sourceID,
      ).length === 1,
      "Restart lost grouped backlinks",
    );
    assert(
      (await api.resolveCardLink(saved.href))?.targetId === saved.primaryID,
      "Renaming broke the stable link",
    );
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const create = async (customKey, title, body) => {
    const id = await api.saveZettel({ customKey, title, body });
    const native = await api.acquireNativeNote({ id, title, body });
    await api.releaseNativeNote(native.noteID);
    return { id, noteID: native.noteID };
  };
  const primary = await create("LinkPrimary", "Token pruning", "Target idea.");
  await create(
    "LinkSecondary",
    "Token pruning",
    "A different idea with the same title.",
  );
  const source = await create(
    "LinkSource",
    "Reading synthesis",
    "Why this matters.\n\nA useful connection.",
  );
  const open = async (id) => {
    api.openEditor({ window: true, zettelId: id });
    const win = await wait(
      () =>
        [...Services.wm.getEnumerator("knowledge-base:editor")].find(
          (win) => win.knowledgeBaseCardId === id,
        ),
      "Editor did not open",
    );
    await win.knowledgeBaseReady();
    win.resizeTo(850, 720);
    return win;
  };
  const editor = await open(source.id);
  const frame = editor.document
    .getElementById("knowledge-base-rich-frame")
    .getCurrentInstance()._iframeWindow;
  Zotero.Utilities.Internal.activate();
  editor.focus();
  await pause(300);
  frame.focus();
  const surface = frame.document.querySelector(".primary-editor");
  surface.focus();
  const range = frame.document.createRange();
  range.selectNodeContents(surface.lastElementChild);
  range.collapse(false);
  frame.getSelection().removeAllRanges();
  frame.getSelection().addRange(range);
  await pause(50);
  const input = Components.classes[
    "@mozilla.org/text-input-processor;1"
  ].createInstance(Components.interfaces.nsITextInputProcessor);
  assert(
    input.beginInputTransactionForTests(frame, null),
    "Cannot type in the native note",
  );
  const key = (key) => {
    const event = (type) =>
      new frame.KeyboardEvent(
        type,
        Components.utils.cloneInto({ key, code: key }, frame),
      );
    input.keydown(event("keydown"));
    input.keyup(event("keyup"));
  };
  const popup = editor.document.getElementById("knowledge-base-link-drop");
  const rows = () => [
    ...editor.document.querySelectorAll("#knowledge-base-link-results li"),
  ];
  const workspace = editor.document.getElementById(
    "knowledge-base-editor-workspace",
  );
  const before = workspace.getBoundingClientRect();
  input.commitCompositionWith(" [[Link");
  await wait(
    () => !popup.hidden && rows().length === 2,
    "Native brackets did not search notes",
  );
  const after = workspace.getBoundingClientRect(),
    bounds = popup.getBoundingClientRect();
  assert(
    Math.abs(before.top - after.top) < 1 &&
      Math.abs(before.height - after.height) < 1,
    "Suggestions moved the writing surface",
  );
  assert(
    editor.getComputedStyle(popup).position === "fixed" &&
      bounds.width >= 200 &&
      bounds.right <= editor.innerWidth &&
      bounds.bottom <= editor.innerHeight,
    "Suggestions overflow the editor",
  );
  assert(
    editor.document.getElementById("knowledge-base-link-search").hidden,
    "Inline suggestions repeat the search field",
  );
  const primaryIndex = rows().findIndex((row) =>
    row.textContent.includes("LinkPrimary"),
  );
  assert(primaryIndex >= 0, "Duplicate titles lost their stable references");
  for (let n = 0; n < primaryIndex; n++) key("ArrowDown");
  assert(
    rows()[primaryIndex].getAttribute("aria-selected") === "true" &&
      surface.contains(frame.document.activeElement),
    "Arrows stole focus from writing",
  );
  await shot(editor, "link-suggestions");
  key("Enter");
  const link = await wait(
    () =>
      [...surface.querySelectorAll("a")].find(
        (link) => link.title === "[[LinkPrimary]]",
      ),
    "Enter did not insert the selected link",
  );
  const href = link.getAttribute("href");
  assert(
    frame.wrappedJSObject.doUndo(),
    "Native link insertion cannot be undone",
  );
  await wait(
    () => !surface.querySelector('a[title="[[LinkPrimary]]"]'),
    "Undo retained the completed link",
  );
  assert(
    frame.wrappedJSObject.doRedo(),
    "Native link insertion cannot be redone",
  );
  await wait(
    () => surface.querySelector('a[title="[[LinkPrimary]]"]'),
    "Redo lost the completed link",
  );
  const pasteRange = frame.document.createRange();
  pasteRange.selectNodeContents(surface.lastElementChild);
  pasteRange.collapse(false);
  frame.getSelection().removeAllRanges();
  frame.getSelection().addRange(pasteRange);
  surface.focus();
  await pause(50);
  frame.document.execCommand("insertParagraph");
  await pause(100);
  const pasteEvent = new frame.ClipboardEvent(
    "paste",
    Components.utils.cloneInto(
      {
        bubbles: true,
        cancelable: true,
        dataType: "text/plain",
        data: "[[LinkPrimary]]",
      },
      frame,
    ),
  );
  assert(
    pasteEvent.clipboardData?.getData("text/plain") === "[[LinkPrimary]]",
    "Paste fixture lost its plain reference",
  );
  surface.dispatchEvent(pasteEvent);
  await wait(
    () => surface.querySelectorAll('a[title="[[LinkPrimary]]"]').length === 2,
    "A pasted reference did not become a native link",
  ).catch((error) => {
    throw new Error(
      String(error) +
        " " +
        JSON.stringify({
          prevented: pasteEvent.defaultPrevented,
          html: surface.innerHTML,
          selection:
            frame.wrappedJSObject._currentEditorInstance._editorCore.view.state.selection.toJSON(),
        }),
    );
  });
  surface.focus();
  const selectedText = surface.querySelector("p").firstChild;
  const proseRange = frame.document.createRange();
  proseRange.setStart(selectedText, 0);
  proseRange.setEnd(selectedText, 3);
  frame.getSelection().removeAllRanges();
  frame.getSelection().addRange(proseRange);
  await pause(50);
  frame.document.querySelector(".knowledge-base-note-link").click();
  await wait(
    () =>
      !popup.hidden &&
      rows().some((row) => row.textContent.includes("LinkPrimary")),
    "The note link button did not search notes",
  );
  rows()
    .find((row) => row.textContent.includes("LinkPrimary"))
    .click();
  await wait(
    () =>
      surface.querySelector('a[title="[[LinkPrimary|Why]]"]')?.textContent ===
      "Why",
    "A selected native phrase was not preserved as the link label",
  );
  await editor.setEditorMode("source");
  const body = editor.document.getElementById("knowledge-base-editor-body");
  body.value += "\n\nContext for [[Link|my own wording";
  body.setSelectionRange(body.value.length, body.value.length);
  body.dispatchEvent(new editor.Event("input", { bubbles: true }));
  await wait(
    () => !popup.hidden && rows().length === 2,
    "Alias text was included in the search query",
  );
  const option = rows().find((row) => row.textContent.includes("LinkPrimary")),
    optionRect = option.getBoundingClientRect();
  editor.windowUtils.sendMouseEvent(
    "mousedown",
    optionRect.left + 20,
    optionRect.top + optionRect.height / 2,
    0,
    1,
    0,
  );
  editor.windowUtils.sendMouseEvent(
    "mouseup",
    optionRect.left + 20,
    optionRect.top + optionRect.height / 2,
    0,
    1,
    0,
  );
  await wait(
    () => body.value.endsWith("[[LinkPrimary|my own wording]]"),
    "Pointer selection lost the alias",
  );
  const finalSource = body.value;
  body.value += "\n\n```\n[[literal\n```";
  const codeCursor = body.value.indexOf("[[literal") + 9;
  body.setSelectionRange(codeCursor, codeCursor);
  body.dispatchEvent(new editor.Event("input", { bubbles: true }));
  await pause(150);
  assert(popup.hidden, "Literal code opened note suggestions");
  body.value = finalSource;
  body.setSelectionRange(body.value.length, body.value.length);
  body.dispatchEvent(new editor.Event("input", { bubbles: true }));
  assert(await editor.save(false), "Links did not save");
  await editor.setEditorMode("visual");
  const visual = editor.document
    .getElementById("knowledge-base-rich-frame")
    .getCurrentInstance()._iframeWindow;
  await wait(
    () =>
      visual.document.querySelector(
        'a[title="[[LinkPrimary|my own wording]]"]',
      ),
    "Changing modes lost the alias",
  );
  const backlinks = (await api.getBacklinks(primary.id)).filter(
    (link) => link.sourceId === source.id,
  );
  assert(
    backlinks.length === 1 &&
      backlinks[0].context &&
      !backlinks[0].context.includes("[["),
    "Backlinks did not group references or show prose context",
  );
  const target = await open(primary.id);
  const incoming = target.document.getElementById(
    "knowledge-base-editor-backlinks-label",
  );
  await wait(() => !incoming.hidden, "Backlink navigation is missing");
  incoming.click();
  await wait(
    () =>
      target.document.querySelector(
        "#knowledge-base-editor-backlinks .backlink-context",
      )?.textContent === backlinks[0].context,
    "Backlink context is not visible",
  );
  await shot(target, "backlinks");
  const originalOpen = api.openEditor;
  let navigation;
  api.openEditor = (options) => {
    navigation = options;
    return originalOpen.call(api, options);
  };
  try {
    const backlinkButton = target.document.querySelector(
      "#knowledge-base-editor-backlinks button",
    );
    const backlinkBounds = backlinkButton.getBoundingClientRect();
    target.windowUtils.sendMouseEvent(
      "mousedown",
      backlinkBounds.left + 20,
      backlinkBounds.top + backlinkBounds.height / 2,
      0,
      1,
      0,
    );
    target.windowUtils.sendMouseEvent(
      "mouseup",
      backlinkBounds.left + 20,
      backlinkBounds.top + backlinkBounds.height / 2,
      0,
      1,
      0,
    );
    await wait(
      () => navigation?.zettelId === source.id,
      "A backlink pointer click did not return to the referring note",
    );
  } finally {
    api.openEditor = originalOpen;
  }

  await api.saveZettel({
    id: primary.id,
    customKey: "LinkPrimary",
    title: "Renamed token pruning",
    body: "Target idea.",
  });
  assert(
    (await api.resolveCardLink(href))?.targetId === primary.id,
    "Renaming broke a note link",
  );
  await editor.knowledgeBasePrepareNavigation();
  await target.knowledgeBasePrepareNavigation();
  const note = await Zotero.Items.getAsync(source.noteID);
  assert(
    note.getNote().includes("my own wording"),
    "Native saving lost the custom display text",
  );
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      primaryID: primary.id,
      sourceID: source.id,
      noteID: note.id,
      html: note.getNote(),
      href,
    }),
  );
  await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
  quit();
}
