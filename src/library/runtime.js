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
        "corpus",
        "indexer",
        "semantic",
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
      await scope.SWTags.loadTerms(SWHost.rootURI);
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
    wakeIndex() {
      scope.SWIndexer.wake();
    },
    openTagManager(win, libraryID) {
      return scope.SWTags.open(win, libraryID);
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
