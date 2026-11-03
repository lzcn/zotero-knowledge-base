/* global SWHost */
/* exported libraryRuntime */
// Knowledge Base owns this module's lifecycle. Data and preference identifiers
// intentionally stay stable so installed libraries reuse their existing index.
var libraryRuntime = (() => {
  const scope = {
    Zotero,
    Services,
    ChromeUtils,
    IOUtils,
    PathUtils,
    TextDecoder,
    TextEncoder,
    Ci,
    setTimeout,
    clearTimeout,
    SWPlugin: SWHost,
  };
  let stopped = false;
  let started;
  let closing;
  let chrome;
  let state = "idle";

  function stop() {
    stopped = true;
    state = "stopped";
    for (const action of [
      () => scope.SWTags?.stop(),
      () => scope.SWSection?.shutdown(),
      () => scope.SWSemantic?.stop(),
      () => scope.SWIndexer?.requestStop(),
    ]) {
      try {
        action();
      } catch (error) {
        Zotero.logError(error);
      }
    }
  }

  async function start() {
    if (started) return started;
    started = (async () => {
      for (const file of [
        "storage",
        "stemmer",
        "tokenizer",
        "search",
        "search-cache",
        "corpus",
        "sources",
        "indexer",
        "semantic",
        "tag-policy",
        "tags",
        "tag-suggestions",
        "retrieval-evidence",
        "section",
      ])
        Services.scriptloader.loadSubScript(
          SWHost.rootURI + "scripts/" + file + ".js",
          scope,
        );
      const service = Components.classes[
        "@mozilla.org/addons/addon-manager-startup;1"
      ].getService(Components.interfaces.amIAddonManagerStartup);
      chrome = service.registerChrome(Services.io.newURI(SWHost.manifestURI), [
        ["content", "similar-works", SWHost.rootURI],
      ]);
      if (stopped) return;
      await scope.SWIndexer.start();
      if (stopped) return;
      scope.SWSection.init(SWHost.rootURI);
      state = "ready";
    })();
    return started;
  }

  function close(appShutdown = false) {
    if (closing) return closing;
    stop();
    closing = (async () => {
      // The owner awaits startup on disable. On application quit, cancellation
      // must not wait for library readiness or a background scan.
      for (const action of [
        () => scope.SWTags?.finishWrites(),
        () => scope.SWSemantic?._loaded,
        () => scope.SWSemantic?._nativeExit,
        () => scope.SWIndexer?._statusWrite,
        ...(appShutdown ? [] : [() => scope.SWIndexer?.shutdown()]),
        () => scope.SWIndexer?.corpus?.close(),
        () => chrome?.destruct(),
      ]) {
        try {
          await action();
        } catch (error) {
          Zotero.logError(error);
        }
      }
      chrome = null;
    })();
    return closing;
  }

  return {
    start,
    stop,
    close,
    openTagManager(win, libraryID) {
      return scope.SWTags.open(win, libraryID);
    },
    async getItemGraphSnapshot(keys, active) {
      const corpus = scope.SWIndexer.corpus;
      await corpus.ready;
      if (stopped || !active()) return null;
      if (corpus.progress.phase !== "ready")
        throw new Error("graph-cache-unavailable");
      if (Zotero.isMac) await scope.SWSemantic.start(corpus);
      if (stopped || !active()) return null;
      return corpus.runTask(() => {
        if (stopped || !active()) return null;
        const documents = [];
        const states = [];
        const vector = (value) => ({
          ids: new Uint32Array(value.ids),
          weights: new Float64Array(value.weights),
          length: value.length,
        });
        for (const key of [...new Set(keys)].sort()) {
          const source = corpus.docs.get(key);
          if (!source) continue;
          const doc = corpus.search.docs.get(key);
          const embedding = scope.SWSemantic.vectors.get(key);
          states.push([
            key,
            source.hash,
            !!doc,
            embedding?.hash === source.hash ? embedding.hash : null,
          ]);
          documents.push({
            key,
            ...(doc
              ? {
                  vector: vector(doc.vector),
                  fieldVectors: doc.fieldVectors.map(vector),
                }
              : {}),
            ...(embedding?.hash === source.hash
              ? { semantic: new Float32Array(embedding.vector) }
              : {}),
          });
        }
        return {
          stamp: JSON.stringify([
            1,
            corpus.search.epoch,
            scope.SWSemantic.version,
            states,
            keys,
          ]),
          documents,
        };
      }, 1);
    },
    async suggestTags(item, active) {
      const target = await scope.SWIndexer.resolveDocItem(item);
      if (!target || stopped || !active()) return [];
      const corpus = scope.SWIndexer.corpus;
      const key = scope.SWIndexer.docKey(target);
      const method = Zotero.isMac ? "hybrid" : "text";
      // Optional neighbor votes reuse saved results; tags never wait for a
      // full-library index load or start model downloads.
      const cached = await corpus.getRecommendations(key, true, method);
      if (stopped || !active()) return [];
      const rows = cached
        ? await scope.SWSection._resolveRows(
            cached.matches.slice(0, 12),
            method,
          )
        : [];
      await Zotero.Items.loadDataTypes(
        [target, ...rows.map((row) => row.item)],
        ["tags"],
      );
      if (stopped || !active()) return [];
      return scope.SWTags.suggest(target, rows, () => !stopped && active());
    },
    addSuggestedTags(item, suggestions, active) {
      return scope.SWTags.addSelected(
        item.id,
        item.libraryID,
        suggestions.map((tag) => tag.name),
        () => !stopped && active(),
        suggestions.filter((tag) => tag.isNew).map((tag) => tag.name),
      );
    },
    getItemPaneCallbacks() {
      return scope.SWSection.getItemPaneCallbacks();
    },
    setItemPaneID(id) {
      scope.SWSection._registered = id || null;
    },
    getStatus() {
      if (state !== "ready") return null;
      return {
        ...scope.SWIndexer.getStatus(),
        indexProgress: { ...scope.SWIndexer.corpus?.progress },
        vectorTotal: scope.SWIndexer.corpus?.docs.size || 0,
      };
    },
    get state() {
      return state;
    },
    onWindowLoad(win) {
      if (state === "ready") scope.SWSection.injectWindow(win);
    },
    onWindowUnload(win) {
      scope.SWSection?.removeWindow(win);
    },
  };
})();
