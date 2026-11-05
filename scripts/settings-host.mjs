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
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  for (const type of ["literature", "zettel", "thinking", "entity"])
    await api.saveZettel({
      title: type,
      body: "Original body",
      noteType: type,
    });
  const template = api.createLiteratureTemplate();
  api.updateLiteratureTemplate(template, {
    name: "Reading",
    body: "## Reading",
  });
  const settings = Zotero.Utilities.Internal.openPreferences(
    "knowledge-base-preferences",
  );
  await wait(
    () =>
      settings.document.getElementById("knowledge-base-literature-template"),
    "Settings did not load",
  );
  settings.resizeTo(940, 1000);
  const doc = settings.document;
  await wait(
    () => doc.getElementById("knowledge-base-source-style").value,
    "Citation styles did not load",
  );
  await wait(
    () =>
      doc.getElementById("knowledge-base-literature-template")?.value ===
      template,
    "Template choice did not load",
  ).catch((error) => {
    throw new Error(
      String(error) +
        " " +
        JSON.stringify({
          expected: template,
          value: doc.getElementById("knowledge-base-literature-template")
            ?.value,
          html: doc.getElementById("knowledge-base-literature-template")
            ?.outerHTML,
          error: doc.getElementById("knowledge-base-preferences-error")
            ?.textContent,
        }),
    );
  });
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
  assert(
    groups.length === 7 &&
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
  const menu = doc.getElementById("knowledge-base-literature-template");
  menu.value = "";
  menu.dispatchEvent(new settings.Event("command", { bubbles: true }));
  assert(
    api.getNoteTemplate("literature") === null,
    "Main template choice was not saved",
  );
  menu.value = template;
  menu.dispatchEvent(new settings.Event("command", { bubbles: true }));
  const assigned = { literature: { id: template, body: "## Reading" } };
  for (const noteType of ["zettel", "thinking", "entity"]) {
    const control = doc.getElementById(
      "knowledge-base-" + noteType + "-template",
    );
    assert(control, "Missing template selector: " + noteType);
    assert(!control.value, "Unassigned type inherited a template: " + noteType);
    const id = api.createLiteratureTemplate(noteType);
    const body = "## " + noteType;
    api.updateLiteratureTemplate(id, { name: noteType, body });
    await wait(
      () => control.value === id,
      "Created template was not synchronized",
    );
    control.value = "";
    control.dispatchEvent(new settings.Event("command", { bubbles: true }));
    assert(
      api.getNoteTemplate(noteType) === null,
      "Could not clear " + noteType,
    );
    control.value = id;
    control.dispatchEvent(new settings.Event("command", { bubbles: true }));
    assert(
      api.getNoteTemplate(noteType) === id &&
        api.getNewNoteBody(noteType) === body &&
        api.getNewNoteBody("literature") === "## Reading",
      "Template choices are not independent: " + noteType,
    );
    assigned[noteType] = { id, body };
  }
  const templateMenus = [...doc.querySelectorAll("[data-template-type]")];
  const boxes = templateMenus.map((control) => control.getBoundingClientRect());
  assert(
    boxes.every(
      (box) =>
        Math.abs(box.x - boxes[0].x) < 2 &&
        Math.abs(box.width - boxes[0].width) < 2,
    ),
    "Template selectors are not aligned",
  );
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
      doc.getElementById("knowledge-base-entity-template").value ===
      assigned.entity.id,
    "Settings did not reflect the external assignment",
  );
  api.updateLiteratureTemplate(assigned.entity.id, { name: "Entity notes" });
  await wait(
    () =>
      doc
        .getElementById("knowledge-base-entity-template")
        .querySelector('[value="' + assigned.entity.id + '"]')
        ?.getAttribute("label") === "Entity notes",
    "Settings retained the old template name",
  );
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
    JSON.stringify({ connectionsOnly: true, templates: assigned }),
  );
  quit();
}
