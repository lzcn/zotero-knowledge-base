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
  [
    "markdown",
    "zotero",
    "graph",
    "assets",
    "rich-text",
    "references",
    "native-notes",
  ]
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
  references,
  native_notes,
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
    ["[[stable-id]]", "Old name"],
  );
});

check("Card links retain their Markdown IDs and manually chosen labels", () => {
  const html = markdown.renderMarkdown(
    "[[stable-id]]",
    htmlWindow,
    (url) => url,
  );
  const link = new JSDOM(html).window.document.querySelector("a");
  assert.equal(link.textContent, "[[stable-id]]");
  assert.equal(link.getAttribute("href"), "knowledge-base://card/stable-id");
});
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
    return (
      {
        title,
        firstCreator: "Author",
        date: "2026",
        citationKey: this.citationKey,
        extra: this.extra,
      }[field] || ""
    );
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
  ItemFields: { getID: (field) => (field === "citationKey" ? 1 : false) },
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
    setScope(scope) {
      this.conditions.push(...scope.conditions);
    }
    async search() {
      const key = this.conditions.find(
        (condition) => condition[0] === "citationKey" && condition[1] === "is",
      )?.[2];
      if (key)
        return [...items.values()]
          .filter(
            (item) =>
              item.libraryID === this.libraryID &&
              (item.citationKey === key ||
                item.extra?.includes(`Citation Key: ${key}`)),
          )
          .map((item) => item.id);
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
      (search) => !search.conditions.some((c) => c[0] === "noChildren"),
    ),
  );
});
items.set(40, {
  ...makeItem(40, 1, "CITE0001", "Citation source"),
  citationKey: "Author2026",
});
items.set(41, {
  ...makeItem(41, 7, "CITE0002", "Group citation"),
  extra: "Citation Key: Extra2026",
});
await references.prepareCitations("[@Author2026] [@Extra2026]");
check(
  "Citation keys resolve native and Extra fields across personal and group libraries",
  () => {
    assert.equal(references.getCitation("Author2026").label, "Author 2026");
    assert.equal(
      references.getCitation("Extra2026").selectURL,
      "zotero://select/groups/777/items/CITE0002",
    );
  },
);
const citationHTML = markdown.renderMarkdown(
  "[@Author2026] [@Missing] `[@Author2026]`",
  htmlWindow,
  (url) => url,
  references.getCitation,
);
check(
  "Citations render author-year links while preserving keys and code examples",
  () => {
    const doc = new JSDOM(citationHTML).window.document;
    assert.equal(doc.querySelector("a").textContent, "Author 2026");
    assert.equal(doc.querySelectorAll("a")[1].textContent, "[@Missing]");
    assert.equal(doc.querySelector("code").textContent, "[@Author2026]");
    assert.ok(
      rich_text
        .richTextToMarkdown(citationHTML)
        .startsWith("[@Author2026] [@Missing]"),
    );
  },
);
items.set(42, {
  ...makeItem(42, 7, "CITE0003", "Duplicate citation"),
  citationKey: "Author2026",
});
assert.equal(await references.resolveCitation("Author2026"), null);
check(
  "Duplicate citation keys stay unresolved instead of linking the wrong item",
  () => {
    assert.equal(references.getCitation("Author2026"), undefined);
  },
);
items.delete(42);
await references.prepareCitations("[@Author2026]");
items.set(43, makeItem(43, 7, "CITE0004", "BBT citation"));
const bbtRecord = { itemID: 43, libraryID: 7, citationKey: "BBT2026" };
globalThis.Zotero.BetterBibTeX = {
  KeyManager: {
    get: (id) => (id === 43 ? bbtRecord : undefined),
    all: (query) => [bbtRecord].filter(query),
  },
};
assert.equal((await references.resolveCitation("BBT2026")).key, "CITE0004");
check(
  "Better BibTeX cached keys resolve without copying or modifying source data",
  () => {
    assert.equal(references.getCitation("BBT2026").label, "Author 2026");
  },
);
const bbtSearch = await zotero.searchItems("BBT2026");
check("The reference picker can search generated Better BibTeX keys", () => {
  assert.ok(
    bbtSearch.some((item) => item.key === "CITE0004" && item.libraryID === 7),
  );
});
delete globalThis.Zotero.BetterBibTeX;
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
  let nativeHTML = "";
  const calls = { open: [], images: [], graphs: [] };
  const api = {
    prepareMarkdown: async () => {},
    nativeNoteHTML: async (title, body) =>
      `<div data-schema-version="9"><h1>${title}</h1>${markdown.renderMarkdown(body, htmlWindow)}</div>`,
    projectNativeNote: (html) => {
      const doc = new JSDOM(html).window.document;
      const root = doc.querySelector("div[data-schema-version]") || doc.body;
      const heading = root.querySelector("h1");
      const title = heading?.textContent || "";
      heading?.remove();
      return { title, body: rich_text.richTextToMarkdown(root) };
    },
    acquireNativeNote: async (input) => {
      nativeHTML = await api.nativeNoteHTML(input.title, input.body);
      return { noteID: 1, html: nativeHTML };
    },
    releaseNativeNote: async () => {},
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
      nativeHTML = await api.nativeNoteHTML(input.title, input.body);
      return { id: "20261001000001", updatedAt: 1, html: nativeHTML };
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
    Items: { getAsync: async () => ({ getNote: () => nativeHTML }) },
    logError: (error) => {
      throw error;
    },
  };
  dom.window.arguments = [args];
  dom.window.eval(previewScript);
  dom.window.eval(formattingScript);
  dom.window.KnowledgeBaseNativeEditor = {
    create: async (options) => {
      let html = nativeHTML;
      return {
        getHTML: () => html,
        getSavedHTML: () => html,
        flush: async () => {},
        reload: async () => {
          html = nativeHTML;
        },
        setReadOnly: async (value) => {
          options.element.mode = value ? "view" : "edit";
        },
        insertHTML: (content) => {
          html = content;
          options.onChange(content);
        },
        focus: () => {},
        destroy: () => {},
      };
    },
  };
  dom.window.eval(
    editorScript + "\nwindow.__editorEval = (expression) => eval(expression);",
  );
  await dom.window.__editorEval("load()");
  const initialMode =
    dom.window.document
      .getElementById("knowledge-base-editor-mode")
      .getAttribute("label") === "editor-browse"
      ? "visual"
      : "reading";
  if (!args.draftId)
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
let closeChoice = 1;
let promptCalls = 0;
let closeCalls = 0;
const closeDrafts = [];
const closeEditor = await editor(
  { prefillTitle: "Unsaved idea", prefillBody: "Keep this text" },
  {
    saveEditorDraft: async (input) => closeDrafts.push(input),
  },
);
const originalClose = closeEditor.win.close.bind(closeEditor.win);
closeEditor.win.close = () => closeCalls++;
closeEditor.win.Services = {
  prompt: {
    BUTTON_POS_0: 1,
    BUTTON_POS_1: 256,
    BUTTON_POS_2: 65536,
    BUTTON_TITLE_IS_STRING: 127,
    BUTTON_TITLE_CANCEL: 2,
    BUTTON_POS_1_DEFAULT: 256,
    confirmEx: () => {
      promptCalls++;
      return closeChoice;
    },
  },
};
closeEditor.win.dispatchEvent(
  new closeEditor.win.KeyboardEvent("keydown", {
    key: "w",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  }),
);
await wait();
await wait();
check(
  "Command-W prompts for unsaved work and Cancel keeps the window and text",
  () => {
    assert.equal(promptCalls, 1);
    assert.equal(closeCalls, 0);
    assert.equal(
      closeEditor.$("knowledge-base-editor-body").value,
      "Keep this text",
    );
  },
);
const closeEvent = new closeEditor.win.Event("close", { cancelable: true });
closeEditor.win.dispatchEvent(closeEvent);
await wait();
await wait();
check("Native close requests use the same unsaved-work confirmation", () => {
  assert.equal(closeEvent.defaultPrevented, true);
  assert.equal(closeCalls, 0);
  assert.equal(promptCalls, 2);
});
closeChoice = 2;
await closeEditor.win.__editorEval("closeIfClean()");
check("Keep draft closes without committing the unsaved card", () => {
  assert.equal(closeCalls, 1);
  assert.equal(closeEditor.saved(), undefined);
  assert.equal(closeDrafts.at(-1).body, "Keep this text");
});
closeEditor.win.close = originalClose;
closeEditor.win.dispatchEvent(new closeEditor.win.Event("unload"));
originalClose();
const saveCloseEditor = await editor({
  prefillTitle: "Save on close",
  prefillBody: "Saved text",
});
let savedCloseCalls = 0;
const originalSavedClose = saveCloseEditor.win.close.bind(saveCloseEditor.win);
saveCloseEditor.win.close = () => savedCloseCalls++;
saveCloseEditor.win.Services = closeEditor.win.Services;
closeChoice = 0;
await saveCloseEditor.win.__editorEval("closeIfClean()");
check("Save and close commits the latest Markdown before closing", () => {
  assert.equal(saveCloseEditor.saved().body, "Saved text");
  assert.equal(savedCloseCalls, 1);
});
saveCloseEditor.win.close = originalSavedClose;
saveCloseEditor.win.dispatchEvent(new saveCloseEditor.win.Event("unload"));
originalSavedClose();
const failedClose = await editor(
  { prefillTitle: "Unsaved", prefillBody: "Preserve on failure" },
  {
    saveEditorCard: async () => {
      throw new Error("CARD_CONFLICT");
    },
  },
);
let failedCloseCalls = 0;
const originalFailedClose = failedClose.win.close.bind(failedClose.win);
failedClose.win.close = () => failedCloseCalls++;
failedClose.win.Services = closeEditor.win.Services;
failedClose.win.Zotero.logError = () => {};
await failedClose.win.__editorEval("closeIfClean()");
check("A failed close-time save keeps the editor and draft recoverable", () => {
  assert.equal(failedCloseCalls, 0);
  assert.equal(failedClose.win.__editorEval("allowClose"), false);
  assert.equal(
    failedClose.$("knowledge-base-editor-body").value,
    "Preserve on failure",
  );
});
failedClose.win.close = originalFailedClose;
failedClose.win.dispatchEvent(new failedClose.win.Event("unload"));
originalFailedClose();
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
const nativeClick = (element, win) =>
  element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
