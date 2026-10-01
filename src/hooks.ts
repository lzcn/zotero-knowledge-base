import { config, version } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import {
  closeDB,
  collectDBDiagnostics,
  describeError,
  getSchemaTrace,
  initDB,
} from "./modules/db";
import { rebuildCounts } from "./modules/zettel";
import { registerItemPaneUI, unregisterItemPaneUI } from "./modules/itemPane";
import { registerReaderUI, unregisterReaderUI } from "./modules/reader";
import { createZToolkit } from "./utils/ztoolkit";
import { initAssets, closeAssets } from "./modules/assets";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Run each step separately so a failure can be attributed to a specific one.
  // The database comes first and is fatal: every later step reads from it.
  const steps: [string, () => Promise<unknown> | unknown][] = [
    ["initDB", initDB],
    ["initAssets", initAssets],
    ["rebuildCounts", rebuildCounts],
    ["registerItemPaneUI", registerItemPaneUI],
    ["registerReaderUI", registerReaderUI],
  ];

  let failed = false;
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (e) {
      failed = true;
      await reportStartupFailure(name, e);
      break;
    }
  }
  if (!failed) {
    await clearStartupLog();
  }

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
}

function startupLogPath(): string {
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    `${config.addonRef}-startup-error.log`,
  );
}

/**
 * Drop a previous run's failure log.
 *
 * Its existence should mean "the current session failed"; leaving a stale file
 * behind would send the next diagnosis down the wrong path.
 */
async function clearStartupLog(): Promise<void> {
  try {
    await IOUtils.remove(startupLogPath(), { ignoreAbsent: true });
  } catch {
    /* a stale log is not worth failing startup over */
  }
}

/**
 * Persist a startup failure next to the database.
 *
 * A transient ProgressWindow is easy to miss and leaves nothing to inspect
 * afterwards, which is how a broken schema migration previously became an
 * invisible failure. Logging must never be the thing that breaks startup.
 */
async function reportStartupFailure(
  step: string,
  error: unknown,
): Promise<void> {
  // Report the message *and* the stack. mozStorage throws XPCOM exceptions
  // rather than Error instances, and their stack can be truncated to a single
  // frame across async boundaries - dropping `message` here is exactly how the
  // first diagnostic round lost the cause.
  const parts = [
    `[${new Date().toISOString()}] startup failed at ${step}`,
    `error: ${describeError(error)}`,
    `stack:\n${
      error instanceof Error ? (error.stack ?? "(none)") : "(not an Error)"
    }`,
  ];

  try {
    parts.push(`schema trace:\n${getSchemaTrace()}`);
  } catch {
    /* diagnostics must never mask the original failure */
  }

  try {
    parts.push(`database state:\n${await collectDBDiagnostics()}`);
  } catch (e) {
    parts.push(`database state: <unavailable: ${describeError(e)}>`);
  }

  const entry = `${parts.join("\n")}\n`;
  const detail = parts.join(" | ");

  Zotero.logError(
    new Error(`Zettel Knowledge Base: startup failed at ${step}: ${detail}`),
  );

  try {
    await Zotero.File.putContentsAsync(startupLogPath(), entry);
  } catch (e) {
    Zotero.logError(
      new Error(`Zettel Knowledge Base: could not write startup log: ${e}`),
    );
  }

  new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true })
    .createLine({
      text: getString("startup-db-error"),
      type: "fail",
    })
    .show();
}

async function onMainWindowLoad(win: Window): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  // @ts-ignore This is a moz feature
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-itemPane.ftl`,
  );

  const link = win.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "link",
  ) as HTMLLinkElement;
  link.rel = "stylesheet";
  link.href = `chrome://${config.addonRef}/content/section.css?v=${version}`;
  win.document.documentElement.appendChild(link);

  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: `${config.addonRef}-menu-open-manager`,
    label: getString("menu-open-manager"),
    commandListener: () => addon.api.openManager(),
  });

  // context menu on selected item(s): create a card sourced to the item
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${config.addonRef}-itemmenu-new-zettel`,
    label: getString("menu-new-zettel"),
    commandListener: () => {
      const item = Zotero.getActiveZoteroPane()?.getSelectedItems?.()[0];
      if (!item) return;
      addon.api.openEditor({
        sourceItem: item.isRegularItem?.()
          ? { key: item.key, libraryID: item.libraryID }
          : undefined,
      });
    },
  });
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

async function onShutdown(): Promise<void> {
  unregisterItemPaneUI();
  closeAssets();
  unregisterReaderUI();
  ztoolkit.unregisterAll();
  await closeDB();
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
