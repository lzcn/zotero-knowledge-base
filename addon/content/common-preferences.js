/* global Zotero */
window.MozXULElement.insertFTLIfNeeded("similar-works.ftl");
window.MozXULElement.insertFTLIfNeeded("knowledge-base-addon.ftl");
window.KnowledgeBaseCommonPreferences?.stop();
window.KnowledgeBaseCommonPreferences = (() => {
  let timer,
    generation = 0,
    unsubscribe;
  const stop = () => {
    generation++;
    window.clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = undefined;
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
        const textBusy = !["idle", "disabled", "stopped", "error"].includes(
          status.state,
        );
        const vectorBusy =
          semantic &&
          !["idle", "disabled", "stopped", "error"].includes(semantic.state);
        const busy = textBusy || vectorBusy;
        const failed =
          status.error ||
          semantic?.error ||
          status.state === "error" ||
          semantic?.state === "error";
        const phase = failed ? "error" : busy ? "updating" : "ready";
        const text = await doc.l10n.formatValue(
          "knowledge-base-vector-" + phase,
        );
        if (token !== generation || !root.isConnected) return;
        const label = doc.getElementById("similar-works-cache-status");
        label.textContent = text;
        label.setAttribute("role", failed ? "alert" : "status");
        const bar = doc.getElementById("similar-works-cache-progress");
        const loading = status.indexProgress?.phase === "loading";
        // Show the active cache stage. Restoring fingerprints and creating
        // semantic vectors have separate totals and should not be averaged.
        const vectorStage =
          !textBusy && semantic && semantic.state !== "disabled";
        const total = vectorStage
          ? status.vectorTotal
          : loading
            ? status.indexProgress.total
            : status.totalItems;
        const done = vectorStage
          ? semantic.indexedItems
          : loading
            ? status.indexProgress.done
            : status.indexedItems;
        bar.hidden = !!failed || (!busy && !total);
        if (total > 0 && !(busy && done >= total)) {
          bar.max = total;
          bar.value = Math.min(done, total);
        } else bar.removeAttribute("value");
      } catch (error) {
        Zotero.logError(error);
      }
      if (token === generation) timer = window.setTimeout(refresh, 1000);
    }
    let countsVersion = 0;
    async function refreshCounts() {
      const version = ++countsVersion;
      try {
        const counts = await api.getNoteCounts();
        const text = await doc.l10n.formatValue(
          "knowledge-base-note-counts",
          counts,
        );
        if (
          token === generation &&
          version === countsVersion &&
          doc.getElementById("knowledge-base-note-counts")?.isConnected
        )
          doc.getElementById("knowledge-base-note-counts").textContent = text;
      } catch (error) {
        Zotero.logError(error);
      }
    }
    unsubscribe = api.onDataChange((change) => {
      if (
        !change ||
        change.all ||
        change.fields.some((field) => ["type", "availability"].includes(field))
      )
        void refreshCounts();
    });
    await Promise.all([refresh(), refreshCounts()]);
  }
  window.addEventListener("unload", stop, { once: true });
  return { start, stop };
})();
