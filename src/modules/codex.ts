import { config } from "../../package.json";

interface Pipe {
  readString(): Promise<string>;
  write(text: string): Promise<unknown>;
  close(): Promise<unknown>;
}
interface Child {
  stdin: Pipe;
  stdout: Pipe;
  stderr: Pipe;
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<unknown>;
}
interface SubprocessAPI {
  call(options: {
    command: string;
    arguments: string[];
    workdir: string;
    stderr: "pipe";
  }): Promise<Child>;
  pathSearch(name: string): Promise<string>;
  getEnvironment(): Record<string, string>;
}
export interface CodexRun {
  cancelled: boolean;
  child?: Child;
  cancelWait?: () => void;
}
export class ReadingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const ENABLED_PREF = `${config.prefsPrefix}.codex.enabled`;
export function isCodexEnabled(): boolean {
  return Zotero.Prefs.get(ENABLED_PREF, true) === true;
}
export function setCodexEnabled(value: boolean): void {
  if (typeof value !== "boolean")
    throw new ReadingError("codex-settings-invalid");
  Zotero.Prefs.set(ENABLED_PREF, value, true);
  if (!value) stopCodexChecks();
}
export function onCodexEnabledChange(listener: () => void): () => void {
  const observer = Zotero.Prefs.registerObserver(ENABLED_PREF, listener, true);
  return () => Zotero.Prefs.unregisterObserver(observer);
}
export function getCodexSettings(): {
  enabled: boolean;
  path: string;
  model: string;
} {
  const read = (key: string) =>
    String(Zotero.Prefs.get(`${config.prefsPrefix}.codex.${key}`, true) || "");
  return {
    enabled: isCodexEnabled(),
    path: read("path"),
    model: read("model"),
  };
}
export function setCodexSetting(key: "path" | "model", value: string): void {
  if (
    !["path", "model"].includes(key) ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32)
  )
    throw new ReadingError("codex-settings-invalid");
  Zotero.Prefs.set(`${config.prefsPrefix}.codex.${key}`, value.trim(), true);
}

function subprocess(): SubprocessAPI {
  return ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs")
    .Subprocess;
}

/** Resolve npm's Node shim to its bundled executable; Zotero does not run Node. */
async function nativeCommand(path: string): Promise<string | null> {
  if (!(await IOUtils.exists(path))) return null;
  const file = Zotero.File.pathToFile(path);
  if (file.isSymlink()) {
    file.normalize();
    path = file.path;
  }
  const name = PathUtils.filename(path);
  if (!/\.(js|cmd)$/i.test(name)) return path;
  const parent = PathUtils.parent(path);
  if (!parent) return null;
  const root = name.endsWith(".js")
    ? PathUtils.parent(parent)
    : PathUtils.join(parent, "node_modules", "@openai", "codex");
  if (!root) return null;
  const arch = /aarch64|arm64/i.test(Services.appinfo.XPCOMABI)
    ? "arm64"
    : "x64";
  const platform = Zotero.isMac ? "darwin" : Zotero.isWin ? "win32" : "linux";
  const target = `${arch === "arm64" ? "aarch64" : "x86_64"}-${Zotero.isMac ? "apple-darwin" : Zotero.isWin ? "pc-windows-msvc" : "unknown-linux-musl"}`;
  const exe = Zotero.isWin ? "codex.exe" : "codex";
  for (const vendor of [
    PathUtils.join(
      root,
      "node_modules",
      "@openai",
      `codex-${platform}-${arch}`,
      "vendor",
    ),
    PathUtils.join(root, "vendor"),
  ]) {
    const candidate = PathUtils.join(vendor, target, "bin", exe);
    if (await IOUtils.exists(candidate)) return candidate;
  }
  return null;
}

