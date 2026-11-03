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
        const semantic = status.semantic;
        const textBusy = !["idle", "disabled", "stopped"].includes(
          status.state,
        );
        const vectorBusy =
          Zotero.isMac &&
          !["idle", "disabled", "stopped"].includes(semantic.state);
        const busy = textBusy || vectorBusy;
        const phase = await doc.l10n.formatValue(
          "similar-works-state-" +
            (textBusy ? status.state : vectorBusy ? semantic.state : "idle"),
        );
        const total =
          status.totalItems ??
          status.indexProgress.total ??
          status.indexedItems;
        const done =
          status.indexProgress.phase === "loading"
            ? status.indexProgress.done
            : vectorBusy
              ? semantic.indexedItems
              : status.indexedItems;
        const text = await doc.l10n.formatValue(
          busy
            ? "similar-works-pref-index-value"
            : "similar-works-pref-cache-ready",
          { phase, count: done, total, known: Number(total > 0) },
        );
        if (token !== generation || !root.isConnected) return;
        doc.getElementById("similar-works-cache-status").textContent = text;
        const bar = doc.getElementById("similar-works-cache-progress");
        bar.hidden = !busy;
        if (total > 0) {
          bar.max = total;
          bar.value = Math.min(done, total);
        } else bar.removeAttribute("value");
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
