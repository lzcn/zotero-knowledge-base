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
  ["markdown", "zotero", "graph", "assets"]
    .map(
      (name) =>
        `export * as ${name} from ${JSON.stringify(path.join(ROOT, "src/modules", `${name}.ts`))};`,
    )
    .join("\n"),
);
const bundle = path.join(workspace, "bundle.mjs");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: bundle,
  logLevel: "warning",
});
const {
  markdown,
  zotero,
  graph: graphModule,
  assets,
} = await import(pathToFileURL(bundle).href);
const htmlWindow = new JSDOM("").window;
let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log(`PASS ${label}`);
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

const sample =
  "# Idea\n\n**Strong** and *emphasis* and ~~removed~~\n\n- [x] Task\n\n> Quote\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[[中文概念|别名]] [stable](knowledge-base://card/20261001000000)\n\n![image](knowledge-base-asset:abc.png)\n\n[source](zotero://select/library/items/ABCD1234)\n\n<script>bad()</script><img src=x onerror=bad()><a href=javascript:bad()>bad</a>";
const rendered = markdown.renderMarkdown(
  sample,
  htmlWindow,
  assets.resolveAssetURL,
);
const renderedDoc = new JSDOM(rendered).window.document;
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
    getDraftLinks: async (body) =>
      markdown.parseCardLinks(body).map((link) => ({
        ...link,
        targetId: link.ref === "missing" ? null : link.ref,
      })),
    getBacklinks: async () => [],
    onDataChange: () => () => {},
    searchItems: async () => sources,
    getSelectedSource: async () => sources[0],
    listZettels: async () => [{ id: "20261001000000", title: "Target card" }],
    saveZettel: async (input) => {
      saved = input;
      return "20261001000001";
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
  dom.window.eval(
    editorScript + "\nwindow.__editorEval = (source) => eval(source);",
  );
  await dom.window.__editorEval("load()");
  return {
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
ed.$("knowledge-base-editor-body").value = sample;
ed.win.__editorEval("updatePreview()");
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
ed.$("knowledge-base-src-insert").click();
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
check("Card picker inserts a stable standard Markdown link", () =>
  assert.equal(
    ed.$("knowledge-base-editor-body").value,
    "[Target card](knowledge-base://card/20261001000000)",
  ),
);
await ed.win.__editorEval("refreshRelations()");
check("Connected cards appear while editing unsaved Markdown", () =>
  assert.match(
    ed.$("knowledge-base-editor-outgoing").textContent,
    /Target card/,
  ),
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
ed.$("knowledge-base-image-insert").click();
await wait();
await wait();
check("Image file picker inserts a persistent Markdown image", () =>
  assert.equal(
    ed.$("knowledge-base-editor-body").value,
    "![Figure.png](knowledge-base-asset:image-test.png)",
  ),
);
ed.$("knowledge-base-editor-preview").querySelector("img").click();
check("Image preview opens the full image viewer", () =>
  assert.equal(
    ed.calls.images[0],
    "resource://knowledge-base-assets/image-test.png",
  ),
);
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

const graphData = {
  nodes: [
    { id: "A", title: "A", kind: "card", snippet: "" },
    { id: "B", title: "B", kind: "card", snippet: "" },
    { id: "C", title: "C", kind: "card", snippet: "" },
    { id: "I", title: "Isolated", kind: "card", snippet: "" },
    { id: "S", title: "Paper", kind: "source", snippet: "" },
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
graphDom.window.Zotero = {
  ZoteroKnowledgeBase: {
    api: {
      loc: (key) => key,
      getGraph: async () => graphData,
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
graphDom.window.eval(await readFile(graphBundle, "utf8"));
graphDom.window.dispatchEvent(new graphDom.window.Event("load"));
await wait();
await wait();
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
check("Selecting a node shows connected nodes in the graph inspector", () =>
  assert.equal(
    graphDom.window.document.querySelectorAll("#graph-connections li").length,
    2,
  ),
);
for (const [id, count] of [
  ["graph-local-one", 2],
  ["graph-local-two", 3],
  ["graph-all", 4],
]) {
  graphDom.window.document.getElementById(id).click();
  check(`Graph scope ${id} switches visible cards and pressed state`, () => {
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.card").length,
      count,
    );
    assert.equal(
      graphDom.window.document.getElementById(id).getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      graphDom.window.document.querySelectorAll(
        '#graph-scope [aria-pressed="true"]',
      ).length,
      1,
    );
  });
}
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
graphDom.window.document.getElementById("graph-refresh").click();
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
graphDom.window.document.getElementById("graph-refresh").click();
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
      graphDom.window.document.getElementById("graph-node-snippet").textContent,
      "Full idea context",
    );
  },
);
for (const win of windows) {
  win.dispatchEvent(new win.Event("unload"));
  win.close();
}
htmlWindow.close();
await rm(workspace, { recursive: true, force: true });
console.log(`OK - ${checks} Markdown, source, editing, image and graph checks`);
