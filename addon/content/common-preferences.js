/* global Zotero */
window.MozXULElement.insertFTLIfNeeded("similar-works.ftl");
window.MozXULElement.insertFTLIfNeeded("knowledge-base-addon.ftl");
window.KnowledgeBaseCommonPreferences?.stop();
window.KnowledgeBaseCommonPreferences = (() => {
  let timer,
    generation = 0;
  const stop = () => {
    generation++;
    window.clearTimeout(timer);
  };
  function renderProgress(doc, status) {
    for (const [id, total, done, enabled] of [
      [
        "similar-works-index-progress",
        status.state === "scanning" && status.totalItems === null
          ? 0
          : (status.totalItems ?? status.indexProgress.total),
        status.indexProgress.phase === "loading"
          ? status.indexProgress.done
          : status.indexedItems,
        ["preparing", "scanning", "indexing"].includes(status.state),
      ],
      [
        "similar-works-vector-progress",
        status.vectorTotal,
        status.semantic.indexedItems,
        !["disabled", "idle", "stopped"].includes(status.semantic.state),
      ],
    ]) {
      const bar = doc.getElementById(id);
      bar.hidden = !enabled;
      if (total > 0) {
        bar.max = total;
        bar.value = Math.min(done, total);
      } else bar.removeAttribute("value");
    }
  }

  async function start(doc) {
    stop();
    const token = generation;
    const api = Zotero.ZoteroKnowledgeBase.api;
    const style = doc.getElementById("knowledge-base-ui-style");
    style.value =
      Zotero.Prefs.get("extensions.zotero.plugin-ui.bear", true) === true
        ? "bear"
        : "minimal";
    if (!style.dataset.bound) {
      style.dataset.bound = "true";
      style.addEventListener("command", () =>
        window.ZoteroPluginUI.select(style.value),
      );
    }
    async function refresh() {
      const status = api.getLibraryStatus();
      const root = doc.getElementById("similar-works-diagnostics");
      if (token !== generation || !root?.isConnected) return;
      root.hidden = !status;
      if (!status) {
        if (api.getLibraryState() === "idle")
          timer = window.setTimeout(refresh, 1000);
        return;
      }
      try {
        const phase = await doc.l10n.formatValue(
          "similar-works-state-" + status.state,
        );
        const vectorPhase = await doc.l10n.formatValue(
          "similar-works-state-" + status.semantic.state,
        );
        const deferred = status.indexProgress.phase === "idle";
        const indexText = deferred
          ? phase
          : await doc.l10n.formatValue("similar-works-pref-index-value", {
              phase,
              count: status.indexedItems,
              total: status.totalItems ?? status.indexProgress.total ?? 0,
              known: Number(status.totalItems !== null),
            });
        const vectorText = deferred
          ? phase
          : await doc.l10n.formatValue("similar-works-pref-vector-value", {
              phase: vectorPhase,
              count: status.semantic.indexedItems,
              total: status.vectorTotal,
            });
        if (token !== generation || !root.isConnected) return;
        for (const [id, text] of Object.entries({
          "similar-works-index": indexText,
          "similar-works-vectors": vectorText,
        }))
          doc.getElementById(id).textContent = text;
        renderProgress(doc, status);
        const error = doc.getElementById("similar-works-diagnostics-error");
        error.textContent =
          status.error || status.semantic.error
            ? await doc.l10n.formatValue("similar-works-pref-error")
            : "";
        error.hidden = !error.textContent;
      } catch (error) {
        Zotero.logError(error);
      }
      if (token === generation) timer = window.setTimeout(refresh, 1000);
    }
    await refresh();
  }
  window.addEventListener("unload", stop, { once: true });
  return { start, stop };
})();
