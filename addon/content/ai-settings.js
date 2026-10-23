/* global Zotero */
window.MozXULElement.insertFTLIfNeeded("knowledge-base-addon.ftl");
const initializedAISettings = new WeakSet();
window.KnowledgeBaseAISettings = {
  async start(doc) {
    const root = doc.getElementById("knowledge-base-ai-settings");
    if (initializedAISettings.has(root)) return;
    initializedAISettings.add(root);
    const api = Zotero.ZoteroKnowledgeBase.api;
    const get = (suffix) => doc.getElementById(`knowledge-base-ai-${suffix}`);
    const enabled = /** @type {HTMLInputElement} */ (get("enabled"));
    const controls = get("controls");
    const provider = /** @type {XULMenuListElement} */ (
      /** @type {unknown} */ (get("provider"))
    );
    const model = /** @type {HTMLInputElement} */ (get("model"));
    const path = /** @type {HTMLInputElement} */ (get("path"));
    const key = /** @type {HTMLInputElement} */ (get("key"));
    const toggleKey = get("toggle-key");
    const status = get("status");
    const test = get("test");
    const listButton = get("list");
    let keyVisible = false;
    let queue = Promise.resolve();
    let job = null;
    let stopped = false;
    let modelJob = null;
    let cancelled = false;
    const showError = (error) => {
      if (!stopped && api.isAIEnabled())
        status.textContent = String(error.message || error);
    };
    const renderKeyVisibility = () => {
      key.type = keyVisible ? "text" : "password";
      toggleKey.setAttribute("aria-pressed", String(keyVisible));
      const label = api.loc(keyVisible ? "ai-hide-key" : "ai-show-key");
      toggleKey.setAttribute("aria-label", label);
      toggleKey.setAttribute("title", label);
      toggleKey.setAttribute(
        "label",
        api.loc(keyVisible ? "ai-hide-key-short" : "ai-show-key-short"),
      );
    };
    const render = () => {
      enabled.checked = api.isAIEnabled();
      controls.hidden = !enabled.checked;
      if (!enabled.checked) {
        key.value = "";
        keyVisible = false;
        renderKeyVisibility();
        status.textContent = "";
        return;
      }
      let settings;
      try {
        settings = api.getAISettings();
      } catch (error) {
        provider.selectedIndex = -1;
        model.value = "";
        for (const control of [model, test, listButton])
          control.setAttribute("disabled", "true");
        get("key-row").hidden = true;
        get("path-row").hidden = true;
        get("help").textContent = "";
        status.textContent = api.loc("ai-provider-unavailable");
        Zotero.logError(error);
        return;
      }
      for (const control of [model, test, listButton])
        control.removeAttribute("disabled");
      const isAPI = settings.requiresKey;
      provider.value = settings.provider;
      model.value = settings.model;
      path.value = settings.path;
      key.value = "";
      keyVisible = false;
      renderKeyVisibility();
      get("remove-key").hidden = !settings.hasStoredKey;
      key.placeholder = api.loc(
        settings.hasKey ? "ai-key-stored" : "ai-key-placeholder",
      );
      get("key-row").hidden = !isAPI;
      get("path-row").hidden = isAPI;
      path.placeholder = api.loc("ai-cli-auto-path");
      get("help").textContent = api.loc(
        settings.provider === "opencode-go"
          ? "pref-ai-opencode-go-help"
          : isAPI
            ? "pref-ai-api-help"
            : "pref-ai-cli-help",
        { provider: "Codex" },
      );
      renderModels(
        settings.provider === "deepseek"
          ? ["deepseek-flash", "deepseek-v4-pro"]
          : isAPI
            ? ["glm-5.3-flash", "deepseek-v4.1-flash"]
            : [],
      );
      model.value = settings.model;
      model.placeholder = api.loc("ai-default-model");
    };
    const renderModels = (values) => {
      const models = get("models");
      models.replaceChildren();
      for (const value of ["", ...values]) {
        const option = doc.createXULElement("menuitem");
        option.setAttribute("value", value);
        option.setAttribute("label", value || api.loc("ai-default-model"));
        models.append(option);
      }
    };
    const enqueue = (input) => {
      queue = queue
        .catch(() => {})
        .then(async () => {
          await api.setAISettings(input);
          if (!stopped) status.textContent = "";
        });
      queue.catch(showError);
      return queue;
    };
    enabled.addEventListener("change", () => api.setAIEnabled(enabled.checked));
    const unsubscribe = api.onAIEnabledChange(() => {
      if (!api.isAIEnabled()) {
        cancelled = true;
        if (job) api.cancelAIJob(job);
        if (modelJob) api.cancelAIJob(modelJob);
      }
      render();
    });
    provider.addEventListener("command", () => {
      if (modelJob) api.cancelAIJob(modelJob);
      cancelled = true;
      if (job) api.cancelAIJob(job);
      enqueue({ provider: provider.value })
        .then(() => {
          if (!stopped) render();
        })
        .catch(showError);
    });
    toggleKey.addEventListener("command", () => {
      keyVisible = !keyVisible;
      renderKeyVisibility();
    });
    get("remove-key").addEventListener("command", () => {
      enqueue({ provider: provider.value, key: "" })
        .then(() => {
          if (!stopped) render();
        })
        .catch(showError);
    });
    listButton.addEventListener("command", async () => {
      if (modelJob) {
        api.cancelAIJob(modelJob);
        return;
      }
      const selected = provider.value;
      const id = `ai-models-${Date.now()}-${Math.random()}`;
      modelJob = id;
      listButton.setAttribute("label", api.loc("ai-cancel"));
      status.textContent = api.loc("ai-listing-models");
      try {
        await queue;
        if (stopped || !api.isAIEnabled() || provider.value !== selected)
          return;
        const values = await api.getAIModels(id);
        if (stopped || !api.isAIEnabled() || provider.value !== selected)
          return;
        const value = model.value;
        renderModels(values);
        model.value = value;
        status.textContent = api.loc("ai-models-listed", {
          count: values.length,
        });
        /** @type {XULPopupElement} */ (
          /** @type {unknown} */ (get("models"))
        ).openPopup(listButton, "after_start", 0, 0, false, false);
      } catch (error) {
        if (provider.value === selected) showError(error);
      } finally {
        if (modelJob === id) modelJob = null;
        if (!stopped)
          listButton.setAttribute("label", api.loc("ai-list-models"));
      }
    });
    get("models").addEventListener("command", (event) => {
      const value = /** @type {Element} */ (event.target).getAttribute("value");
      if (value === null) return;
      model.value = value;
      enqueue({ provider: provider.value, model: value }).catch(showError);
    });
    const fields =
      /** @type {[HTMLInputElement, "model" | "path" | "key"][]} */ ([
        [model, "model"],
        [path, "path"],
        [key, "key"],
      ]);
    for (const [control, field] of fields) {
      const save = () => {
        const input = { provider: provider.value, [field]: control.value };
        if (field === "key") control.value = "";
        enqueue(input)
          .then(() => {
            if (field === "key" && !stopped)
              get("remove-key").hidden = !api.getAISettings().hasStoredKey;
            if (field === "key" && !stopped)
              key.placeholder = api.loc(
                api.getAISettings().hasKey
                  ? "ai-key-stored"
                  : "ai-key-placeholder",
              );
          })
          .catch(showError);
      };
      control.addEventListener("change", save);
    }
    test.addEventListener("command", async () => {
      if (job) {
        cancelled = true;
        api.cancelAIJob(job);
        return;
      }
      cancelled = false;
      job = `ai-test-${Date.now()}-${Math.random()}`;
      test.setAttribute("label", api.loc("ai-cancel"));
      status.textContent = api.loc("ai-testing");
      try {
        await queue;
        if (stopped || cancelled || !api.isAIEnabled()) return;
        await api.testAIConnection(job);
        if (!stopped && api.isAIEnabled())
          status.textContent = api.loc("ai-test-success");
      } catch (error) {
        showError(error);
      } finally {
        job = null;
        if (!stopped) {
          test.setAttribute("label", api.loc("ai-test"));
          if (cancelled) status.textContent = api.loc("ai-cancelled");
        }
      }
    });
    doc.defaultView.addEventListener(
      "unload",
      () => {
        stopped = true;
        unsubscribe();
        if (job) api.cancelAIJob(job);
        if (modelJob) api.cancelAIJob(modelJob);
      },
      { once: true },
    );
    test.setAttribute("label", api.loc("ai-test"));
    listButton.setAttribute("label", api.loc("ai-list-models"));
    renderKeyVisibility();
    render();
  },
};