async function chooseMode(fixture, mode) {
  await fixture.win.__editorEval(`setEditorMode("${mode}", false)`);
  await wait();
}
check("The UI exposes only one native browse/edit toggle", () => {
  assert.equal(ed.$("knowledge-base-editor-mode").localName, "button");
  assert.equal(
    ed.$("knowledge-base-editor-mode").querySelectorAll("menuitem").length,
    0,
  );
});
ed.$("knowledge-base-editor-body").value = sample;
ed.$("knowledge-base-editor-body").dispatchEvent(
  new ed.win.Event("input", { bubbles: true }),
);
await chooseMode(ed, "reading");
check("Reading uses the host note component in view mode", () => {
  assert.equal(ed.$("knowledge-base-rich-frame").localName, "note-editor");
  assert.equal(ed.$("knowledge-base-rich-frame").mode, "view");
  assert.equal(ed.$("knowledge-base-rich-frame").hidden, false);
  assert.equal(ed.$("knowledge-base-editor-body").hidden, true);
  assert.equal(ed.$("knowledge-base-editor-preview").hidden, true);
});
await chooseMode(ed, "visual");
check("Visual mode reuses Zotero's editor and keeps one body surface", () => {
  assert.equal(ed.initialMode, "visual");
  assert.equal(ed.$("knowledge-base-rich-frame").mode, "edit");
  assert.equal(ed.$("knowledge-base-editor-title").hidden, true);
  assert.equal(ed.$("knowledge-base-editor-preview").hidden, true);
});
check(
  "Native insertion uses host formatting instead of offering Markdown commands",
  () => {
    ed.$("knowledge-base-command-open").dispatchEvent(
      new ed.win.Event("command", { bubbles: true }),
    );
    const labels = [
      ...ed.$("knowledge-base-command-list").querySelectorAll("button"),
    ].map((button) => button.textContent);
    assert.ok(
      labels.some((label) => label.includes("editor-reference-insert")),
    );
    assert.ok(!labels.some((label) => label.includes("command-heading")));
  },
);
const recovery = await editor(
  { draftId: "old-draft" },
  {
    getEditorDraft: async () => ({
      draftId: "old-draft",
      draftRevision: 1,
      title: "Recovered title",
      body: "Recovered **body**",
      sourceMode: true,
    }),
  },
);
check(
  "A retained Markdown draft opens in a read-only recovery preview without a format selector",
  () => {
    assert.equal(recovery.initialMode, "visual");
    assert.equal(recovery.$("knowledge-base-editor-body").hidden, true);
    assert.equal(recovery.$("knowledge-base-editor-preview").hidden, false);
    assert.equal(
      recovery.$("knowledge-base-editor-preview").querySelector("strong")
        .textContent,
      "body",
    );
    assert.equal(recovery.$("knowledge-base-rich-frame").mode, "view");
    assert.equal(recovery.saved(), undefined);
  },
);
recovery
  .$("knowledge-base-editor-save")
  .dispatchEvent(new recovery.win.Event("command", { bubbles: true }));
