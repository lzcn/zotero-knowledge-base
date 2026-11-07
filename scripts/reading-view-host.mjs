/** Native PDF sidebar takeover and transient figure capture in a disposable library. */
export default async function readingViewHost({
  Zotero,
  IOUtils,
  PathUtils,
  Services,
  Components,
  setTimeout,
  marker,
  restartMarker,
  readerPDF,
  screenshots,
  benchmark,
}) {
  const plugin = Zotero.ZoteroKnowledgeBase;
  const api = plugin.api;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (check, message) => {
    for (let n = 0; n < 500; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  const main = Zotero.getMainWindow();
  main.resizeTo(1080, 850);
  const now = () => main.performance.now();
  const readingMetrics = { fixture: { notes: 2, backgroundPapers: 24 } };
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    const note = await Zotero.Items.getAsync(saved.noteID);
    assert(
      note.getNote().includes("data-annotation") &&
        note.getNote().includes("data-attachment-key"),
      "Figure metadata lost after restart",
    );
    assert(
      !note.getNote().includes('class="citation"'),
      "Unwanted caption reappeared",
    );
    assert(
      (await Zotero.Items.getAsync(saved.attachmentID)).getAnnotations()
        .length === 0,
      "Capture left an annotation behind",
    );
    await api.openReadingNote(saved.id);
    await wait(
      () =>
        main.document.querySelector(".knowledge-base-native-note-editor")
          ?.contentWindow.knowledgeBaseReady,
      "Restart did not restore editor takeover",
    );
    await main.document
      .querySelector(".knowledge-base-native-note-editor")
      .contentWindow.knowledgeBaseReady();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const paper = new Zotero.Item("journalArticle");
  paper.libraryID = Zotero.Libraries.userLibraryID;
  paper.setField("title", "Reading and writing together");
  await paper.saveTx();
  const attachment = await Zotero.Attachments.importFromFile({
    file: readerPDF,
    parentItemID: paper.id,
  });
  const id = await api.saveZettel({
    title: "Reading notes",
    body: "## Observations\n\nRead on the left and write here.",
    itemKey: paper.key,
    libraryID: paper.libraryID,
  });
  const second = await api.saveZettel({
    title: "Second note",
    body: "Second observation.",
    itemKey: paper.key,
    libraryID: paper.libraryID,
  });
  const empty = await api.saveZettel({ title: "No source", body: "No paper" });
  let missing = false;
  try {
    await api.openReadingNote(empty);
  } catch {
    missing = true;
  }
  assert(missing, "Missing PDF silently opened a blank reader");
  const openingStarted = now();
  await api.openReadingNote(id);
  const reader = await wait(
    () => Zotero.Reader.getByTabID(main.Zotero_Tabs.selectedID),
    "PDF tab did not open",
  );
  await reader._initPromise;
  const browserFor = () => {
    const original = main.ZoteroContextPane.activeEditor;
    const next = original?.nextElementSibling;
    return (
      next?.classList.contains("knowledge-base-native-note-editor") && next
    );
  };
  const browser = await wait(
    browserFor,
    "Native sidebar did not adopt the Knowledge Base editor",
  );
  await wait(
    () => browser.contentWindow.knowledgeBaseReady,
    "Knowledge Base editor did not load",
  );
  await browser.contentWindow.knowledgeBaseReady();
  readingMetrics.pdfAndNoteOpenMs = now() - openingStarted;
  const editor = browser.contentWindow;
  assert(editor.knowledgeBaseCardId === id, "Wrong note opened");
  const metadata = editor.document.getElementById(
    "knowledge-base-editor-metadata",
  );
  assert(
    !metadata.querySelector("details, summary"),
    "Metadata retained a disclosure control",
  );
  assert(
    editor.document
      .getElementById("knowledge-base-src-pick")
      .getBoundingClientRect().width > 0,
    "Source editing is not directly visible",
  );
  const toolbar = reader._iframeWindow.document.querySelector(".toolbar");
  const more = await wait(
    () =>
      reader._iframeWindow.document.getElementById(
        "knowledge-base-reader-more",
      ),
    "Toolbar disclosure missing",
  );
  await wait(
    () => toolbar.classList.contains("knowledge-base-compact"),
    "Narrow PDF toolbar did not collapse tools",
  );
  const pageNumber = reader._iframeWindow.document
    .getElementById("pageNumber")
    .getBoundingClientRect();
  const startBounds = toolbar.querySelector(".start").getBoundingClientRect();
  assert(
    more.getBoundingClientRect().left >= startBounds.right - 1 &&
      pageNumber.right <= startBounds.right + 1,
    "Page number overlaps navigation controls",
  );
  more.click();
  assert(
    more.getAttribute("aria-expanded") === "true",
    "Tools cannot be expanded",
  );
  more.click();
  assert(
    more.getAttribute("aria-expanded") === "false",
    "Tools cannot be collapsed",
  );
  const nativeElement = editor.document.getElementById(
    "knowledge-base-rich-frame",
  );
  const noteID = editor.eval("nativeNoteID");
  const core = () =>
    nativeElement.getCurrentInstance()._iframeWindow.wrappedJSObject
      ._currentEditorInstance._editorCore;
  assert(
    !reader._iframeWindow.document.getElementById("knowledge-base-clip-figure"),
    "Clip icon was retained",
  );
  const pdfView = reader._internalReader._primaryView;
  await wait(
    () =>
      pdfView._pdfRenderer &&
      pdfView._iframeWindow.document.querySelector(".page canvas"),
    "PDF page not rendered",
  );
  const pdfWin = pdfView._iframeWindow;
  const originalAdd = pdfView._onAddAnnotation;
  pdfWin.focus();
  pdfWin.document.getElementById("viewerContainer").focus();
  await pause(100);
  const input = Components.classes[
    "@mozilla.org/text-input-processor;1"
  ].createInstance(Components.interfaces.nsITextInputProcessor);
  assert(
    input.beginInputTransactionForTests(pdfWin, null),
    "Cannot synthesize PDF shortcut",
  );
  const keyboard = (type, options) =>
    new pdfWin.KeyboardEvent(type, Components.utils.cloneInto(options, pdfWin));
  const keypress = (key, code) => {
    input.keydown(keyboard("keydown", { key, code }));
    input.keyup(keyboard("keyup", { key, code }));
  };
  input.keydown(
    keyboard("keydown", {
      key: Zotero.isMac ? "Meta" : "Control",
      code: Zotero.isMac ? "MetaLeft" : "ControlLeft",
    }),
  );
  input.keydown(keyboard("keydown", { key: "Shift", code: "ShiftLeft" }));
  keypress("X", "KeyX");
  input.keyup(keyboard("keyup", { key: "Shift", code: "ShiftLeft" }));
  input.keyup(
    keyboard("keyup", {
      key: Zotero.isMac ? "Meta" : "Control",
      code: Zotero.isMac ? "MetaLeft" : "ControlLeft",
    }),
  );
  await wait(
    () => pdfView._onAddAnnotation !== originalAdd,
    "Capture shortcut did not arm",
  );
  keypress("Escape", "Escape");
  assert(
    pdfView._onAddAnnotation === originalAdd,
    "Escape did not restore the native image tool",
  );
  input.keydown(
    keyboard("keydown", {
      key: Zotero.isMac ? "Meta" : "Control",
      code: Zotero.isMac ? "MetaLeft" : "ControlLeft",
    }),
  );
  input.keydown(keyboard("keydown", { key: "Shift", code: "ShiftLeft" }));
  keypress("X", "KeyX");
  input.keyup(keyboard("keyup", { key: "Shift", code: "ShiftLeft" }));
  input.keyup(
    keyboard("keyup", {
      key: Zotero.isMac ? "Meta" : "Control",
      code: Zotero.isMac ? "MetaLeft" : "ControlLeft",
    }),
  );
  pdfWin.focus();
  await wait(
    () => pdfView._onAddAnnotation !== originalAdd,
    "Capture shortcut did not rearm",
  );
  await pause(100);
  Services.clipboard.emptyClipboard(Services.clipboard.kGlobalClipboard);
  const page = pdfWin.document
    .querySelector(".page canvas")
    .getBoundingClientRect();
  const outer = reader._iframe.getBoundingClientRect();
  const inner = pdfView._iframe.getBoundingClientRect();
  const x = outer.left + inner.left + page.left + 45,
    y = outer.top + inner.top + page.top + 50;
  main.windowUtils.sendMouseEvent(
    "mousedown",
    x,
    y,
    0,
    1,
    0,
    false,
    0.5,
    1,
    false,
    false,
    1,
  );
  await pause(30);
  main.windowUtils.sendMouseEvent(
    "mousemove",
    x + 230,
    y + 110,
    0,
    1,
    0,
    false,
    0.5,
    1,
    false,
    false,
    1,
  );
  await pause(30);
  main.windowUtils.sendMouseEvent(
    "mouseup",
    x + 230,
    y + 110,
    0,
    1,
    0,
    false,
    0,
    1,
    false,
    false,
    0,
  );
  const insertionStarted = now();
  const clipboard = Services.clipboard;
  await wait(
    () =>
      clipboard.hasDataMatchingFlavors(
        ["image/png"],
        clipboard.kGlobalClipboard,
      ),
    "Capture did not copy a PNG",
  );
  assert(
    !core().getHTML().includes("data-attachment-key"),
    "Capture wrote to the open note before pasting",
  );
  const nativeWin = nativeElement.getCurrentInstance()._iframeWindow;
  nativeWin.focus();
  nativeWin.document.querySelector(".ProseMirror").focus();
  let pastedAnnotations;
  nativeWin.addEventListener(
    "paste",
    (event) => {
      const value = event.clipboardData.getData("zotero/annotation");
      if (value) pastedAnnotations = JSON.parse(value);
    },
    { capture: true, once: true },
  );
  core().view.focus();
  const pasteInput = Components.classes[
    "@mozilla.org/text-input-processor;1"
  ].createInstance(Components.interfaces.nsITextInputProcessor);
  assert(
    pasteInput.beginInputTransactionForTests(nativeWin, null),
    "Cannot synthesize paste",
  );
  const pasteKey = (type, options) =>
    new nativeWin.KeyboardEvent(
      type,
      Components.utils.cloneInto(options, nativeWin),
    );
  const modifier = {
    key: Zotero.isMac ? "Meta" : "Control",
    code: Zotero.isMac ? "MetaLeft" : "ControlLeft",
  };
  pasteInput.keydown(pasteKey("keydown", modifier));
  pasteInput.keydown(pasteKey("keydown", { key: "v", code: "KeyV" }));
  pasteInput.keyup(pasteKey("keyup", { key: "v", code: "KeyV" }));
  pasteInput.keyup(pasteKey("keyup", modifier));
  await wait(
    () => core().getHTML().includes("data-attachment-key"),
    "Pasting the clipboard did not insert an image",
  );
  assert(
    pastedAnnotations?.[0]?.image?.startsWith("data:image/png;base64,"),
    "Clipboard did not expose the captured PNG and source together",
  );
  const capturedImage = new main.Image();
  capturedImage.src = pastedAnnotations[0].image;
  await capturedImage.decode();
  const colorCanvas = main.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas",
  );
  colorCanvas.width = capturedImage.width;
  colorCanvas.height = capturedImage.height;
  const colorContext = colorCanvas.getContext("2d");
  colorContext.drawImage(capturedImage, 0, 0);
  const pixels = colorContext.getImageData(
    0,
    0,
    colorCanvas.width,
    colorCanvas.height,
  ).data;
  let colored = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (
      Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
        Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
      80
    )
      colored++;
  assert(colored > 100, "Capture missed the embedded color figure");
  assert(
    pdfView._onAddAnnotation === originalAdd,
    "Capture kept intercepting ordinary annotations",
  );
  assert(
    attachment.getAnnotations().length === 0,
    "Capture created a permanent PDF annotation",
  );
  const html = core().getHTML();
  const root = new main.DOMParser().parseFromString(html, "text/html").body;
  const img = root.querySelector("img[data-attachment-key][data-annotation]");
  assert(img, "Captured image has no native attachment/source metadata");
  const origin = JSON.parse(
    decodeURIComponent(img.getAttribute("data-annotation")),
  );
  assert(
    origin.attachmentURI === Zotero.URI.getItemURI(attachment) &&
      origin.position.pageIndex === 0 &&
      origin.position.rects.length === 1,
    "Capture lost its PDF coordinates",
  );
  assert(
    !root.querySelector(".citation"),
    "Capture inserted a visible source citation",
  );
  await editor.knowledgeBasePrepareNavigation();
  readingMetrics.figureInsertAndSaveMs = now() - insertionStarted;
  await editor.setEditorMode("source");
  await editor.setEditorMode("visual");
  assert(
    nativeElement
      .getCurrentInstance()
      ._iframeWindow.wrappedJSObject._currentEditorInstance._editorCore.getHTML()
      .includes("data-annotation"),
    "Markdown round-trip lost image provenance",
  );
  const insertionTarget = nativeElement.getCurrentInstance();
  const nativeInsert = insertionTarget.insertAnnotations;
  let releaseInsertion;
  const insertionGate = new Promise((resolve) => {
    releaseInsertion = resolve;
  });
  insertionTarget.insertAnnotations = async function (annotations) {
    await insertionGate;
    return nativeInsert.call(this, annotations);
  };
  const queuedInsertion = editor.knowledgeBaseInsertAnnotations([
    {
      type: "highlight",
      text: "Queued annotation survives navigation",
      color: "#ffd400",
      pageLabel: "1",
      position: origin.position,
      attachmentItemID: attachment.id,
    },
  ]);
  let navigated = false;
  const preparing = editor.knowledgeBasePrepareNavigation().then(() => {
    navigated = true;
  });
  await pause(50);
  assert(!navigated, "Navigation completed before annotation insertion");
  releaseInsertion();
  await Promise.all([queuedInsertion, preparing]);
  insertionTarget.insertAnnotations = nativeInsert;
  assert(
    (await Zotero.Items.getAsync(noteID))
      .getNote()
      .includes("Queued annotation survives navigation"),
    "Pending annotation was not saved before navigation",
  );
  const originalSerializer =
    Zotero.EditorInstanceUtilities.serializeAnnotations;
  const serialized = originalSerializer([
    {
      type: "highlight",
      text: "Quoted passage",
      color: "#ffd400",
      pageLabel: "1",
      position: origin.position,
      attachmentItemID: attachment.id,
    },
  ]).html;
  assert(
    !serialized.includes('class="citation"') &&
      serialized.includes("data-annotation"),
    "Ordinary Add to Note still repeats the source caption",
  );
  const capture = async (filename) => {
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
      PathUtils.join(screenshots, filename),
      new Uint8Array(await blob.arrayBuffer()),
    );
  };
  const noteToolbarBounds = nativeElement
    .getCurrentInstance()
    ._iframeWindow.document.querySelector(".toolbar")
    .getBoundingClientRect();
  for (const button of nativeElement
    .getCurrentInstance()
    ._iframeWindow.document.querySelectorAll(".toolbar .toolbar-button")) {
    const box = button.getBoundingClientRect();
    if (box.width)
      assert(
        box.bottom <= noteToolbarBounds.bottom + 1,
        "Note toolbar buttons overflow below its border",
      );
  }
  await capture("reading-view.png");
  more.click();
  await pause(50);
  const toolBounds = toolbar.querySelector(".center").getBoundingClientRect();
  const endBounds = toolbar.querySelector(".end").getBoundingClientRect();
  assert(
    toolBounds.width > 0 && endBounds.top >= toolBounds.bottom - 1,
    "Tool groups overlap in the disclosure",
  );
  await capture("reading-tools.png");
  more.click();
  main.resizeTo(1400, 850);
  await wait(
    () => !toolbar.classList.contains("knowledge-base-compact"),
    "Wide PDF toolbar did not restore inline tools",
  );
  await capture("reading-wide.png");
  const switchStarted = now();
  await api.openReadingNote(second);
  const next = await wait(() => {
    const b = browserFor();
    return b?.contentWindow.knowledgeBaseCardId === second && b;
  }, "Second native note did not adopt Knowledge Base");
  await next.contentWindow.knowledgeBaseReady();
  readingMetrics.noteSwitchMs = now() - switchStarted;
  assert(
    (await Zotero.Items.getAsync(noteID)).getNote().includes("data-annotation"),
    "Switching notes lost the figure",
  );
  if (benchmark) {
    for (let n = 0; n < readingMetrics.fixture.backgroundPapers; n++) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = paper.libraryID;
      item.setField("title", "Background indexing fixture " + n);
      item.setField(
        "abstractNote",
        "A fixed study of graph structures, note taking and semantic retrieval. ".repeat(
          30,
        ),
      );
      await item.saveTx({ skipSelect: true });
    }
    await wait(
      () => api.getLibraryStatus()?.state === "indexing",
      "Background indexing did not begin",
    );
    const before = api.getLibraryStatus();
    const delays = [];
    const end = now() + 2500;
    while (now() < end) {
      const expected = now() + 10;
      await pause(10);
      delays.push(Math.max(0, now() - expected));
    }
    delays.sort((a, b) => a - b);
    readingMetrics.backgroundIndexing = {
      samples: delays.length,
      timerIntervalMs: 10,
      sampleWindowMs: 2500,
      maxTimerLagMs: Math.max(...delays),
      p95TimerLagMs: delays[Math.floor(delays.length * 0.95)],
      indexedDuringSample:
        api.getLibraryStatus().indexedItems - before.indexedItems,
    };
  }
  const note = await Zotero.Items.getAsync(noteID);
  const tabInstance = await Zotero.Notes.open(note.id);
  const tabElement =
    tabInstance._iframeWindow.browsingContext.embedderElement.closest(
      "note-editor",
    );
  const adopted = async (element) => {
    const b = await wait(
      () =>
        element.nextElementSibling?.classList.contains(
          "knowledge-base-native-note-editor",
        ) && element.nextElementSibling,
      "Native note did not adopt the shared editor",
    );
    await wait(
      () => b.contentWindow.knowledgeBaseReady,
      "Shared editor did not load",
    );
    await b.contentWindow.knowledgeBaseReady();
    assert(
      !b.contentWindow.document.querySelector(
        "#knowledge-base-editor-metadata details, #knowledge-base-editor-metadata summary",
      ) &&
        b.contentWindow.document
          .getElementById("knowledge-base-src-pick")
          .getBoundingClientRect().width > 0,
      "A note host hid metadata behind a disclosure control",
    );
    return b;
  };
  await adopted(tabElement);
  const windowInstance = await Zotero.Notes.open(note.id, null, {
    openInWindow: true,
  });
  const windowElement =
    windowInstance._iframeWindow.browsingContext.embedderElement.closest(
      "note-editor",
    );
  const standalone = await adopted(windowElement);
  assert(
    standalone.contentWindow.knowledgeBaseCardId === id,
    "Standalone note opened a different card",
  );
  await standalone.contentWindow.setEditorMode("source");
  const source = standalone.contentWindow.document.getElementById(
    "knowledge-base-editor-body",
  );
  source.value += "\n\nPreference switch preserves this edit.";
  source.dispatchEvent(
    new standalone.contentWindow.Event("input", { bubbles: true }),
  );
  await api.setNativeNoteTakeover(false);
  assert(
    !main.document.querySelector(".knowledge-base-native-note-editor"),
    "Turning takeover off retained a Knowledge Base view",
  );
  assert(
    windowElement.style.display !== "none",
    "Native editor did not return",
  );
  assert(
    note.getNote().includes("Preference switch preserves this edit."),
    "Disabling takeover lost an unsaved edit",
  );
  await api.setNativeNoteTakeover(true);
  await adopted(windowElement);
  // Closing a native note window must release its browser without affecting other hosts.
  const noteWindow = windowElement.ownerDocument.defaultView;
  noteWindow.close();
  await wait(() => noteWindow.closed, "Standalone note did not close");
  const remaining = await adopted(tabElement);
  const originalStop = remaining.contentWindow.knowledgeBaseStopEditor;
  remaining.contentWindow.knowledgeBaseStopEditor = () => {
    originalStop();
    throw new Error("Injected editor cleanup failure");
  };
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      id,
      noteID,
      attachmentID: attachment.id,
      ...(benchmark ? { readingMetrics } : {}),
    }),
  );
  await plugin.hooks.onShutdown();
  assert(
    !main.document.querySelector(".knowledge-base-native-note-editor"),
    "Shutdown left the Knowledge Base sidebar mounted",
  );
  assert(
    !reader._iframeWindow.document.getElementById("knowledge-base-clip-figure"),
    "Shutdown left capture controls",
  );
  assert(
    Zotero.EditorInstanceUtilities.serializeAnnotations !== originalSerializer,
    "Shutdown did not restore native serialization",
  );
  quit();
}
