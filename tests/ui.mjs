import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const workspace = await mkdtemp(path.join(tmpdir(), "knowledge-base-ui-"));
const entry = path.join(workspace, "entry.ts");
await writeFile(
  entry,
  ["markdown", "zotero", "graph", "assets", "rich-text"]
    .map(
      (name) =>
        `export * as ${name.replace(/-/g, "_")} from ${JSON.stringify(path.join(ROOT, "src/modules", `${name}.ts`))};`,
    )
    .join("\n"),
);
const bundle = path.join(workspace, "bundle.mjs");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: bundle,
  logLevel: "warning",
});
const htmlWindow = new JSDOM("<!doctype html><html><body></body></html>")
  .window;
globalThis.window = htmlWindow;
globalThis.document = htmlWindow.document;
const {
  rich_text,
  markdown,
  zotero,
  graph: graphModule,
  assets,
} = await import(pathToFileURL(bundle).href);
let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log(`PASS ${label}`);
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
const equations = String.raw`Inline $E = mc^2$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$`;
check(
  "Markdown renders inline and display math and preserves its LaTeX source",
  () => {
    const html = markdown.renderMarkdown(equations, htmlWindow);
    const doc = new JSDOM(html).window.document;
    assert.equal(doc.querySelectorAll(".katex").length, 2);
    assert.equal(doc.querySelectorAll(".katex-display").length, 1);
    const source = rich_text.richTextToMarkdown(html);
    assert.match(source, /\$E = mc\^2\$/);
    assert.ok(source.includes(String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`));
  },
);
check(
  "Code, escaped dollars and prices stay literal; math cannot inject active HTML",
  () => {
    const html = markdown.renderMarkdown(
      String.raw`\$literal$ and $5 and $10.

INLINECODE

~~~
$$not math$$
~~~

$\href{javascript:alert(1)}{test}$ <img src=x onerror=alert(1)>`.replace(
        "INLINECODE",
        () => "`$code$`",
      ),
      htmlWindow,
    );
    const doc = new JSDOM(html).window.document;
    assert.equal(doc.querySelectorAll(".katex").length, 1);
    assert.equal(doc.querySelector('[onerror],a[href^="javascript:"]'), null);
  },
);

const sample =
  "# Idea\n\n**Strong** and *emphasis* and ~~removed~~\n\n- [x] Task\n\n> Quote\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[[中文概念|别名]] [stable](knowledge-base://card/20261001000000)\n\n![image](knowledge-base-asset:abc.png)\n\n[source](zotero://select/library/items/ABCD1234)\n\n<script>bad()</script><img src=x onerror=bad()><a href=javascript:bad()>bad</a>";
const rendered = markdown.renderMarkdown(
  sample,
  htmlWindow,
  assets.resolveAssetURL,
);
const renderedDoc = new JSDOM(rendered).window.document;
check("Managed references render only their stable index", () => {
  const body =
    "[[card:stable-id]] [Old name](knowledge-base://card/stable-id) `[[card:ignored]]`";
  assert.deepEqual(
    markdown.parseCardLinks(body).map((link) => link.ref),
    ["stable-id"],
  );
  const html = markdown.renderMarkdown(body, htmlWindow, (url) => url);
  const doc = new JSDOM(html).window.document;
  assert.deepEqual(
    [...doc.querySelectorAll("a")].map((a) => a.textContent),
    ["stable-id", "stable-id"],
  );
});

check(
  "Card previews resolve current titles while retaining stable URLs",
  () => {
    const html = markdown.renderMarkdown(
      "[[stable-id]]",
      htmlWindow,
      (url) => url,
      (id) => (id === "stable-id" ? "Current title" : undefined),
    );
    const link = new JSDOM(html).window.document.querySelector("a");
    assert.equal(link.textContent, "Current title");
    assert.equal(link.getAttribute("href"), "knowledge-base://card/stable-id");
  },
);
check(
  "Markdown headings, emphasis, task lists, quotes, code and tables",
  () => {
    for (const selector of [
      "h1",
      "strong",
      "em",
      "del",
      "input[type=checkbox]",
      "blockquote",
      "pre code",
      "table",
    ])
      assert.ok(renderedDoc.querySelector(selector), selector);
  },
);
check(
  "Wiki links, Markdown card links, Zotero sources and managed images render",
  () => {
    assert.ok(
      renderedDoc.querySelector(
        'a[href="knowledge-base://card/20261001000000"]',
      ),
    );
    assert.equal(
      renderedDoc.querySelector("a.zettel-link").textContent,
      "别名",
    );
    assert.ok(
      renderedDoc.querySelector(
        'img[src="resource://knowledge-base-assets/abc.png"]',
      ),
    );
    assert.ok(renderedDoc.querySelector('a[href^="zotero://"]'));
  },
);
check("Markdown preview removes executable markup", () => {
  assert.equal(
    renderedDoc.querySelector("script,[onerror],a[href^=javascript]"),
    null,
  );
});
check(
  "Only actual Markdown links are indexed; code and escapes remain literal",
  () => {
    assert.deepEqual(
      markdown.parseCardLinks(
        "[[Idea|Alias]] [Stable](knowledge-base://card/20261001000000) `[[Code]]`\n\n```\n[[Fence]]\n```\n\n\\[\\[Escaped]]",
      ),
      [
        { ref: "Idea", display: "Alias" },
        { ref: "20261001000000", display: "Stable" },
      ],
    );
  },
);

const libraries = [
  { libraryID: 1, libraryType: "user", name: "My Library" },
  { libraryID: 7, libraryTypeID: 777, libraryType: "group", name: "Group" },
];
const makeItem = (id, libraryID, key, title) => ({
  id,
  libraryID,
  key,
  loaded: false,
  isNote: () => false,
  isRegularItem: () => true,
  getField(field) {
    assert.notEqual(
      field,
      "creatorSummary",
      "creatorSummary is not a Zotero item field",
    );
    if (["title", "date"].includes(field))
      assert.ok(this.loaded, "item data must be loaded");
    return { title, firstCreator: "Author", date: "2026" }[field] || "";
  },
  getAttachments: () => [20],
});
const items = new Map([
  [1, makeItem(1, 1, "ABCD1234", "Atomic idea")],
  [7, makeItem(7, 7, "GROUP123", "Group idea")],
]);
items.set(20, {
  id: 20,
  parentItemID: 1,
  isNote: () => false,
  isRegularItem: () => false,
  isFileAttachment: () => true,
  getAnnotations: () => [
    {
      id: 21,
      key: "ANNO1234",
      annotationType: "highlight",
      annotationText: "Quote",
      annotationPageLabel: "2",
    },
  ],
});
let selection;
let focusCount = 0;
const searches = [];
globalThis.Zotero = {
  Libraries: {
    getAll: () => libraries,
    get: (id) => libraries.find((lib) => lib.libraryID === id),
    userLibrary: libraries[0],
  },
  Items: {
    get: (id) => items.get(id),
    getAsync: async (ids) =>
      Array.isArray(ids) ? ids.map((id) => items.get(id)) : items.get(ids),
    loadDataTypes: async (list) => {
      list.forEach((item) => {
        item.loaded = true;
      });
    },
    getIDFromLibraryAndKey: (libraryID, key) =>
      [...items.values()].find(
        (item) => item.libraryID === libraryID && item.key === key,
      )?.id || false,
  },
  Search: class {
    constructor({ libraryID }) {
      this.libraryID = libraryID;
      this.conditions = [];
      searches.push(this);
    }
    addCondition(...args) {
      this.conditions.push(args);
    }
    async search() {
      return [this.libraryID];
    }
  },
  getMainWindow: () => ({
    focus: () => focusCount++,
    ZoteroPane: {
      selectItem: async (id, options) => {
        await wait();
        selection = { id, options };
      },
    },
  }),
  getActiveZoteroPane: () => ({ getSelectedItems: () => [items.get(20)] }),
  DataDirectory: { dir: "/disposable-data" },
  logError: () => {},
};
const sources = await zotero.searchItems("idea");
check(
  "Source search uses real author field, loads data and includes group libraries",
  () => {
    assert.equal(sources.length, 2);
    assert.equal(sources[0].creatorYear, "Author 2026");
    assert.equal(
      sources[1].selectURL,
      "zotero://select/groups/777/items/GROUP123",
    );
    assert.ok(
      searches.every((search) =>
        search.conditions.some((condition) => condition[0] === "deleted"),
      ),
    );
  },
);
const existingNote = {
  ...makeItem(30, 1, "NOTE1234", "Existing note"),
  isNote: () => true,
  isRegularItem: () => false,
  getNoteTitle: () => "Existing note",
};
items.set(30, existingNote);
const noteSummary = await zotero.getItemSummary("NOTE1234", 1);
check("Existing notes are linked by identity without importing content", () => {
  assert.equal(noteSummary.title, "Existing note");
  assert.equal(noteSummary.selectURL, "zotero://select/library/items/NOTE1234");
  assert.ok(
    searches.every(
      (search) =>
        !search.conditions.some(
          (c) =>
            c[0] === "noChildren" || (c[0] === "itemType" && c[2] === "note"),
        ),
    ),
  );
});
await zotero.selectItem("GROUP123", 7);
check("Source navigation awaits selection and switches to library root", () => {
  assert.deepEqual(selection, { id: 7, options: { inLibraryRoot: true } });
  assert.equal(focusCount, 2);
});
check("Source keys require an explicit library identity", () =>
  assert.ok(zotero.getItemSummary),
);
assert.equal(await zotero.getItemSummary("ABCD1234", null), null);
check("Selected attachment resolves to its reference", () =>
  assert.ok(zotero.getSelectedSource),
);
assert.equal((await zotero.getSelectedSource()).key, "ABCD1234");
check(
  "Highlights are collected from attachments rather than regular items",
  () => assert.ok(zotero.getHighlights),
);
assert.equal((await zotero.getHighlights("ABCD1234", 1))[0].text, "Quote");

const writes = [];
globalThis.PathUtils = { join: (...parts) => path.join(...parts) };
globalThis.IOUtils = {
  makeDirectory: async () => {},
  write: async (file, bytes) => writes.push({ file, bytes }),
};
globalThis.Services = {
  uuid: { generateUUID: () => ({ toString: () => "{image-test}" }) },
};
const imageURL = await assets.importImage([137, 80, 78, 71], "image/png");
check(
  "Imported images are stored independently and have stable Markdown URLs",
  () => {
    assert.equal(imageURL, "knowledge-base-asset:image-test.png");
    assert.equal(
      writes[0].file,
      "/disposable-data/knowledge-base/assets/image-test.png",
    );
    assert.equal(
      assets.resolveAssetURL(imageURL),
      "resource://knowledge-base-assets/image-test.png",
    );
    assert.equal(
      assets.resolveAssetURL("knowledge-base-asset:../../private.png"),
      "knowledge-base-asset:../../private.png",
    );
  },
);

const formattingBundle = path.join(workspace, "editor-formatting.js");
await build({
  entryPoints: [path.join(ROOT, "src/ui/editor-formatting.ts")],
  bundle: true,
  outfile: formattingBundle,
});
const formattingScript = await readFile(formattingBundle, "utf8");
const editorScript = await readFile(
  path.join(ROOT, "addon/content/editor.js"),
  "utf8",
);
const previewScript = await readFile(
  path.join(ROOT, "addon/content/markdown.js"),
  "utf8",
);
const editorXML = await readFile(
  path.join(ROOT, "addon/content/editor.xhtml"),
  "utf8",
);
const richBundle = path.join(workspace, "rich-editor.js");
await build({
  entryPoints: [path.join(ROOT, "src/ui/rich-editor.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: richBundle,
});
const richScript = await readFile(richBundle, "utf8");
const windows = [];
async function editor(args = {}, overrides = {}) {
  const dom = new JSDOM(editorXML, {
    contentType: "application/xhtml+xml",
    runScripts: "outside-only",
  });
  windows.push(dom.window);
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  let saved;
  const calls = { open: [], images: [], graphs: [] };
  const api = {
    loc: (key) => key,
    renderMarkdown: (body) =>
      markdown.renderMarkdown(body, htmlWindow, assets.resolveAssetURL),
    richTextToMarkdown: (html) => rich_text.richTextToMarkdown(html),
    getFamily: async () => ({ parent: null, children: [] }),
    getParentCandidates: async () => [],
    getDraftLinks: async (body) =>
      markdown.parseCardLinks(body).map((link) => ({
        ...link,
        display: link.ref === "20261001000000" ? "Target card" : link.display,
        targetId: link.ref === "missing" ? null : link.ref,
      })),
    getBacklinks: async () => [],
    onDataChange: () => () => {},
    searchItems: async () => sources,
    getSelectedSource: async () => sources[0],
    listZettels: async () => [{ id: "20261001000000", title: "Target card" }],
    discardEditorDraft: async () => {},
    saveEditorDraft: async () => {},
    getEditorDraft: async () => null,
    saveEditorCard: async (input) => {
      saved = input;
      return { id: "20261001000001", updatedAt: 1 };
    },
    openLink: async (href) => calls.open.push(href),
    openImage: (url) => calls.images.push(url),
    openGraph: (options) => calls.graphs.push(options),
    getItemSummary: async () => sources[0],
    importImage: assets.importImage,
    updateImageDraft: assets.updateImageDraft,
    releaseImageDraft: async () => {},
    pickImage: async () => ({
      url: "knowledge-base-asset:image-test.png",
      name: "Figure.png",
    }),
    selectItem: async (...values) => calls.open.push(values),
    ...overrides,
  };
  dom.window.Zotero = {
    ZoteroKnowledgeBase: { api },
    logError: (error) => {
      throw error;
    },
  };
  dom.window.arguments = [args];
  dom.window.eval(previewScript);
  dom.window.eval(formattingScript);
  const richFrame = dom.window.document.getElementById(
    "knowledge-base-rich-frame",
  );
  const richWindow = richFrame.contentWindow;
  richWindow.document.open();
  richWindow.document.write(
    '<!doctype html><html><body><div id="editor"></div></body></html>',
  );
  richWindow.document.close();
  richWindow.requestAnimationFrame = (fn) => richWindow.setTimeout(fn, 0);
  richWindow.cancelAnimationFrame = (id) => richWindow.clearTimeout(id);
  richWindow.Range.prototype.getClientRects = () => [];
  richWindow.Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
  });
  richWindow.eval(richScript);
  dom.window.eval(
    editorScript + "\nwindow.__editorEval = (source) => eval(source);",
  );
  await dom.window.__editorEval("load()");
  const initialMode = dom.window.document.getElementById(
    "knowledge-base-editor-mode",
  ).value;
  await dom.window.__editorEval('setEditorMode("source", false)');
  return {
    initialMode,
    win: dom.window,
    $: (id) => dom.window.document.getElementById(id),
    calls,
    saved: () => saved,
  };
}
const ed = await editor({ prefillTitle: "New concept" });
check("Editor prefills concept titles in its real XML document", () =>
  assert.equal(ed.$("knowledge-base-editor-title").value, "New concept"),
);
// Slow writes must not clear edits made after their snapshot was taken.
let finishSave;
let draftSnapshot;
const slow = await editor(
  {},
  {
    saveEditorDraft: async (input) => {
      draftSnapshot = input;
    },
    saveEditorCard: async () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  },
);
slow.$("knowledge-base-editor-body").value = "first";
slow.win.__editorEval("setDirty()");
const pendingSave = slow.win.__editorEval("save(false)");
await wait();
slow.$("knowledge-base-editor-body").value = "second";
slow.win.__editorEval("setDirty()");
finishSave({ id: "slow-card", updatedAt: 10 });
await pendingSave;
check(
  "Typing during a save stays dirty and retains the newer recovery draft",
  () => {
    assert.equal(slow.win.__editorEval("dirty"), true);
    assert.equal(draftSnapshot.body, "second");
    assert.equal(draftSnapshot.expectedUpdatedAt, 10);
  },
);
slow.win.close();
const recovered = await editor(
  { draftId: "recover" },
  {
    getEditorDraft: async () => ({
      draftId: "recover",
      draftRevision: 2,
      title: "Recovered card",
      body: "Kept after restart",
      expectedUpdatedAt: null,
    }),
  },
);
check(
  "Recovered drafts load without immediately overwriting a saved card",
  () => {
    assert.equal(
      recovered.$("knowledge-base-editor-body").value,
      "Kept after restart",
    );
    assert.equal(recovered.saved(), undefined);
    assert.equal(recovered.win.__editorEval("dirty"), true);
  },
);
recovered.win.close();
const commands = await editor({ prefillTitle: "Commands" });
const commandBody = commands.$("knowledge-base-editor-body");
const typeCommand = (text) => {
  commandBody.value = text;
  commandBody.setSelectionRange(text.length, text.length);
  commandBody.dispatchEvent(new commands.win.Event("input", { bubbles: true }));
};
typeCommand("/task");
check(
  "Typing a slash filters commands without moving focus or changing body text",
  () => {
    assert.equal(commands.$("knowledge-base-command-menu").hidden, false);
    assert.equal(commandBody.value, "/task");
  },
);
commandBody.dispatchEvent(
  new commands.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
);
check(
  "Executing a slash command replaces only its invocation with a real Markdown task",
  () => {
    assert.equal(commandBody.value, "- [ ] ");
    assert.equal(commands.$("knowledge-base-command-menu").hidden, true);
  },
);
for (const text of [
  "https://example.com/task",
  "```\n/task",
  "~~~\n/task",
  "content /task",
]) {
  typeCommand(text);
  check(
    `Slash commands leave URLs, code and inline prose alone: ${JSON.stringify(text)}`,
    () => assert.equal(commands.$("knowledge-base-command-menu").hidden, true),
  );
}
typeCommand("/heading");
commands.win.dispatchEvent(
  new commands.win.KeyboardEvent("keydown", { key: "Escape" }),
);
check("Cancelling a slash command preserves its unsaved text", () =>
  assert.equal(commandBody.value, "/heading"),
);
commandBody.value = "Selected title";
commandBody.setSelectionRange(0, 14);
commands
  .$("knowledge-base-command-open")
  .dispatchEvent(new commands.win.Event("command", { bubbles: true }));
commands.$("knowledge-base-command-search").value = "heading";
commands
  .$("knowledge-base-command-search")
  .dispatchEvent(new commands.win.Event("input"));
commands.$("knowledge-base-command-list").querySelector("button").click();
check(
  "The insertion menu applies a chosen command to the saved selection",
  () => assert.equal(commandBody.value, "## Selected title"),
);
ed.$("knowledge-base-editor-body").value = sample;
await ed.win.__editorEval('setEditorMode("reading", false)');
check(
  "HTML Markdown including task checkbox renders in a Zotero XML window",
  () => {
    assert.ok(
      ed
        .$("knowledge-base-editor-preview")
        .querySelector("input[type=checkbox]"),
    );
    assert.ok(ed.$("knowledge-base-editor-preview").querySelector("table"));
    assert.equal(
      ed.$("knowledge-base-editor-preview").querySelector("input").namespaceURI,
      "http://www.w3.org/1999/xhtml",
    );
  },
);
const richFrame = ed.$("knowledge-base-rich-frame");
const richWindow = richFrame.contentWindow;
const nativeClick = (element, win) =>
  element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
async function chooseMode(fixture, mode) {
  fixture.$("knowledge-base-editor-mode").value = mode;
  fixture
    .$("knowledge-base-editor-mode")
    .dispatchEvent(new fixture.win.Event("command", { bubbles: true }));
  await wait();
  await wait();
}
await chooseMode(ed, "visual");
const richSurface = richWindow.document.querySelector(".tiptap");
assert.ok(richSurface);
check(
  "New cards start in visual mode and the three modes show one body surface",
  () => {
    assert.equal(ed.initialMode, "visual");
    assert.equal(
      ed.$("knowledge-base-editor-mode").querySelectorAll("menuitem").length,
      3,
    );
    assert.equal(ed.$("knowledge-base-editor-body").hidden, true);
    assert.equal(ed.$("knowledge-base-editor-preview").hidden, true);
    assert.equal(richFrame.hidden, false);
  },
);
const beforeModeSwitch = ed.$("knowledge-base-editor-body").value;
const beforeModeRevision = ed.win.__editorEval("revision");
await chooseMode(ed, "reading");
check(
  "Reading mode is read-only and keeps editing actions out of the way",
  () => {
    assert.equal(ed.$("knowledge-base-editor-title").readOnly, true);
    assert.equal(ed.$("knowledge-base-command-open").hidden, true);
    assert.equal(ed.$("knowledge-base-src-pick").disabled, true);
    assert.equal(ed.$("knowledge-base-editor-preview").hidden, false);
    assert.equal(ed.$("knowledge-base-editor-body").hidden, true);
    assert.equal(richFrame.hidden, true);
    ed.win.__editorEval('insertText("Should not be inserted")');
    assert.equal(ed.$("knowledge-base-editor-body").value, beforeModeSwitch);
  },
);
await chooseMode(ed, "source");
check(
  "Source mode exposes only the original Markdown without rewriting it",
  () => {
    assert.equal(ed.$("knowledge-base-editor-title").readOnly, false);
    assert.equal(ed.$("knowledge-base-editor-body").hidden, false);
    assert.equal(ed.$("knowledge-base-editor-preview").hidden, true);
    assert.equal(richFrame.hidden, true);
    assert.equal(ed.$("knowledge-base-editor-body").value, beforeModeSwitch);
    assert.equal(ed.win.__editorEval("revision"), beforeModeRevision);
  },
);
ed.$("knowledge-base-editor-body").setSelectionRange(2, 5);
ed.win.dispatchEvent(
  new ed.win.KeyboardEvent("keydown", {
    key: "e",
    ctrlKey: true,
    bubbles: true,
  }),
);
await wait();
await wait();
assert.equal(ed.$("knowledge-base-editor-mode").value, "reading");
ed.win.dispatchEvent(
  new ed.win.KeyboardEvent("keydown", {
    key: "e",
    ctrlKey: true,
    bubbles: true,
  }),
);
await wait();
await wait();
check(
  "Reading shortcut returns to the last editing mode and source selection",
  () => {
    assert.equal(ed.$("knowledge-base-editor-mode").value, "source");
    assert.equal(ed.$("knowledge-base-editor-body").selectionStart, 2);
    assert.equal(ed.$("knowledge-base-editor-body").selectionEnd, 5);
  },
);
await chooseMode(ed, "visual");
assert.equal(richWindow.document.querySelector(".tiptap"), richSurface);

// Use the engine's document transaction; no direct DOM rewrites or fake input event.
const controller = ed.win.__editorEval("richEditor");
controller.setHTML(
  markdown.renderMarkdown("[[stable-id|My label]]", htmlWindow),
);
controller.insertHTML("<p>More text</p>");
check("Visual edits preserve explicit card-link aliases", () => {
  assert.ok(
    ed.$("knowledge-base-editor-body").value.includes("[[stable-id|My label]]"),
  );
});
controller.setHTML(
  '<p><a href="knowledge-base://card/stable-id">Old name</a></p><p><img src="resource://knowledge-base-assets/image-test.png" alt="Figure"></p>',
);
controller.insertHTML("<p>Changed directly in visual editor</p>");
await wait();
check(
  "Tiptap edits persist without replacing the editing DOM or losing card and image identities",
  () => {
    assert.ok(
      ed
        .$("knowledge-base-editor-body")
        .value.includes("Changed directly in visual editor"),
    );
    assert.ok(
      ed.$("knowledge-base-editor-body").value.includes("[[stable-id]]"),
    );
    assert.ok(
      ed
        .$("knowledge-base-editor-body")
        .value.includes("knowledge-base-asset:image-test.png"),
    );
    assert.equal(richWindow.document.querySelector(".tiptap"), richSurface);
  },
);
controller.format("bold");
controller.insertHTML("<p><strong>Bold insertion</strong></p>");
assert.ok(controller.getHTML().includes("<strong>"));
richSurface.dispatchEvent(
  new richWindow.KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    bubbles: true,
  }),
);
check(
  "Mature editor handles formatting and undo with its document history",
  () => assert.ok(!controller.getHTML().includes("Bold insertion")),
);
controller.setHTML(
  '<ul><li><input type="checkbox" checked="checked">A task</li></ul><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>',
);
controller.insertHTML("<p>Tail</p>");
check("Tiptap tables and tasks round-trip to Markdown", () => {
  assert.match(ed.$("knowledge-base-editor-body").value, /\| A \|/);
  assert.match(ed.$("knowledge-base-editor-body").value, /\[x\]/);
});
controller.setHTML(markdown.renderMarkdown(equations, htmlWindow));
controller.insertHTML("<p>After equations</p>");
check(
  "Tiptap keeps math nodes and LaTeX when editing surrounding prose",
  () => {
    const value = ed.$("knowledge-base-editor-body").value;
    assert.match(value, /\$E = mc\^2\$/);
    assert.ok(
      value.includes(String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`),
      value + "\n" + controller.getHTML(),
    );
    assert.ok(value.includes("After equations"));
    assert.ok(richSurface.querySelector(".katex"));
  },
);
const mathEngine = richSurface.editor;
const findMath = (name) => {
  let result;
  mathEngine.state.doc.descendants((node, pos) => {
    if (!result && node.type.name === name) result = { node, pos };
  });
  return result;
};
richWindow.prompt = () => {
  throw new Error("Math editing must never open a JavaScript prompt");
};
let inlineMath = findMath("inlineMath");
mathEngine.commands.setTextSelection(inlineMath.pos);
richSurface.dispatchEvent(
  new richWindow.KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
  }),
);
check(
  "Arrow navigation expands inline math as editable Markdown document text",
  () => {
    assert.equal(
      mathEngine.state.selection.$from.parent.type.name,
      "inlineMath",
    );
    assert.equal(
      richSurface.querySelector(".inline-math .math-source").textContent,
      "$E = mc^2$",
    );
    assert.ok(richSurface.querySelector(".inline-math.math-editing"));
  },
);
mathEngine.commands.setTextSelection({
  from: inlineMath.pos + 2,
  to: inlineMath.pos + inlineMath.node.nodeSize - 2,
});
mathEngine.view.dispatch(mathEngine.state.tr.insertText("E = mc^3"));
check(
  "Editing formula text saves its Markdown delimiters without a dialog",
  () => {
    assert.ok(ed.$("knowledge-base-editor-body").value.includes("$E = mc^3$"));
    assert.ok(controller.getHTML().includes('data-math-source="$E = mc^3$"'));
  },
);
richSurface.dispatchEvent(
  new richWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
);
check("Leaving formula text restores its rendered preview", () => {
  assert.equal(richSurface.querySelector(".inline-math.math-editing"), null);
  assert.ok(richSurface.querySelector(".inline-math .katex"));
});
mathEngine.commands.undo();
check("In-place formula edits participate in the editor's undo history", () => {
  assert.ok(ed.$("knowledge-base-editor-body").value.includes("$E = mc^2$"));
});
let blockMath = findMath("blockMath");
mathEngine.commands.setTextSelection(blockMath.pos + 4);
mathEngine.view.dispatch(mathEngine.state.tr.insertText("a+b"));
check("Display math keeps editable dollar markers and multiline source", () => {
  assert.ok(
    richSurface
      .querySelector(".block-math.math-editing .math-source")
      .textContent.startsWith("$$\na+b"),
  );
  assert.ok(ed.$("knowledge-base-editor-body").value.includes("$$\na+b"));
});
richSurface.dispatchEvent(
  new richWindow.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  }),
);
check("Enter inserts an actual newline inside Markdown display math", () => {
  assert.ok(findMath("blockMath").node.textContent.startsWith("$$\na+b\n"));
});
inlineMath = findMath("inlineMath");
mathEngine.commands.setTextSelection({
  from: inlineMath.pos + 1,
  to: inlineMath.pos + 2,
});
mathEngine.commands.deleteSelection();
check("An unfinished formula preserves exactly what was typed", () => {
  const html = new JSDOM(controller.getHTML()).window.document;
  assert.equal(
    html
      .querySelector('[data-type="inline-math"]')
      .getAttribute("data-math-source"),
    "E = mc^2$",
  );
  assert.ok(
    ed.$("knowledge-base-editor-body").value.includes("Inline E = mc^2$."),
  );
});
controller.setHTML("<p></p>");
function typeMath(text) {
  for (const char of text) {
    const { from, to } = mathEngine.state.selection;
    const handled = mathEngine.view.someProp("handleTextInput", (handler) =>
      handler(mathEngine.view, from, to, char),
    );
    if (!handled)
      mathEngine.view.dispatch(mathEngine.state.tr.insertText(char));
  }
}
typeMath("$x^2$");
check("Typing Markdown math creates a source-editable formula", () => {
  assert.equal(findMath("inlineMath").node.textContent, "$x^2$");
  assert.equal(ed.$("knowledge-base-editor-body").value, "$x^2$");
});
controller.setHTML("<p></p>");
typeMath("$$");
richSurface.dispatchEvent(
  new richWindow.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  }),
);
check("Typing a display-math opener creates a multiline Markdown block", () => {
  assert.equal(findMath("blockMath").node.textContent, "$$\n\n$$");
  assert.equal(mathEngine.state.selection.$from.parent.type.name, "blockMath");
});
controller.setHTML(markdown.renderMarkdown(equations, htmlWindow));
await chooseMode(ed, "source");
ed.win.__editorEval("toggleSourceDrop()");
await ed.win.__editorEval("searchSources()");
ed.$("knowledge-base-src-results").firstElementChild.click();
check(
  "Selecting a source fills its association and enables jump and insertion",
  () => {
    assert.ok(
      ed.$("knowledge-base-src-display").textContent.includes("Atomic idea"),
    );
    assert.equal(ed.$("knowledge-base-src-insert").disabled, false);
  },
);
ed.$("knowledge-base-editor-body").setSelectionRange(0, 0);
ed.$("knowledge-base-src-insert").dispatchEvent(
  new ed.win.Event("command", { bubbles: true }),
);
check("Source insertion creates an actual Zotero Markdown link", () =>
  assert.match(
    ed.$("knowledge-base-editor-body").value,
    /^\[Atomic idea\]\(zotero:\/\/select\/library\/items\/ABCD1234\)/,
  ),
);
ed.$("knowledge-base-editor-body").value = "";
ed.$("knowledge-base-editor-body").setSelectionRange(0, 0);
ed.win.__editorEval("openCardPicker()");
await ed.win.__editorEval("searchCards()");
ed.$("knowledge-base-link-results").firstElementChild.click();
check("Card picker inserts a stable managed reference", () =>
  assert.equal(ed.$("knowledge-base-editor-body").value, "[[20261001000000]]"),
);
await ed.win.__editorEval("refreshRelations()");
check("Connected cards appear while editing unsaved Markdown", () =>
  assert.match(
    ed.$("knowledge-base-editor-outgoing").textContent,
    /Target card/,
  ),
);
const childDraft = await editor(
  { prefillParentId: "PARENT" },
  {
    getZettel: async (id) => ({ id, title: "Parent concept" }),
  },
);
childDraft.$("knowledge-base-editor-title").value = "Child concept";
await childDraft.win.__editorEval("save(false)");
check(
  "New child drafts save their explicitly prefilled parent without adding a reference",
  () => {
    assert.equal(childDraft.saved().parentId, "PARENT");
    assert.equal(childDraft.saved().body, "");
  },
);
ed.win.__editorEval("openCardPicker()");
await ed.win.__editorEval("searchCards()");
ed.$("knowledge-base-link-search").dispatchEvent(
  new ed.win.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
);
check(
  "Reference picker can be reached by keyboard and distinguishes title from stable ID",
  () => {
    const row = ed.$("knowledge-base-link-results").firstElementChild;
    assert.equal(ed.win.document.activeElement, row);
    assert.equal(
      row.querySelector(".relation-title").textContent,
      "Target card",
    );
    assert.equal(
      row.querySelector(".relation-id").textContent,
      "20261001000000",
    );
  },
);
ed.$("knowledge-base-link-drop").hidden = true;
const familyBox = ed.$("knowledge-base-editor-family");
const manyChildren = Array.from({ length: 8 }, (_, i) => ({
  id: String(i),
  title: `Child ${i}`,
}));
ed.win.ZoteroKnowledgeBaseMarkdown.renderFamily(
  familyBox,
  { parent: null, children: manyChildren },
  ed.win.Zotero.ZoteroKnowledgeBase.api,
);
check(
  "Large child groups initially collapse without hiding the parent or losing children",
  () => {
    assert.equal(familyBox.querySelector("details").open, false);
    assert.equal(familyBox.querySelectorAll(".family-link").length, 8);
  },
);
familyBox.querySelector("details").open = true;
ed.win.ZoteroKnowledgeBaseMarkdown.renderFamily(
  familyBox,
  { parent: null, children: manyChildren },
  ed.win.Zotero.ZoteroKnowledgeBase.api,
);
check("Relationship refresh preserves an explicitly expanded child group", () =>
  assert.equal(familyBox.querySelector("details").open, true),
);
ed.$("knowledge-base-editor-body").value = "word";
ed.$("knowledge-base-editor-body").setSelectionRange(0, 4);
ed.win.__editorEval('formatSelection("bold")');
check("Formatting toolbar edits the actual selected Markdown text", () =>
  assert.equal(ed.$("knowledge-base-editor-body").value, "**word**"),
);
ed.$("knowledge-base-editor-body").value = "- [x] done";
ed.$("knowledge-base-editor-body").setSelectionRange(10, 10);
ed.$("knowledge-base-editor-body").dispatchEvent(
  new ed.win.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  }),
);
check("Markdown list editing continues a new unchecked task", () =>
  assert.equal(ed.$("knowledge-base-editor-body").value, "- [x] done\n- [ ] "),
);
await ed.win.__editorEval("save(false)");
check(
  "Saved content stays Markdown and preserves the source association",
  () => {
    assert.equal(ed.saved().body, "- [x] done\n- [ ] ");
    assert.equal(ed.saved().itemKey, "ABCD1234");
    assert.equal(ed.saved().libraryID, 1);
  },
);
ed.$("knowledge-base-editor-body").value = "";
ed.$("knowledge-base-editor-body").setSelectionRange(0, 0);
ed.$("knowledge-base-image-insert").dispatchEvent(
  new ed.win.Event("command", { bubbles: true }),
);
await wait();
await wait();
check("Image file picker inserts a persistent Markdown image", () =>
  assert.equal(
    ed.$("knowledge-base-editor-body").value,
    "![Figure.png](knowledge-base-asset:image-test.png)",
  ),
);
await chooseMode(ed, "reading");
ed.$("knowledge-base-editor-preview").querySelector("img").click();
check("Image preview opens the full image viewer", () =>
  assert.equal(
    ed.calls.images[0],
    "resource://knowledge-base-assets/image-test.png",
  ),
);
await chooseMode(ed, "source");
const paste = new ed.win.Event("paste", { bubbles: true, cancelable: true });
Object.defineProperty(paste, "clipboardData", {
  value: {
    files: [
      {
        name: "Clipboard.png",
        type: "image/png",
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      },
    ],
  },
});
ed.$("knowledge-base-editor-body").dispatchEvent(paste);
await wait();
await wait();
check("Pasting image data imports bytes and inserts an image link", () => {
  assert.equal(paste.defaultPrevented, true);
  assert.match(
    ed.$("knowledge-base-editor-body").value,
    /!\[Clipboard.png\]\(knowledge-base-asset:image-test.png\)/,
  );
});
const missing = await editor(
  { zettelId: "old" },
  {
    getZettel: async () => ({
      id: "old",
      title: "Missing source",
      body: "Text",
      item_key: "MISSING1",
      library_id: 7,
    }),
    getItemSummary: async () => null,
  },
);
await missing.win.__editorEval("save(false)");
check(
  "Editing a detached source never silently deletes its original key/library",
  () => assert.equal(missing.saved().itemKey, "MISSING1"),
);
const failing = await editor(
  {},
  {
    searchItems: async () => {
      throw new Error("Search failed");
    },
  },
);
failing.win.__editorEval("toggleSourceDrop()");
await failing.win.__editorEval("searchSources()");
check(
  "Source search failures are visible instead of producing a dead picker",
  () =>
    assert.match(
      failing.$("knowledge-base-src-status").textContent,
      /Search failed/,
    ),
);

check(
  "Tree layout separates broad branches, centers parents and remains deterministic",
  () => {
    const nodes = [
      { id: "r", title: "Root", kind: "card" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        title: "A deliberately long title for this child",
        kind: "card",
        parentId: "r",
      })),
    ];
    const positions = graphModule.layoutHierarchy(nodes);
    const children = nodes.slice(1).map((node) => positions.get(node.id));
    for (let i = 1; i < children.length; i++)
      assert.ok(children[i].x - children[i - 1].x >= 200);
    assert.equal(positions.get("r").x, (children[0].x + children.at(-1).x) / 2);
    assert.deepEqual([...positions], [...graphModule.layoutHierarchy(nodes)]);
  },
);
check(
  "A deep knowledge outline lays out without recursion or non-finite coordinates",
  () => {
    const nodes = Array.from({ length: 10000 }, (_, i) => ({
      id: String(i),
      title: "Card",
      kind: "card",
      parentId: i ? String(i - 1) : null,
    }));
    const positions = graphModule.layoutHierarchy(nodes);
    assert.equal(positions.size, 10000);
    assert.ok(Number.isFinite(positions.get("9999").y));
    assert.ok(positions.get("9999").y > positions.get("9998").y);
  },
);
const graphData = {
  nodes: [
    {
      id: "A",
      title: "A",
      kind: "card",
      snippet: "# Summary\n\n**Rendered preview**",
    },
    { id: "B", title: "B", kind: "card", snippet: "" },
    { id: "C", title: "C", kind: "card", snippet: "" },
    { id: "I", title: "Isolated", kind: "card", snippet: "" },
    {
      id: "S",
      title: "Paper",
      kind: "source",
      snippet: "Author 2024 · Journal",
      citation: "Author 2024 · Journal",
    },
  ],
  edges: [
    { source: "A", target: "B", kind: "link" },
    { source: "B", target: "C", kind: "link" },
    { source: "A", target: "S", kind: "source" },
  ],
};
check(
  "Full graph includes isolated cards; local graph follows incoming/outgoing edges",
  () => {
    assert.equal(graphModule.filterGraph(graphData).nodes.length, 4);
    assert.deepEqual(
      graphModule
        .filterGraph(graphData, { centerId: "A", depth: 1 })
        .nodes.map((node) => node.id),
      ["A", "B"],
    );
    assert.deepEqual(
      graphModule
        .filterGraph(graphData, { centerId: "A", depth: 2 })
        .nodes.map((node) => node.id),
      ["A", "B", "C"],
    );
    assert.ok(
      graphModule
        .filterGraph(graphData, { includeSources: true })
        .nodes.some((node) => node.id === "S"),
    );
  },
);
const graphDom = new JSDOM(
  await readFile(path.join(ROOT, "addon/content/graph.xhtml"), "utf8"),
  { contentType: "application/xhtml+xml", runScripts: "outside-only" },
);
windows.push(graphDom.window);
await new Promise((resolve) =>
  graphDom.window.addEventListener("load", resolve, { once: true }),
);
const graphOptions = { outline: true, references: true, sources: true };
let optionsChanged;
graphDom.window.Zotero = {
  ZoteroKnowledgeBase: {
    api: {
      loc: (key) => key,
      getGraph: async () => graphData,
      getGraphOptions: () => graphOptions,
      onGraphOptionsChange: (listener) => {
        optionsChanged = listener;
        return () => {
          optionsChanged = undefined;
        };
      },
      renderMarkdown: (body) => markdown.renderMarkdown(body, htmlWindow),
      onDataChange: () => () => {},
      openEditor() {},
    },
  },
};
graphDom.window.arguments = [];
const graphBundle = path.join(workspace, "graph.js");
await build({
  entryPoints: [path.join(ROOT, "src/ui/graph.js")],
  bundle: true,
  format: "iife",
  outfile: graphBundle,
  logLevel: "warning",
});
graphDom.window.eval(previewScript);
graphDom.window.eval(await readFile(graphBundle, "utf8"));
graphDom.window.dispatchEvent(new graphDom.window.Event("load"));
await wait();
await wait();
check(
  "Graph uses saved relationship settings and defaults to all relationships",
  () => {
    assert.deepEqual(graphOptions, {
      outline: true,
      references: true,
      sources: true,
    });
    assert.equal(
      graphDom.window.document.getElementById("graph-settings"),
      null,
    );
    assert.equal(
      graphDom.window.document.getElementById("graph-node-focus"),
      null,
    );
    assert.equal(graphDom.window.document.getElementById("graph-hint"), null);
  },
);
check(
  "Graph renders directed SVG edges and every isolated card in a real XML DOM",
  () => {
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.card").length,
      4,
    );
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-edge.link").length,
      2,
    );
    assert.equal(
      graphDom.window.document.getElementById("graph-error").textContent,
      "",
    );
  },
);
graphDom.window.document
  .querySelector(".graph-node")
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
const pointerNode = graphDom.window.document.querySelector(".graph-node");
let capturedOnNode = false;
pointerNode.setPointerCapture = () => {
  capturedOnNode = true;
};
pointerNode.dispatchEvent(
  new graphDom.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
);
graphDom.window.document
  .getElementById("graph-svg")
  .dispatchEvent(
    new graphDom.window.MouseEvent("pointerup", { bubbles: true }),
  );
check(
  "Node dragging keeps pointer capture on the node so clicks remain actionable",
  () => assert.equal(capturedOnNode, true),
);
check("Selecting a node shows connected nodes in the graph inspector", () =>
  assert.equal(
    graphDom.window.document.querySelectorAll("#graph-connections li").length,
    2,
  ),
);
const originalPositions = Array.from(
  graphDom.window.document.querySelectorAll(".graph-node"),
  (node) => node.getAttribute("transform"),
);
const originalViewport = graphDom.window.document
  .querySelector("#graph-svg > g")
  .getAttribute("transform");
check(
  "Graph uses curved paths with clipped endpoints and handles self references",
  () => {
    assert.match(
      graphDom.window.document
        .querySelector(".graph-edge.link")
        .getAttribute("d"),
      / Q /,
    );
    assert.match(
      graphModule.edgePath(
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 50, y: 100 },
        "parent",
      ),
      / C /,
    );
    assert.match(
      graphModule.edgePath(
        { id: "a", x: 0, y: 0 },
        { id: "a", x: 0, y: 0 },
        "link",
      ),
      / C /,
    );
  },
);
graphOptions.references = false;
optionsChanged();
await wait();
check("Hiding references leaves every card visible", () => {
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-edge.link").length,
    0,
  );
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-node.card").length,
    4,
  );
});
check(
  "Relationship toggles retain every node position and the current viewport",
  () => {
    assert.deepEqual(
      Array.from(
        graphDom.window.document.querySelectorAll(".graph-node"),
        (node) => node.getAttribute("transform"),
      ),
      originalPositions,
    );
    assert.equal(
      graphDom.window.document
        .querySelector("#graph-svg > g")
        .getAttribute("transform"),
      originalViewport,
    );
  },
);
graphOptions.references = true;
optionsChanged();
await wait();
check("Showing references restores edges without filtering cards", () =>
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-edge.link").length,
    2,
  ),
);
graphOptions.sources = false;
optionsChanged();
await wait();
check(
  "Hiding source items removes their nodes, edges and legend, retaining every card",
  () => {
    assert.equal(
      graphDom.window.document.querySelectorAll(
        ".graph-node.source,.graph-edge.source",
      ).length,
      0,
    );
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.card").length,
      4,
    );
    assert.equal(
      graphDom.window.document.getElementById("graph-legend-sources").hidden,
      true,
    );
  },
);
graphOptions.sources = true;
optionsChanged();
await wait();
check("Source nodes return when enabled in preferences", () => {
  assert.ok(graphDom.window.document.querySelector(".graph-node.source"));
  assert.ok(
    graphDom.window.document.getElementById("graph-search").placeholder,
  );
});
const searchGraph = graphDom.window.document.getElementById("graph-search");
searchGraph.value = "isolated";
searchGraph.dispatchEvent(new graphDom.window.Event("input"));
check("Graph search keeps the entire graph visible", () =>
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-node.card").length,
    4,
  ),
);
searchGraph.value = "";
// Replace the entire API object as a plugin reload does, rather than mutating
// one method on the old object. Open windows must call the new instance.
let latestApiCalled = false;
graphDom.window.Zotero.ZoteroKnowledgeBase.api = {
  ...graphDom.window.Zotero.ZoteroKnowledgeBase.api,
  getGraph: async () => {
    latestApiCalled = true;
    return graphData;
  },
};
graphDom.window.document
  .getElementById("graph-refresh")
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
await wait();
await wait();
check("Open graph window uses the replacement API after plugin reload", () => {
  assert.ok(latestApiCalled);
  assert.equal(
    graphDom.window.document.getElementById("graph-error").textContent,
    "",
  );
});
const crowdedCards = Array.from({ length: 120 }, (_, i) => ({
  id: `crowded-${i}`,
  title: `Long card title with explanatory context ${i}`,
  kind: "card",
  snippet: "Full idea context",
}));
graphDom.window.Zotero.ZoteroKnowledgeBase.api.getGraph = async () => ({
  nodes: crowdedCards,
  edges: [],
});
graphDom.window.document
  .getElementById("graph-refresh")
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
await wait();
await wait();
check("All Cards keeps every node while hiding crowded graph labels", () => {
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-node").length,
    120,
  );
  assert.ok(
    graphDom.window.document.querySelectorAll(".graph-node.label-hidden")
      .length > 0,
  );
  assert.equal(
    graphDom.window.document.getElementById("graph-error").textContent,
    "",
  );
});
const hiddenNode = graphDom.window.document.querySelector(
  ".graph-node.label-hidden",
);
hiddenNode.dispatchEvent(
  new graphDom.window.MouseEvent("click", { bubbles: true }),
);
check(
  "Selecting a crowded node reveals its title and complete card context",
  () => {
    assert.ok(hiddenNode.classList.contains("selected"));
    assert.ok(!hiddenNode.classList.contains("label-hidden"));
    assert.equal(
      graphDom.window.document
        .getElementById("graph-node-snippet")
        .textContent.trim(),
      "Full idea context",
    );
  },
);
// Exercise the card browser in its actual XML document.
const managerDOM = new JSDOM(
  await readFile(path.join(ROOT, "addon/content/manager.xhtml"), "utf8"),
  { contentType: "application/xhtml+xml", runScripts: "outside-only" },
);
const managerWin = managerDOM.window;
windows.push(managerWin);
// Model the icon children created by Zotero's native toolbarbutton constructor.
for (const button of managerWin.document.querySelectorAll("toolbarbutton")) {
  const icon = managerWin.document.createElementNS(
    button.namespaceURI,
    "image",
  );
  icon.classList.add("toolbarbutton-icon");
  button.appendChild(icon);
}
let managerCards = [
  {
    id: "20261002011320",
    title: "这是2017的Zettel",
    body: "An idea with a clear source and related notes.",
    updated_at: 1790874821032,
    outgoing: 1,
    incoming: 0,
  },
  {
    id: "20261002005552",
    title: "是直接点",
    body: "Child idea",
    updated_at: 1790874821032,
    outgoing: 0,
    incoming: 0,
  },
];
const managerCalls = { edits: [], graphs: [], deletes: [], opens: [] };
const labels = {
  "manager-new": "New card",
  "graph-title": "All cards graph",
  "manager-edit": "Edit card",
  "manager-delete": "Delete card",
  "manager-show-graph": "Show card in graph",
  "new-child": "New child card",
  parent: "Parent",
  children: "Children",
  root: "Entry point",
  entries: "Entry points",
  "manager-outgoing": "Linked cards",
  "manager-backlinks": "Backlinks",
  "manager-updated": "Updated",
  "manager-title": "Knowledge Base",
  "manager-search-placeholder": "Search title, body or ID…",
};
managerWin.arguments = [{}];
managerWin.confirm = () => true;
managerWin.Zotero = {
  logError: (error) => {
    throw error;
  },
  ZoteroKnowledgeBase: {
    api: {
      loc: (key) => labels[key] || key,
      listEditorDrafts: async () => [],
      listZettels: async () => managerCards,
      getZettel: async (id) => managerCards.find((card) => card.id === id),
      getFamily: async () => ({
        parent: null,
        children: [managerCards[1]].filter(Boolean),
      }),
      getOutgoing: async () => [],
      getBacklinks: async () => [],
      getUnresolvedRefs: async () => [],
      onDataChange: () => () => {},
      renderMarkdown: (body) => `<p>${body}</p>`,
      openEditor: (args) => managerCalls.edits.push(args),
      openGraph: (args) => managerCalls.graphs.push(args),
      openManager: (args) => managerCalls.opens.push(args),
      deleteZettel: async (id) => {
        managerCalls.deletes.push(id);
        managerCards = managerCards.filter((card) => card.id !== id);
      },
    },
  },
};
managerWin.eval(previewScript);
managerWin.eval(
  (await readFile(path.join(ROOT, "addon/content/manager.js"), "utf8")) +
    "\nwindow.__managerLoad = load;",
);
await managerWin.__managerLoad();
await wait();
await wait();
const managerDoc = managerWin.document;
check("Card browser exposes IDs and uses Zotero native toolbar actions", () => {
  assert.deepEqual(
    [...managerDoc.querySelectorAll(".zettel-row .zid")].map(
      (el) => el.textContent,
    ),
    managerCards.map((card) => card.id),
  );
  const actions = [
    ...managerDoc.querySelectorAll(".card-actions toolbarbutton"),
  ];
  assert.equal(actions.length, 3);
  for (const button of actions) {
    assert.equal(
      button.namespaceURI,
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    );
    assert.ok(button.getAttribute("tooltiptext"));
    assert.ok(button.getAttribute("aria-label"));
    assert.ok(button.getAttribute("label"));
    assert.ok(button.querySelector(".toolbarbutton-icon"));
    assert.equal(button.textContent.trim(), "");
  }
  assert.equal(
    managerDoc.querySelector(".zettel-row.active").getAttribute("aria-current"),
    "true",
  );
});
managerDoc.getElementById("knowledge-base-preview").scrollTop = 64;
managerDoc.querySelectorAll(".zettel-row")[1].click();
await wait();
await wait();
managerDoc
  .getElementById("knowledge-base-back")
  .dispatchEvent(new managerWin.Event("command", { bubbles: true }));
await wait();
await wait();
check(
  "Back navigation restores the card's independently scrolling preview",
  () => {
    assert.equal(
      managerDoc.querySelector(".zettel-row.active").dataset.id,
      managerCards[0].id,
    );
    assert.equal(
      managerDoc.getElementById("knowledge-base-preview").scrollTop,
      64,
    );
  },
);
nativeClick(managerDoc.getElementById("knowledge-base-btn-edit"), managerWin);
nativeClick(
  managerDoc.getElementById("knowledge-base-btn-local-graph"),
  managerWin,
);
managerDoc.getElementById("knowledge-base-btn-child").click();
check("Edit, graph and new-child actions target the selected card", () => {
  assert.equal(managerCalls.edits[0].zettelId, managerCards[0].id);
  assert.equal(managerCalls.graphs[0].centerId, managerCards[0].id);
  assert.equal(managerCalls.edits[1].prefillParentId, managerCards[0].id);
});
managerDoc.querySelector("#knowledge-base-family .family-link").click();
check("Compact child entries still navigate to their card", () =>
  assert.equal(managerCalls.opens[0].selectId, managerCards[1].id),
);
// Save the real rendered fixture for browser visual inspection when requested.
if (process.env.KNOWLEDGE_BASE_PREVIEW) {
  const css = await readFile(
    path.join(ROOT, "addon/content/manager.css"),
    "utf8",
  );
  const markup = managerDoc
    .getElementById("knowledge-base-root")
    .outerHTML.replace(/html:/g, "");
  await writeFile(
    process.env.KNOWLEDGE_BASE_PREVIEW,
    `<html><head><meta charset="utf-8"><style>${css}\n:root{--bg:#f5f5f7;--fg:#1d1d1f;--accent:#007aff}body{margin:0}#knowledge-base-toolbar,#knowledge-base-list-pane{background:#f5f5f7}</style></head><body>${markup}</body></html>`,
  );
}
nativeClick(managerDoc.getElementById("knowledge-base-btn-delete"), managerWin);
await wait();
await wait();
check("Delete action removes the selected card and clears its details", () => {
  assert.equal(managerCalls.deletes[0], "20261002011320");
  assert.equal(managerDoc.querySelectorAll(".zettel-row").length, 1);
  assert.equal(managerDoc.getElementById("knowledge-base-detail").hidden, true);
});
for (const win of windows) {
  win.dispatchEvent(new win.Event("unload"));
  win.close();
}
htmlWindow.close();
await rm(workspace, { recursive: true, force: true });
console.log(`OK - ${checks} Markdown, source, editing, image and graph checks`);
