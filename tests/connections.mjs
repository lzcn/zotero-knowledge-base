import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(join(tmpdir(), "knowledge-base-ai-"));
try {
  await build({
    stdin: {
      contents:
        'export * from "./src/modules/ai.ts"; export * from "./src/modules/connection-planner.ts"; export * from "./src/modules/connection-retrieval.ts"; export * from "./src/modules/opencode-api.ts"; export {connectionAnchor, linkNotePassages} from "./src/modules/markdown.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "ai.mjs"),
  });
  const dom = new JSDOM(
    "<button id='start'></button><section id='review' hidden></section>",
    { runScripts: "outside-only" },
  );
  const prefs = new Map();
  const observers = new Map();
  globalThis.addon = { data: {} };
  const logins = [];
  dom.window.Zotero = { logError: () => {} };
  globalThis.Zotero = {
    getMainWindow: () => dom.window,
    Prefs: {
      get: (key) => prefs.get(key),
      set: (key, value) => {
        prefs.set(key, value);
        for (const { name, listener } of observers.values())
          if (key === name) listener();
      },
      registerObserver(name, listener) {
        const token = Symbol();
        observers.set(token, { name, listener });
        return token;
      },
      unregisterObserver(token) {
        observers.delete(token);
      },
    },
  };
  globalThis.Services = {
    logins: {
      findLogins: (origin, action, realm) =>
        logins.filter((login) => login.realm === realm),
      addLoginAsync: async (value) => {
        logins.push(value);
      },
      removeLogin: (value) => {
        logins.splice(logins.indexOf(value), 1);
      },
      modifyLogin: (old, value) => {
        logins.splice(logins.indexOf(old), 1, value);
      },
    },
  };
  globalThis.Cc = {
    "@mozilla.org/login-manager/loginInfo;1": {
      createInstance: () => ({
        init(origin, action, realm, username, password) {
          Object.assign(this, { origin, action, realm, username, password });
        },
      }),
    },
  };
  globalThis.Ci = { nsILoginInfo: {} };
  const ai = await import(pathToFileURL(join(root, "ai.mjs")));
  globalThis.Services.env = {
    get: (name) => (name === "DEEPSEEK_API_KEY" ? "environment-secret" : ""),
  };
  assert.equal(ai.isAIEnabled(), false);
  ai.initAI();
  await assert.rejects(ai.testAIConnection("disabled-test"), /ai-disabled/);
  await assert.rejects(ai.getAIModels("disabled-models"), /ai-disabled/);
  await assert.rejects(
    ai.withAIJob("disabled-job", () => {
      throw new Error("Must not enter disabled work");
    }),
    /ai-disabled/,
  );
  ai.setAIEnabled(true);
  assert.equal(ai.getAISettings().hasKey, true);
  assert.equal(ai.getAISettings().hasStoredKey, false);
  await ai.setAISettings({
    provider: "deepseek",
    key: "test-secret",
    model: "test-model",
  });
  assert.equal(ai.getAISettings().hasStoredKey, true);
  assert.equal(JSON.stringify([...prefs]).includes("test-secret"), false);
  assert.equal(ai.getAISettings().requiresKey, true);
  let requests = 0;
  dom.window.fetch = async (url, options) => {
    requests++;
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    assert.equal(JSON.parse(options.body).response_format.type, "json_object");
    return {
      ok: true,
      json: async () => ({
        choices: [
          { finish_reason: "stop", message: { content: '{"ok":true}' } },
        ],
      }),
    };
  };
  await ai.testAIConnection("test");
  assert.equal(requests, 1);
  await ai.setAISettings({
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
    key: "original-go-secret",
  });
  const originalGo = logins.find((login) => login.realm === "OpenCode Go API");
  const originalAPI = {
    origin: "chrome://knowledge-base",
    realm: "OpenCode API",
    password: "original-api-secret",
  };
  logins.push(originalAPI);
  prefs.set(
    "extensions.zotero.knowledge-base.ai.opencode-api.model",
    "saved-console-model",
  );
  prefs.set(
    "extensions.zotero.knowledge-base.ai.opencode.model",
    "saved-cli-model",
  );
  for (const provider of ["opencode-api", "opencode"])
    await assert.rejects(ai.setAISettings({ provider }), /settings-invalid/);
  await ai.setAISettings({ provider: "codex" });
  await ai.setAISettings({ provider: "opencode-go" });
  assert.equal(ai.getAISettings().model, "deepseek-v4.1-flash");
  assert.equal(ai.getAISettings().hasStoredKey, true);
  assert.equal(
    logins.find((login) => login.realm === "OpenCode Go API"),
    originalGo,
  );
  dom.window.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://opencode.ai/inference/go/openai/v1/chat/completions",
    );
    assert.equal(options.headers.Authorization, "Bearer original-go-secret");
    assert.equal(JSON.parse(options.body).thinking.type, "disabled");
    return {
      ok: true,
      json: async () => ({
        choices: [
          { finish_reason: "stop", message: { content: '{"ok":true}' } },
        ],
      }),
    };
  };
  await ai.testAIConnection("go-session");
  const goModel = ai.getAISettings().model;
  dom.window.fetch = async (url, options) => {
    assert.equal(url, "https://opencode.ai/inference/go/v1/models");
    assert.equal(options.headers.Authorization, "Bearer original-go-secret");
    return {
      ok: true,
      json: async () => ({
        data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-b" }],
      }),
    };
  };
  assert.deepEqual(await ai.getAIModels("list-go"), ["model-a", "model-b"]);
  assert.equal(ai.getAISettings().model, goModel);
  assert.ok(logins.includes(originalAPI));
  assert.ok(logins.includes(originalGo));
  assert.equal(
    prefs.get("extensions.zotero.knowledge-base.ai.opencode-api.model"),
    "saved-console-model",
  );
  assert.equal(
    prefs.get("extensions.zotero.knowledge-base.ai.opencode.model"),
    "saved-cli-model",
  );
  for (const [model, protocol] of [
    ["gpt-6-luna", "responses"],
    ["minimax-m3", "messages"],
    ["qwen3.8-max", "messages"],
    ["gemini-4-argon-contributor", "gemini"],
  ])
    assert.equal(ai.openCodeRequest(model, "prompt").protocol, protocol);
  assert.equal(
    ai.apiResponseText("responses", {
      status: "completed",
      output: [
        { type: "reasoning" },
        {
          type: "message",
          phase: "commentary",
          content: [{ type: "output_text", text: "Working" }],
        },
        {
          type: "message",
          content: [{ type: "output_text", text: '{"ok":true}' }],
        },
      ],
    }),
    '{"ok":true}',
  );
  assert.equal(
    ai.apiResponseText("messages", {
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"ok":true}' }],
    }),
    '{"ok":true}',
  );
  assert.equal(
    ai.apiResponseText("gemini", {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "hidden", thought: true }, { text: '{"ok":true}' }],
          },
        },
      ],
    }),
    '{"ok":true}',
  );
  for (const protocol of ["chat", "responses", "messages", "gemini"])
    assert.throws(
      () => ai.apiResponseText(protocol, {}),
      /AI_RESPONSE_INVALID/,
    );
  assert.throws(
    () =>
      ai.apiResponseText("chat", { choices: [{ finish_reason: "length" }] }),
    /AI_RESPONSE_TRUNCATED/,
  );
  await ai.setAISettings({ provider: "deepseek" });
  dom.window.fetch = async () => ({ ok: false, status: 402 });
  await assert.rejects(ai.testAIConnection("balance"), /balance-required/);
  dom.window.fetch = async (_, options) =>
    new Promise((resolve, reject) =>
      options.signal.addEventListener("abort", () =>
        reject(new dom.window.DOMException("Aborted", "AbortError")),
      ),
    );
  const cancel = ai.testAIConnection("cancel");
  ai.cancelAIJob("cancel");
  await assert.rejects(cancel, /cancelled/);
  dom.window.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [{ id: "model-z" }, { id: "model-a" }, { id: "model-a" }],
    }),
  });
  assert.deepEqual(await ai.getAIModels("models"), ["model-a", "model-z"]);
  for (const provider of ["codex"]) {
    await ai.setAISettings({ provider, model: "" });
    assert.equal(ai.getAISettings().requiresKey, false);
    assert.equal(ai.getAISettings().hasKey, false);
    assert.equal(ai.getAISettings().model, "");
    await assert.rejects(
      ai.setAISettings({ provider, key: "not-needed" }),
      /settings-invalid/,
    );
    const args = ai.cliArguments(ai.getAISettings());
    assert.ok(args.includes("read-only"));
    assert.equal(args.at(-1), "-");
  }
  assert.equal(
    ai.cliResponse(
      '{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}',
    ),
    "answer",
  );
  assert.throws(() => ai.cliResponse('{"type":"turn.failed"}'), /cli-failed/);
  await ai.setAISettings({ provider: "deepseek" });
  let enteredDisable;
  const enteredDisabledJob = new Promise((resolve) => {
    enteredDisable = resolve;
  });
  const disabledRun = ai.withAIJob("disable-running", async (_ask, signal) => {
    enteredDisable();
    await new Promise((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    );
    return "late result";
  });
  await enteredDisabledJob;
  const savedLogins = [...logins];
  ai.setAIEnabled(false);
  await assert.rejects(disabledRun, /ai-disabled/);
  assert.deepEqual(logins, savedLogins);
  ai.setAIEnabled(true);
  const make = (id, extras = {}) => ({
    id,
    title: id,
    reference: id,
    kind: "zettel",
    parentId: null,
    version: 1,
    canParent: true,
    ...extras,
  });
  const current = { ...make("current"), body: "A scoped atomic argument" };
  const notes = [
    make("parent", { kind: "thinking" }),
    make("related"),
    make("descendant", { canParent: false }),
  ];
  const tree = [
    make("root"),
    make("current", { parentId: "root" }),
    ...Array.from({ length: 2000 }, (_, i) =>
      make("child-" + i, { parentId: i ? "child-" + (i - 1) : "current" }),
    ),
    make("peer", { parentId: "root" }),
  ];
  assert.deepEqual(
    [...ai.eligibleParentIDs(tree, "current")],
    ["root", "peer"],
  );
  const summaryCalls = [];
  const reads = [];
  const responses = [
    { ids: ["parent", "related"] },
    { parents: ["parent"], links: ["related"] },
    {
      parent: {
        id: "parent",
        reason: "Organizes this claim",
        currentEvidence: "scoped atomic argument",
        targetEvidence: "Qualified evidence",
      },
      links: [
        {
          id: "related",
          reason: "Qualifies the claim",
          anchor: "scoped atomic argument",
          relation: "qualifies",
          currentEvidence: "scoped atomic argument",
          targetEvidence: "Qualified evidence",
        },
      ],
    },
  ];
  const context = {
    current,
    notes,
    ask: async () => responses.shift(),
    retrieve: async () => [],
    summaries: async (ids) => {
      summaryCalls.push(ids);
      return new Map(ids.map((id) => [id, `Claim of ${id}`]));
    },
    read: async (id) => {
      reads.push(id);
      return { ...make(id), body: "Qualified evidence" };
    },
    check() {},
    progress() {},
    language: "en-US",
  };
  const plan = await ai.planConnections(context);
  assert.equal(ai.connectionAnchor("Repeat. Repeat.", "Repeat"), -1);
  for (const body of [
    "`atomic argument`",
    "$$atomic argument$$",
    "[atomic argument](https://example.com)",
    "[[target|atomic argument]]",
    "```js\natomic argument\n```",
    "$atomic argument$",
  ]) {
    assert.equal(ai.connectionAnchor(body, "atomic argument"), -1, body);
  }
  assert.equal(
    ai.linkNotePassages("Before **atomic argument** and after.", [
      { anchor: "atomic argument", reference: "related" },
    ]),
    "Before **[[related|atomic argument]]** and after.",
  );
  assert.throws(() =>
    ai.linkNotePassages("Repeated Repeated", [
      { anchor: "Repeated", reference: "related" },
    ]),
  );
  assert.throws(() =>
    ai.linkNotePassages("A scoped atomic argument", [
      { anchor: "scoped atomic", reference: "one" },
      { anchor: "atomic argument", reference: "two" },
    ]),
  );
  const noExisting = await ai.planConnections({
    ...context,
    existingLinks: new Set(["related"]),
    ask: async (prompt) =>
      prompt.includes("Select up to 24")
        ? { ids: ["related"] }
        : { parents: [], links: [] },
  });
  assert.equal(noExisting.links.length, 0);
  assert.equal(plan.parent.id, "parent");
  assert.deepEqual(summaryCalls[0], ["parent", "related"]);
  assert.deepEqual(reads, ["parent", "related"]);
  assert.equal(plan.links[0].id, "related");
  assert.deepEqual(
    await ai.planConnections({ ...context, ask: async () => ({ ids: [] }) }),
    { parent: null, links: [], read: [] },
  );
  const proposal = {
    parent: null,
    links: [
      {
        id: "related",
        relation: "qualifies",
        reason: "Conditions matter",
        anchor: "atomic argument",
        currentEvidence: "scoped atomic argument",
        targetEvidence: "Qualified evidence",
      },
    ],
  };
  for (const invalid of [
    { parent: { id: "descendant", reason: "cycle" }, links: [] },
    { ...proposal, links: [{ ...proposal.links[0], id: "invented" }] },
    {
      ...proposal,
      links: [{ ...proposal.links[0], targetEvidence: "Only in a summary" }],
    },
    {
      ...proposal,
      links: [{ ...proposal.links[0], currentEvidence: "Invented words here" }],
    },
    { ...proposal, links: [{ ...proposal.links[0], relation: "similar" }] },
    { ...proposal, links: [{ ...proposal.links[0], anchor: "[[invented]]" }] },
  ]) {
    let step = 0;
    await assert.rejects(
      ai.planConnections({
        ...context,
        ask: async () =>
          step++ === 0
            ? { ids: notes.map((note) => note.id) }
            : step === 2
              ? { parents: [], links: ["related"] }
              : invalid,
      }),
      /AI_RESPONSE_INVALID/,
    );
  }
  let repaired = 0;
  const repairedPlan = await ai.planConnections({
    ...context,
    ask: async () =>
      [
        { ids: ["related"] },
        { parents: [], links: ["related"] },
        {
          ...proposal,
          links: [{ ...proposal.links[0], targetEvidence: "Wrong quotation" }],
        },
        proposal,
      ][repaired++],
  });
  assert.equal(repaired, 4);
  assert.equal(repairedPlan.links[0].targetEvidence, "Qualified evidence");
  const localOnly = await ai.planConnections({
    ...context,
    retrieve: async (queries) => {
      assert.deepEqual(queries, ["calibration"]);
      return ["related"];
    },
    ask: async (prompt) =>
      prompt.includes("Select up to 24")
        ? { ids: [], queries: ["calibration"] }
        : prompt.includes("TWO independent")
          ? { parents: [], links: ["related"] }
          : proposal,
  });
  assert.equal(localOnly.links[0].id, "related");
  const tooMuch = async (id) => ({
    ...make(id),
    body: "Long evidence ".repeat(4500),
  });
  await assert.rejects(
    ai.planConnections({
      ...context,
      notes: [...notes, make("extra")],
      read: tooMuch,
      ask: async (prompt) =>
        prompt.includes("Select up to 24")
          ? { ids: ["parent", "related", "extra"] }
          : { parents: ["parent"], links: ["related", "extra"] },
    }),
    /AI_CONTEXT_TOO_LONG/,
  );
  const retrieval = ai.createConnectionRetriever(
    "Teacher calibration",
    "Teacher confidence on augmented examples determines distillation reliability",
    ["教师校准"],
  );
  retrieval.add(
    "hidden-body",
    "Unrelated title",
    "Distillation reliability depends on teacher confidence and calibration on augmented examples.",
  );
  retrieval.add(
    "summary-only",
    "Another title",
    "Different vocabulary",
    "Calibrated teacher confidence improves reliability.",
  );
  retrieval.add("chinese", "笔记甲", "教师校准影响知识迁移的可靠程度");
  for (let i = 0; i < 25; i++)
    retrieval.add(
      "noise-" + i,
      "Teacher calibration distillation",
      "No matching body concepts here.",
    );
  const recalled = retrieval.candidates();
  for (const id of ["hidden-body", "summary-only", "chinese"])
    assert.ok(recalled.includes(id), id);
  assert.equal(recalled.includes("noise-0"), false);
  const large = Array.from({ length: 1000 }, (_, i) =>
    make(`id-${i}`, { title: "A title ".repeat(35) }),
  );
  const batches = ai.titleBatches(large);
  assert.ok(batches.length > 2);
  assert.deepEqual(
    batches.flat().map((note) => note.id),
    large.map((note) => note.id),
  );
  let visited = 0;
  await ai.planConnections({
    ...context,
    notes: large,
    ask: async (prompt) => {
      if (prompt.includes("Select up to 24"))
        visited += JSON.parse(prompt.split("\n").at(-1)).titles.length;
      return { ids: [] };
    },
  });
  assert.equal(visited, large.length);
  const smallCatalogue = Array.from({ length: 600 }, (_, i) =>
    make(`short-${i}`),
  );
  assert.equal(ai.titleBatches(smallCatalogue).length, 1);
  let inFlight = 0;
  let maximum = 0;
  const progress = [];
  await ai.planConnections({
    ...context,
    notes: large,
    progress: (...args) => progress.push(args),
    ask: async () => {
      maximum = Math.max(maximum, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { ids: [] };
    },
  });
  assert.equal(maximum, 2);
  assert.deepEqual(progress.filter((row) => row[0] === "titles").at(-1), [
    "titles",
    batches.length,
    batches.length,
  ]);
  await assert.rejects(
    ai.planConnections({
      ...context,
      check() {
        throw new Error("cancelled");
      },
      ask() {
        throw new Error("should not call");
      },
    }),
    /cancelled/,
  );

  dom.window.eval(await readFile("addon/content/connections.js", "utf8"));
  const button = dom.window.document.getElementById("start");
  const panel = dom.window.document.getElementById("review");
  let applied = 0;
  let currentVersion = true;
  let appliedSelection;
  const result = { ...plan, current, targets: notes };
  const ui = dom.window.KnowledgeBaseConnections.create({
    button,
    panel,
    api: {
      loc: (key) => key,
      isAIEnabled: ai.isAIEnabled,
      onAIEnabledChange: ai.onAIEnabledChange,
      establishConnections: async () => result,
      cancelAIJob() {},
    },
    available: () => true,
    prepare: async () => ({ id: "current", token: "version" }),
    isCurrent: () => currentVersion,
    apply: async (_, selection) => {
      applied++;
      appliedSelection = selection;
    },
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  let releaseCleanup;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const running = ai.withAIJob("shutdown-drain", async (_ask, signal) => {
    entered();
    await new Promise((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    );
    await new Promise((resolve) => {
      releaseCleanup = resolve;
    });
  });
  await started;
  let closed = false;
  const closingAI = ai.closeAI().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  releaseCleanup();
  await Promise.all([running, closingAI]);
  assert.equal(closed, true);
  ai.initAI();
  const settingsDOM = new JSDOM(
    await readFile("addon/content/ai-preferences.xhtml", "utf8"),
    { contentType: "application/xhtml+xml", runScripts: "outside-only" },
  );
  settingsDOM.window.MozXULElement = { insertFTLIfNeeded() {} };
  settingsDOM.window.document.createXULElement = (name) =>
    settingsDOM.window.document.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      name,
    );
  settingsDOM.window.document.getElementById(
    "knowledge-base-ai-models",
  ).openPopup = () => {};
  let connectionTests = 0;
  prefs.set("extensions.zotero.knowledge-base.ai.provider", "missing-provider");
  settingsDOM.window.Zotero = {
    logError: () => {},
    ZoteroKnowledgeBase: {
      api: {
        ...ai,
        getAIModels: async () => ["candidate-model"],
        loc: (key) => key,
        testAIConnection: async () => {
          connectionTests++;
        },
      },
    },
  };
  settingsDOM.window.eval(
    await readFile("addon/content/ai-settings.js", "utf8"),
  );
  ai.setAIEnabled(false);
  await settingsDOM.window.KnowledgeBaseAISettings.start(
    settingsDOM.window.document,
  );
  await settingsDOM.window.KnowledgeBaseAISettings.start(
    settingsDOM.window.document,
  );
  const setting = (name) =>
    settingsDOM.window.document.getElementById(`knowledge-base-ai-${name}`);
  assert.equal(setting("controls").hidden, true);
  assert.equal(setting("enabled").checked, false);
  setting("enabled").click();
  assert.equal(setting("controls").hidden, false);
  assert.equal(setting("provider").querySelectorAll("menuitem").length, 3);
  assert.equal(setting("test").hasAttribute("disabled"), true);
  assert.equal(setting("test").getAttribute("label"), "ai-test");
  assert.equal(setting("list").getAttribute("label"), "ai-list-models");
  assert.equal(setting("status").textContent, "ai-provider-unavailable");
  assert.equal(
    prefs.get("extensions.zotero.knowledge-base.ai.provider"),
    "missing-provider",
  );
  setting("provider").value = "deepseek";
  setting("provider").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  assert.equal(setting("test").hasAttribute("disabled"), false);
  assert.equal(setting("key").value, "");
  assert.equal(setting("key").type, "password");
  assert.equal(setting("toggle-key").getAttribute("aria-label"), "ai-show-key");
  setting("toggle-key").dispatchEvent(new settingsDOM.window.Event("command"));
  assert.equal(setting("key").type, "text");
  assert.equal(setting("toggle-key").getAttribute("aria-label"), "ai-hide-key");
  setting("toggle-key").dispatchEvent(new settingsDOM.window.Event("command"));
  assert.equal(setting("key").type, "password");
  assert.equal(setting("remove-key").hidden, false);
  setting("provider").value = "codex";
  setting("provider").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  assert.equal(setting("key-row").hidden, true);
  assert.equal(setting("path-row").hidden, false);
  assert.equal(setting("model").value, "");
  setting("list").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  const choice = setting("models").querySelector(
    'menuitem[value="candidate-model"]',
  );
  assert.ok(choice);
  choice.dispatchEvent(
    new settingsDOM.window.Event("command", { bubbles: true }),
  );
  await settle();
  assert.equal(ai.getAISettings().model, "candidate-model");
  await ai.setAISettings({ provider: "deepseek" });
  setting("provider").value = "deepseek";
  setting("provider").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  assert.equal(setting("key-row").hidden, false);
  setting("remove-key").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  assert.equal(ai.getAISettings().hasStoredKey, false);
  setting("provider").value = "codex";
  setting("provider").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  assert.equal(setting("model").value, "candidate-model");
  assert.equal(setting("key-row").hidden, true);
  setting("test").dispatchEvent(new settingsDOM.window.Event("command"));
  setting("test").dispatchEvent(new settingsDOM.window.Event("command"));
  await settle();
  assert.equal(connectionTests, 0);
  assert.match(setting("status").textContent, /cancelled/);
  settingsDOM.window.close();
  button.click();
  await settle();
  assert.equal(applied, 0);
  assert.equal(panel.querySelectorAll("input:checked").length, 0);
  assert.equal(panel.querySelectorAll(".connection-evidence").length, 2);
  assert.ok(panel.textContent.includes("Qualified evidence"));
  assert.ok(panel.textContent.includes("ai-relation-qualifies"));
  ai.setAIEnabled(false);
  assert.equal(button.hidden, true);
  assert.equal(panel.hidden, true);
  assert.equal(panel.querySelectorAll("input").length, 0);
  ai.setAIEnabled(true);
  assert.equal(button.hidden, false);
  button.click();
  await settle();
  assert.equal(
    panel.querySelector("mark").textContent,
    "scoped atomic argument",
  );
  const buttons = panel.querySelectorAll(".connection-actions button");
  assert.equal(buttons[0].disabled, true);
  panel.querySelector("input").click();
  buttons[0].click();
  await settle();
  assert.equal(applied, 1);
  assert.equal(appliedSelection.parent, true);
  assert.equal(appliedSelection.links.length, 0);
  button.click();
  await settle();
  currentVersion = false;
  panel.querySelector("input").click();
  buttons[0].click();
  await settle();
  assert.equal(applied, 1);
  assert.match(panel.textContent, /ai-plan-stale/);
  ui.destroy();
  dom.window.close();
  console.log(
    "PASS default-off AI, independent Settings and OpenCode Go only; retained provider credentials and model lists; body, summary and bilingual-query recall; complete title paging; independently ranked parents and links; mandatory full-text evidence and repair; fabricated-quote rejection; cancellation, stale proposals and explicit review",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
