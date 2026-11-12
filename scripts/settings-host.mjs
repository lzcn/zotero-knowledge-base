/** Minimal native Settings and type-specific templates in a disposable library. */
export default async function settingsHost({
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
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (read, message) => {
    for (let i = 0; i < 400; i++) {
      const value = await read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
  const capture = async (win, name) => {
    if (!screenshots) return;
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
    const picture = await win.browsingContext.currentWindowGlobal.drawSnapshot(
      undefined,
      1,
      "white",
    );
    const canvas = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = picture.width;
    canvas.height = picture.height;
    canvas.getContext("2d").drawImage(picture, 0, 0);
    picture.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    await IOUtils.write(
      PathUtils.join(screenshots, name + ".png"),
      new Uint8Array(await blob.arrayBuffer()),
    );
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  if (await IOUtils.exists(marker)) {
    const saved = JSON.parse(await IOUtils.readUTF8(marker));
    for (const [type, template] of Object.entries(saved.templates))
      assert(
        api.getNoteTemplate(type) === template.id &&
          api.getNewNoteBody(type) === template.body,
        "Template assignment changed after restart: " + type,
      );
    assert(
      (await api.getNoteCounts()).total === 4,
      "Note counts changed after restart",
    );
    assert(
      JSON.stringify(api.getGraphGroups()) === JSON.stringify(saved.groups),
      "Typed graph groups changed after restart",
    );
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  const examples = {
    literature: [
      "读懂一篇论文",
      "先理解问题，再记录方法与证据。把自己的判断和原文结论分开。",
    ],
    zettel: [
      "让想法彼此连接",
      "一张笔记只保留一个清楚的想法。通过链接，逐渐形成自己的知识网络。",
    ],
    thinking: [
      "保留思考的过程",
      "记录尚未解决的问题，也记录下一次阅读时需要寻找的线索。",
    ],
    entity: [
      "让笔记回到阅读本身",
      "## 清楚地表达一个想法\n\nA clear thought, a useful connection. 用自己的话记录值得留下的洞见。[阅读线索](https://example.org/research)\n\n## 数学与思考\n\n在预算 $K \\ll N$ 下，保留对任务最重要的视觉信息。\n\n$$\n\\min_{\\mathcal S:\\, |\\mathcal S| \\le K} \\mathcal L(\\mathcal S)\n$$\n\n> 好的笔记，让下一次思考有一个清楚的起点。",
    ],
  };
  for (const [noteType, [title, body]] of Object.entries(examples))
    await api.saveZettel({ title, body, noteType });
  const template = api.createLiteratureTemplate();
  api.updateLiteratureTemplate(template, {
    name: "Reading",
    body: "## Reading",
  });
  const settings = Zotero.Utilities.Internal.openPreferences(
    "knowledge-base-preferences",
  );
  await wait(
    () => settings.document.getElementById("knowledge-base-template-manage"),
    "Settings did not load",
  );
  settings.resizeTo(940, 1000);
  const doc = settings.document;
  await wait(
    () => doc.getElementById("knowledge-base-workbench-mode").value,
    "Note settings did not load",
  );
  assert(
    !doc.getElementById("knowledge-base-source-style"),
    "Source style control remains",
  );
  assert(
    !doc.getElementById("similar-works-limit"),
    "Manual result batching remains exposed",
  );
  assert(
    !doc.querySelector("[data-template-type]"),
    "Settings still repeats every template selector",
  );
  const mathPreview = doc.getElementById("knowledge-base-math-preview");
  assert(
    mathPreview?.closest(".settings-enhancement"),
    "Math preview is outside Enhancement",
  );
  await wait(
    () => mathPreview?.checked && mathPreview.getAttribute("label"),
    "Math preview checkbox did not initialize",
  );
  assert(
    mathPreview?.checked && !mathPreview.getAttribute("label").includes(";"),
    "Math preview option is missing or verbose",
  );
  for (const enabled of [false, true]) {
    mathPreview.checked = enabled;
    mathPreview.dispatchEvent(new settings.Event("command", { bubbles: true }));
    await wait(
      () =>
        Zotero.Prefs.get(
          "extensions.zotero.knowledge-base.mathPreview",
          true,
        ) === enabled,
      "Math preview setting did not save",
    );
  }
  const takeover = doc.getElementById("knowledge-base-native-note-takeover");
  assert(
    takeover?.checked && takeover.getAttribute("label"),
    "Native note takeover setting is missing or unnamed",
  );
  for (const enabled of [false, true]) {
    takeover.checked = enabled;
    takeover.dispatchEvent(new settings.Event("command", { bubbles: true }));
    await wait(
      () => !takeover.disabled && api.getNativeNoteTakeover() === enabled,
      "Native note takeover setting did not save",
    );
  }
  const groups = [...doc.querySelectorAll(".plugin-preferences .main-section")];
  assert(groups.length === 6, "Settings sections are missing or duplicated");
  assert(
    new Set(
      groups.map(
        (group) =>
          settings.getComputedStyle(group.querySelector(":scope > h3")).color,
      ),
    ).size === 1,
    "Settings headings use different colors",
  );
  assert(
    groups.every(
      (group) =>
        settings.getComputedStyle(group).backgroundColor === "rgba(0, 0, 0, 0)",
    ) &&
      groups
        .slice(1)
        .every(
          (group) =>
            parseFloat(settings.getComputedStyle(group).borderTopWidth) >= 1,
        ),
    "Settings sections lack neutral separators",
  );
  assert(
    doc
      .getElementById("knowledge-base-graph-appearance")
      .closest(".main-section")
      .classList.contains("settings-graph"),
    "Graph is nested under Notes",
  );
  assert(
    doc
      .getElementById("similar-works-diagnostics")
      .closest(".main-section")
      .classList.contains("settings-status"),
    "Cache is nested under Similar Items",
  );
  const excluded = doc.getElementById("similar-works-excluded-tags");
  await wait(
    () => excluded.placeholder,
    "The exclusion placeholder did not translate",
  );
  assert(
    !doc.getElementById("similar-works-excluded-tags-help") &&
      !excluded.value &&
      excluded.placeholder.length < 50,
    "Excluded tags retain long helper text",
  );
  const assigned = { literature: { id: template, body: "## Reading" } };
  for (const noteType of ["zettel", "thinking", "entity"]) {
    const id = api.createLiteratureTemplate(noteType),
      body = "## " + noteType;
    api.updateLiteratureTemplate(id, { name: noteType, body });
    api.setNoteTemplate(noteType, id);
    assigned[noteType] = { id, body };
  }
  api.setNoteTemplate("entity", null);
  doc.getElementById("knowledge-base-template-manage").click();
  const manager = await wait(
    () => Services.wm.getMostRecentWindow("knowledge-base:templates"),
    "Template manager did not open",
  );
  await wait(
    () =>
      manager.document.getElementById("knowledge-base-template-name")?.value ===
      "Reading",
    "Template editor did not load",
  );
  const type = manager.document.getElementById("knowledge-base-template-type"),
    use = manager.document.getElementById("knowledge-base-template-default");
  type.value = "entity";
  type.dispatchEvent(new manager.Event("command", { bubbles: true }));
  assert(!use.checked, "Entity unexpectedly inherited the literature template");
  use.checked = true;
  use.dispatchEvent(new manager.Event("command", { bubbles: true }));
  assert(
    api.getNewNoteBody("entity") === "## Reading",
    "The type-specific template was not assigned",
  );
  use.checked = false;
  use.dispatchEvent(new manager.Event("command", { bubbles: true }));
  assert(
    api.getNewNoteBody("literature") === "## Reading" &&
      api.getNewNoteBody("entity") === "",
    "Changing Entity changed Literature",
  );
  type.value = "entity";
  type.dispatchEvent(new manager.Event("command", { bubbles: true }));
  manager.document.getElementById("knowledge-base-template-new").click();
  const entityTemplate = api.getNoteTemplate("entity");
  assert(
    entityTemplate && entityTemplate !== template,
    "New template was not assigned to the chosen type",
  );
  const body = manager.document.getElementById("knowledge-base-template-body");
  body.value = "## Entity";
  body.dispatchEvent(new manager.Event("input", { bubbles: true }));
  assert(
    api.getNewNoteBody("entity") === "## Entity" &&
      api.getNewNoteBody("literature") === "## Reading",
    "Type-specific templates overwrote each other",
  );
  type.value = "literature";
  type.dispatchEvent(new manager.Event("command", { bubbles: true }));
  assert(
    body.value === "## Reading" && use.checked,
    "Switching type did not select its assigned template",
  );
  api.deleteLiteratureTemplate(entityTemplate);
  assert(
    api.getNoteTemplate("entity") === null,
    "Deleting a template left its type assignment",
  );
  assert(
    !type.closest("#knowledge-base-template-editor"),
    "Type selection is hidden inside a template editor",
  );
  if (manager.matchMedia("(prefers-color-scheme: dark)").matches) {
    const surface = manager.document.querySelector(".template-window");
    const background = manager
      .getComputedStyle(surface)
      .backgroundColor.match(/\d+(?:\.\d+)?/g)
      ?.map(Number);
    assert(
      background && background.slice(0, 3).every((value) => value < 128),
      "Dark template header has a light background",
    );
  }
  await capture(manager, "templates");
  manager.close();
  api.setNoteTemplate("entity", assigned.entity.id);
  await wait(
    () =>
      doc
        .getElementById("knowledge-base-note-counts")
        .textContent.includes("4"),
    "Note counts did not appear",
  );
  const extra = await api.saveZettel({
    title: "Live count",
    body: "",
    noteType: "entity",
  });
  await wait(
    () =>
      doc
        .getElementById("knowledge-base-note-counts")
        .textContent.includes("5"),
    "Creating a note did not refresh the status",
  );
  await api.deleteZettel(extra);
  await wait(
    async () =>
      (await api.getNoteCounts()).total === 4 &&
      !doc
        .getElementById("knowledge-base-note-counts")
        .textContent.includes("5"),
    "Trashing a note did not refresh the status",
  );
  const original = api.getLibraryStatus;
  const snapshot = original();
  api.getLibraryStatus = () => ({
    ...snapshot,
    state: "idle",
    indexedItems: 10,
    indexProgress: { phase: "ready", done: 10, total: 10 },
    vectorTotal: 10,
    totalItems: 10,
    semantic: {
      ...snapshot.semantic,
      state: "indexing",
      indexedItems: 2,
      error: null,
    },
  });
  await wait(
    () => doc.getElementById("similar-works-cache-progress").value === 2,
    "Vector progress did not update",
  );
  assert(
    doc.getElementById("similar-works-cache-status").textContent.length < 15,
    "Cache status is verbose",
  );
  api.getLibraryStatus = () => ({
    ...snapshot,
    state: "preparing",
    indexedItems: 0,
    totalItems: 10,
    indexProgress: { phase: "loading", done: 3, total: 10 },
    semantic: {
      ...snapshot.semantic,
      state: "disabled",
      indexedItems: 0,
      error: null,
    },
  });
  await wait(
    () => doc.getElementById("similar-works-cache-progress").value === 3,
    "Feature cache loading was hidden behind an idle semantic state",
  );
  api.openEditor({ zettelId: (await api.listZettels())[0].id });
  const main = Zotero.getMainWindow();
  const current = () =>
    main.document
      .querySelector(".knowledge-base-workbench")
      ?.contentWindow?.document.getElementById(
        "knowledge-base-workbench-editor",
      )?.contentWindow;
  const note = await wait(
    () => current()?.knowledgeBaseReady && current(),
    "Appearance editor did not open",
  );
  await note.knowledgeBaseReady();
  const addGroup = doc.getElementById("knowledge-base-add-group");
  const originalTags = await api.getGraphTags();
  addGroup.click();
  const customTag = "#Custom graph topic";
  const groupInput = await wait(
    () => doc.querySelector(".graph-group-tag"),
    "Editable graph tag did not appear",
  );
  assert(groupInput.localName === "input", "Graph tags remain selection-only");
  groupInput.value = "  " + customTag + "  ";
  groupInput.dispatchEvent(
    new settings.KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
  );
  assert(
    api.getGraphGroups()[0].tag === customTag,
    "A tag outside the vocabulary was rejected",
  );
  assert(
    groupInput.value === customTag &&
      [...groupInput.list.options].some((option) => option.value === customTag),
    "Typed tag was not offered as a suggestion",
  );
  assert(
    JSON.stringify(await api.getGraphTags()) === JSON.stringify(originalTags),
    "Graph configuration added tags to notes",
  );
  const appearance = doc.getElementById("knowledge-base-ui-style");
  assert(
    !doc.getElementById("knowledge-base-custom-css") &&
      !appearance.querySelector('[value="paper"]'),
    "Retired appearance controls remain",
  );
  const card = await api.getZettel((await api.listZettels())[0].id);
  const originalBody = card.body;
  main.resizeTo(1180, 900);
  const samples = new Map();
  for (const style of ["minimal", "bear", "notes"]) {
    appearance.value = style;
    appearance.dispatchEvent(new settings.Event("command", { bubbles: true }));
    await wait(
      () =>
        note.document.documentElement.hasAttribute("data-plugin-bear") ===
          (style !== "minimal") &&
        note.document.documentElement.hasAttribute("data-plugin-notes") ===
          (style === "notes"),
      "Open note did not adopt " + style,
    );
    const primary = await wait(() => {
      const frame = note.document
        .querySelector("note-editor")
        ?.getCurrentInstance()?._iframeWindow;
      const element = frame?.document.querySelector(".primary-editor");
      return element && { frame, element };
    }, "Native typography surface is unavailable");
    await primary.frame.document.fonts.ready;
    const prose = primary.frame.getComputedStyle(primary.element);
    const heading = primary.frame.getComputedStyle(
      primary.element.querySelector("h1"),
    );
    const formula = primary.element.querySelector(".katex");
    assert(
      formula && !primary.element.querySelector(".katex-error"),
      "Formula did not render in " + style,
    );
    const math = primary.frame.getComputedStyle(formula);
    samples.set(style, {
      font: prose.fontFamily,
      heading: heading.fontWeight,
      headingSize: heading.fontSize,
      bodySize: prose.fontSize,
      width: prose.maxWidth,
      math: math.fontSize,
      leading: prose.lineHeight,
      link: primary.frame.getComputedStyle(
        primary.element.querySelector('a[href="https://example.org/research"]'),
      ).color,
    });
    assert(
      math.fontFamily.includes("KaTeX"),
      "Prose typography replaced mathematical glyph fonts",
    );
    await capture(main, style + "-style");
    await note.setEditorMode("source");
    const sourceDocument = note.document
      .getElementById("knowledge-base-editor-body")
      .querySelector("iframe").contentDocument;
    const scroller = sourceDocument.querySelector(".cm-scroller");
    const sourceStyle = sourceDocument.defaultView.getComputedStyle(scroller);
    assert(
      sourceStyle.fontFamily === prose.fontFamily,
      "Markdown did not inherit the " + style + " font",
    );
    assert(
      sourceStyle.lineHeight === prose.lineHeight,
      "Markdown did not inherit the " + style + " leading",
    );
    if (style === "minimal") await capture(note, "minimal-markdown");
    await note.setEditorMode("visual");
  }
  assert(
    new Set([...samples.values()].map((sample) => sample.font)).size === 3,
    "Notebook styles share one prose font",
  );
  for (const property of [
    "headingSize",
    "bodySize",
    "width",
    "math",
    "leading",
  ]) {
    assert(
      new Set([...samples.values()].map((sample) => sample[property])).size ===
        1,
      "Switching style changed document geometry: " + property,
    );
  }
  assert(
    Number(samples.get("bear").heading) <
      Number(samples.get("minimal").heading),
    "Bear headings are still too heavy",
  );
  assert(
    new Set([...samples.values()].map((sample) => sample.link)).size === 3,
    "Styles did not apply their link colors",
  );
  assert(await note.save(false), "Appearance changes prevented saving");
  assert(
    (await api.getZettel(card.id)).body === originalBody,
    "Appearance changes modified saved note content",
  );
  const plain = doc.querySelector(".plugin-preferences");
  for (const width of [940, 720]) {
    settings.resizeTo(width, 1000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(
      plain.scrollWidth <= plain.clientWidth + 2,
      "Settings overflow horizontally",
    );
    await capture(settings, "settings-" + width);
  }
  api.getLibraryStatus = original;
  settings.close();
  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({
      connectionsOnly: true,
      templates: assigned,
      groups: api.getGraphGroups(),
    }),
  );
  quit();
}
