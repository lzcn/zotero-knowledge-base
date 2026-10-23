import { config, version } from "../../package.json";
import { getString } from "../utils/locale";
import { openCodeRequest, apiResponseText } from "./opencode-api";

const PROVIDERS = ["deepseek", "opencode-go", "codex"] as const;
export type AIProvider = (typeof PROVIDERS)[number];
const DEFAULT_MODELS = {
  deepseek: "deepseek-flash",
  "opencode-go": "glm-5.3-flash",
  codex: "",
};
const REALMS = {
  deepseek: "DeepSeek API",
  "opencode-go": "OpenCode Go API",
  codex: null,
};
const providerName = (provider: AIProvider) =>
  provider === "deepseek"
    ? "DeepSeek"
    : provider === "opencode-go"
      ? "OpenCode Go"
      : "Codex";
export interface AISettings {
  provider: AIProvider;
  model: string;
  path: string;
  hasKey: boolean;
  hasStoredKey: boolean;
  requiresKey: boolean;
}
const prefix = `${config.prefsPrefix}.ai`;
const origin = "chrome://knowledge-base";
const jobs = new Map<string, AbortController>();
const completions = new Set<Promise<void>>();
let stopping = false;
let enabledObserver: symbol | undefined;
export function isAIEnabled(): boolean {
  return Zotero.Prefs.get(`${prefix}.enabled`, true) === true;
}
export function assertAIEnabled(): void {
  if (!isAIEnabled()) throw new Error(getString("ai-disabled"));
}
export function setAIEnabled(enabled: boolean): void {
  if (typeof enabled !== "boolean")
    throw new Error(getString("ai-settings-invalid"));
  Zotero.Prefs.set(`${prefix}.enabled`, enabled, true);
}
export function onAIEnabledChange(listener: () => void): () => void {
  const observer = Zotero.Prefs.registerObserver(
    `${prefix}.enabled`,
    listener,
    true,
  );
  return () => Zotero.Prefs.unregisterObserver(observer);
}
export function initAI(): void {
  stopping = false;
  if (!enabledObserver)
    enabledObserver = Zotero.Prefs.registerObserver(
      `${prefix}.enabled`,
      () => {
        if (!isAIEnabled())
          for (const controller of jobs.values()) controller.abort();
      },
      true,
    );
}

function credentials(provider: AIProvider) {
  const realm = REALMS[provider];
  return realm ? Services.logins.findLogins(origin, "", realm) : [];
}

function apiKey(provider: AIProvider): string {
  return (
    credentials(provider)[0]?.password ||
    (provider === "deepseek"
      ? Services.env?.get("DEEPSEEK_API_KEY")?.trim()
      : "") ||
    ""
  );
}

export function getAISettings(): AISettings {
  const provider = Zotero.Prefs.get(`${prefix}.provider`, true) || "deepseek";
  if (!PROVIDERS.includes(provider as AIProvider))
    throw new Error(getString("ai-settings-invalid"));
  return {
    provider: provider as AIProvider,
    model: String(
      Zotero.Prefs.get(`${prefix}.${provider}.model`, true) ||
        DEFAULT_MODELS[provider as AIProvider],
    ),
    path: String(Zotero.Prefs.get(`${prefix}.${provider}.path`, true) || ""),
    requiresKey: !!REALMS[provider as AIProvider],
    hasKey: !!apiKey(provider as AIProvider),
    hasStoredKey: credentials(provider as AIProvider).length > 0,
  };
}

export async function setAISettings(input: {
  provider: AIProvider;
  model?: string;
  path?: string;
  key?: string;
}): Promise<void> {
  if (!PROVIDERS.includes(input.provider))
    throw new Error(getString("ai-settings-invalid"));
  for (const value of [input.model, input.path, input.key])
    if (
      value !== undefined &&
      (typeof value !== "string" || /[\r\n\0]/.test(value))
    )
      throw new Error(getString("ai-settings-invalid"));
  if (input.key !== undefined) {
    if (!REALMS[input.provider])
      throw new Error(getString("ai-settings-invalid"));
    const key = input.key.trim();
    const existing = credentials(input.provider);
    if (key) {
      const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
        Ci.nsILoginInfo,
      );
      // Realm logins require null here; the bundled IDL omits its nullability.
      login.init(
        origin,
        null as unknown as string,
        REALMS[input.provider]!,
        input.provider,
        key,
        "",
        "",
      );
      if (existing[0]) Services.logins.modifyLogin(existing[0], login);
      else await Services.logins.addLoginAsync(login);
      for (const duplicate of existing.slice(1))
        Services.logins.removeLogin(duplicate);
    } else for (const login of existing) Services.logins.removeLogin(login);
  }
  for (const field of ["model", "path"] as const)
    if (input[field] !== undefined)
      Zotero.Prefs.set(
        `${prefix}.${input.provider}.${field}`,
        input[field]!.trim(),
        true,
      );
  Zotero.Prefs.set(`${prefix}.provider`, input.provider, true);
}

