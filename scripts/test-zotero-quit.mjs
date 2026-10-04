/** Run the real host against disposable profile/data directories. */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  access,
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const binary =
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero";
await access(binary);
const xpi = resolve(process.argv[2] || "dist/zotero-knowledge-base.xpi");
const files = unzipSync(await readFile(xpi));
const root = await mkdtemp(join(tmpdir(), "knowledge-base-quit-"));
const profile = join(root, "profile");
const data = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
const prefs = {
  "intl.locale.requested": process.env.KB_HOST_LOCALE || "en-US",
  "extensions.zotero.dataDir": data,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "app.update.auto": false,
  "extensions.update.enabled": false,
  "extensions.zotero.automaticScraperUpdates": false,
};
if (process.env.KB_HOST_COLOR_SCHEME) {
  prefs["ui.systemUsesDarkTheme"] =
    process.env.KB_HOST_COLOR_SCHEME === "dark" ? 1 : 0;
}
await writeFile(
  join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
// Add the test trigger only to this disposable copy of the installation package.
const bootstrap = strFromU8(files["bootstrap.js"]);
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
if (!bootstrap.includes(trigger))
  throw new Error("Cannot find plugin startup hook");
files["bootstrap.js"] = strToU8(
  bootstrap.replace(trigger, trigger + "\n  runQuitTest();") +
    `
function runQuitTest() {
  const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  async function run() {
    try {
      const kb = Zotero.ZoteroKnowledgeBase;
      if (!Zotero.getMainWindow()?.document.getElementById("knowledge-base-menu-open-manager")) {
        setTimeout(run, 250);
        return;
      }
      const item = new Zotero.Item("book");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Isolated test source");
      await item.saveTx();
      await kb.api.saveZettel({ title: "Shutdown test", body: "Inline $E = mc^2$", itemKey: item.key, libraryID: item.libraryID });
      const rows = await kb.api.listZettels();
      await kb.api.saveZettel({ title: "Child card", body: "[[" + rows[0].id + "]]", parentId: rows[0].id });
      kb.api.openManager({ selectId: rows[0].id });
      kb.api.openEditor({ zettelId: rows[0].id });
      kb.api.openGraph({ centerId: rows[0].id });
      setTimeout(async () => {
        try {
        const manager = [...Services.wm.getEnumerator("knowledge-base:manager")][0];
        const graph = [...Services.wm.getEnumerator("knowledge-base:graph")][0];
        const buttons = [...manager.document.querySelectorAll(".kb-native-tool"), ...graph.document.querySelectorAll(".kb-native-tool")];
        const iconsVisible = buttons.every(button => {
          const icon = button.querySelector(".toolbarbutton-icon");
          const text = button.querySelector(".toolbarbutton-text");
          const largeIcon = ["knowledge-base-btn-edit", "knowledge-base-btn-delete", "knowledge-base-btn-local-graph", "knowledge-base-btn-graph"].includes(button.id);
          const size = largeIcon ? 20 : 16;
          return icon?.getBoundingClientRect().width === size && icon.getBoundingClientRect().height === size
            && text && button.ownerGlobal.getComputedStyle(text).display === "none"
            && button.getBoundingClientRect().width === (largeIcon ? 32 : 28);
        });
        const relations = [...manager.document.querySelectorAll(".relation-link")];
        const identitiesVisible = relations.length >= 2 && relations.every(button => {
          const id = button.querySelector(".relation-id");
          return id && id.getBoundingClientRect().bottom <= button.getBoundingClientRect().bottom;
        });
        const mathVisible = !!manager.document.querySelector("#knowledge-base-preview .katex") && !!graph.document.querySelector("#graph-node-snippet .katex");
        const settings = Zotero.Utilities.Internal.openPreferences("knowledge-base-preferences");
        for (let n = 0; n < 100 && !settings.document.querySelector('[preference="extensions.zotero.knowledge-base.graph.sources"]'); n++) await new Promise(resolve => setTimeout(resolve, 100));
        const controls = [...settings.document.querySelectorAll('[preference^="extensions.zotero.knowledge-base.graph."]')];
        const preferencesVisible = controls.length === 3 && controls.every(control => control.label && control.getBoundingClientRect().width > 0);
        const sourceWasVisible = !!graph.document.querySelector(".graph-node.source");
        const sourceControl = controls.find(control => control.getAttribute("preference").endsWith("sources"));
        sourceControl.checked = false;
        sourceControl.dispatchEvent(new settings.Event("command", { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 150));
        const sourcesHidden = sourceWasVisible && !graph.document.querySelector(".graph-node.source,.graph-edge.source") && Zotero.Prefs.get("extensions.zotero.knowledge-base.graph.sources", true) === false;
        settings.close();
        const editor = [...Services.wm.getEnumerator("knowledge-base:editor")][0];
        const body = editor.document.getElementById("knowledge-base-editor-body");
        const modeMenu = editor.document.getElementById("knowledge-base-editor-mode");
        const rootElement = editor.document.getElementById("knowledge-base-editor-root");
        for (let n = 0; n < 80 && rootElement.dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (rootElement.dataset.mode !== "visual") throw new Error("The editor did not start in visual mode");
        if (modeMenu.querySelectorAll("menuitem").length !== 3 || !modeMenu.getAttribute("aria-label")) throw new Error("Native three-mode control is missing");
        async function switchMode(mode) {
          modeMenu.value = mode;
          modeMenu.dispatchEvent(new editor.Event("command", { bubbles: true }));
          for (let n = 0; n < 80 && rootElement.dataset.mode !== mode; n++) await new Promise(resolve => setTimeout(resolve, 100));
          const surfaces = [body, editor.document.getElementById("knowledge-base-editor-preview"), editor.document.getElementById("knowledge-base-rich-frame")];
          if (rootElement.dataset.mode !== mode || surfaces.filter(surface => !surface.hidden).length !== 1) throw new Error("Editor mode is not a single surface: " + mode);
        }
        await switchMode("source");
        body.value = "A saved idea with [[" + (await kb.api.listZettels()).find(card => card.id !== rows[0].id).id + "]] and $E = mc^2$.\\n\\n$$\\nx^2+y^2\\n$$\\n\\n## From reading to an idea\\n\\n- Keep the source close to the idea.\\n- Connect it to a related card.\\n\\n> One clear thought per card makes it easier to revisit.\\n\\n| Connection | Purpose |\\n| --- | --- |\\n| Parent | Outline |\\n| Card link | Related idea |";
        body.dispatchEvent(new editor.Event("input", { bubbles: true }));
        for (let n = 0; n < 80 && (await kb.api.getZettel(rows[0].id)).body !== body.value; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if ((await kb.api.getZettel(rows[0].id)).body !== body.value) throw new Error("Editor autosave did not persist");
        if ((await kb.api.listEditorDrafts()).length) throw new Error("Committed draft was not removed");
        const saveButton = editor.document.getElementById("knowledge-base-editor-save");
        if (!saveButton.label || saveButton.getBoundingClientRect().height < 16) throw new Error("Native Save control is not visible");
        saveButton.dispatchEvent(new editor.Event("command", { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 150));
        if (editor.closed) throw new Error("Save unexpectedly closed the editor");
        await switchMode("visual");
        const frame = editor.document.getElementById("knowledge-base-rich-frame");
        for (let n = 0; n < 80 && (frame.hidden || !frame.contentDocument.querySelector(".tiptap")); n++) await new Promise(resolve => setTimeout(resolve, 100));
        const richSurface = frame.contentDocument.querySelector(".tiptap");
        if (frame.hidden || !richSurface?.querySelector("a[href^='knowledge-base:']")) throw new Error("Visual editing failed to render the linked card");
        frame.contentWindow.prompt = () => { throw new Error("Formula editing opened a JavaScript prompt"); };
        const mathEngine = richSurface.editor;
        let formula;
        mathEngine.state.doc.descendants((node, pos) => {
          if (!formula && node.type.name === "inlineMath") formula = { node, pos };
        });
        if (!formula) throw new Error("Markdown formula is missing");
        mathEngine.commands.setTextSelection(formula.pos);
        richSurface.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        const mathSource = richSurface.querySelector(".inline-math.math-editing .math-source");
        if (mathSource?.textContent !== "$E = mc^2$" || frame.contentWindow.getComputedStyle(mathSource).display === "none") throw new Error("Caret did not reveal editable Markdown math");
        const exponent = formula.pos + 1 + formula.node.textContent.indexOf("2");
        mathEngine.commands.setTextSelection({ from: exponent, to: exponent + 1 });
        mathEngine.view.focus();
        if (!frame.contentDocument.execCommand("insertText", false, "3")) throw new Error("Native contenteditable math input failed");
        for (let n = 0; n < 80 && !body.value.includes("$E = mc^3$"); n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (!body.value.includes("$E = mc^3$")) throw new Error("In-place math input did not preserve Markdown markers");
        richSurface.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        if (richSurface.querySelector(".inline-math.math-editing")) throw new Error("Math source did not collapse after caret exit");
        mathEngine.commands.undo();
        if (!body.value.includes("$E = mc^2$")) throw new Error("Markdown math undo failed");
        mathEngine.commands.redo();
        for (let n = 0; n < 80 && !(await kb.api.getZettel(rows[0].id)).body.includes("$E = mc^3$"); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await kb.api.getZettel(rows[0].id)).body.includes("$E = mc^3$")) throw new Error("Edited Markdown formula was not saved");
        if (richSurface.querySelector(".inline-math.math-editing")) richSurface.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        let displayFormula;
        mathEngine.state.doc.descendants((node, pos) => {
          if (!displayFormula && node.type.name === "blockMath") displayFormula = { node, pos };
        });
        if (!displayFormula) throw new Error("Display math is missing");
        const displayExponent = displayFormula.pos + 1 + displayFormula.node.textContent.indexOf("2");
        mathEngine.commands.setTextSelection({ from: displayExponent, to: displayExponent + 1 });
        mathEngine.view.focus();
        if (!frame.contentDocument.execCommand("insertText", false, "3")) throw new Error("Native display math input failed");
        for (let n = 0; n < 80 && !body.value.includes("x^3+y^2"); n++) await new Promise(resolve => setTimeout(resolve, 50));
        const displaySource = richSurface.querySelector(".block-math.math-editing .math-source");
        if (!body.value.includes("x^3+y^2") || !displaySource?.textContent.startsWith("$$") || !displaySource.textContent.endsWith("$$")) throw new Error("Display formula input lost its Markdown markers");
        richSurface.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        for (let n = 0; n < 80 && (await kb.api.getZettel(rows[0].id)).body !== body.value; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if ((await kb.api.getZettel(rows[0].id)).body !== body.value) throw new Error("Display formula edit was not saved");
        const whiteSurfaces = [
          manager.document.getElementById("knowledge-base-detail-pane"),
          body,
          frame.contentDocument.body,
          graph.document.getElementById("graph-canvas"),
        ].every(surface => surface.ownerGlobal.getComputedStyle(surface).backgroundColor === "rgb(255, 255, 255)");
        function hasReadableText(surface) {
          const color = surface.ownerGlobal.getComputedStyle(surface).color.match(/[0-9.]+/g).slice(0, 3).map(Number);
          const rgb = color.map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4); });
          return 1.05 / (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05) >= 4.5;
        }
        const readableText = [manager.document.getElementById("knowledge-base-detail-pane"), body, frame.contentDocument.body].every(hasReadableText);
        const beforeSwitch = body.value;
        await switchMode("reading");
        if (!editor.document.getElementById("knowledge-base-editor-title").readOnly || !editor.document.getElementById("knowledge-base-command-open").hidden) throw new Error("Reading mode is editable");
        await switchMode("source");
        if (body.value !== beforeSwitch) throw new Error("Mode changes rewrote the original Markdown");
        await switchMode("visual");
        const editorRelations = editor.document.getElementById("knowledge-base-editor-relations");
        editorRelations.open = true;
        for (const details of manager.document.querySelectorAll(".card-connections details")) details.open = true;
        await new Promise(resolve => setTimeout(resolve, 100));
        const workspace = editor.document.getElementById("knowledge-base-editor-workspace").getBoundingClientRect();
        const connectionBounds = editorRelations.getBoundingClientRect();
        const managerPreview = manager.document.getElementById("knowledge-base-preview").getBoundingClientRect();
        const managerConnections = manager.document.querySelector(".card-connections").getBoundingClientRect();
        const compactConnections = connectionBounds.height <= 141 && workspace.height >= connectionBounds.height * 2 && managerPreview.height >= managerConnections.height * 1.2;
        if (!compactConnections) throw new Error("Expanded links take too much space: " + JSON.stringify({ workspace, connectionBounds, managerPreview, managerConnections }));
        const systemDark = editor.matchMedia("(prefers-color-scheme: dark)").matches;
        const expectedColorScheme = ${JSON.stringify(process.env.KB_HOST_COLOR_SCHEME || "")};
        if (expectedColorScheme && systemDark !== (expectedColorScheme === "dark")) throw new Error("Host color scheme did not match the requested test environment");
        if (!whiteSurfaces || !readableText) throw new Error("White reading surfaces or readable text colors were lost");
        const screenshotDirectory = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
        if (screenshotDirectory) {
          await IOUtils.makeDirectory(screenshotDirectory, { ignoreExisting: true });
          async function snapshot(name, win) {
            const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
            const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d").drawImage(image, 0, 0);
            image.close();
            const blob = await new Promise(resolve => canvas.toBlob(resolve));
            await IOUtils.write(PathUtils.join(screenshotDirectory, name + ".png"), new Uint8Array(await blob.arrayBuffer()));
          }
          for (const [name, win] of [["manager", manager], ["editor", editor], ["graph", graph]]) await snapshot(name, win);
          mathEngine.commands.setTextSelection(formula.pos + 2);
          await snapshot("math-editing", editor);
          richSurface.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          mathEngine.commands.setTextSelection(displayFormula.pos + 4);
          await snapshot("display-math-editing", editor);
          richSurface.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          await switchMode("reading");
          await snapshot("reading", editor);
          await switchMode("source");
          await snapshot("markdown", editor);
        }
        editor.close();
        const saved = await kb.api.getZettel(rows[0].id);
        await kb.api.saveEditorDraft({ id: saved.id, title: saved.title, body: "Recovered draft body", expectedUpdatedAt: saved.updated_at, draftId: "host-recovery", draftRevision: 1 });
        kb.api.openEditor({ draftId: "host-recovery" });
        let recovered;
        for (let n = 0; n < 80; n++) {
          recovered = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseDraftId === "host-recovery");
          if (recovered?.document.getElementById("knowledge-base-editor-body")?.value === "Recovered draft body") break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (recovered?.document.getElementById("knowledge-base-editor-body")?.value !== "Recovered draft body") throw new Error("Draft recovery failed");
        recovered.document.getElementById("knowledge-base-editor-save").dispatchEvent(new recovered.Event("command", { bubbles: true }));
        for (let n = 0; n < 80 && (await kb.api.getZettel(saved.id)).body !== "Recovered draft body"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if ((await kb.api.getZettel(saved.id)).body !== "Recovered draft body") throw new Error("Recovered draft did not save");
        const recoveredMenu = recovered.document.getElementById("knowledge-base-editor-mode");
        recoveredMenu.value = "source";
        recoveredMenu.dispatchEvent(new recovered.Event("command", { bubbles: true }));
        for (let n = 0; n < 80 && recovered.document.getElementById("knowledge-base-editor-body").hidden; n++) await new Promise(resolve => setTimeout(resolve, 100));
        const pendingBody = recovered.document.getElementById("knowledge-base-editor-body");
        pendingBody.value = "Last keystroke before quitting";
        pendingBody.dispatchEvent(new recovered.Event("input", { bubbles: true }));
        await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ cards: 2, iconsVisible, identitiesVisible, mathVisible, sourcesHidden, preferencesVisible, whiteSurfaces, readableText, compactConnections, systemDark, quitting: Date.now() }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        } catch (error) {
          await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error), stack: error.stack }));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
        }
      }, 1500);
    } catch (error) {
      await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error) }));
    }
  }
  setTimeout(run, 250);
}
`,
);
await writeFile(
  join(profile, "extensions/knowledge-base@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  binary,
  ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
  { stdio: ["ignore", log.fd, log.fd] },
);
const exited = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) =>
    resolve({ code, signal, time: Date.now() }),
  );
});
let timeout;
let passed = false;
try {
  const result = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Zotero did not exit within 45 seconds")),
        45000,
      );
    }),
  ]);
  const state = JSON.parse(await readFile(marker, "utf8"));
  if (
    state.error ||
    result.code !== 0 ||
    state.cards !== 2 ||
    !state.iconsVisible ||
    !state.identitiesVisible ||
    !state.mathVisible ||
    !state.sourcesHidden ||
    !state.preferencesVisible ||
    !state.whiteSurfaces ||
    !state.readableText ||
    !state.compactConnections
  )
    throw new Error(JSON.stringify({ state, result }));
  const db = new DatabaseSync(join(data, "knowledge-base.sqlite"), {
    readOnly: true,
  });
  try {
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("SELECT count(*) AS n FROM zettels").get().n !== 2
    )
      throw new Error("Saved database failed verification");
    if (
      !db
        .prepare("SELECT body FROM editor_drafts WHERE body = ?")
        .get("Last keystroke before quitting")
    )
      throw new Error("The last pending edit was not preserved on quit");
  } finally {
    db.close();
  }
  console.log(
    `PASS White reading surfaces and readable text (${state.systemDark ? "dark" : "light"} host); in-place Markdown math input, undo and autosave; three single-pane modes, compact expanded connections, toolbar icons and recovery drafts; real Zotero quit (${result.time - state.quitting} ms); saved database is intact.`,
  );
  passed = true;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited.catch(() => {});
    clearTimeout(killTimer);
  }
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error(`Test profile and logs retained at ${root}`);
}
