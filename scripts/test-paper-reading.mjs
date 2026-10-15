/** Real Zotero PDF extraction, subprocess, reading UI and native save validation. */
/* global ChromeUtils, Zotero, Services, PathUtils, Components */
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  open,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { Script } from "node:vm";

const live = process.env.KB_HOST_CODEX_LIVE === "1";
const root = await mkdtemp(join(tmpdir(), "kb-paper-reading-host-"));
const data = join(root, "data");
const profile = join(root, "profile");
const marker = join(root, "result.json");
await mkdir(data);
await mkdir(join(profile, "extensions"), { recursive: true });
const pdf = join(root, "fixture.pdf");
const cli = join(root, "fixture-cli");
const cancelled = join(root, "cancelled");
const markdown =
  "## 方法\n\n这篇合成论文提出按照估计工作量调度请求的有界队列，每个节点维护自己的排队状态。[p. 1]\n\n## 实验与局限\n\n作者与先进先出队列比较，使用相同的工作节点和请求集合。[p. 2]\n\n公式示例为 $C = \\sum_{i=1}^{n} x_i$。本阅读稿仅依据提取文字，未核对图表。";
await writeFile(
  cli,
  [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then echo codex-fixture; exit 0; fi',
    'if [ "$1" = "login" ]; then exit 0; fi',
    'while [ "$#" -gt 0 ]; do',
    '  if [ "$1" = "--output-last-message" ]; then shift; output="$1"; fi',
    "  shift",
    "done",
    "cat > prompt.txt",
    "if /usr/bin/grep -q 'Cancellation fixture' prompt.txt; then",
    "  touch '" + cancelled + "'",
    "  exec /bin/sleep 30",
    "fi",
    "cat > \"$output\" <<'EOF'",
    JSON.stringify({ markdown }),
    "EOF",
    "",
  ].join("\n"),
  { mode: 0o700 },
);
// A genuine two-page PDF containing only synthetic test prose.
const paragraphs = [
  [
    "Synthetic Queue Scheduling Study",
    "This synthetic paper studies distributed request scheduling.",
    "Each worker estimates request work and keeps a bounded local queue.",
    "Requests go to the worker with the smallest estimated load.",
    "The goal is to reduce queue delay under the same resource budget.",
    "This fixture contains no private research or user notes.",
  ],
  [
    "Experimental Evaluation",
    "The scheduler is compared with FIFO on two synthetic workers.",
    "Both policies receive the same twenty artificial requests.",
    "Mean delay is 12 time units for FIFO and 8 for the workload policy.",
    "The evaluation does not establish behavior on production workloads.",
    "The paper reports no GPU measurements or vision-model claims.",
  ],
];
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
];
for (let i = 0; i < 2; i++) {
  const stream =
    "BT /F1 12 Tf 50 760 Td 22 TL\n" +
    paragraphs[i]
      .map((line, index) => (index ? "T* " : "") + "(" + line + ") Tj")
      .join("\n") +
    "\nET";
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents " +
      (4 + i * 2) +
      " 0 R >>",
    "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  );
}
objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
let document = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(document));
  document += index + 1 + " 0 obj\n" + object + "\nendobj\n";
});
const xref = Buffer.byteLength(document);
document +=
  "xref\n0 " +
  (objects.length + 1) +
  "\n0000000000 65535 f \n" +
  offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
    .join("") +
  "trailer\n<< /Size " +
  (objects.length + 1) +
  " /Root 1 0 R >>\nstartxref\n" +
  xref +
  "\n%%EOF\n";
await writeFile(pdf, document);
await writeFile(
  join(profile, "user.js"),
  Object.entries({
    "extensions.zotero.dataDir": data,
    "extensions.zotero.useDataDir": true,
    "extensions.zotero.firstRun2": false,
    "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 15,
    "app.update.auto": false,
    "extensions.update.enabled": false,
    "extensions.zotero.automaticScraperUpdates": false,
    "intl.locale.requested": "zh-CN",
  })
    .map(
      ([key, value]) =>
        "user_pref(" +
        JSON.stringify(key) +
        ", " +
        JSON.stringify(value) +
        ");",
    )
    .join("\n"),
);
const files = unzipSync(
  await readFile(resolve("dist/zotero-knowledge-base.xpi")),
);
const bootstrap = strFromU8(files["bootstrap.js"]);
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
if (!bootstrap.includes(trigger)) throw new Error("Missing startup hook");