export function cancelAIJob(id: string): void {
  jobs.get(id)?.abort();
}
export function stopAI(): void {
  stopping = true;
  if (enabledObserver) Zotero.Prefs.unregisterObserver(enabledObserver);
  enabledObserver = undefined;
  for (const controller of jobs.values()) controller.abort();
}

export async function closeAI(): Promise<void> {
  stopAI();
  await Promise.allSettled([...completions]);
}

export async function withAIJob<T>(
  id: string,
  run: (
    ask: (prompt: string) => Promise<Record<string, unknown>>,
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  assertAIEnabled();
  if (stopping) throw new Error(getString("ai-cancelled"));
  if (jobs.has(id)) throw new Error(getString("ai-busy"));
  const win = Zotero.getMainWindow() as unknown as Window & typeof globalThis;
  const controller = new win.AbortController();
  jobs.set(id, controller);
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  completions.add(completed);
  try {
    const settings = getAISettings();
    const result = await run((prompt) => {
      assertAIEnabled();
      return askAI(settings, prompt, controller.signal, id);
    }, controller.signal);
    assertAIEnabled();
    return result;
  } finally {
    if (jobs.get(id) === controller) jobs.delete(id);
    completions.delete(completed);
    finish();
  }
}

export function parseAIJSON(text: string): Record<string, unknown> {
  try {
    const result = JSON.parse(
      text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1"),
    );
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result;
  } catch {
    throw new Error(getString("ai-json-invalid"));
  }
}

interface Process {
  stdin: { write(text: string): Promise<void>; close(): Promise<void> };
  stdout: { readString(): Promise<string> };
  stderr: { readString(): Promise<string> };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): void;
}

export function cliArguments(settings: AISettings): string[] {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--disable",
    "shell_tool",
    "--disable",
    "apps",
    "--disable",
    "plugins",
    "--disable",
    "multi_agent_v2",
  ];
  if (settings.model) args.push("--model", settings.model);
  args.push("-");
  return args;
}

export function cliResponse(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(getString("ai-response-invalid"));
    }
    if (
      event.type === "error" ||
      event.type === "turn.failed" ||
      event.type === "session.error"
    )
      throw new Error(
        getString("ai-cli-failed", {
          args: { provider: "Codex", code: event.type },
        }),
      );
    if (event.type === "item.completed" && event.item?.type === "agent_message")
      messages.push(event.item.text);
  }
  // A CLI may emit progress messages before its final answer.
  return messages.at(-1) || "";
}

