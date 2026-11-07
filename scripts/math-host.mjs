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
    JSON.stringify({ connectionsOnly: true, id, noteID, html }),
  );
  await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
  assert(
    !main.document.querySelector(".knowledge-base-note-math"),
    "Shutdown retained rendered previews",
  );
  assert(
    (await Zotero.Items.getAsync(noteID)).getNote() === html,
    "Shutdown changed the formula source",
  );
  quit();
}
