/** Focused editing checks, injected only into a disposable host installation. */
export default async function textToolsHost({
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
  const wait = async (check, label) => {
    for (let n = 0; n < 200; n++) {
      const value = await check();
      if (value) return value;
      await pause(25);
    }
    throw new Error(label);
  };
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    assert(
      (await knowledgeBase.api.getZettel(saved.cardID)).body === saved.body,
      "Formatted body changed after restart",
    );
    assert(
      (await Zotero.Items.getAsync(saved.noteID)).getNote() === saved.html,
      "Native formatting changed after restart",
    );
    assert(
      (await Zotero.Items.getAsync(saved.ordinaryID)).getNote().includes("$z$"),
      "Ordinary note formatting was not persisted",
    );
    await knowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const main = Zotero.getMainWindow();
  main.resizeTo(1100, 900);
  const shot = async (name, win = main) => {
    if (!screenshots) return;
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
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
  const cardID = await knowledgeBase.api.saveZettel({
    title: "Text tools",
    body: "## Dynamic link prediction\n\nPreserve **bold**, [a link](https://example.org) and `code`.",
  });
  knowledgeBase.api.openEditor({ zettelId: cardID });
  const inline = await wait(() => {
    const workbench = main.document.querySelector(
      ".knowledge-base-workbench",
    )?.contentWindow;
    const view = workbench?.document.getElementById(
      "knowledge-base-workbench-editor",
    )?.contentWindow;
    return (
      view?.knowledgeBaseCardId === cardID &&
      view.document.readyState === "complete" &&
      view
    );
  }, "Knowledge Base editor did not open");
  await inline.knowledgeBaseReady();
  const native = () =>
    inline.document
      .getElementById("knowledge-base-rich-frame")
      .getCurrentInstance()._iframeWindow;
  const core = (frame) =>
    frame.wrappedJSObject._currentEditorInstance._editorCore;
  const invoke = async (frame, action) => {
    const button = await wait(() => {
      const button = frame.document.querySelector(
        '[data-text-action="' + action + '"]',
      );
      return button?.getBoundingClientRect().width > 0 && button;
    }, "Direct text action is missing: " + action);
    const wrapper = button.parentElement;
    assert(
      wrapper.querySelectorAll("button").length === 2,
      "Text actions are duplicated",
    );
    assert(
      !wrapper.querySelector(".popup") && !button.hasAttribute("aria-haspopup"),
      "Text action still opens a menu",
    );
    const host = frame.browsingContext.embedderElement,
      parent = host.ownerDocument,
      offset = host.getBoundingClientRect(),
      rect = button.getBoundingClientRect(),
      x = offset.left + rect.left + rect.width / 2,
      y = offset.top + rect.top + rect.height / 2;
    assert(
      parent.elementFromPoint(x, y) === host,
      "A sibling frame covers the text action",
    );
    assert(
      button.contains(
        frame.document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        ),
      ),
      "Native content covers the text action",
    );
    assert(
      button.getAttribute("aria-label") &&
        button.querySelector("svg") &&
        !button.textContent.trim(),
      "Text action is not a named icon button",
    );
    const nativeFind = frame.document.querySelector(
      ".toolbar .middle>.toolbar-button:last-child",
    );
    assert(
      !nativeFind || frame.getComputedStyle(nativeFind).display === "none",
      "The native and plugin find buttons are both visible",
    );
    let clicked = false;
    button.addEventListener("click", () => (clicked = true), { once: true });
    parent.defaultView.windowUtils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
    parent.defaultView.windowUtils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    await pause(100);
    assert(clicked, "Pointer click missed the text action: " + action);
    assert(
      !button.hasAttribute("data-error"),
      "Text action failed: " + wrapper.textContent,
    );
    return wrapper;
  };
  const mathCount = (doc) => {
    let count = 0;
    doc.descendants((node) => {
      node = node.wrappedJSObject || node;
      if (node.type.name === "math_inline" || node.type.name === "math_display")
        count++;
    });
    return count;
  };
  const frame = native(),
    view = core(frame).view,
    schema = view.state.schema;
  const paragraph = (text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const paper = new Zotero.Item("journalArticle");
  paper.libraryID = Zotero.Libraries.userLibraryID;
  paper.setField("title", "Protected source");
  await paper.saveTx();
  const embedded = await Zotero.Attachments.importEmbeddedImage({
    parentItemID: inline.eval("nativeNoteID"),
    blob: new main.Blob(
      [
        Uint8Array.from(
          main.atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=",
          ),
          (character) => character.charCodeAt(0),
        ),
      ],
      { type: "image/png" },
    ),
  });
  const citation = {
    citationItems: [
      {
        uris: [Zotero.URI.getItemURI(paper)],
        itemData: Zotero.Utilities.Item.itemToCSLJSON(paper),
        locator: "23",
        label: "page",
      },
    ],
    properties: {},
  };
  const literalBackslashes = "Path C:\\Users\\zhi\\notes and command \\alpha";
  const raw = [
    paragraph(literalBackslashes),
    paragraph("Current $t$ and \\(u,v\\)."),
    paragraph("\\[ \\mathcal H_{<t}=\\{(u_i,v_i,t_i)\\mid t_i<t\\} \\]"),
    paragraph(
      "\\[ \\boxed{\\hat y_{uv}^t=P\\left((u,v,t)\\text{发生交互}\\mid\\mathcal H_{<t}\\right)} \\]",
    ),
    paragraph("Before \\[x^2\\] after."),
    paragraph("\\["),
    paragraph("a^2+b^2=c^2"),
    paragraph("\\]"),
    {
      type: "codeBlock",
      content: [{ type: "text", text: "\\(code\\)\n\\[code\\]" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "\\(literal\\)", marks: [{ type: "code" }] },
        {
          type: "text",
          text: "\\(link\\)",
          marks: [{ type: "link", attrs: { href: "https://example.org" } }],
        },
        { type: "math_inline", content: [{ type: "text", text: "z" }] },
      ],
    },
  ];
  raw[0].content.push(
    {
      type: "image",
      attrs: { attachmentKey: embedded.key, width: 1, height: 1 },
    },
    { type: "citation", attrs: { citation } },
  );
  const objects = () => {
    const result = [];
    core(native()).view.state.doc.descendants((node) => {
      node = node.wrappedJSObject || node;
      if (node.type.name === "image")
        result.push({ key: node.attrs.attachmentKey });
      if (node.type.name === "citation")
        result.push({ citation: node.attrs.citation });
    });
    return JSON.stringify(result);
  };
  view.dispatch(
    view.state.tr.insert(
      view.state.doc.content.size,
      schema.nodeFromJSON(
        frame.wrappedJSObject.JSON.parse(
          JSON.stringify({ type: "doc", content: raw }),
        ),
      ).content,
    ),
  );
  const original = view.state.doc.toJSON(),
    originalObjects = objects();
  let selectionFrom;
  view.state.doc.descendants((node, pos) => {
    node = node.wrappedJSObject || node;
    if (node.isText && node.text.startsWith("Current"))
      selectionFrom = pos + node.text.indexOf("\\(");
  });
  const TextSelection = view.state.selection.constructor;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        selectionFrom,
        selectionFrom + "\\(u,v\\)".length,
      ),
    ),
  );
  await invoke(frame, "normalize");
  assert(
    mathCount(view.state.doc) === 2 &&
      view.state.doc.textContent.includes("$t$"),
    "Native selection formatting affected other text",
  );
  frame.wrappedJSObject.doUndo();
  assert(
    JSON.stringify(view.state.doc.toJSON()) === JSON.stringify(original),
    "Selected native formatting undo failed",
  );
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
  );
  const tools = await invoke(frame, "normalize");
  assert(
    mathCount(view.state.doc) === 7,
    "Native math count: " +
      JSON.stringify({
        selection: view.state.selection.toJSON(),
        status: tools.textContent,
        disabled: frame.document.querySelector("[data-text-action=normalize]")
          .disabled,
        doc: view.state.doc.toJSON(),
      }),
  );
  assert(
    view.state.doc.textContent.includes("\\(code\\)") &&
      view.state.doc.textContent.includes("\\(literal\\)") &&
      view.state.doc.textContent.includes("\\(link\\)"),
    "Protected code or links were altered",
  );
  assert(
    objects() === originalObjects,
    "Formatting changed image or citation metadata",
  );
  const normalized = view.state.doc.toJSON();
  frame.wrappedJSObject.doUndo();
  assert(
    JSON.stringify(view.state.doc.toJSON()) === JSON.stringify(original),
    "Native formatting cannot be undone in one step",
  );
  frame.wrappedJSObject.doRedo();
  assert(
    JSON.stringify(view.state.doc.toJSON()) === JSON.stringify(normalized),
    "Native redo failed",
  );
  tools.querySelector('[data-text-action="normalize"]').click();
  assert(
    JSON.stringify(view.state.doc.toJSON()) === JSON.stringify(normalized),
    "Normalization is not idempotent",
  );
  await wait(
    () => frame.document.querySelectorAll(".primary-editor .katex").length >= 7,
    "Native math did not render",
  );
  await shot("text-tools-native");
  await inline.setEditorMode("source");
  const source = inline.document.getElementById("knowledge-base-editor-body");
  assert(
    source.value.includes(literalBackslashes),
    "Native-to-Markdown conversion added unnecessary backslashes",
  );
  const added =
    "\n\nSelection \\(\\alpha+\\beta\\).\n\n\\[ a_t=\\frac{1}{2} \\]\n\n`\\(literal\\)`\n\n~~~tex\n\\[code\\]\n~~~\n\nhttps://example.org/\\(x\\) [[note\\(id\\)]]\n\nReplace target target.";
  source.setRangeText(added, source.value.length, source.value.length, "end");
  source.dispatchEvent(new inline.Event("input", { bubbles: true }));
  const sourceBefore = source.value,
    selected = "\\(\\alpha+\\beta\\)",
    start = source.value.indexOf(selected);
  source.focus();
  source.setSelectionRange(start, start + selected.length);
  await pause(200);
  const sourceTools = await invoke(native(), "normalize");
  assert(
    source.value.includes("$\\alpha+\\beta$") &&
      source.value.includes("\\[ a_t="),
    "Source selection affected the rest of the note: " +
      JSON.stringify({
        status: sourceTools.textContent,
        selection: [source.selectionStart, source.selectionEnd],
        tail: source.value.slice(-450),
      }),
  );
  await shot("text-tools-source");
  const sourceDoc = source.querySelector("iframe").contentDocument;
  const cm = sourceDoc.querySelector(".cm-content");
  const undo = () =>
    cm.dispatchEvent(
      new sourceDoc.defaultView.KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  undo();
  assert(
    source.value === sourceBefore,
    "Source formatting cannot be undone in one step",
  );
  source.setSelectionRange(source.value.length, source.value.length);
  sourceTools.querySelector('[data-text-action="normalize"]').click();
  assert(
    source.value.includes("$$\na_t=\\frac{1}{2}\n$$") &&
      source.value.includes("`\\(literal\\)`") &&
      source.value.includes("\\[code\\]") &&
      source.value.includes("https://example.org/\\(x\\) [[note\\(id\\)]]"),
    "Source display math or protected text is incorrect",
  );
  main.resizeTo(700, 900);
  await pause(100);
  for (const altKey of [false, true]) {
    cm.focus();
    const event = new sourceDoc.defaultView.KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
      altKey,
      bubbles: true,
      cancelable: true,
    });
    cm.dispatchEvent(event);
    await wait(
      () => sourceDoc.querySelector(".cm-search"),
      "Source search shortcut failed: " +
        JSON.stringify({
          altKey,
          prevented: event.defaultPrevented,
          connected: cm.isConnected,
          platform: sourceDoc.defaultView.navigator.platform,
          readOnly: source.readOnly,
          disabled: source.disabled,
          sameDoc: source.querySelector("iframe").contentDocument === sourceDoc,
          panels: [...sourceDoc.querySelectorAll(".cm-panel")].map(
            (el) => el.outerHTML,
          ),
          mode: inline.eval("editorMode"),
        }),
    );
    assert(
      sourceDoc.querySelector('[name="showReplace"]').checked === altKey,
      "Source shortcut opened the wrong search mode",
    );
    sourceDoc.querySelector('.cm-search input[name="search"]').dispatchEvent(
      new sourceDoc.defaultView.KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(
      () => !sourceDoc.querySelector(".cm-search"),
      "Escape did not close source search",
    );
    cm.dispatchEvent(
      new sourceDoc.defaultView.KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await pause(100);
    assert(
      !inline.closed && inline.knowledgeBaseCardId === cardID,
      "Closing search navigated away from the note",
    );
  }
  await invoke(native(), "find");
  let search = await wait(
    () => sourceDoc.querySelector(".cm-search"),
    "Source find did not open",
  );
  assert(
    !search.querySelector('[name="showReplace"]').checked &&
      search.querySelector('input[name="replace"]').getBoundingClientRect()
        .height === 0,
    "Source toolbar search did not start in find mode",
  );
  await shot("search-source");
  search.querySelector('[name="showReplace"]').click();
  await invoke(native(), "find");
  await wait(
    () => !sourceDoc.querySelector(".cm-search"),
    "Source toolbar did not close search",
  );
  await invoke(native(), "find");
  search = await wait(
    () => sourceDoc.querySelector(".cm-search"),
    "Source search did not reopen",
  );
  assert(
    !search.querySelector('[name="showReplace"]').checked,
    "Reopened source search retained replacement mode",
  );
  search.querySelector('[name="showReplace"]').click();
  const fill = (field, value) => {
    field.value = value;
    field.dispatchEvent(
      new field.ownerDocument.defaultView.Event("change", { bubbles: true }),
    );
  };
  fill(search.querySelector('input[name="search"]'), "target");
  fill(search.querySelector('input[name="replace"]'), "result");
  search.querySelector('button[name="replaceAll"]').click();
  assert(
    source.value.includes("Replace result result."),
    "Source replacement failed",
  );
  undo();
  assert(
    source.value.includes("Replace target target."),
    "Source replace-all undo failed",
  );
  search.querySelector('button[name="replaceAll"]').click();
  search.querySelector('button[name="close"]').click();
  await inline.setEditorMode("visual");
  assert(
    core(native()).view.state.doc.textContent.includes(literalBackslashes),
    "Markdown round-trip changed literal backslashes",
  );
  for (const altKey of [false, true]) {
    const frame = native(),
      editable = frame.document.querySelector(".primary-editor");
    editable.focus();
    editable.dispatchEvent(
      new frame.KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(
      () => frame.document.querySelector(".findbar"),
      "Native search shortcut failed: " + altKey,
    );
    await wait(
      () =>
        frame.document.querySelector("#replace-checkbox")?.checked === altKey,
      "Native shortcut opened the wrong search mode",
    );
    core(frame).pluginState.search.setActive(false);
    await wait(
      () => !frame.document.querySelector(".findbar"),
      "Native search did not close",
    );
  }
  await invoke(native(), "find");
  await wait(
    () =>
      native().document.querySelector("#replace-checkbox")?.checked === false,
    "Native toolbar search did not start in find mode",
  );
  assert(
    native().document.querySelectorAll('.findbar input[type="text"]').length ===
      1,
    "Native search revealed replacement by default",
  );
  await shot("search-native");
  await invoke(native(), "find");
  await wait(
    () => !native().document.querySelector(".findbar"),
    "Native toolbar did not close search",
  );
  await invoke(native(), "find");
  await wait(
    () =>
      native().document.querySelector("#replace-checkbox")?.checked === false,
    "Native search did not reopen in find mode",
  );
  native().document.querySelector("#replace-checkbox").click();
  await wait(
    () =>
      native().document.querySelectorAll('.findbar input[type="text"]')
        .length === 2,
    "Native replacement did not expand",
  );
  const findFrame = native(),
    findView = core(findFrame).view;
  const findbar = findFrame.document.querySelector(".findbar"),
    fields = findbar.querySelectorAll('input[type="text"]');
  const reactFill = (field, value) => {
    Object.getOwnPropertyDescriptor(
      findFrame.wrappedJSObject.HTMLInputElement.prototype,
      "value",
    ).set.call(field, value);
    field.dispatchEvent(new findFrame.Event("input", { bubbles: true }));
  };
  reactFill(fields[0], "result");
  reactFill(fields[1], "final");
  await wait(
    () => core(findFrame).pluginState.search.searchTerm === "result",
    "Native search query did not update",
  );
  await wait(
    () => core(findFrame).pluginState.search.results.length === 2,
    "Native search did not find both results",
  );
  await pause(100);
  const beforeReplace = JSON.stringify(findView.state.doc.toJSON());
  [...findbar.querySelectorAll("button.text-button")].at(-1).click();
  assert(
    findView.state.doc.textContent.includes("Replace final final."),
    "Native replace-all failed: " +
      JSON.stringify({
        text: findView.state.doc.textContent,
        fields: [...fields].map((field) => field.value),
        buttons: [...findbar.querySelectorAll("button.text-button")].map(
          (button) => button.textContent,
        ),
      }),
  );
  findFrame.wrappedJSObject.doUndo();
  assert(
    JSON.stringify(findView.state.doc.toJSON()) === beforeReplace,
    "Native replace-all undo failed",
  );
  findFrame.wrappedJSObject.doRedo();
  assert(
    objects() === originalObjects,
    "Mode switching or replacement changed image/citation metadata",
  );
  const codeBlocks = [];
  findView.state.doc.descendants((node) => {
    node = node.wrappedJSObject || node;
    if (node.type.name === "codeBlock")
      codeBlocks.push(node.textContent.replace(/\n$/, ""));
  });
  assert(
    codeBlocks.includes("\\(code\\)\n\\[code\\]") &&
      codeBlocks.includes("\\[code\\]"),
    "Code block contents changed during formatting or mode switches: " +
      JSON.stringify(codeBlocks),
  );
  assert(await inline.save(false), "Could not save formatted note");
  main.resizeTo(1100, 900);
  const noteID = inline.eval("nativeNoteID");
  const ordinary = new Zotero.Item("note");
  ordinary.libraryID = Zotero.Libraries.userLibraryID;
  ordinary.setNote(
    await knowledgeBase.api.nativeNoteHTML("Ordinary tools", "Plain note"),
  );
  await ordinary.saveTx();
  const instance = await Zotero.Notes.open(ordinary.id, null, {
    openInWindow: true,
  });
  await instance._initPromise;
  const ordinaryWindow =
    instance._iframeWindow.browsingContext.embedderElement.ownerDocument
      .defaultView;
  const editor = ordinaryWindow.document.querySelector("note-editor");
  await wait(
    () =>
      editor
        .getCurrentInstance()
        ?._iframeWindow?.document.querySelector("[data-text-action=normalize]"),
    "Ordinary note text tools missing",
  );
  await pause(250);
  const ordinaryFrame = editor.getCurrentInstance()._iframeWindow,
    ordinaryCore = core(ordinaryFrame);
  ordinaryCore.view.dispatch(
    ordinaryCore.view.state.tr.insert(
      ordinaryCore.view.state.doc.content.size,
      ordinaryCore.view.state.schema.nodeFromJSON(
        ordinaryFrame.wrappedJSObject.JSON.parse(
          JSON.stringify(paragraph("\\(x\\) and $y$")),
        ),
      ),
    ),
  );
  await shot("text-tools-ordinary", ordinaryWindow);
  await invoke(ordinaryFrame, "normalize");
  assert(
    mathCount(ordinaryCore.view.state.doc) === 2,
    "Ordinary native formatting failed",
  );
  ordinaryFrame.document
    .querySelector(".knowledge-base-markdown-toggle")
    .click();
  const ordinarySource = await wait(
    () =>
      typeof ordinaryWindow.document.querySelector(
        ".knowledge-base-markdown-source",
      )?.value === "string" &&
      ordinaryFrame.document.body.classList.contains(
        "knowledge-base-source-mode",
      ) &&
      ordinaryWindow.document.querySelector(".knowledge-base-markdown-source"),
    "Ordinary source did not open",
  );
  ordinarySource.setRangeText(
    "\n\n\\(z\\)",
    ordinarySource.value.length,
    ordinarySource.value.length,
    "end",
  );
  ordinarySource.dispatchEvent(
    new ordinaryWindow.Event("input", { bubbles: true }),
  );
  await shot("text-tools-ordinary", ordinaryWindow);
  await invoke(ordinaryFrame, "normalize");
  assert(
    ordinarySource.value.includes("$z$"),
    "Ordinary source formatting failed",
  );
  ordinaryFrame.document
    .querySelector(".knowledge-base-markdown-toggle")
    .click();
  await wait(
    () =>
      Zotero.Items.getAsync(ordinary.id).then((item) =>
        item.getNote().includes("$z$"),
      ),
    "Ordinary note did not autosave",
  );
  ordinaryWindow.close();
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      cardID,
      noteID,
      body: (await knowledgeBase.api.getZettel(cardID)).body,
      html: (await Zotero.Items.getAsync(noteID)).getNote(),
      ordinaryID: ordinary.id,
    }),
  );
  quit();
}