async function runCLI(
  settings: AISettings,
  prompt: string,
  signal: AbortSignal,
  args = cliArguments(settings),
): Promise<string> {
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as {
    Subprocess: {
      pathSearch(name: string): Promise<string>;
      call(options: object): Promise<Process>;
    };
  };
  const command =
    settings.path ||
    (await Subprocess.pathSearch(settings.provider).catch(async () => {
      // Finder-launched apps can inherit a shorter PATH than the user's shell.
      const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
      for (const candidate of [
        `/opt/homebrew/bin/${settings.provider}`,
        `/usr/local/bin/${settings.provider}`,
        PathUtils.join(home, ".local", "bin", settings.provider),
        PathUtils.join(home, ".cargo", "bin", settings.provider),
      ]) {
        if (await IOUtils.exists(candidate)) return candidate;
      }
      throw new Error(
        getString("ai-cli-not-found", {
          args: { provider: providerName(settings.provider) },
        }),
      );
    }));
  const directory = await IOUtils.createUniqueDirectory(
    PathUtils.tempDir,
    "knowledge-base-ai",
    0o700,
  );
  let process: Process | undefined;
  const abort = () => process?.kill(300);
  try {
    signal.throwIfAborted();

    process = await Subprocess.call({
      command,
      arguments: args,
      workdir: directory,
      environment: { PWD: directory },
      environmentAppend: true,
      stderr: "pipe",
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const read = async (pipe: Process["stdout"]) => {
      let output = "";
      while (true) {
        const chunk = await pipe.readString();
        if (!chunk) return output;
        output += chunk;
        if (output.length > 2_000_000) {
          abort();
          throw new Error(getString("ai-response-invalid"));
        }
      }
    };
    const stdout = read(process.stdout);
    const stderr = read(process.stderr);
    // Attach handlers before stdin can fail, so early process exits are drained.
    const completion = Promise.all([stdout, stderr, process.wait()]);
    try {
      if (prompt) await process.stdin.write(prompt);
      await process.stdin.close();
    } catch (error) {
      abort();
      await completion.catch(() => {});
      throw error;
    }
    const [output, , status] = await completion;
    signal.throwIfAborted();
    if (status.exitCode !== 0)
      throw new Error(
        getString("ai-cli-failed", {
          args: {
            provider: providerName(settings.provider),
            code: status.exitCode,
          },
        }),
      );
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    abort();
    await process?.wait();
    await IOUtils.remove(directory, { recursive: true, ignoreAbsent: true });
  }
}

async function askAI(
  settings: AISettings,
  prompt: string,
  signal: AbortSignal,
  sessionID: string,
): Promise<Record<string, unknown>> {
  const win = Zotero.getMainWindow() as unknown as Window & typeof globalThis;
  const controller = new win.AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = win.setTimeout(abort, 180_000);
  try {
    signal.throwIfAborted();
    let text: string;
    if (settings.requiresKey) {
      const provider = providerName(settings.provider);
      const key = apiKey(settings.provider);
      if (!key)
        throw new Error(getString("ai-key-required", { args: { provider } }));
      const openCode =
        settings.provider === "opencode-go"
          ? openCodeRequest(settings.model, prompt)
          : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (key) headers.Authorization = `Bearer ${key}`;
      if (openCode) {
        headers["User-Agent"] = `Zotero-Knowledge-Base/${version}`;
        headers["x-opencode-session"] = sessionID;
        if (openCode.protocol === "messages")
          headers["anthropic-version"] = "2023-06-01";
      }
      const response = await win.fetch(
        openCode?.url || "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers,
          body: JSON.stringify(
            openCode?.body || {
              model: settings.model,
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              max_tokens: 4096,
              thinking: { type: "disabled" },
            },
          ),
        },
      );
      if (!response.ok) {
        if (response.status === 402)
          throw new Error(
            getString("ai-balance-required", { args: { provider } }),
          );
        const detail = (await response.json().catch(() => null)) as {
          type?: string;
          error?: { type?: string };
        } | null;
        if (
          detail?.type === "FreeTierError" ||
          detail?.error?.type === "FreeTierError"
        )
          throw new Error(getString("ai-free-restricted"));
        throw new Error(
          getString("ai-http-failed", {
            args: { provider, code: response.status },
          }),
        );
      }
      const result = (await response.json().catch(() => {
        throw new Error(getString("ai-json-invalid"));
      })) as unknown;
      text = apiResponseText(openCode?.protocol || "chat", result);
    } else
      text = cliResponse(await runCLI(settings, prompt, controller.signal));
    controller.signal.throwIfAborted();
    if (typeof text !== "string" || !text.trim())
      throw new Error(getString("ai-response-empty"));
    return parseAIJSON(text);
  } catch (error) {
    if ((error as Error)?.message === "AI_RESPONSE_INVALID")
      throw new Error(getString("ai-response-invalid"));
    if ((error as Error)?.message === "AI_RESPONSE_TRUNCATED")
      throw new Error(getString("ai-response-truncated"));
    if (controller.signal.aborted)
      throw new Error(
        getString(signal.aborted ? "ai-cancelled" : "ai-timeout"),
      );
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    win.clearTimeout(timeout);
  }
}

export function testAIConnection(id: string): Promise<void> {
  return withAIJob(id, async (ask) => {
    const result = await ask(
      'Return only this JSON object: {"ok":true}. Do not use tools.',
    );
    if (result.ok !== true) throw new Error(getString("ai-response-invalid"));
  });
}

/** Discover provider model IDs only when requested from Settings. */
export async function getAIModels(id: string): Promise<string[]> {
  return withAIJob(id, async (_, signal) => {
    const settings = getAISettings();
    const win = Zotero.getMainWindow() as unknown as Window & typeof globalThis;
    const controller = new win.AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = win.setTimeout(abort, 30_000);
    try {
      signal.throwIfAborted();
      let ids: string[];
      if (!settings.requiresKey) {
        const output = await runCLI(settings, "", controller.signal, [
          "debug",
          "models",
        ]);
        const data = JSON.parse(output);
        const models = Array.isArray(data) ? data : data.models;
        if (!Array.isArray(models))
          throw new Error(getString("ai-response-invalid"));
        ids = models
          .filter(
            (model: { visibility?: string }) =>
              !model.visibility || model.visibility === "list",
          )
          .map(
            (model: { slug?: unknown; id?: unknown }) => model.slug || model.id,
          )
          .filter((id): id is string => typeof id === "string");
      } else {
        const key = apiKey(settings.provider);
        const response = await win.fetch(
          settings.provider === "opencode-go"
            ? "https://opencode.ai/inference/go/v1/models"
            : "https://api.deepseek.com/models",
          {
            signal: controller.signal,
            redirect: "error",
            headers: {
              "User-Agent": `Zotero-Knowledge-Base/${version}`,
              "x-opencode-session": id,
              ...(key ? { Authorization: `Bearer ${key}` } : {}),
            },
          },
        );
        if (!response.ok) throw new Error(getString("ai-models-unavailable"));
        const result = (await response.json()) as { data?: { id: string }[] };
        if (
          !Array.isArray(result.data) ||
          result.data.some((model) => typeof model.id !== "string")
        )
          throw new Error(getString("ai-response-invalid"));
        ids = result.data.map((model) => model.id);
      }
      controller.signal.throwIfAborted();
      if (!ids.length) throw new Error(getString("ai-models-unavailable"));
      return [...new Set(ids)].sort();
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error(
          getString(signal.aborted ? "ai-cancelled" : "ai-timeout"),
        );
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      win.clearTimeout(timer);
    }
  });
}