await wait();
await wait();
check("Explicitly saving a recovery draft returns to native editing", () => {
  assert.equal(recovery.saved().sourceMode, true);
  assert.equal(recovery.$("knowledge-base-editor-preview").hidden, true);
  assert.equal(recovery.$("knowledge-base-rich-frame").hidden, false);
  assert.equal(recovery.$("knowledge-base-rich-frame").mode, "edit");
});
check("Native math projects to Markdown without losing LaTeX", () => {
  assert.equal(
    rich_text.richTextToMarkdown(
      '<p>A <span class="math">$x^2$</span>.</p><pre class="math">$$y^2$$</pre>',
    ),
    "A $x^2$.\n\n$$y^2$$",
  );
});
check(
  "Native structured citations, annotations and image keys stay intact in source",
  () => {
    for (const html of [
      '<span class="citation" data-citation="%7B%7D">Author 2026</span>',
      '<span data-annotation="%7B%7D">Highlight</span>',
      '<img data-attachment-key="IMG12345">',
    ]) {
      assert.ok(rich_text.richTextToMarkdown(html).includes(html));
    }
  },
);
globalThis.Zotero.getMainWindow = () => htmlWindow;
const nativeMath = await native_notes.nativeNoteHTML("Native title", equations);
check(
  "Native note creation uses host-compatible math and a real title heading",
  () => {
    assert.ok(
      nativeMath.startsWith(
        '<div data-schema-version="2"><h1>Native title</h1>',
      ),
    );
    assert.ok(nativeMath.includes('<span class="math">$E = mc^2$</span>'));
    assert.ok(nativeMath.includes('<pre class="math">'));
    const projected = native_notes.projectNativeNote(nativeMath);
    assert.equal(projected.title, "Native title");
    assert.ok(projected.body.includes(String.raw`\int_0^1 x^2\,dx`));
  },
);
check(
  "Native tables with paragraph-wrapped cells project to valid Markdown",
  () => {
    const projected = native_notes.projectNativeNote(
      '<div data-schema-version="9"><h1>Table</h1><table>\n<tbody>\n<tr>\n<th><p>Connection</p></th>\n<th><p>Purpose</p></th>\n</tr>\n<tr>\n<td><p>Parent</p></td>\n<td><p>Outline</p></td>\n</tr>\n</tbody>\n</table></div>',
    );
    assert.equal(
      projected.body,
      "| Connection | Purpose |\n| --- | --- |\n| Parent | Outline |",
    );
  },
);
const citationURI = "http://zotero.org/users/local/test/items/ABCD1234";
const metadata = [
  {
    uris: [citationURI],
    itemData: { title: "Structured citation", type: "book" },
  },
];
const locatedCitation = {
  citationItems: [{ uris: [citationURI], locator: "23", label: "page" }],
  properties: {},
};
const structuredHTML = `<div data-schema-version="9" data-citation-items="${encodeURIComponent(JSON.stringify(metadata))}"><h1>Metadata</h1><p><span class="citation" data-citation="${encodeURIComponent(JSON.stringify(locatedCitation))}">Author 2026, p. 23</span></p><p><img data-attachment-key="IMAG1234"></p></div>`;
const structuredProjection = native_notes.projectNativeNote(structuredHTML);
const structuredRoundTrip = await native_notes.nativeNoteHTML(
  structuredProjection.title,
  structuredProjection.body,
);
check(
  "Source edits preserve citation item data, locators and native image identity",
  () => {
    const doc = new JSDOM(structuredRoundTrip).window.document;
    const citation = JSON.parse(
      decodeURIComponent(
        doc.querySelector("[data-citation]").getAttribute("data-citation"),
      ),
    );
    assert.equal(citation.citationItems[0].locator, "23");
    assert.equal(
      citation.citationItems[0].itemData.title,
      "Structured citation",
    );
    assert.equal(
      doc.querySelector("img").getAttribute("data-attachment-key"),
      "IMAG1234",
    );
  },
);
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
await wait();
await wait();
check("Source insertion creates an actual Zotero Markdown link", () =>
  assert.match(
    ed.$("knowledge-base-editor-body").value,
    /^\[Atomic idea\]\(zotero:\/\/select\/library\/items\/ABCD1234\)/,
  ),
);
const referenceEditor = await editor(
  { prefillTitle: "References", sourceItem: { key: "ABCD1234", libraryID: 1 } },
  {
    searchItems: async () => [
      { ...sources[0], citationKey: "Author2026" },
      noteSummary,
    ],
  },
);
referenceEditor.win.__editorEval('toggleSourceDrop("reference")');
await referenceEditor.win.__editorEval("searchSources()");
referenceEditor.$("knowledge-base-src-results").firstElementChild.click();
await wait();
await wait();
check(
  "The reference picker inserts citation keys without changing the card's source",
  () => {
    assert.equal(
      referenceEditor.$("knowledge-base-editor-body").value,
      "[@Author2026]",
    );
    assert.equal(referenceEditor.win.__editorEval("source.key"), "ABCD1234");
  },
);
referenceEditor.win.__editorEval('toggleSourceDrop("reference")');
await referenceEditor.win.__editorEval("searchSources()");
referenceEditor.$("knowledge-base-src-results").lastElementChild.click();
await wait();
await wait();
check("Zotero note references use ordinary editable Markdown link text", () => {
  assert.ok(
    referenceEditor
      .$("knowledge-base-editor-body")
      .value.includes(
        "[Existing note](zotero://select/library/items/NOTE1234)",
      ),
  );
  assert.equal(referenceEditor.win.__editorEval("source.key"), "ABCD1234");
  const html = markdown.renderMarkdown(
    "[My note title](zotero://select/library/items/NOTE1234)",
    htmlWindow,
  );
  assert.equal(
    rich_text.richTextToMarkdown(html),
    "[My note title](zotero://select/library/items/NOTE1234)",
  );
});
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
      prepareMarkdown: async () => {},
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
      prepareMarkdown: async () => {},
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