export async function discoverCodex(): Promise<string> {
  if (!isCodexEnabled()) throw new ReadingError("codex-disabled");
  const manual = getCodexSettings().path;
  if (manual) {
    if (!PathUtils.isAbsolute(manual))
      throw new ReadingError("codex-path-invalid");
    const command = await nativeCommand(manual);
    if (!command) throw new ReadingError("codex-path-invalid");
    return command;
  }
  let fromPath = "";
  try {
    fromPath = await subprocess().pathSearch(
      Zotero.isWin ? "codex.exe" : "codex",
    );
  } catch {
    // GUI applications commonly lack the terminal's package-manager PATH.
  }
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  const candidates = [fromPath];
  if (Zotero.isMac || !Zotero.isWin)
    candidates.push(
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "/usr/bin/codex",
      PathUtils.join(home, ".local", "bin", "codex"),
    );
  if (Zotero.isWin) {
    const appData = subprocess().getEnvironment().APPDATA;
    if (appData) candidates.push(PathUtils.join(appData, "npm", "codex.cmd"));
  }
  for (const path of candidates.filter(Boolean)) {
    const command = await nativeCommand(path);
    if (command) return command;
  }
  throw new ReadingError("codex-not-found");
}

export function cancelCodex(run: CodexRun): void {
  run.cancelled = true;
  run.cancelWait?.();
  void run.child?.kill(0).catch((error) => Zotero.logError(error));
}
export function checkReading(run: CodexRun): void {
  if (run.cancelled) throw new ReadingError("codex-cancelled");
}

/** PDFWorker is shared by Zotero; cancel our wait without terminating that worker. */
export async function waitForReading<T>(
  run: CodexRun,
  task: Promise<T>,
): Promise<T> {
  checkReading(run);
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        run.cancelWait = () => reject(new ReadingError("codex-cancelled"));
      }),
    ]);
  } finally {
    run.cancelWait = undefined;
  }
}

/** Drain both pipes concurrently, bound memory, and reap the child on every path. */
export async function runCodex(
  run: CodexRun,
  command: string,
  args: string[],
  workdir: string,
  input = "",
  timeout = 15 * 60_000,
): Promise<string> {
  checkReading(run);
  const { setTimeout, clearTimeout } = ChromeUtils.importESModule(
    "resource://gre/modules/Timer.sys.mjs",
  );
  const child: Child = await subprocess().call({
    command,
    arguments: args,
    workdir,
    stderr: "pipe",
  });
  run.child = child;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void child.kill(0).catch((error) => Zotero.logError(error));
  }, timeout);
  const drain = async (pipe: Pipe) => {
    let tail = "";
    while (true) {
      const chunk = await pipe.readString();
      if (!chunk) return tail;
      tail = (tail + chunk).slice(-8000);
    }
  };
  const output = drain(child.stdout);
  const errors = drain(child.stderr);
  // Attach rejection handlers before stdin writes so failed launches cannot leak them.
  const drained = Promise.allSettled([output, errors]);
  try {
    checkReading(run);
    if (input) await child.stdin.write(input);
    await child.stdin.close();
    const exit = await child.wait();
    const pipes = await drained;
    checkReading(run);
    if (expired) throw new ReadingError("codex-timeout");
    if (exit.exitCode !== 0) {
      Zotero.logError(new Error(`Knowledge Base Codex exit: ${exit.exitCode}`));
      throw new ReadingError("codex-failed");
    }
    if (pipes[0].status === "rejected" || pipes[1].status === "rejected")
      throw new ReadingError("codex-failed");
    return pipes[0].value;
  } finally {
    clearTimeout(timer);
    await child.kill(0);
    await drained;
    if (run.child === child) run.child = undefined;
  }
}

export function codexReadingArguments(dir: string): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-c",
    'web_search="disabled"',
    "-c",
    "features.shell_tool=false",
    "--output-schema",
    PathUtils.join(dir, "schema.json"),
    "--output-last-message",
    PathUtils.join(dir, "result.json"),
  ];
  const model = getCodexSettings().model;
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

const checks = new Set<CodexRun>();
export async function testCodex(): Promise<string> {
  const run: CodexRun = { cancelled: false };
  checks.add(run);
  try {
    const command = await discoverCodex();
    const version = await runCodex(
      run,
      command,
      ["--version"],
      PathUtils.tempDir,
      "",
      20_000,
    );
    const login = await runCodex(
      run,
      command,
      ["login", "status"],
      PathUtils.tempDir,
      "",
      20_000,
    );
    return version.trim() + (login.trim() ? ` · ${login.trim()}` : "");
  } finally {
    checks.delete(run);
  }
}
export function stopCodexChecks(): void {
  for (const run of checks) cancelCodex(run);
}
