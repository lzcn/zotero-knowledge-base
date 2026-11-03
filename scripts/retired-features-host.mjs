/** Verify feature removal without changing notes or retained service credentials. */
export default async function retiredFeaturesHost({
  Zotero,
  IOUtils,
  PathUtils,
  Services,
  Components,
  setTimeout,
  marker,
  restartMarker,
  aiRequests,
}) {
  const knowledgeBase = Zotero.ZoteroKnowledgeBase,
    api = knowledgeBase.api;
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (check, message) => {
    for (let n = 0; n < 300; n++) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
  const quit = () =>
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  const retired = [
    "isAIEnabled",
    "setAIEnabled",
    "getAISettings",
    "setAISettings",
    "getAIModels",
    "testAIConnection",
    "findRelatedNotes",
    "cancelRelatedNotes",
  ];
  for (const name of retired)
    assert(!(name in api), "Retired feature remains callable: " + name);
  assert(
    !Zotero.PreferencePanes.pluginPanes.some(
      (pane) => pane.id === "knowledge-base-ai-preferences",
    ),
    "Retired Settings pane is registered",
  );
  const stored = () =>
    JSON.stringify({
      prefs: Object.fromEntries(
        [
          "enabled",
          "provider",
          "deepseek.model",
          "opencode-go.model",
          "opencode-api.model",
          "codex.path",
        ].map((key) => [
          key,
          Zotero.Prefs.get("extensions.zotero.knowledge-base.ai." + key, true),
        ]),
      ),
      keys: ["DeepSeek API", "OpenCode Go API", "OpenCode API"].map((realm) =>
        Services.logins
          .findLogins("chrome://knowledge-base", "", realm)
          .map((row) => row.password),
      ),
      templates: api.getLiteratureTemplateSettings(),
    });
  const state = async (ids) =>
    JSON.stringify(
      await Promise.all(
        ids.map(async (id) => ({
          note: await api.getZettel(id),
          family: await api.getFamily(id),
          links: await api.getOutgoing(id),
        })),
      ),
    );
  assert(
    !(await IOUtils.exists(aiRequests)),
    "Retired AI executed during startup",
  );
  if (await IOUtils.exists(marker)) {
    const first = JSON.parse(await IOUtils.readUTF8(marker));
    assert(
      stored() === first.stored,
      "Restart changed templates, saved settings or keys",
    );
    assert(
      (await state(first.ids)) === first.state,
      "Restart changed notes, hierarchy or manual links",
    );
    assert(
      (await IOUtils.readUTF8(first.oldCache)) === "retained summaries",
      "Retired summary cache was modified",
    );
    await knowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    quit();
    return;
  }
  assert(
    Zotero.Prefs.get("extensions.zotero.knowledge-base.ai.enabled", true) ===
      true,
    "Retirement rewrote the saved enabled preference",
  );
  for (const [realm, name] of [
    ["DeepSeek API", "deepseek"],
    ["OpenCode Go API", "opencode-go"],
    ["OpenCode API", "opencode-api"],
  ]) {
    const login = Components.classes[
      "@mozilla.org/login-manager/loginInfo;1"
    ].createInstance(Components.interfaces.nsILoginInfo);
    login.init(
      "chrome://knowledge-base",
      null,
      realm,
      name,
      "fixture-preserved-" + name,
      "",
      "",
    );
    await Services.logins.addLoginAsync(login);
  }
  Zotero.Prefs.set(
    "extensions.zotero.knowledge-base.ai.opencode-go.model",
    "retained-go-model",
    true,
  );
  Zotero.Prefs.set(
    "extensions.zotero.knowledge-base.ai.opencode-api.model",
    "retained-api-model",
    true,
  );
  const templateID = api.createLiteratureTemplate();
  const prompt =
    "Takeaway：一句话概括这篇论文最值得记住的研究启发。\n\n作者观察到什么现象？ Problem：现有方法存在什么问题？";
  api.updateLiteratureTemplate(templateID, {
    name: "Research template",
    body: prompt,
  });
  api.setLiteratureTemplate(templateID);
  const before = stored();
  const oldCache = PathUtils.join(
    Zotero.DataDirectory.dir,
    "knowledge-base-ai-summaries.json",
  );
  await IOUtils.writeUTF8(oldCache, "retained summaries");
  const paper = new Zotero.Item("journalArticle");
  paper.setField("title", "Source paper fixture");
  await paper.saveTx();
  const literatureID = await api.saveZettel({
    sourceNote: true,
    title: "Reading note",
    body: prompt,
    itemKey: paper.key,
    libraryID: paper.libraryID,
  });
  const targetID = await api.saveZettel({
    title: "Manual target",
    body: "A reusable claim.",
    customKey: "ManualTarget",
  });
  const currentID = await api.saveZettel({
    title: "Current note",
    body: prompt + "\n\n[[ManualTarget]]",
    parentId: literatureID,
  });
  const main = Zotero.getMainWindow();
  const preferences = Zotero.Utilities.Internal.openPreferences(
    "knowledge-base-preferences",
  );
  try {
    await wait(
      () =>
        preferences.document.getElementById("knowledge-base-source-style")
          ?.value,
      "Settings did not load",
    );
  } catch (error) {
    throw new Error(
      error.message +
        " " +
        JSON.stringify({
          pane: preferences.Zotero_Preferences?.navigation?.value,
          controls: [
            ...preferences.document.querySelectorAll("[id^='knowledge-base-']"),
          ].map((node) => node.id),
          message: preferences.document.getElementById(
            "knowledge-base-preferences-error",
          )?.textContent,
        }),
    );
  }
  assert(
    !preferences.document.querySelector('[id^="knowledge-base-ai-"]'),
    "Retired AI controls remain in Settings",
  );
  preferences.close();
  const open = async (id) => {
    api.openEditor({ zettelId: id });
    const manager = await wait(
      () =>
        main.document.querySelector(".knowledge-base-workbench")?.contentWindow
          ?.ZoteroKnowledgeBase_selectZettel &&
        main.document.querySelector(".knowledge-base-workbench").contentWindow,
      "Workbench did not open",
    );
    const editor = await wait(() => {
      const view = manager.document.getElementById(
        "knowledge-base-workbench-editor",
      ).contentWindow;
      return (
        view?.knowledgeBaseCardId === id && view.knowledgeBaseReady && view
      );
    }, "Note did not open");
    await editor.knowledgeBaseReady();
    assert(await editor.save(false), "Editor did not settle");
    assert(
      !editor.KnowledgeBaseConnections &&
        !editor.document.getElementById("knowledge-base-related-notes") &&
        !editor.document.getElementById("knowledge-base-connections"),
      "Retired note suggestions remain available",
    );
    assert(
      manager.document.getElementById("knowledge-base-btn-local-graph"),
      "Manual graph navigation was removed",
    );
    return editor;
  };
  let editor = await open(currentID);
  await editor.setEditorMode("source");
  assert(
    editor.document
      .getElementById("knowledge-base-editor-body")
      .value.includes("[[ManualTarget]]"),
    "Markdown mode lost the manual reference",
  );
  editor = await open(literatureID);
  assert(
    (await api.getZettel(literatureID)).item_key === paper.key,
    "Source-paper association changed",
  );
  editor = await open(currentID);
  await editor.setEditorMode("visual");
  assert(
    (await api.getOutgoing(currentID)).some(
      (link) => link.targetId === targetID,
    ),
    "Manual outgoing link was lost",
  );
  assert(
    (await api.getBacklinks(targetID)).some(
      (link) => link.sourceId === currentID,
    ),
    "Manual backlink was lost",
  );
  assert(
    (await api.getFamily(currentID)).parent?.id === literatureID,
    "Manual hierarchy was changed",
  );
  assert(
    stored() === before && !(await IOUtils.exists(aiRequests)),
    "Navigation changed retained settings or executed AI",
  );
  await editor.knowledgeBasePrepareNavigation();
  const ids = [literatureID, currentID, targetID];
  const result = {
    connectionsOnly: true,
    ids,
    stored: before,
    state: await state(ids),
    oldCache,
  };
  await knowledgeBase.hooks.onShutdown();
  await IOUtils.writeUTF8(marker, JSON.stringify(result));
  quit();
}