async function runPaperTest(options) {
  const { setTimeout } = ChromeUtils.importESModule(
    "resource://gre/modules/Timer.sys.mjs",
  );
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (test, label, limit = 60000) => {
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      if (await test()) return;
      await pause(40);
    }
    throw new Error("Timed out: " + label);
  };
  const kb = Zotero.ZoteroKnowledgeBase;
  const checks = [];
  const readingWindow = () =>
    Services.wm.getMostRecentWindow("knowledge-base:paper-reading");
  const openReading = async (source) => {
    const token = kb.api.openPaperReading(source.key, source.libraryID);
    await wait(
      () => readingWindow()?.arguments?.[0]?.token === token,
      "reading window",
    );
    const win = readingWindow();
    await wait(
      () =>
        (win.document.getElementById("reading-save") &&
          !win.document.getElementById("reading-save").disabled) ||
        win.document.querySelector("#reading-status[data-error]"),
      "reading draft",
      options.live ? 180000 : 60000,
    );
    if (win.document.querySelector("#reading-status[data-error]")) {
      await kb.api.generatePaperReading(win.arguments[0].token, () => {});
      throw new Error(
        win.document.getElementById("reading-status").textContent,
      );
    }
    return win;
  };
  try {
    if (kb.api.isCodexEnabled())
      throw new Error("Paper reading must start disabled");
    if (
      kb.api.openPaperReading("DISABLED", Zotero.Libraries.userLibraryID) !==
        undefined ||
      readingWindow()
    )
      throw new Error("Disabled feature opened a reading window");
    let disabled = false;
    try {
      await kb.api.testCodex();
    } catch (error) {
      disabled = /codex-disabled/.test(String(error));
    }
    if (!disabled) throw new Error("Disabled feature launched a CLI check");
    checks.push("Default-off feature blocks reading windows and CLI checks");
    kb.api.setCodexEnabled(true);
    kb.api.setCodexSetting("path", options.live ? "" : options.cli);
    const connected = await kb.api.testCodex();
    if (!/codex/i.test(connected))
      throw new Error("CLI connection check failed");
    checks.push("CLI discovery and connection");
    const source = new Zotero.Item("journalArticle");
    source.libraryID = Zotero.Libraries.userLibraryID;
    source.setField("title", "Synthetic Queue Scheduling Study");
    source.setField("date", "2026");
    source.setCreators([
      { firstName: "A", lastName: "Fixture", creatorType: "author" },
    ]);
    await source.saveTx();
    const pdf = await Zotero.Attachments.importFromFile({
      file: options.pdf,
      parentItemID: source.id,
    });
    const win = await openReading(source);
    if ((await kb.api.listByItem(source.key, source.libraryID)).length)
      throw new Error("Generation wrote a note before review");
    const result = await kb.api.generatePaperReading(
      win.arguments[0].token,
      () => {},
    );
    if (result.pages !== 2 || result.truncated || !result.markdown.trim())
      throw new Error("PDF pages not faithfully extracted");
    kb.api.openPaperReading(source.key, source.libraryID);
    if (readingWindow() !== win) throw new Error("Duplicate reading window");
    checks.push(
      "Native PDF extraction, preview and duplicate click protection",
    );
    win.document.getElementById("reading-toggle").click();
    await wait(
      () => !win.document.getElementById("reading-preview").hidden,
      "rendered preview",
    );
    await win.document.fonts.ready;
    await pause(250);
    if (
      win.document.querySelector("#reading-preview h2")?.namespaceURI !==
      "http://www.w3.org/1999/xhtml"
    )
      throw new Error("Preview lost its HTML namespace");
    if (options.screenshot) {
      await IOUtils.makeDirectory(options.screenshot, { ignoreExisting: true });
      const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(
        undefined,
        1,
        "white",
      );
      const canvas = win.document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "canvas",
      );
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      image.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      await IOUtils.write(
        PathUtils.join(options.screenshot, "codex-reading.png"),
        new Uint8Array(await blob.arrayBuffer()),
      );
    }
    win.document.getElementById("reading-save").click();
    await wait(
      () =>
        win.closed || win.document.querySelector("#reading-status[data-error]"),
      "save Literature Note",
    );
    if (!win.closed)
      throw new Error(
        win.document.getElementById("reading-status").textContent,
      );
    const card = (await kb.api.listByItem(source.key, source.libraryID)).find(
      (note) => note.kind === "literature",
    );
    if (!card) throw new Error("No Literature Note saved");
    const acquired = await kb.api.acquireNativeNote({
      id: card.id,
      title: card.title,
      body: card.body,
    });
    const native = await Zotero.Items.getAsync(acquired.noteID);
    if (native.parentItemID !== source.id || !native.getNote().includes("<h1>"))
      throw new Error("Native note source or title was lost");
    if (
      !options.live &&
      !native
        .getNote()
        .includes("zotero://open-pdf/library/items/" + pdf.key + "?page=2")
    )
      throw new Error("Evidence did not become native PDF links");
    await kb.api.releaseNativeNote(acquired.noteID);
    checks.push("Reviewed native save with source, title, math and PDF links");
    let activeEditor;
    await wait(() => {
      const manager = Zotero.getMainWindow().document.querySelector(
        ".knowledge-base-workbench",
      )?.contentWindow;
      activeEditor = manager?.document.getElementById(
        "knowledge-base-workbench-editor",
      )?.contentWindow;
      return (
        activeEditor?.knowledgeBaseCardId === card.id &&
        activeEditor.document
          .getElementById("knowledge-base-rich-frame")
          ?.getCurrentInstance()?._item.id === native.id
      );
    }, "native editor initialization");
    await activeEditor.knowledgeBaseReady();
    kb.api.setCodexSetting("path", options.cli);
    const second = await openReading(source);
    activeEditor.document
      .getElementById("knowledge-base-rich-frame")
      .getCurrentInstance()
      ._postMessage({
        action: "insertHTML",
        html: "<p>Concurrent native reading edit</p>",
      });
    await wait(
      () => native.getNote().includes("Concurrent native reading edit"),
      "native edit save",
    );
    const edited = native.getNote();
    let conflict = false;
    try {
      await kb.api.applyPaperReading(
        second.arguments[0].token,
        second.document.getElementById("reading-draft").value,
      );
    } catch (error) {
      conflict = /codex-note-changed|CONFLICT/.test(String(error));
    }
    if (
      !conflict ||
      kb.api.getMarkdownDocument(native.getNote()) !==
        kb.api.getMarkdownDocument(edited)
    )
      throw new Error("Concurrent edit was overwritten");
    second.close();
    await wait(() => second.closed, "previous reading window closed");
    checks.push("Concurrent native changes reject stale drafts");
    const third = await openReading(source);
    const parser = new (Zotero.getMainWindow().DOMParser)();
    const blocks = Array.from(
      parser
        .parseFromString(native.getNote(), "text/html")
        .querySelector("div[data-schema-version]").children,
    ).map((node) => node.outerHTML);
    await kb.api.applyPaperReading(
      third.arguments[0].token,
      third.document.getElementById("reading-draft").value,
    );
    const appended = parser
      .parseFromString(native.getNote(), "text/html")
      .querySelector("div[data-schema-version]");
    if (
      !blocks.every(
        (block, index) => appended.children[index].outerHTML === block,
      ) ||
      (await kb.api.listByItem(source.key, source.libraryID)).length !== 1
    )
      throw new Error(
        "Append altered previous blocks or duplicated Literature Notes",
      );
    third.close();
    await wait(() => third.closed, "append window closed");
    checks.push(
      "Append preserves every native block and reuses one Literature Note",
    );
    const cancelSource = new Zotero.Item("journalArticle");
    cancelSource.libraryID = source.libraryID;
    cancelSource.setField("title", "Cancellation fixture");
    await cancelSource.saveTx();
    await Zotero.Attachments.importFromFile({
      file: options.pdf,
      parentItemID: cancelSource.id,
    });
    kb.api.openPaperReading(cancelSource.key, cancelSource.libraryID);
    await wait(
      () => IOUtils.exists(options.cancelled),
      "cancellable child start",
    );
    const closing = readingWindow();
    const active = kb.api.generatePaperReading(
      closing.arguments[0].token,
      () => {},
    );
    closing.close();
    let stopped = false;
    try {
      await active;
    } catch (error) {
      stopped = /codex-cancelled/.test(String(error));
    }
    if (
      !stopped ||
      (await kb.api.listByItem(cancelSource.key, cancelSource.libraryID)).length
    )
      throw new Error("Cancelled child left a Literature Note");
    checks.push("Closing kills the child and saves no late note");
    await IOUtils.writeUTF8(
      options.marker,
      JSON.stringify({
        passed: true,
        liveModel: options.live,
        checks,
        cli: connected,
      }),
    );
  } catch (error) {
    await IOUtils.writeUTF8(
      options.marker,
      JSON.stringify({ error: String(error), stack: error.stack, checks }),
    );
  } finally {
    await kb.hooks.onShutdown();
    Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
  }
}
const code =
  "(" +
  runPaperTest.toString() +
  ")(" +
  JSON.stringify({
    live,
    cli,
    pdf,
    cancelled,
    marker,
    screenshot: process.env.KB_HOST_SCREENSHOTS || "",
  }) +
  ");";
new Script(code);
files["bootstrap.js"] = strToU8(
  bootstrap.replace(trigger, trigger + "\n void " + code),
);
await writeFile(
  join(profile, "extensions", "knowledge-base@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero",
  ["-no-remote", "-profile", profile],
  { stdio: ["ignore", log.fd, log.fd] },
);
const timeout = setTimeout(() => child.kill("SIGKILL"), live ? 300000 : 150000);
let passed = false;
try {
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (exit !== 0 || !result.passed)
    throw new Error(JSON.stringify({ exit, result }));
  console.log(JSON.stringify(result, null, 2));
  passed = true;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error("Test profile and logs retained at " + root);
}
