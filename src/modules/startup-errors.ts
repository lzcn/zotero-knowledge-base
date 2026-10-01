import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { collectDBDiagnostics, describeError, getSchemaTrace } from "./db";

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
export async function clearStartupLog(): Promise<void> {
  try {
    await IOUtils.remove(startupLogPath(), { ignoreAbsent: true });
  } catch {
    /* a stale log is not worth failing startup over */
  }
}

/**
 * Persist a startup failure next to the database.
 *
 * Persist diagnostics so initialization failures remain inspectable.
 * Logging must never mask the original failure.
 */
export async function reportStartupFailure(
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
    new Error(`Knowledge Base: startup failed at ${step}: ${detail}`),
  );

  try {
    await Zotero.File.putContentsAsync(startupLogPath(), entry);
  } catch (e) {
    Zotero.logError(
      new Error(`Knowledge Base: could not write startup log: ${e}`),
    );
  }

  new ztoolkit.ProgressWindow(config.addonName, { closeOnClick: true })
    .createLine({
      text: getString("startup-db-error"),
      type: "fail",
    })
    .show();
}
