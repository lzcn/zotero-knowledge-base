/** Formula headings and native reader note previews in disposable Zotero data. */
export default async function mathHost({
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
}) {
  const api = Zotero.ZoteroKnowledgeBase.api;
  const main = Zotero.getMainWindow();
  main.resizeTo(1200, 900);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const assert = (ok, label) => {
    if (!ok) throw new Error(label);
  };
  const wait = async (check, label) => {
    for (let n = 0; n < 300; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(label);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  const shot = async (filename) => {
    if (!screenshots) return;
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
    await pause(150);
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
    const blob = await new Promise((r) => canvas.toBlob(r));
    await IOUtils.write(
      PathUtils.join(screenshots, filename),
      new Uint8Array(await blob.arrayBuffer()),
    );
  };
  const open = async (id) => {
    api.openEditor({ zettelId: id });
    const editor = await wait(() => {
      const e = main.document
        .querySelector(".knowledge-base-workbench")
        ?.contentWindow?.document.getElementById(
          "knowledge-base-workbench-editor",
        )?.contentWindow;
      return e?.knowledgeBaseCardId === id && e.knowledgeBaseReady && e;
    }, "Math editor did not open");
    await editor.knowledgeBaseReady();
    return editor;
  };
  const frame = (editor) =>
    editor.document
      .getElementById("knowledge-base-rich-frame")
      .getCurrentInstance()._iframeWindow;
  const core = (editor) =>
    frame(editor).wrappedJSObject._currentEditorInstance._editorCore;
  const checkHeading = async (editor, count) => {
    await wait(
      () =>
        frame(editor).document.querySelectorAll(
          ".primary-editor :is(h1,h2,h3,h4,h5,h6) .katex",
        ).length >= count,
      "Heading formulas did not render",
    ).catch((error) => {
      throw new Error(
        String(error) +
          " " +
          JSON.stringify({
            html: core(editor).getHTML(),
            doc: core(editor).view.state.doc.toJSON(),
            expression:
              core(editor).view.state.schema.nodes.heading.spec.content,
          }),
      );
    });
    let headings = 0;
    core(editor).view.state.doc.descendants((node) => {
      node = node.wrappedJSObject || node;
      if (node.type.name === "heading") {
        assert(
          node.type.validContent(node.content),
          "Heading contains invalid native nodes",
        );
        node.forEach((child) => {
          if (child.type.name === "math_inline") headings++;
        });
      }
    });
    assert(headings >= count, "Heading formulas were flattened to plain text");
  };
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    assert(
      (await Zotero.Items.getAsync(saved.noteID)).getNote() === saved.html,
      "Math source changed after restart",
    );
    await checkHeading(await open(saved.id), 4);
    assert(
      (await Zotero.Items.getAsync(saved.annotationID)).annotationComment ===
        saved.annotationComment,
      "Annotation math source changed after restart",
    );
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const paper = new Zotero.Item("journalArticle");
  paper.libraryID = Zotero.Libraries.userLibraryID;
  paper.setField("title", "Formula preview source");
  paper.addTag("Paper manual", 0);
  paper.addTag("Paper automatic", 1);
  paper.addTag("Overlap", 1);
  await paper.saveTx();
  Zotero.Prefs.set(
    "extensions.zotero.similar-works.excludedTags",
    "@auto",
    true,
  );
  const pdf = await Zotero.Attachments.importFromFile({
    file: readerPDF,
    parentItemID: paper.id,
  });
  const annotationComment = String.raw`也就是分类每对正样本 $(T_i, I_i)$ 和负样本 $(T_i, I_j)$。<b>Risk</b> $\frac{a_1}{b^2}$`;
  const annotation = await Zotero.Annotations.saveFromJSON(pdf, {
    key: Zotero.Utilities.generateObjectKey(),
    type: "highlight",
    text: "Knowledge Base reader toolbar",
    comment: annotationComment,
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    position: { pageIndex: 0, rects: [[40, 770, 300, 790]] },
  });
  const id = await api.saveZettel({
    title: "Formula headings",
    itemKey: paper.key,
    libraryID: paper.libraryID,
    body: "## Risk $r$ and $\\frac{a_1}{b^2}$\n\n$r$ Takeaway: preserve equations and original LaTeX.\n\n`$literal$` remains code.\n\n$$\\sum_{i=1}^{n} x_i$$",
  });
  const editor = await open(id);
  await checkHeading(editor, 2);
  await editor.setEditorMode("source");
  const source = editor.document.getElementById("knowledge-base-editor-body");
  assert(
    source.value.includes("## Risk $r$ and $\\frac{a_1}{b^2}$"),
    "Heading math source changed during projection",
  );
  source.value += "\n\n### Updated $\\alpha_i^2$\n\n###### $\\mathcal{R}$";
  source.dispatchEvent(new editor.Event("input", { bubbles: true }));
  await editor.setEditorMode("visual");
  await checkHeading(editor, 4);
  await shot("math-headings.png");
  assert(await editor.save(false), "Heading math did not save");
  const noteID = editor.eval("nativeNoteID");
  const html = (await Zotero.Items.getAsync(noteID)).getNote();
  assert(
    /<h2[^>]*>[^]*?class="math"/.test(html) &&
      html.includes("$\\frac{a_1}{b^2}$") &&
      html.includes("$\\alpha_i^2$"),
    "Saved headings lost native math",
  );
  const nativeNote = await Zotero.Items.getAsync(noteID);
  nativeNote.addTag("Note automatic", 1);
  nativeNote.addTag("Note manual", 0);
  nativeNote.addTag("Overlap", 0);
  await nativeNote.saveTx();
  const visible = await api.getNoteTags(noteID, id);
  assert(
    visible.includes("Paper manual") &&
      visible.includes("Note manual") &&
      visible.includes("Overlap") &&
      !visible.includes("Paper automatic") &&
      !visible.includes("Note automatic"),
    "@auto did not preserve manual tags and hide automatic associations",
  );
  await wait(
    () =>
      !editor.document
        .getElementById("knowledge-base-note-tags")
        .textContent.includes("automatic"),
    "The note tag display ignored @auto",
  );
  Zotero.Prefs.set("extensions.zotero.similar-works.excludedTags", "", true);
  await wait(
    () =>
      editor.document
        .getElementById("knowledge-base-note-tags")
        .textContent.includes("Paper automatic"),
    "Automatic tags did not return after changing exclusions",
  );
  Zotero.Prefs.set(
    "extensions.zotero.similar-works.excludedTags",
    "@auto",
    true,
  );
  assert(
    main.Zotero_Tabs.selectedID !== "zotero-pane",
    "Source fixture is not in the note tab",
  );
  editor.document.getElementById("knowledge-base-src-display").click();
  await wait(
    () =>
      main.Zotero_Tabs.selectedID === "zotero-pane" &&
      main.ZoteroPane.getSelectedItems().some((item) => item.id === paper.id),
    "The first Source click did not select its paper",
  );
  await Zotero.Reader.open(pdf.id);
  const reader = await wait(
    () => Zotero.Reader.getByTabID(main.Zotero_Tabs.selectedID),
    "Reader did not open",
  );
  await reader._initPromise;
  const readerWindow = reader._iframeWindow;
  const readerDoc = readerWindow.document;
  const internal = reader._internalReader;
  const view = internal._primaryView;
  await view.initializedPromise;
  await wait(
    () => view._iframeWindow.document.querySelector(".page canvas"),
    "PDF page did not render",
  );
  internal._updateState(
    Components.utils.cloneInto({ sidebarOpen: false }, readerWindow),
  );
  internal.setSelectedAnnotations(
    Components.utils.cloneInto([annotation.key], readerWindow),
  );
  view._openAnnotationPopup();
  const preview = await wait(
    () => readerDoc.querySelector(".knowledge-base-annotation-preview"),
    "Annotation preview did not render",
  );
  assert(
    preview.querySelectorAll("math").length === 3 &&
      preview.querySelector("mfrac"),
    "Annotation formulas are missing",
  );
  assert(
    preview.querySelector("b")?.textContent === "Risk",
    "Annotation rich text was flattened",
  );
  const sourceComment = readerDoc.querySelector(
    ".annotation-popup .comment .content:not(.knowledge-base-annotation-preview)",
  );
  assert(
    readerWindow.getComputedStyle(sourceComment).display === "none",
    "Raw annotation source remains visible",
  );
  assert(
    annotation.annotationComment === annotationComment,
    "Viewing math wrote to the annotation",
  );
  await shot("annotation-math-preview.png");
  Zotero.Utilities.Internal.activate();
  main.focus();
  await pause(300);
  readerWindow.focus();
  const clickTarget = preview.querySelector("math");
  const clickRect = clickTarget.getBoundingClientRect();
  const iframeRect = reader._iframe.getBoundingClientRect();
  const clickX = iframeRect.left + clickRect.left + clickRect.width / 2;
  const clickY = iframeRect.top + clickRect.top + clickRect.height / 2;
  assert(
    clickTarget.contains(
      readerDoc.elementFromPoint(
        clickRect.left + clickRect.width / 2,
        clickRect.top + clickRect.height / 2,
      ),
    ),
    "Annotation formula is covered by another element",
  );
  main.windowUtils.sendMouseEvent("mousedown", clickX, clickY, 0, 1, 0);
  main.windowUtils.sendMouseEvent("mouseup", clickX, clickY, 0, 1, 0);
  await wait(
    () =>
      readerDoc.activeElement === sourceComment &&
      !readerDoc.querySelector(".knowledge-base-annotation-preview"),
    "Clicking math did not open native LaTeX editing",
  );
  const range = readerDoc.createRange();
  range.selectNodeContents(sourceComment);
  range.collapse(false);
  const selection = readerWindow.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const input = Components.classes[
    "@mozilla.org/text-input-processor;1"
  ].createInstance(Components.interfaces.nsITextInputProcessor);
  assert(
    input.beginInputTransactionForTests(readerWindow, null),
    "Cannot type in the native annotation editor",
  );
  input.commitCompositionWith(" $z^2$");
  assert(
    sourceComment.textContent.includes("$z^2$"),
    "Typing after a pointer click did not edit the annotation",
  );
  await shot("annotation-math-editing.png");
  sourceComment.blur();
  await wait(
    () => annotation.annotationComment.includes("$z^2$"),
    "Native annotation did not save",
  );
  await wait(
    () =>
      readerDoc.querySelectorAll(".knowledge-base-annotation-preview math")
        .length === 4,
    "Edited annotation did not render after blur",
  );
  let savedComment = annotation.annotationComment;
  assert(
    savedComment.includes("$(T_i, I_i)$") &&
      savedComment.includes("<b>Risk</b>") &&
      !/mathml|<math|knowledge-base/.test(savedComment),
    "Math preview contaminated annotation source",
  );
  Zotero.Prefs.set("extensions.zotero.knowledge-base.mathPreview", false, true);
  await wait(
    () => !readerDoc.querySelector(".knowledge-base-annotation-preview"),
    "Annotation math did not turn off",
  );
  assert(
    readerWindow.getComputedStyle(sourceComment).display !== "none",
    "Turning math off hid native annotation text",
  );
  Zotero.Prefs.set("extensions.zotero.knowledge-base.mathPreview", true, true);
  await wait(
    () =>
      readerDoc.querySelectorAll(".knowledge-base-annotation-preview math")
        .length === 4,
    "Annotation math did not turn on",
  );
  internal._updateState(
    Components.utils.cloneInto(
      { primaryViewAnnotationPopup: null },
      readerWindow,
    ),
  );
  view._openAnnotationPopup();
  await wait(
    () =>
      readerDoc.querySelectorAll(".knowledge-base-annotation-preview math")
        .length === 4,
    "Reopened annotation lost math",
  );
  const keyboardPreview = readerDoc.querySelector(
    ".knowledge-base-annotation-preview",
  );
  Zotero.Utilities.Internal.activate();
  main.focus();
  await pause(300);
  readerWindow.focus();
  Services.focus.setFocus(
    keyboardPreview,
    Services.focus.FLAG_RAISE | Services.focus.FLAG_BYKEY,
  );
  const keyboardSource = readerDoc.querySelector(
    ".annotation-popup .comment .content:not(.knowledge-base-annotation-preview)",
  );
  await wait(
    () =>
      keyboardSource?.isConnected &&
      readerDoc.activeElement === keyboardSource &&
      !readerDoc.querySelector(".knowledge-base-annotation-preview"),
    "Keyboard focus closed the annotation or left it read-only",
  ).catch((error) => {
    throw new Error(
      String(error) +
        " " +
        JSON.stringify({
          focused: readerDoc.hasFocus(),
          active: readerDoc.activeElement?.className,
          sourceEditable: keyboardSource?.getAttribute("contenteditable"),
          connected: keyboardSource?.isConnected,
          previewPresent: !!readerDoc.querySelector(
            ".knowledge-base-annotation-preview",
          ),
          selected: internal._state.selectedAnnotationIDs,
        }),
    );
  });
  const keyboardRange = readerDoc.createRange();
  keyboardRange.selectNodeContents(keyboardSource);
  keyboardRange.collapse(false);
  selection.removeAllRanges();
  selection.addRange(keyboardRange);
  input.commitCompositionWith(" $k^2$");
  keyboardSource.blur();
  await wait(
    () =>
      annotation.annotationComment.includes("$k^2$") &&
      readerDoc.querySelectorAll(".knowledge-base-annotation-preview math")
        .length === 5,
    "Keyboard editing did not save and render the annotation",
  );
  savedComment = annotation.annotationComment;
  const pane = main.document.querySelector("context-pane");
  pane.collapsed = false;
  pane.mode = "notes";
  const context = await wait(
    () => pane._getCurrentNotesContext(),
    "Notes context did not open",
  );
  context.mode = "notesList";
  await context._updateNotesList();
  const row = await wait(
    () =>
      [...main.document.querySelectorAll("note-row")].find(
        (row) => row.note?.id === noteID,
      ),
    "Native note card did not appear",
  );
  await wait(
    () => row.querySelector(".note-content math"),
    "Native card still displays raw math",
  );
  assert(
    row.querySelector(".note-content math").namespaceURI ===
      "http://www.w3.org/1998/Math/MathML",
    "Preview did not produce native MathML",
  );
  assert(
    (await Zotero.Items.getAsync(noteID)).getNote() === html,
    "Preview rendering wrote to the note",
  );
  Zotero.Prefs.set("extensions.zotero.knowledge-base.mathPreview", false, true);
  await wait(
    () => !row.querySelector(".knowledge-base-note-math"),
    "Math preview did not turn off",
  );
  Zotero.Prefs.set("extensions.zotero.knowledge-base.mathPreview", true, true);
  await wait(
    () => row.querySelector(".note-content math"),
    "Math preview did not turn on",
  );
  row.render();
  await wait(
    () => row.querySelector(".note-content math"),
    "Native refresh lost rendered math",
  );
  await shot("native-math-preview.png");
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      id,
      noteID,
      html,
      annotationID: annotation.id,
      annotationComment: savedComment,
    }),
  );
  await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
  assert(
    !main.document.querySelector(".knowledge-base-note-math") &&
      !readerDoc.querySelector(".knowledge-base-annotation-preview"),
    "Shutdown retained rendered previews",
  );
  assert(
    (await Zotero.Items.getAsync(noteID)).getNote() === html,
    "Shutdown changed the formula source",
  );
  quit();
}
