import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  stat,
  access,
  mkdir,
} from "node:fs/promises";
import { join, dirname, basename, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "kb-reading-test-"));
const windows = [];
const prefs = new Map();
const prefObservers = new Map();
const state = {
  card: null,
  mapping: null,
  writes: [],
  released: [],
  failures: [],
  mode: "ok",
  pdf: null,
};
globalThis.readingTest = state;
const main = new JSDOM("<main />").window;
main.openDialog = (_url, _name, _options, args) => {
  const win = new JSDOM("<main />").window;
  win.arguments = [args];
  win.focus = () => {};
  const close = win.close.bind(win);
  win.close = () => {
    win.dispatchEvent(new win.Event("unload"));
    close();
  };
  windows.push(win);
  state.duringOpen?.(args.token);
  void Promise.resolve().then(() => win.dispatchEvent(new win.Event("unload")));
  return win;
};
const source = {
  id: 1,
  key: "PAPERKEY",
  libraryID: 1,
  deleted: false,
  isRegularItem: () => true,
  isInTrash() {
    return this.deleted;
  },
  isEditable: () => true,
  getField: (field) =>
    ({ title: "A fixture paper", firstCreator: "Fixture", date: "2026" })[
      field
    ] || "",
  getBestAttachments: async () => (state.noPDF ? [] : [attachment]),
};
const attachment = {
  id: 2,
  key: "PDFKEY01",
  parentItemID: 1,
  libraryID: 1,
  isPDFAttachment: () => true,
  isInTrash: () => false,
  getFilePathAsync: async () => join(dir, "paper.pdf"),
};
const note = {
  id: 3,
  key: "NOTEKEY1",
  libraryID: 1,
  html: '<div data-schema-version="2"><h1>A fixture paper</h1></div>',
  isNote: () => true,
  isInTrash: () => false,
  getNote() {
    return this.html;
  },
};
const fixtureText =
  "This is a synthetic article. A bounded queue schedules requests by estimated work. The experiments compare the queue with a FIFO baseline using the same workers. No private material is present. Results and limitations are discussed with explicit evidence. ";
const markdown =
  "## 方法\n\n论文使用有界队列分配请求，并按照估计工作量安排调度。[p. 1]\n\n## 实验\n\n在相同工作节点上与先进先出队列比较。[p. 2]\n\n## 阅读局限\n\n本阅读稿基于 PDF 提取文字，未核对图表。";
await writeFile(join(dir, "paper.pdf"), "fixture");
const cli = join(dir, "fixture-cli");
await writeFile(
  cli,
  `#!/bin/sh
if [ "$1" = "--version" ]; then echo codex-fixture; exit 0; fi
if [ "$1" = "login" ]; then exit 0; fi
if [ "$1" = "hang" ]; then exec /bin/sleep 30; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; output="$1"; fi
  shift
done
cat > prompt.json
cat > "$output" <<'EOF'
${JSON.stringify({ markdown })}
EOF
`,
  { mode: 0o700 },
);
let lastSpawn;
function pipeReader(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  stream.setEncoding("utf8");
  return {
    async readString() {
      const value = await iterator.next();
      return value.done ? "" : value.value;
    },
  };
}
globalThis.ChromeUtils = {
  importESModule(path) {
    if (path.includes("Timer")) return { setTimeout, clearTimeout };
    return {
      Subprocess: {
        pathSearch: async () => cli,
        getEnvironment: () => ({}),
        async call(options) {
          if (state.mode === "failure") options.arguments = ["invalid"];
          const child = spawn(options.command, options.arguments, {
            cwd: options.workdir,
            stdio: "pipe",
          });
          lastSpawn = { ...options, child };
          const waiting = new Promise((resolve, reject) => {
            child.on("exit", (exitCode) =>
              resolve({ exitCode: exitCode ?? -9 }),
            );
            child.on("error", reject);
          });
          return {
            stdin: {
              write: (data) =>
                new Promise((resolve, reject) =>
                  child.stdin.write(data, (error) =>
                    error ? reject(error) : resolve(),
                  ),
                ),
              close: async () => child.stdin.end(),
            },
            stdout: pipeReader(child.stdout),
            stderr: pipeReader(child.stderr),
            wait: () => waiting,
            kill: () => {
              child.kill("SIGKILL");
              return waiting;
            },
          };
        },
      },
    };
  },
};
globalThis.Services = {
  appinfo: { XPCOMABI: "aarch64" },
  dirsvc: { get: () => ({ path: dir }) },
};
globalThis.Ci = { nsIFile: {} };
globalThis.PathUtils = {
  join,
  parent: dirname,
  filename: basename,
  isAbsolute,
  tempDir: dir,
};
globalThis.IOUtils = {
  exists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  stat,
  readUTF8: (path) => readFile(path, "utf8"),
  writeUTF8: writeFile,
  makeDirectory: mkdir,
  remove: (path, options) =>
    rm(path, { recursive: options.recursive, force: true }),
};
let serial = 0;
globalThis.Zotero = {
  isMac: true,
  isWin: false,
  getMainWindow: () => main,
  File: { pathToFile: () => ({ isSymlink: () => false }) },
  Prefs: {
    get: (key) => prefs.get(key),
    set: (key, value) => {
      prefs.set(key, value);
      for (const observer of prefObservers.values())
        if (observer.key === key) observer.listener();
    },
    registerObserver: (key, listener) => {
      const id = prefObservers.size + 1;
      prefObservers.set(id, { key, listener });
      return id;
    },
    unregisterObserver: (id) => prefObservers.delete(id),
  },
  Utilities: { randomString: () => `fixture${++serial}` },
  Items: {
    getAsync: async () => note,
    getByLibraryAndKeyAsync: async (_library, key) =>
      ({ PAPERKEY: source, PDFKEY01: attachment, NOTEKEY1: note })[key] ||
      false,
    loadDataTypes: async () => {},
  },
  Libraries: { get: () => ({ libraryType: "user", editable: true }) },
  PDFWorker: {
    getFullText: async () =>
      state.pdf || {
        text: fixtureText + "\f" + fixtureText,
        totalPages: 2,
        extractedPages: 2,
      },
  },
  logError: (error) => state.failures.push(error),
};
const output = join(dir, "reading.mjs");
await build({
  entryPoints: ["src/modules/paper-reading.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "reading-data",
      setup(builder) {
        builder.onResolve(
          { filter: /(?:locale|zettel|db|native-notes)$/ },
          (args) => ({ path: args.path, namespace: "reading-data" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "reading-data" }, (args) => ({
          contents: args.path.endsWith("locale")
            ? `export const getString = key => key;`
            : args.path.endsWith("db")
              ? `export const getOne = async () => readingTest.mapping;`
              : args.path.endsWith("zettel")
                ? `export const listByItem = async () => readingTest.card ? [readingTest.card] : []; export const getZettel = async () => readingTest.card;`
                : `export const getMarkdownDocument = html => { const doc = Zotero.getMainWindow().document.implementation.createHTMLDocument(); doc.body.innerHTML = html; return (doc.querySelector('div[data-schema-version]') || doc.body).innerHTML; };
      export const projectNativeNote = html => { const doc = Zotero.getMainWindow().document.implementation.createHTMLDocument(); doc.body.innerHTML = html; doc.querySelector('h1')?.remove(); return {body:doc.body.textContent}; };
      export const ensureLiteratureNote = async () => { readingTest.card = { id:'lit-id', title:'A fixture paper', body:'', kind:'literature', updated_at:1, item_key:'PAPERKEY', library_id:1 }; return 'lit-id'; };
      export const acquireNativeNote = async () => ({noteID:3, html: readingTest.note.html});
      export const releaseNativeNote = async id => readingTest.released.push(id);
      export const nativeNoteHTML = async (_, body) => '<div data-schema-version="2"><pre>' + body.replaceAll('&','&amp;').replaceAll('<','&lt;') + '</pre></div>';
      export const saveNativeCard = async input => { if(!input.isCurrent()) throw new Error('NOTE_SESSION_CLOSED'); if(input.expectedNoteHTML !== readingTest.note.html) throw new Error('CARD_CONFLICT'); readingTest.writes.push(input); readingTest.note.html=input.nativeHTML; return {id:input.id}; };
      `,
        }));
      },
    },
  ],
});
state.note = note;
const api = await import(pathToFileURL(output));
await build({
  entryPoints: ["src/modules/codex.ts"],
  outfile: join(dir, "codex.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
});
const runtime = await import(pathToFileURL(join(dir, "codex.mjs")));
const token = () => windows.at(-1).arguments[0].token;
const open = () => {
  api.openPaperReading(source.key, 1);
  return token();
};
try {
  api.initPaperReading();
  api.initPaperReading();
  assert.equal(prefObservers.size, 1, "Repeated startup owns one observer");
  assert.equal(runtime.isCodexEnabled(), false);
  assert.equal(api.openPaperReading(source.key, 1), undefined);
  assert.equal(windows.length, 0, "Disabled reading creates no window");
  await assert.rejects(runtime.testCodex(), /codex-disabled/);
  runtime.setCodexEnabled(true);
  const phases = [];
  let early;
  state.duringOpen = (token) => {
    early = api.generatePaperReading(token, (phase) => phases.push(phase));
  };
  const first = open();
  state.duringOpen = undefined;
  api.openPaperReading(source.key, 1);
  assert.equal(
    windows.length,
    1,
    "Repeated clicks reuse the same reading window",
  );
  const pending = api.generatePaperReading(first, () => {});
  assert.equal(
    pending,
    early,
    "A reentrant chrome-window load finds the registered session",
  );
  assert.equal(
    api.generatePaperReading(first, () => {}),
    pending,
  );
  const draft = await pending;
  assert.equal(draft.pages, 2);
  assert.equal(
    state.card,
    null,
    "Generation alone creates no card or native note",
  );
  assert.equal(state.writes.length, 0);
  assert.deepEqual(phases, ["codex-extracting", "codex-reading"]);
  const prompt = await readFile(
    join(lastSpawn.workdir, "prompt.json"),
    "utf8",
  ).catch(() => "removed");
  assert.equal(
    prompt,
    "removed",
    "Temporary paper input is removed after the child exits",
  );
  assert.ok(lastSpawn.arguments.includes("--ignore-user-config"));
  assert.ok(lastSpawn.arguments.includes("read-only"));
  assert.ok(
    !lastSpawn.arguments.includes("--dangerously-bypass-approvals-and-sandbox"),
  );
  assert.equal(await api.applyPaperReading(first, draft.markdown), "lit-id");
  assert.ok(
    note.html.includes("zotero://open-pdf/library/items/PDFKEY01?page=2"),
  );
  assert.equal(state.writes.length, 1);
  await assert.rejects(
    api.applyPaperReading(first, draft.markdown),
    /codex-output-invalid/,
  );
  api.closePaperReading(first);

  state.mapping = { note_key: note.key, library_id: 1 };
  note.html =
    '<div data-schema-version="2"><h1>My title</h1><span data-citation="preserved">Original citation</span><img data-attachment-key="ORIGINAL" /></div>';
  const original = note.html;
  const second = open();
  const next = await api.generatePaperReading(second, () => {});
  assert.equal(next.hasExisting, true);
  note.html = original.replace("My title", "Edited title");
  await assert.rejects(
    api.applyPaperReading(second, next.markdown),
    /codex-note-changed/,
  );
  note.html = original.replace(
    'data-schema-version="2"',
    'data-schema-version="11"',
  );
  state.card.updated_at++;
  await api.applyPaperReading(second, next.markdown);
  assert.ok(note.html.includes('data-citation="preserved"'));
  assert.ok(note.html.includes('data-attachment-key="ORIGINAL"'));
  assert.ok(note.html.includes("Original citation"));
  assert.equal(state.writes.length, 2);
  api.closePaperReading(second);

  const third = open();
  const before = await api.generatePaperReading(third, () => {});
  source.deleted = true;
  await assert.rejects(
    api.applyPaperReading(third, before.markdown),
    /codex-source-unavailable/,
  );
  source.deleted = false;
  api.closePaperReading(third);
  state.noPDF = true;
  const missing = open();
  await assert.rejects(
    api.generatePaperReading(missing, () => {}),
    /codex-pdf-missing/,
  );
  api.closePaperReading(missing);
  state.noPDF = false;
  state.pdf = {
    text: fixtureText + "\f" + fixtureText,
    totalPages: 3,
    extractedPages: 2,
  };
  const partial = open();
  const partialDraft = await api.generatePaperReading(partial, () => {});
  assert.equal(partialDraft.truncated, true);
  assert.ok(
    partialDraft.markdown.includes("codex-partial-note"),
    "Partial-reading scope stays in the saved draft",
  );
  api.closePaperReading(partial);
  state.pdf = { text: "", totalPages: 2, extractedPages: 2 };
  const scanned = open();
  await assert.rejects(
    api.generatePaperReading(scanned, () => {}),
    /codex-pdf-empty/,
  );
  api.closePaperReading(scanned);
  state.pdf = new Promise(() => {});
  const extracting = open();
  const held = api.generatePaperReading(extracting, () => {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  api.closePaperReading(extracting);
  await assert.rejects(held, /codex-cancelled/);
  state.pdf = null;
  assert.equal(
    state.writes.length,
    2,
    "Failures and cancellation preserve existing notes",
  );

  const child = { cancelled: false };
  const hanging = runtime.runCodex(child, cli, ["hang"], dir, "", 10_000);
  await new Promise((resolve) => setTimeout(resolve, 30));
  runtime.cancelCodex(child);
  await assert.rejects(hanging, /codex-cancelled/);
  assert.equal(child.child, undefined);
  await assert.rejects(
    runtime.runCodex({ cancelled: false }, cli, ["hang"], dir, "", 30),
    /codex-timeout/,
  );
  runtime.setCodexSetting("path", join(dir, "missing"));
  await assert.rejects(
    runtime.discoverCodex(),
    /codex-path-invalid/,
    "Invalid explicit paths never fall back to another executable",
  );
  runtime.setCodexSetting("path", "");
  assert.throws(
    () => api.parseReadingResult({ markdown: "a".repeat(50) + " [p. 3]" }, 2),
    /codex-output-invalid/,
  );
  assert.ok(
    api
      .paperPrompt("title", "author", "paper", true)
      .includes("partial reading"),
  );
  assert.ok(
    api
      .paperPrompt("title", "author", "paper", false)
      .includes("untrusted source material"),
  );
  const disabledToken = open();
  state.pdf = new Promise(() => {});
  const disabledTask = api.generatePaperReading(disabledToken, () => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  const beforeDisable = state.writes.length;
  runtime.setCodexEnabled(false);
  await assert.rejects(disabledTask, /codex-cancelled|codex-disabled/);
  assert.equal(state.writes.length, beforeDisable);
  assert.equal(api.openPaperReading(source.key, 1), undefined);
  assert.throws(
    () => api.generatePaperReading(disabledToken, () => {}),
    /codex-disabled/,
  );
  await api.closePaperReadingTasks();
  assert.equal(prefObservers.size, 0, "Shutdown releases the feature observer");
  console.log(
    "PASS Paper reading: isolated CLI, cancellation, preview, append, native objects, conflicts, source deletion and cleanup",
  );
} finally {
  for (const win of windows) win.close();
  main.close();
  await rm(dir, { recursive: true, force: true });
}
