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
    "preferences",
    "document-merge",
    "note-tags",
  ]
    .map(
      (name) =>
        `export * as ${name.replace(/-/g, "_")} from ${JSON.stringify(path.join(ROOT, "src/modules", `${name}.ts`))};`,
    )
    .join("\n") +
    `\nexport * as platform from ${JSON.stringify(path.join(ROOT, "src/ui/platform.ts"))};` +
    `\nexport * as graph_canvas from ${JSON.stringify(path.join(ROOT, "src/ui/graph-canvas.ts"))};` +
    `\nexport * as graph_layout from ${JSON.stringify(path.join(ROOT, "src/ui/graph-layout.ts"))};` +
    `\nexport * as native_reading_view from ${JSON.stringify(path.join(ROOT, "src/ui/native-reading-view.ts"))};` +
    `\nexport * as native_markdown_toolbar from ${JSON.stringify(path.join(ROOT, "src/ui/native-markdown-toolbar.ts"))};` +
    `\nimport { markdownLanguage } from ${JSON.stringify(path.join(ROOT, "node_modules/@codemirror/lang-markdown/dist/index.js"))};` +
    `\nimport { markdownMath } from ${JSON.stringify(path.join(ROOT, "src/ui/markdown-math.ts"))};` +
    `\nexport const parseMath = text => markdownLanguage.parser.configure([markdownMath]).parse(text).toString();`,
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
  native_markdown_toolbar,
  native_reading_view,
  preferences,
  graph_layout,
  graph_canvas,
  platform,
  document_merge,
  note_tags,
  parseMath,
} = await import(pathToFileURL(bundle).href);
let checks = 0;
function check(label, fn) {
  fn();
  checks++;
  console.log(`PASS ${label}`);
}
check(
  "macOS accelerators preserve Control editing and ignore input-method composition",
  () => {
    const event = { metaKey: false, ctrlKey: true, altKey: false };
    assert.equal(platform.isAccelKey(event, true), false);
    assert.equal(platform.isAccelKey(event, false), true);
    assert.equal(
      platform.isAccelKey({ ...event, ctrlKey: false, metaKey: true }, true),
      true,
    );
    assert.equal(
      platform.isAccelKey({ ...event, metaKey: true, isComposing: true }, true),
      false,
    );
    assert.equal(
      platform.isAccelKey({ ...event, metaKey: true, keyCode: 229 }, true),
      false,
    );
  },
);
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
const menuDOM = new JSDOM(
  '<div class="toolbar"><div class="start"></div><div class="end"><div class="dropdown"><button class="toolbar-button">…</button></div></div></div>',
);
const dropdown = menuDOM.window.document.querySelector(".dropdown");
let toggles = 0;
const removeMenu = native_markdown_toolbar.attachMarkdownToggle(
  menuDOM.window,
  "Markdown",
  () => toggles++,
);
dropdown.insertAdjacentHTML(
  "beforeend",
  '<div class="popup"><button class="option">Show in Library</button></div>',
);
await wait();
check("Markdown is directly available in the native toolbar", () => {
  const toggle = menuDOM.window.document.querySelector(
    ".toolbar .start > .knowledge-base-markdown-toggle",
  );
  assert.ok(toggle);
  assert.equal(dropdown.querySelectorAll("button.option").length, 1);
  assert.ok(toggle.querySelector("svg"));
  assert.equal(toggle.textContent, "");
  toggle.click();
  assert.equal(toggles, 1);
  removeMenu.setMode(true);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  removeMenu.setMode(false);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});
const toolbar = menuDOM.window.document.querySelector(".toolbar .start");
toolbar.replaceChildren();
await wait();
check("Rebuilt toolbars retain one Markdown switch", () => {
  assert.equal(
    toolbar.querySelectorAll(".knowledge-base-markdown-toggle").length,
    1,
  );
});
removeMenu();
toolbar.replaceChildren();
await wait();
check("Toolbar cleanup removes the switch and its observer", () => {
  assert.equal(toolbar.querySelector(".knowledge-base-markdown-toggle"), null);
});
menuDOM.window.close();
const readingDOM = new JSDOM(
  '<div id="editor-container"><div class="editor"><div class="toolbar"><div class="start"></div><div class="middle"><button>Format</button></div></div><div class="editor-core"><div class="primary-editor ProseMirror" contenteditable="true"><p id="paragraph">Native <strong>text</strong></p><span class="katex">Formula</span><img src="https://example.test/image.png" /></div></div></div></div>',
  { pretendToBeVisual: true },
);
const readingWin = readingDOM.window;
const nativeBody = readingWin.document.querySelector(".primary-editor");
const originalNativeDOM = nativeBody.outerHTML;
const originalToolbar = readingWin.document.querySelector(".toolbar");
let openedLink;
const reading = native_reading_view.attachReadingView(
  readingWin,
  "Reading view",
  () => {},
  (href) => (openedLink = href),
);
reading.show(true);
check(
  "Reading reuses native rendering without changing the toolbar or editable document",
  () => {
    const panel = readingWin.document.querySelector(
      ".knowledge-base-reading-view",
    );
    assert.equal(panel.hidden, false);
    assert.ok(panel.querySelector(".katex"));
    assert.ok(panel.querySelector("img"));
    assert.equal(panel.querySelector("[contenteditable], [id]"), null);
    assert.equal(nativeBody.outerHTML, originalNativeDOM);
    assert.equal(
      readingWin.document.querySelector(".toolbar"),
      originalToolbar,
    );
  },
);
reading.show(true, '<p>Draft <a href="knowledge-base://card/A">link</a></p>');
readingWin.document.querySelector(".knowledge-base-reading-view a").click();
check(
  "Reading a Markdown draft follows links without applying it to the native writer",
  () => {
    assert.equal(openedLink, "knowledge-base://card/A");
    assert.equal(nativeBody.outerHTML, originalNativeDOM);
  },
);
reading.show(true);
nativeBody.querySelector("p").textContent = "External native update";
await new Promise((resolve) => setTimeout(resolve, 40));
check(
  "Native reading follows live changes and disposes its observer and surface",
  () => {
    assert.ok(
      readingWin.document
        .querySelector(".knowledge-base-reading-view")
        .textContent.includes("External native update"),
    );
    reading.destroy();
    assert.equal(
      readingWin.document.querySelector(".knowledge-base-reading-view"),
      null,
    );
    assert.equal(
      readingWin.document.querySelector(".knowledge-base-reading-toggle"),
      null,
    );
    assert.equal(
      readingWin.document.body.classList.contains(
        "knowledge-base-reading-mode",
      ),
      false,
    );
  },
);
readingWin.close();
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
  "Display math interrupts prose before setext headings and closes before trailing text",
  () => {
    const body = String.raw`Before.
$$
W
=
\frac{a}{b}
$$
After.

$$x_t$$ trailing prose with $y$.

Real heading
===
`;
    const doc = new JSDOM(markdown.renderMarkdown(body, htmlWindow)).window
      .document;
    assert.deepEqual(
      [...doc.querySelectorAll('[data-type="block-math"]')].map((node) =>
        node.getAttribute("data-latex").trim(),
      ),
      [
        String.raw`W
=
\frac{a}{b}`,
        "x_t",
      ],
    );
    assert.equal(doc.querySelectorAll(".katex-error").length, 0);
    assert.deepEqual(
      [...doc.querySelectorAll("h1,h2")].map((node) => node.textContent),
      ["Real heading"],
    );
    assert.match(doc.body.textContent, /After/);
    assert.match(doc.body.textContent, /trailing prose with/);
    assert.equal(doc.querySelectorAll('[data-type="inline-math"]').length, 1);
    const source = rich_text.richTextToMarkdown(doc.body.innerHTML);
    assert.ok(
      source.includes(String.raw`W
=
\frac{a}{b}`),
    );
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
assert.equal(
  new JSDOM(
    markdown.renderMarkdown("#tag-a #tag with spaces", htmlWindow),
  ).window.document.body.textContent.trim(),
  "#tag-a #tag with spaces",
);

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
  "Managed wiki links render native URLs and round-trip stable IDs and aliases",
  () => {
    const target = {
      id: "stable-id",
      title: "Renamed note",
      reference: "@NewKey",
      href: "zotero://select/library/items/NOTE1234",
    };
    const html = markdown.renderMarkdown(
      "[[@OldKey]] [[stable-id|My label]] [OldKey](knowledge-base://card/%40OldKey)",
      htmlWindow,
      undefined,
      undefined,
      () => target,
    );
    const links = [...new JSDOM(html).window.document.querySelectorAll("a")];
    assert.deepEqual(
      links.map((link) => link.getAttribute("href")),
      Array(3).fill(target.href),
    );
    assert.deepEqual(
      links.map((link) => link.textContent),
      [target.title, "My label", target.title],
    );
    assert.equal(
      rich_text.richTextToMarkdown(html),
      "[[stable-id]] [[stable-id|My label]] [[stable-id]]",
    );
    assert.equal(
      rich_text.richTextToMarkdown(
        '<p><a href="zotero://select/library/items/NOTE1234" title="Ordinary tooltip">Ordinary link</a></p>',
      ),
      '[Ordinary link](zotero://select/library/items/NOTE1234 "Ordinary tooltip")',
    );
  },
);
check(
  "Literature links use author-year while citation-key titles and custom aliases remain distinct",
  () => {
    const target = {
      id: "literature-1-SOURCE01",
      title: "Smith2026",
      label: "Smith et al. 2026",
      sourceTitle: "A very long literature title",
      reference: "@Smith2026",
      href: "zotero://select/library/items/NOTE1234",
    };
    const html = markdown.renderMarkdown(
      "[[literature-1-SOURCE01]] [[@Smith2026|My reading]] [A very long literature title](knowledge-base://card/literature-1-SOURCE01)",
      htmlWindow,
      undefined,
      undefined,
      () => target,
    );
    const links = [...new JSDOM(html).window.document.querySelectorAll("a")];
    assert.deepEqual(
      links.map((link) => link.textContent),
      [target.label, "My reading", target.label],
    );
    assert.ok(links.every((link) => link.getAttribute("href") === target.href));
    assert.equal(
      rich_text.richTextToMarkdown(html),
      "[[literature-1-SOURCE01]] [[literature-1-SOURCE01|My reading]] [[literature-1-SOURCE01]]",
    );
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
  isInTrash: () => false,
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
  isInTrash: () => false,
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
  isInTrash: () => false,
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
const sourceBundle = path.join(workspace, "markdown-source.js");
await build({
  entryPoints: [path.join(ROOT, "src/ui/markdown-source.ts")],
  bundle: true,
  outfile: sourceBundle,
});
const sourceScript = await readFile(sourceBundle, "utf8");
const formattingScript = await readFile(formattingBundle, "utf8");
const editorScript = await readFile(
  path.join(ROOT, "addon/content/editor.js"),
  "utf8",
);
const previewScript = await readFile(
  path.join(ROOT, "addon/content/markdown.js"),
  "utf8",
);
const panelDOM = new JSDOM("<main><aside></aside><div></div></main>", {
  runScripts: "outside-only",
});
const panelWin = panelDOM.window;
panelWin.eval(previewScript);
const panelHandle = panelWin.document.querySelector("main > div");
const panelPane = panelWin.document.querySelector("aside");
const panelValues = new Map();
const panelErrors = [];
panelWin.addEventListener("error", (event) => {
  panelErrors.push(event.error);
  event.preventDefault();
});
const originalPrefs = globalThis.Zotero.Prefs;
globalThis.Zotero.Prefs = {
  get: (key) => panelValues.get(key),
  set: (key, value) => {
    if (!Number.isInteger(value)) throw new Error("Invalid integer preference");
    panelValues.set(key, value);
  },
};
const panelAPI = { ...preferences, loc: (key) => key };
panelHandle.parentElement.getBoundingClientRect = () => ({
  left: 100,
  right: 1100,
  width: 1000,
});
const dragPanel = (x, end = "pointerup") => {
  panelHandle.dispatchEvent(
    new panelWin.MouseEvent("pointerdown", { button: 0 }),
  );
  panelWin.dispatchEvent(
    new panelWin.MouseEvent("pointermove", { clientX: x }),
  );
  panelWin.dispatchEvent(new panelWin.Event(end));
};
check(
  "First panel drag saves a fractional width as an integer preference",
  () => {
    panelWin.KnowledgeBasePanels.attach(
      panelHandle,
      panelPane,
      "manager",
      panelAPI,
    );
    dragPanel(414.159);
    assert.deepEqual(panelErrors, []);
    assert.equal(preferences.getPanelWidth("manager"), 31);
    assert.equal(panelPane.style.flexBasis, "31%");
    assert.equal(
      panelWin.document.documentElement.classList.contains("resizing-panels"),
      false,
    );
  },
);
check("Panel drag clamps its size and window blur ends dragging", () => {
  dragPanel(0);
  assert.equal(preferences.getPanelWidth("manager"), 18);
  dragPanel(2000, "blur");
  assert.equal(preferences.getPanelWidth("manager"), 55);
  assert.equal(panelPane.style.flexBasis, "55%");
  panelWin.dispatchEvent(
    new panelWin.MouseEvent("pointermove", { clientX: 400 }),
  );
  assert.equal(panelPane.style.flexBasis, "55%");
  assert.equal(
    panelWin.document.documentElement.classList.contains("resizing-panels"),
    false,
  );
});
check("A failed width save still clears the panel dragging state", () => {
  panelAPI.setPanelWidth = () => {
    throw new Error("Preference save failed");
  };
  dragPanel(421.456, "pointercancel");
  assert.equal(panelErrors.length, 1);
  assert.match(panelErrors[0].message, /Preference save failed/);
  assert.equal(
    panelWin.document.documentElement.classList.contains("resizing-panels"),
    false,
  );
  panelWin.dispatchEvent(
    new panelWin.MouseEvent("pointermove", { clientX: 800 }),
  );
  assert.equal(panelPane.style.flexBasis, "32%");
});
panelWin.close();
if (originalPrefs === undefined) delete globalThis.Zotero.Prefs;
else globalThis.Zotero.Prefs = originalPrefs;
// Native tags and preference controls share the same effective-tag rules.
const tagPreferences = new Map();
const priorTagPrefs = globalThis.Zotero.Prefs;
const priorTagItems = globalThis.Zotero.Items;
const priorTagLogger = globalThis.Zotero.logError;
globalThis.Zotero.Prefs = {
  get: (key) => tagPreferences.get(key),
  set: (key, value) => tagPreferences.set(key, value),
};
globalThis.Zotero.logError = () => {};
const tagParent = {
  id: 71,
  parentItemID: false,
  isInTrash: () => false,
  getTags: () => [{ tag: "Machine learning" }, { tag: "中文 标签" }],
};
const tagNote = {
  id: 72,
  parentItemID: 71,
  isNote: () => true,
  isInTrash: () => false,
  getTags: () => [{ tag: "Own tag" }, { tag: "Machine learning" }],
};
globalThis.Zotero.Items = {
  getAsync: async (id) => (id === 72 ? tagNote : id === 71 ? tagParent : false),
  loadDataTypes: async () => {},
};
assert.deepEqual(await native_notes.getNoteTags(72), [
  "Own tag",
  "Machine learning",
  "中文 标签",
]);
assert.deepEqual(await native_notes.getNoteTags(999), []);
preferences.setTagInheritance(false);
assert.deepEqual(await native_notes.getNoteTags(72), [
  "Own tag",
  "Machine learning",
]);
preferences.setTagInheritance(true);
tagNote.parentItemID = 999;
assert.deepEqual(await native_notes.getNoteTags(72), [
  "Own tag",
  "Machine learning",
]);
tagNote.parentItemID = 71;
check("Parent tags inherit live without changing the note's own tags", () => {
  assert.equal(preferences.getTagInheritance(), true);
  assert.deepEqual(tagNote.getTags(), [
    { tag: "Own tag" },
    { tag: "Machine learning" },
  ]);
});
check(
  "Deep card hierarchies inherit tags without recursion or duplicated names",
  () => {
    const tags = new Map(
      Array.from({ length: 10000 }, (_, i) => [
        String(i),
        i === 0 ? ["Parent tag"] : ["Own tag"],
      ]),
    );
    const parents = new Map(
      Array.from(tags.keys(), (id) => [
        id,
        id === "0" ? null : String(Number(id) - 1),
      ]),
    );
    const effective = note_tags.inheritCardTags(tags, parents);
    assert.deepEqual(effective.get("9999"), ["Own tag", "Parent tag"]);
    assert.deepEqual(tags.get("9999"), ["Own tag"]);
    assert.equal(
      note_tags.inheritCardTags(
        new Map([
          ["a", ["A"]],
          ["b", ["B"]],
        ]),
        new Map([
          ["a", "b"],
          ["b", "a"],
        ]),
      ).size,
      2,
    );
  },
);
preferences.setGraphGroups([
  { tag: "Machine learning", color: "#AA22CC" },
  { tag: "中文 标签", color: "#2288aa" },
]);
check(
  "Graph groups preserve order and exact multiword tags, rejecting invalid colors",
  () => {
    assert.deepEqual(preferences.getGraphGroups(), [
      { tag: "Machine learning", color: "#aa22cc" },
      { tag: "中文 标签", color: "#2288aa" },
    ]);
    assert.throws(() =>
      preferences.setGraphGroups([{ tag: "Bad", color: "red" }]),
    );
    assert.equal(preferences.getGraphGroups().length, 2);
  },
);
const prefsDOM = new JSDOM(
  await readFile(path.join(ROOT, "addon/content/preferences.xhtml"), "utf8"),
  { contentType: "application/xhtml+xml", runScripts: "outside-only" },
);
const prefsWin = prefsDOM.window;
prefsWin.document.createXULElement = (tag) =>
  prefsWin.document.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    tag,
  );
prefsWin.MozXULElement = { insertFTLIfNeeded() {} };
prefsWin.Zotero = {
  logError: (error) => {
    throw error;
  },
  ZoteroKnowledgeBase: {
    api: {
      ...preferences,
      getGraphTags: async () => ["Machine learning", "中文 标签"],
      getSourceStyles: async () => [{ id: "apa", title: "APA" }],
      getSourceStyle: () => "apa",
      setSourceStyle() {},
      loc: (key) => key,
    },
  },
};
prefsWin.eval(
  await readFile(path.join(ROOT, "addon/content/preferences.js"), "utf8"),
);
await Promise.all([
  prefsWin.KnowledgeBasePreferences.start(prefsWin.document),
  prefsWin.KnowledgeBasePreferences.start(prefsWin.document),
]);
const prefsCommand = (control) =>
  control.dispatchEvent(new prefsWin.Event("command", { bubbles: true }));
const groupRows = () => [
  ...prefsWin.document.querySelectorAll(".graph-group-row"),
];
prefsCommand(groupRows()[1].querySelector(".graph-group-up"));
assert.equal(preferences.getGraphGroups()[0].tag, "中文 标签");
prefsCommand(groupRows()[0].querySelector(".graph-group-remove"));
prefsCommand(prefsWin.document.getElementById("knowledge-base-add-group"));
await wait();
const newRow = groupRows()[1];
const groupTag = newRow.querySelector(".graph-group-tag");
groupTag.value = "中文 标签";
prefsCommand(groupTag);
const groupColor = newRow.querySelector(".graph-group-color");
groupColor.value = "#117744";
groupColor.dispatchEvent(new prefsWin.Event("change"));
const titleLengthControl = prefsWin.document.getElementById(
  "knowledge-base-graph-label-length",
);
assert.equal(titleLengthControl.value, "20");
titleLengthControl.value = "12";
titleLengthControl.dispatchEvent(new prefsWin.Event("change"));
assert.equal(preferences.getGraphLabelLength(), 12);
const depthControl = prefsWin.document.getElementById(
  "knowledge-base-graph-local-depth",
);
assert.equal(depthControl.value, "1");
depthControl.value = "2";
depthControl.dispatchEvent(new prefsWin.Event("change"));
assert.equal(preferences.getGraphLocalDepth(), 2);
assert.throws(() => preferences.setGraphLocalDepth(0));
assert.throws(() => preferences.setGraphLocalDepth(1.5));
preferences.setGraphLocalDepth(1);
for (const invalid of ["0", "81", "12.5", ""]) {
  titleLengthControl.value = invalid;
  titleLengthControl.dispatchEvent(new prefsWin.Event("change"));
  assert.equal(titleLengthControl.value, "12");
}
assert.throws(() => preferences.setGraphLabelLength(0));
preferences.setGraphLabelLength(20);
const inheritControl = prefsWin.document.getElementById(
  "knowledge-base-inherit-tags",
);
inheritControl.checked = false;
prefsCommand(inheritControl);
check(
  "Native Settings add, reorder, remove and autosave graph groups without duplicate handlers",
  () => {
    assert.equal(groupRows().length, 2);
    assert.deepEqual(preferences.getGraphGroups(), [
      { tag: "Machine learning", color: "#aa22cc" },
      { tag: "中文 标签", color: "#117744" },
    ]);
    assert.equal(preferences.getTagInheritance(), false);
    assert.equal(
      prefsWin.document.getElementById("knowledge-base-preferences-error")
        .hidden,
      true,
    );
  },
);
prefsWin.close();
globalThis.Zotero.Items = priorTagItems;
globalThis.Zotero.logError = priorTagLogger;
if (priorTagPrefs === undefined) delete globalThis.Zotero.Prefs;
else globalThis.Zotero.Prefs = priorTagPrefs;
const editorXML = await readFile(
  path.join(ROOT, "addon/content/editor.xhtml"),
  "utf8",
);
const windows = [];
async function editor(args = {}, overrides = {}) {
  const dom = new JSDOM(editorXML, {
    contentType: "application/xhtml+xml",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  Object.defineProperty(dom.window.document.documentElement, "style", {
    value: dom.window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ).style,
  });
  dom.window.document.createElement = (tag) =>
    dom.window.document.createElementNS("http://www.w3.org/1999/xhtml", tag);
  dom.window.document.execCommand = () => false;
  // JSDOM has no layout engine for chrome XML and ShadowRoot ancestry.
  dom.window.getComputedStyle = () => {
    const style = dom.window.document.createElement("div").style;
    style.cssText =
      "font-size:14px; line-height:25px; white-space:pre-wrap; direction:ltr; padding:0; position:relative;";
    return style;
  };
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
  windows.push(dom.window);
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  let saved;
  let nativeHTML = "";
  const calls = { open: [], images: [], graphs: [] };
  const api = {
    getPanelWidth: () => 28,
    setPanelWidth: () => {},
    getNoteTags: async () => [],
    getNoteHealth: async () => ({
      note: "available",
      source: "none",
      editable: true,
    }),
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
    getMarkdownSource: (html) => api.projectNativeNote(html),
    getMarkdownDocument: (html) => {
      const content = api.projectNativeNote(html);
      const doc = new htmlWindow.DOMParser().parseFromString(html, "text/html");
      return doc.querySelector("h1")
        ? `# ${content.title}\n\n${content.body}`
        : content.body;
    },
    markdownNoteHTML: async (title, body) => api.nativeNoteHTML(title, body),
    acquireNativeNote: async (input) => {
      nativeHTML = await api.nativeNoteHTML(input.title, input.body);
      return { noteID: 1, html: nativeHTML };
    },
    releaseNativeNote: async () => {},
    loc: (key) => key,
    renderMarkdown: (body) =>
      markdown.renderMarkdown(body, htmlWindow, assets.resolveAssetURL),
    richTextToMarkdown: (html) => rich_text.richTextToMarkdown(html),
    getZettel: async () => null,
    copyNoteReference: (reference) => calls.open.push(`[[${reference}]]`),
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
    onNativeNoteChange: () => () => {},
    onSourceStyleChange: () => () => {},
    getSourceBibliography: async () =>
      '<div class="csl-entry">Author (2026). <i>Linked Zotero item</i>. Journal.</div>',
    searchItems: async () => sources,
    getSelectedSource: async () => sources[0],
    listZettels: async () => [{ id: "20261001000000", title: "Target card" }],
    discardEditorDraft: async () => {},
    saveEditorDraft: async () => {},
    getEditorDraft: async () => null,
    mergeMarkdownDocuments: document_merge.mergeMarkdownDocuments,
    isAccelKey: (event) => platform.isAccelKey(event, true),
    saveEditorCard: async (input) => {
      saved = input;
      nativeHTML = await api.nativeNoteHTML(input.title, input.body);
      return { id: "20261001000001", updatedAt: 1, html: nativeHTML };
    },
    openEditor: (options) => calls.open.push(options),
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
  // JSDOM cannot load chrome URLs; supply the HTML frame used by the real host.
  dom.window.KnowledgeBaseMarkdownSource = {
    async create(textarea, labels) {
      const root = dom.window.document.createElement("div");
      root.id = textarea.id;
      root.hidden = textarea.hidden;
      textarea.replaceWith(root);
      const frame = dom.window.document.createElement("iframe");
      root.append(frame);
      frame.contentWindow.focus = () => {};
      frame.contentWindow.Range.prototype.getClientRects = () => [];
      frame.contentWindow.Range.prototype.getBoundingClientRect = () =>
        new frame.contentWindow.DOMRect();
      frame.contentWindow.eval(sourceScript);
      return frame.contentWindow.KnowledgeBaseMarkdownSource.mount(
        root,
        textarea,
        labels,
      );
    },
  };
  dom.window.KnowledgeBaseNativeEditor = {
    create: async (options) => {
      dom.window.__nativeEditorOptions = options;
      let html = nativeHTML;
      return {
        getHTML: () => html,
        getSavedHTML: () => html,
        flush: async () => {},
        reload: async () => {
          html = nativeHTML;
        },
        setSourceMode: (value) => {
          options.element.setAttribute("data-source-mode", String(value));
        },
        getTypography: () => ({
          "font-family": "sans-serif",
          "font-size": "14px",
          "line-height": "25px",
        }),
        setReadingMode: (value, html) => {
          options.element.setAttribute("data-reading-mode", String(value));
          dom.window.__readingHTML = html;
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
  const initialSourceAllocated = !!dom.window.document
    .getElementById("knowledge-base-editor-body")
    .querySelector("iframe");
  const initialMode = dom.window.document.getElementById(
    "knowledge-base-editor-root",
  ).dataset.mode;
  if (!args.draftId)
    await dom.window.__editorEval('setEditorMode("source", false)');
  return {
    initialMode,
    initialSourceAllocated,
    win: dom.window,
    $: (id) => dom.window.document.getElementById(id),
    calls,
    saved: () => saved,
  };
}
check(
  "LaTeX blocks protect equals signs and underscores from heading styling",
  () => {
    const tree = parseMath(
      "# Title\n\n$$T_{i,k}\n=\n\\sum_{u=1}^{a_{i,k}} X_{i,k}^{(u)}$$\n\nHeading\n=\n\nInline $a_i * b_i$.",
    );
    assert.match(tree, /BlockMath/);
    assert.match(tree, /InlineMath/);
    assert.equal((tree.match(/SetextHeading1/g) || []).length, 1);
    assert.equal((tree.match(/ATXHeading1/g) || []).length, 1);
    assert.doesNotMatch(tree, /Emphasis/);
  },
);
check(
  "Math syntax leaves code, escaped dollars and currency as ordinary Markdown",
  () => {
    const tree = parseMath(
      "`$x$`\n\n```tex\n$$x\n=\n$$\n```\n\n\\$literal\\$ and $5 to $10.",
    );
    assert.doesNotMatch(tree, /(?:Block|Inline)Math/);
    assert.match(tree, /FencedCode/);
    assert.match(tree, /InlineCode/);
    assert.match(parseMath("$$x\n=\nUnfinished"), /BlockMath/);
  },
);
const cursorFixture = await editor({ prefillTitle: "Cursor" });
const cursorBody = cursorFixture.$("knowledge-base-editor-body");
check(
  "Programmatic source updates map the cursor without rewriting unchanged text",
  () => {
    cursorBody.value = "First paragraph\n\nSecond paragraph\n\nThird paragraph";
    const position = cursorBody.value.indexOf("Second") + 3;
    cursorBody.setSelectionRange(position, position + 4);
    cursorBody.value += " suffix";
    assert.equal(cursorBody.selectionStart, position);
    assert.equal(cursorBody.selectionEnd, position + 4);
    cursorBody.value = "Prefix " + cursorBody.value;
    assert.equal(cursorBody.selectionStart, position + 7);
    assert.equal(cursorBody.selectionEnd, position + 11);
    const identical = cursorBody.value;
    cursorBody.value = identical;
    assert.equal(cursorBody.selectionStart, position + 7);
    assert.equal(cursorBody.selectionEnd, position + 11);
  },
);
cursorFixture.win.close();
const ed = await editor({ prefillTitle: "New concept" });
check("Connection categories stay visible for a note with no links", () => {
  assert.equal(ed.$("knowledge-base-editor-relations").hidden, false);
  assert.equal(
    ed.$("knowledge-base-editor-relations").querySelector("details"),
    null,
  );
  const buttons = [
    ...ed.$("knowledge-base-editor-relations").querySelectorAll("nav button"),
  ];
  assert.equal(buttons.length, 3);
  assert.ok(
    buttons.every(
      (button) => button.disabled && button.textContent.endsWith("0"),
    ),
  );
});
const relationEditor = await editor(
  { zettelId: "RELATION" },
  {
    getZettel: async (id) => ({
      id,
      title: id === "TARGET" ? "Linked idea" : "Relationship fixture",
      body: "",
      kind: "zettel",
      updated_at: "2026-10-05",
    }),
    getFamily: async () => ({
      parent: null,
      children: [{ id: "CHILD", title: "Child idea" }],
    }),
    getBacklinks: async () => [
      { sourceId: "INCOMING", sourceTitle: "Incoming idea", ref: "RELATION" },
    ],
    getDraftLinks: async () => [
      { targetId: "TARGET", display: "Linked idea", ref: "TARGET" },
    ],
  },
);
check(
  "One full-width connection list opens at a time and its entries navigate",
  () => {
    const children = relationEditor.$("knowledge-base-editor-children-label");
    const backlinks = relationEditor.$("knowledge-base-editor-backlinks-label");
    assert.equal(children.disabled, false);
    assert.ok(children.textContent.endsWith("1"));
    children.click();
    assert.equal(children.getAttribute("aria-expanded"), "true");
    assert.equal(
      relationEditor.$("knowledge-base-editor-family").hidden,
      false,
    );
    backlinks.click();
    assert.equal(relationEditor.$("knowledge-base-editor-family").hidden, true);
    assert.equal(
      relationEditor.$("knowledge-base-editor-backlinks").hidden,
      false,
    );
    relationEditor
      .$("knowledge-base-editor-backlinks")
      .querySelector("button")
      .click();
    assert.equal(relationEditor.calls.open.at(-1).zettelId, "INCOMING");
    backlinks.click();
    assert.equal(backlinks.getAttribute("aria-expanded"), "false");
    assert.equal(
      relationEditor.$("knowledge-base-editor-backlinks").hidden,
      true,
    );
  },
);
check(
  "More uses one consistent button style and closes after an action",
  () => {
    const more = relationEditor.win.document.getElementById(
      "knowledge-base-editor-more",
    );
    more.open = true;
    const graphButton = relationEditor.$("knowledge-base-editor-graph");
    assert.equal(graphButton.namespaceURI, "http://www.w3.org/1999/xhtml");
    graphButton.click();
    assert.equal(more.open, false);
    assert.equal(relationEditor.calls.graphs.at(-1).centerId, "RELATION");
  },
);
check(
  "Native tags render as complete names, including spaces, without added hashes",
  () => {
    const container = ed.win.document.getElementById(
      "knowledge-base-note-tags",
    );
    ed.win.ZoteroKnowledgeBaseMarkdown.tags(container, [
      "Machine learning",
      "中文 标签",
      "#Existing tag",
    ]);
    assert.equal(container.hidden, false);
    assert.deepEqual(
      [...container.children].map((label) => label.textContent),
      ["Machine learning", "中文 标签", "#Existing tag"],
    );
    ed.win.ZoteroKnowledgeBaseMarkdown.tags(container, []);
    assert.equal(container.hidden, true);
    assert.equal(container.children.length, 0);
  },
);

check("Editor prefills concept titles in its real XML document", () =>
  assert.equal(ed.win.__editorEval("noteTitle"), "New concept"),
);
let unavailableAcquisitions = 0;
const unavailableEditor = await editor(
  { zettelId: "missing-original" },
  {
    getZettel: async () => ({
      id: "missing-original",
      title: "Retained note",
      body: "Retained **content**",
      updated_at: 7,
    }),
    getNoteTags: async () => [],
    getNoteHealth: async () => ({
      note: "missing",
      source: "none",
      editable: true,
    }),
    acquireNativeNote: async () => {
      unavailableAcquisitions++;
      throw new Error("Must not create a replacement");
    },
  },
);
check(
  "An unavailable original cannot create a replacement or offer cached-copy recovery",
  () => {
    assert.equal(unavailableAcquisitions, 0);
    assert.equal(
      unavailableEditor.$("knowledge-base-editor-preview").hidden,
      false,
    );
    assert.ok(
      unavailableEditor
        .$("knowledge-base-editor-preview")
        .textContent.includes("Retained content"),
    );
    assert.equal(
      unavailableEditor.$("knowledge-base-editor-save").disabled,
      true,
    );
    assert.equal(
      unavailableEditor.$("knowledge-base-editor-save-copy").hidden,
      true,
    );
    assert.equal(
      unavailableEditor.$("knowledge-base-editor-body").hidden,
      true,
    );
    assert.equal(unavailableEditor.win.__editorEval("dirty"), false);
  },
);
const unavailableNavigation =
  await unavailableEditor.win.knowledgeBasePrepareNavigation();
check(
  "A clean cached note can leave the workbench without attempting an unavailable save",
  () => {
    assert.equal(unavailableNavigation, true);
  },
);
let restorationHealth = "trashed";
let restorationChanged;
let restoredNativeAcquisitions = 0;
const restoredEditor = await editor(
  { zettelId: "RESTORED_NOTE" },
  {
    getZettel: async () => ({
      id: "RESTORED_NOTE",
      title: "Original note",
      body: "Native content",
      updated_at: 3,
    }),
    getNoteHealth: async () => ({
      note: restorationHealth,
      source: "none",
      editable: true,
    }),
    onDataChange: (listener) => {
      restorationChanged = listener;
      return () => {};
    },
    acquireNativeNote: async (input) => {
      restoredNativeAcquisitions++;
      return {
        noteID: 42,
        html: await restoredEditor.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
          input.title,
          input.body,
        ),
      };
    },
  },
);
check(
  "A note in Trash keeps its card and cannot create a Markdown-based replacement",
  () => {
    assert.equal(restoredNativeAcquisitions, 0);
    assert.equal(
      restoredEditor.$("knowledge-base-editor-save-copy").hidden,
      true,
    );
  },
);
restorationHealth = "available";
restorationChanged({
  all: false,
  cardIDs: ["RESTORED_NOTE"],
  noteIDs: [],
  itemKeys: [],
  fields: ["availability"],
});
await wait();
await wait();
check(
  "Restoring in Zotero reconnects an already open card without a manual editor toggle",
  () => {
    assert.equal(restoredNativeAcquisitions, 1);
    assert.equal(restoredEditor.win.__editorEval("nativeNoteID"), 42);
    assert.equal(restoredEditor.win.knowledgeBaseCardId, "RESTORED_NOTE");
    assert.equal(restoredEditor.$("knowledge-base-rich-frame").hidden, false);
    assert.equal(
      restoredEditor.$("knowledge-base-editor-preview").hidden,
      true,
    );
    assert.equal(
      restoredEditor.$("knowledge-base-editor-save").disabled,
      false,
    );
    assert.equal(restoredEditor.saved(), undefined);
  },
);
restoredEditor.win.close();
for (const pendingEdit of [false, true]) {
  let health = "available";
  let discarded = 0;
  const fixture = await editor(
    { zettelId: "AUTOSAVED_NOTE" },
    {
      getZettel: async () => ({
        id: "AUTOSAVED_NOTE",
        title: "Original note",
        body: "Native content",
        kind: "zettel",
        updated_at: 3,
      }),
      getNoteHealth: async () => ({
        note: health,
        source: "none",
        editable: true,
      }),
      discardEditorDraft: async () => discarded++,
    },
  );
  if (pendingEdit) {
    const body = fixture.$("knowledge-base-editor-body");
    body.value += "\n\nUnsaved **Markdown**.";
    body.dispatchEvent(new fixture.win.Event("input"));
  } else {
    await fixture.win.__editorEval('setEditorMode("visual", false)');
    fixture.win.__nativeEditorOptions.onChange(
      await fixture.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
        "Original note",
        "Native content",
      ),
    );
  }
  const beforeTrash = fixture.win.__editorEval("snapshot()");
  const nativeAPI = fixture.win.Zotero.ZoteroKnowledgeBase.api;
  const acquireOriginal = nativeAPI.acquireNativeNote;
  nativeAPI.acquireNativeNote = () =>
    acquireOriginal({ title: "Original note", body: "Native content" });
  health = "trashed";
  await fixture.win.__editorEval("refreshHealth()");
  health = "available";
  await fixture.win.__editorEval("refreshHealth()");
  check(
    pendingEdit
      ? "Trash restoration retains genuinely unsaved Markdown separately from the original"
      : "Trash restoration clears an index-only draft already saved by the native editor",
    () => {
      assert.equal(fixture.win.__editorEval("dirty"), pendingEdit);
      assert.equal(fixture.win.__editorEval("recoveryPending"), pendingEdit);
      assert.equal(fixture.$("knowledge-base-rich-frame").hidden, pendingEdit);
      assert.equal(discarded, pendingEdit ? 0 : 1);
      if (pendingEdit) {
        const afterRestore = fixture.win.__editorEval("snapshot()");
        assert.equal(afterRestore.sourceDocument, beforeTrash.sourceDocument);
        assert.equal(afterRestore.body, beforeTrash.body);
      }
      assert.equal(fixture.saved(), undefined);
    },
  );
  fixture.win.close();
}
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
      "# Unsaved idea\n\nKeep this text",
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
    "# Unsaved\n\nPreserve on failure",
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
let unchangedWrites = 0;
const unchanged = await editor(
  { zettelId: "UNCHANGED" },
  {
    getZettel: async () => ({
      id: "UNCHANGED",
      kind: "zettel",
      title: "Untouched",
      body: "Original content",
      updated_at: 1,
    }),
    saveEditorCard: async () => {
      unchangedWrites++;
    },
    saveEditorDraft: async () => {
      unchangedWrites++;
    },
  },
);
await unchanged.win.__editorEval('setEditorMode("visual", false)');
unchanged.win.__editorEval(
  "richEditor.flush = async () => { throw new Error('Unexpected native write'); }",
);
const unchangedSaved = await unchanged.win.__editorEval("save(false)");
check(
  "Switching an unchanged saved note performs no native, draft or index writes",
  () => {
    assert.equal(unchangedSaved, true);
    assert.equal(unchangedWrites, 0);
  },
);
unchanged.win.close();
let acknowledgedCard = {
  id: "ACKNOWLEDGED",
  kind: "zettel",
  title: "Original",
  body: "Original body",
  updated_at: 1,
};
const acknowledgedDrafts = [];
const acknowledged = await editor(
  { zettelId: acknowledgedCard.id },
  {
    getZettel: async () => acknowledgedCard,
    getItemSummary: async (key, libraryID) => ({
      key,
      libraryID,
      title: "Local source",
    }),
    discardEditorDraft: async (...values) => acknowledgedDrafts.push(values),
  },
);
await acknowledged.win.__editorEval('setEditorMode("visual", false)');
acknowledgedCard = {
  ...acknowledgedCard,
  title: "External heading",
  body: "Saved elsewhere",
  updated_at: 2,
};
acknowledged.win.__acknowledgedHTML =
  await acknowledged.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
    acknowledgedCard.title,
    acknowledgedCard.body,
  );
acknowledged.win.__editorEval(
  "richEditor.getHTML = () => window.__acknowledgedHTML",
);
acknowledged.win.__nativeEditorOptions.onChange(
  acknowledged.win.__acknowledgedHTML,
);
acknowledged.win.__nativeEditorOptions.onExternalHTML(
  acknowledged.win.__acknowledgedHTML,
);
await wait();
check(
  "A native refresh matching saved content and metadata clears its redundant draft without another save",
  () => {
    assert.equal(acknowledged.win.__editorEval("dirty"), false);
    assert.equal(acknowledged.win.__editorEval("expectedUpdatedAt"), 2);
    assert.equal(acknowledgedDrafts.at(-1)[1], 1);
  },
);
acknowledged.win.__editorEval(
  'setSource({key:"LOCAL001",libraryID:1,title:"Local source"},true)',
);
acknowledged.win.__nativeEditorOptions.onChange(
  acknowledged.win.__acknowledgedHTML,
);
await wait();
check("Native refresh acknowledgement retains pending source changes", () => {
  assert.equal(acknowledged.win.__editorEval("dirty"), true);
  assert.equal(acknowledged.win.__editorEval("source.key"), "LOCAL001");
  assert.equal(acknowledgedDrafts.length, 1);
});
acknowledged.win.close();
const synchronized = await editor(
  { zettelId: "SYNC_NOTE" },
  {
    getZettel: async () => ({
      id: "SYNC_NOTE",
      kind: "zettel",
      title: "Original",
      body: "Original body",
      updated_at: 1,
    }),
  },
);
const latestHTML =
  await synchronized.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
    "External heading",
    "Changed in the other window",
  );
synchronized.win.__nativeEditorOptions.onExternalHTML(latestHTML);
check(
  "An idle Knowledge Base Markdown editor follows the same native note session",
  () => {
    assert.match(
      synchronized.$("knowledge-base-editor-body").value,
      /Changed in the other window/,
    );
    assert.equal(synchronized.win.__editorEval("dirty"), false);
    assert.equal(synchronized.win.__editorEval("expectedNoteHTML"), latestHTML);
  },
);
const preservedSource = synchronized
  .$("knowledge-base-editor-body")
  .value.replace("# External heading", "External heading\n===============")
  .replace("Changed in the other window", "Changed in the other window  \n");
synchronized.$("knowledge-base-editor-body").value = preservedSource;
const normalizedHTML = latestHTML.replace(
  'data-schema-version="9"',
  'data-schema-version="10"',
);
synchronized.win.__nativeEditorOptions.onExternalHTML(normalizedHTML);
check(
  "Equivalent native HTML normalization preserves author Markdown layout",
  () => {
    assert.equal(
      synchronized.$("knowledge-base-editor-body").value,
      preservedSource,
    );
    assert.equal(
      synchronized.win.__editorEval("expectedNoteHTML"),
      normalizedHTML,
    );
  },
);
synchronized.$("knowledge-base-editor-body").value = synchronized
  .$("knowledge-base-editor-body")
  .value.replace("Changed in the other window", "Local draft");
synchronized.win.__editorEval("setDirty()");
const conflictingHTML =
  await synchronized.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
    "External heading",
    "A second external edit",
  );
synchronized.win.__nativeEditorOptions.onExternalHTML(conflictingHTML);
await wait();
check(
  "Shared note updates preserve a divergent local draft and expose conflict recovery",
  () => {
    assert.match(
      synchronized.$("knowledge-base-editor-body").value,
      /Local draft/,
    );
    assert.equal(
      synchronized.$("knowledge-base-editor-status").textContent,
      "editor-save-conflict",
    );
    assert.equal(
      synchronized.$("knowledge-base-editor-save-copy").hidden,
      false,
    );
    assert.equal(
      synchronized.win.__editorEval("expectedNoteHTML"),
      normalizedHTML,
    );
  },
);
synchronized.win.close();
const mergedEditor = await editor(
  { zettelId: "MERGE_NOTE" },
  {
    getZettel: async () => ({
      id: "MERGE_NOTE",
      kind: "zettel",
      title: "Merge",
      body: "First paragraph\n\nSecond paragraph",
      updated_at: 1,
    }),
  },
);
mergedEditor.$("knowledge-base-editor-body").value = mergedEditor
  .$("knowledge-base-editor-body")
  .value.replace("First paragraph", "Local first paragraph");
mergedEditor.win.__editorEval("setDirty()");
const mergedHTML =
  await mergedEditor.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
    "Merge",
    "First paragraph\n\nRemote second paragraph",
  );
mergedEditor.win.__nativeEditorOptions.onExternalHTML(mergedHTML);
check(
  "Independent Markdown edits merge and retain the native version as the save baseline",
  () => {
    assert.match(
      mergedEditor.$("knowledge-base-editor-body").value,
      /Local first paragraph/,
    );
    assert.match(
      mergedEditor.$("knowledge-base-editor-body").value,
      /Remote second paragraph/,
    );
    assert.equal(mergedEditor.win.__editorEval("expectedNoteHTML"), mergedHTML);
    assert.equal(mergedEditor.win.__editorEval("dirty"), true);
  },
);
mergedEditor.win.close();
let releaseDeferredSave;
let savingInput;
const deferredEditor = await editor(
  { zettelId: "DEFERRED_NOTE" },
  {
    getZettel: async () => ({
      id: "DEFERRED_NOTE",
      kind: "zettel",
      title: "Deferred",
      body: "First paragraph\n\nSecond paragraph",
      updated_at: 1,
    }),
    saveEditorCard: async (input) => {
      savingInput = input;
      await new Promise((resolve) => {
        releaseDeferredSave = resolve;
      });
      return {
        id: "DEFERRED_NOTE",
        updatedAt: 2,
        html: await deferredEditor.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
          input.title,
          input.body,
        ),
      };
    },
  },
);
deferredEditor.$("knowledge-base-editor-body").value = deferredEditor
  .$("knowledge-base-editor-body")
  .value.replace("First paragraph", "Saved first paragraph");
deferredEditor.win.__editorEval("setDirty()");
const deferredSave = deferredEditor.win.__editorEval("save(false)");
for (let n = 0; n < 20 && !releaseDeferredSave; n++) await wait();
assert.ok(releaseDeferredSave);
// The native write has committed, while KB metadata completion is still pending.
const interveningHTML =
  await deferredEditor.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
    savingInput.title,
    savingInput.body.replace("Second paragraph", "External second paragraph"),
  );
deferredEditor.win.__nativeEditorOptions.onExternalHTML(interveningHTML);
releaseDeferredSave();
assert.equal(await deferredSave, true);
check(
  "An external update during save is applied after the committed baseline without losing either edit",
  () => {
    assert.match(
      deferredEditor.$("knowledge-base-editor-body").value,
      /Saved first paragraph/,
    );
    assert.match(
      deferredEditor.$("knowledge-base-editor-body").value,
      /External second paragraph/,
    );
    assert.equal(
      deferredEditor.win.__editorEval("expectedNoteHTML"),
      interveningHTML,
    );
    assert.equal(deferredEditor.win.__editorEval("dirty"), false);
  },
);
deferredEditor.win.close();
let compositionSaves = 0;
const compositionEditor = await editor(
  { zettelId: "IME_NOTE" },
  {
    getZettel: async () => ({
      id: "IME_NOTE",
      kind: "zettel",
      title: "Input",
      body: "Initial paragraph",
      updated_at: 1,
    }),
    saveEditorCard: async (input) => {
      compositionSaves++;
      return {
        id: "IME_NOTE",
        updatedAt: 2,
        html: await compositionEditor.win.Zotero.ZoteroKnowledgeBase.api.nativeNoteHTML(
          input.title,
          input.body,
        ),
      };
    },
  },
);
const compositionBody = compositionEditor.$("knowledge-base-editor-body");
const compositionFrame = compositionBody.querySelector("iframe").contentWindow;
const compositionDOM = compositionFrame.document.querySelector(".cm-editor");
compositionDOM.dispatchEvent(
  new compositionFrame.CompositionEvent("compositionstart", { bubbles: true }),
);
compositionBody.value += "\n\n输入中的文字";
compositionBody.dispatchEvent(
  new compositionEditor.win.Event("input", { bubbles: true }),
);
compositionEditor.win.dispatchEvent(
  new compositionEditor.win.KeyboardEvent("keydown", {
    key: "w",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }),
);
compositionEditor.win.dispatchEvent(
  new compositionEditor.win.KeyboardEvent("keydown", {
    key: "s",
    metaKey: true,
    isComposing: true,
    bubbles: true,
    cancelable: true,
  }),
);
await new Promise((resolve) => setTimeout(resolve, 620));
check(
  "Chinese composition blocks document autosave and Control-W never closes the editor",
  () => {
    assert.equal(compositionSaves, 0);
    assert.equal(compositionBody.isComposing, true);
    assert.match(compositionBody.value, /输入中的文字/);
  },
);
compositionDOM.dispatchEvent(
  new compositionFrame.CompositionEvent("compositionend", {
    bubbles: true,
    data: "文字",
  }),
);
await new Promise((resolve) => setTimeout(resolve, 650));
check(
  "Finishing composition resumes saving the committed Chinese document",
  () => {
    assert.equal(compositionBody.isComposing, false);
    assert.equal(compositionSaves, 1);
  },
);
compositionEditor.win.close();
let failedNativeDraft;
let failedNativeWrites = 0;
const failedNative = await editor(
  { zettelId: "NATIVE_FAILURE" },
  {
    getZettel: async () => ({
      id: "NATIVE_FAILURE",
      kind: "zettel",
      title: "Native failure",
      body: "Keep this draft",
      updated_at: 1,
    }),
    saveEditorDraft: async (input) => {
      failedNativeDraft = input;
    },
    saveEditorCard: async () => {
      failedNativeWrites++;
    },
  },
);
const nativeErrors = [];
failedNative.win.Zotero.logError = (error) => nativeErrors.push(error);
await failedNative.win.__editorEval('setEditorMode("visual", false)');
failedNative.win.__editorEval(
  "setDirty(); richEditor.flush = async () => { throw new Error('Native save failed'); }",
);
const failedNativeSave = failedNative.win.__editorEval("save(false)");
const duplicateNativeSave = failedNative.win.__editorEval("save(false)");
const nativeSaveResults = await Promise.all([
  failedNativeSave,
  duplicateNativeSave,
]);
check(
  "A failed native flush blocks navigation and all concurrent callers see failure",
  () => {
    assert.deepEqual(nativeSaveResults, [false, false]);
    assert.equal(failedNativeWrites, 0);
    assert.equal(nativeErrors.length, 1);
    assert.match(
      failedNative.$("knowledge-base-editor-status").textContent,
      /Native save failed/,
    );
    assert.equal(failedNative.win.__editorEval("dirty"), true);
  },
);
await failedNative.win.__editorEval("persistDraft()");
check("A failed native save retains recoverable editor content", () => {
  assert.match(failedNativeDraft.body, /Keep this draft$/);
  assert.equal(failedNativeDraft.id, "NATIVE_FAILURE");
});
failedNative.win.close();
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
check(
  "Editor offers only Zettel and Thinking types and keeps an automatic Zettel key",
  () => {
    assert.equal(ed.$("knowledge-base-editor-mode"), null);
    assert.equal(ed.$("knowledge-base-kind"), null);
    assert.equal(ed.$("knowledge-base-metadata"), null);
    assert.equal(ed.$("knowledge-base-note-kind").value, "zettel");
  },
);
const typeDraft = await editor();
check("New notes can switch type and only Thinking Notes can edit keys", () => {
  const type = typeDraft.$("knowledge-base-note-kind");
  assert.deepEqual(
    [...type.options].map((option) => option.value),
    ["zettel", "thinking"],
  );
  assert.equal(typeDraft.$("knowledge-base-editor-key").hidden, true);
  type.value = "thinking";
  type.dispatchEvent(new typeDraft.win.Event("change"));
  assert.equal(typeDraft.$("knowledge-base-editor-key").hidden, false);
  typeDraft.$("knowledge-base-editor-key").value = "MyProject";
  typeDraft
    .$("knowledge-base-editor-key")
    .dispatchEvent(new typeDraft.win.Event("input"));
  assert.equal(typeDraft.win.__editorEval("snapshot()").customKey, "MyProject");
  type.value = "zettel";
  type.dispatchEvent(new typeDraft.win.Event("change"));
  assert.equal(typeDraft.win.__editorEval("snapshot()").customKey, null);
  assert.equal(ed.$("knowledge-base-parent-root"), null);
  assert.equal(
    ed.$("knowledge-base-src-pick").getAttribute("aria-label"),
    "editor-change-source",
  );
  assert.equal(
    ed.$("knowledge-base-parent-change").getAttribute("aria-label"),
    "editor-change-parent",
  );
  assert.equal(
    ed.$("knowledge-base-editor-family").querySelector("section"),
    null,
  );
});
ed.$("knowledge-base-parent-change").click();
await new Promise((resolve) => setTimeout(resolve, 230));
check("The Parent picker uses references and a single No parent action", () => {
  assert.equal(ed.$("knowledge-base-parent-picker").hidden, false);
  assert.equal(
    ed.$("knowledge-base-parent-results").querySelector(".metadata-clear")
      .textContent,
    "editor-parent-none",
  );
  ed.$("knowledge-base-parent-results")
    .querySelector(".metadata-clear")
    .click();
  assert.equal(ed.$("knowledge-base-parent-picker").hidden, true);
  assert.equal(ed.win.__editorEval("snapshot()").parentId, null);
});
ed.$("knowledge-base-editor-body").value = sample;
ed.$("knowledge-base-editor-body").dispatchEvent(
  new ed.win.Event("input", { bubbles: true }),
);
await chooseMode(ed, "visual");
check(
  "The editor has a clickable source and Change without obsolete source actions",
  () => {
    assert.equal(ed.$("knowledge-base-src-display").localName, "div");
    assert.equal(
      ed.win.document.getElementById("knowledge-base-src-clear"),
      null,
    );
    assert.equal(
      ed.win.document.getElementById("knowledge-base-src-anno"),
      null,
    );
    assert.equal(
      ed.win.document.getElementById("knowledge-base-src-jump"),
      null,
    );
  },
);
check("Visual mode reuses Zotero's editor and keeps one body surface", () => {
  assert.equal(ed.initialMode, "visual");
  assert.equal(ed.initialSourceAllocated, false);
  assert.equal(ed.$("knowledge-base-rich-frame").mode, "edit");
  assert.equal(ed.$("knowledge-base-editor-title"), null);
  assert.equal(ed.$("knowledge-base-editor-preview").hidden, true);
});
ed.$("knowledge-base-editor-format").dispatchEvent(
  new ed.win.Event("command", { bubbles: true }),
);
await wait();
await wait();
check(
  "Markdown keeps the same native toolbar with its body writer paused",
  () => {
    assert.equal(ed.$("knowledge-base-editor-root").dataset.mode, "source");
    assert.equal(ed.$("knowledge-base-editor-body").hidden, false);
    assert.equal(ed.$("knowledge-base-rich-frame").mode, "edit");
    assert.equal(ed.$("knowledge-base-rich-frame").hidden, false);
    assert.equal(
      ed.$("knowledge-base-rich-frame").getAttribute("data-source-mode"),
      "true",
    );
    assert.equal(
      ed.$("knowledge-base-editor-format").getAttribute("label"),
      "editor-format-native",
    );
  },
);
ed.$("knowledge-base-editor-format").dispatchEvent(
  new ed.win.Event("command", { bubbles: true }),
);
await wait();
await wait();
check(
  "Markdown uses CodeMirror and keeps the title inside the document",
  () => {
    assert.ok(
      ed
        .$("knowledge-base-editor-body")
        .querySelector("iframe")
        .contentDocument.querySelector(".cm-editor"),
    );
    assert.equal(ed.$("knowledge-base-editor-title"), null);
  },
);
check(
  "Returning from Markdown restores native editing without a split preview",
  () => {
    assert.equal(ed.$("knowledge-base-editor-root").dataset.mode, "visual");
    assert.equal(ed.$("knowledge-base-editor-body").hidden, true);
    assert.equal(ed.$("knowledge-base-editor-preview").hidden, true);
  },
);
await chooseMode(ed, "source");
const readingSource = ed.$("knowledge-base-editor-body");
readingSource.value = "# Kept draft\n\n$$x^2$$\n\nUnformatted  text";
readingSource.setSelectionRange(8, 13);
const sourceBeforeReading = readingSource.value;
const writesBeforeReading = ed.saved();
await ed.win.__editorEval("toggleReading()");
check(
  "Source Reading retains the draft and writer mode without saving or formatting",
  () => {
    assert.equal(ed.$("knowledge-base-editor-root").dataset.mode, "reading");
    assert.equal(readingSource.hidden, true);
    assert.equal(readingSource.value, sourceBeforeReading);
    assert.equal(readingSource.selectionStart, 8);
    assert.equal(readingSource.selectionEnd, 13);
    assert.equal(ed.win.__editorEval("snapshot().sourceMode"), true);
    assert.equal(ed.saved(), writesBeforeReading);
    assert.ok(ed.win.__readingHTML.includes("katex-display"));
  },
);
await ed.win.__editorEval("toggleReading()");
assert.equal(ed.$("knowledge-base-editor-root").dataset.mode, "source");
assert.equal(readingSource.hidden, false);
assert.equal(readingSource.value, sourceBeforeReading);
assert.equal(readingSource.selectionStart, 8);
assert.equal(readingSource.selectionEnd, 13);
await chooseMode(ed, "visual");
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
  "Inline math does not add list escapes to adjacent prose or mutate the native DOM",
  () => {
    const root = htmlWindow.document.createElement("div");
    root.innerHTML = String.raw`<p><span class="math">$\psi_1$</span>-norm and <span data-type="inline-math" data-latex="\alpha_1"></span>-tail</p><p>-literal</p>`;
    const original = root.innerHTML;
    assert.equal(
      rich_text.richTextToMarkdown(root),
      String.raw`$\psi_1$-norm and $\alpha_1$-tail` + "\n\n\\-literal",
    );
    assert.equal(root.innerHTML, original);
  },
);
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
globalThis.addon = { data: {} };
const protectedProjection = native_notes.getMarkdownSource(structuredHTML);
check(
  "Markdown retains native citations and images as HTML with their metadata",
  () => {
    assert.ok(protectedProjection.body.includes("data-citation="));
    assert.ok(protectedProjection.body.includes("data-attachment-key="));
    assert.equal(protectedProjection.fragments.length, 2);
    assert.ok(protectedProjection.fragments[0].includes("locator%22%3A%2223"));
    assert.ok(protectedProjection.fragments[1].includes("IMAG1234"));
  },
);
const payloadSurface = ed.$("knowledge-base-editor-body");
payloadSurface.value = protectedProjection.body;
await wait();
check(
  "Native citation metadata stays in the document while the editor shows a chip",
  () => {
    const chip = payloadSurface
      .querySelector("iframe")
      .contentDocument.querySelector(".knowledge-base-md-node-citation");
    assert.ok(chip);
    assert.ok(chip.textContent.includes("Author 2026"));
    assert.ok(!chip.textContent.includes("locator%22"));
    assert.ok(payloadSurface.value.includes("locator%22%3A%2223"));
  },
);
const copiedParagraph =
  '<div data-schema-version="9"><h1>Copied note</h1><p style="color: rgb(34,34,34); background-color: white">Ordinary <strong>editable</strong> text</p></div>';
check(
  "Copied neutral colors leave ordinary paragraphs editable as Markdown",
  () => {
    const projection = native_notes.getMarkdownSource(copiedParagraph);
    assert.equal(projection.body, "Ordinary **editable** text");
    assert.equal(projection.fragments.length, 0);
    assert.equal(
      native_notes.getMarkdownDocument(copiedParagraph),
      "# Copied note\n\nOrdinary **editable** text",
    );
  },
);
const legacyFragmentProjection = native_notes.getMarkdownSource(
  copiedParagraph,
  true,
);
const legacyFragmentRoundTrip = await native_notes.markdownNoteHTML(
  legacyFragmentProjection.title,
  legacyFragmentProjection.body + "\n\nRecovered old draft",
  copiedParagraph,
);
check(
  "Older draft fragment indices still restore the original rich formatting",
  () => {
    assert.ok(legacyFragmentRoundTrip.includes("Recovered old draft"));
    assert.ok(legacyFragmentRoundTrip.includes("background-color: white"));
    assert.ok(!legacyFragmentRoundTrip.includes("knowledge-base://fragment/"));
  },
);
const documentRoundTrip = await native_notes.markdownDocumentHTML(
  "# Renamed\n\nOrdinary **editable** text\n\n$e=mc^2$",
  copiedParagraph,
);
check(
  "Full native Markdown documents retain one heading and native math",
  () => {
    const doc = new JSDOM(documentRoundTrip).window.document;
    assert.equal(doc.querySelectorAll("h1").length, 1);
    assert.equal(doc.querySelector("h1").textContent, "Renamed");
    assert.ok(doc.querySelector(".math").textContent.includes("$e=mc^2$"));
  },
);
const paragraphDocument = await native_notes.markdownDocumentHTML(
  "First paragraph\n\n# Added heading",
  '<div data-schema-version="9"><p>First paragraph</p></div>',
);
check(
  "Full native Markdown documents do not invent titles for paragraph-led notes",
  () => {
    assert.equal(
      new JSDOM(paragraphDocument).window.document.querySelector("h1")
        .textContent,
      "Added heading",
    );
    assert.equal((paragraphDocument.match(/First paragraph/g) || []).length, 1);
  },
);
const styledOriginal =
  '<div data-schema-version="9"><h1>Styled note</h1><p style="text-align:center">Centered paragraph</p></div>';
const styledSource = native_notes.getMarkdownSource(styledOriginal);
const styledRoundTrip = await native_notes.markdownNoteHTML(
  styledSource.title,
  styledSource.body + "\n\nAdded text",
  styledOriginal,
);
check(
  "Protected block formatting restores without nesting block nodes inside paragraphs",
  () => {
    assert.ok(
      styledRoundTrip.includes(
        '<p style="text-align:center">Centered paragraph</p>',
      ),
    );
    assert.ok(!styledRoundTrip.includes("<p><p"));
  },
);
const paragraphRoundTrip = await native_notes.markdownNoteHTML(
  "Native first paragraph",
  "Native first paragraph\n\nMy added paragraph",
  '<div data-schema-version="9"><p>Native first paragraph</p></div>',
);
check(
  "Markdown edits of existing paragraph-titled notes do not prepend a duplicate title",
  () => {
    assert.equal(
      (paragraphRoundTrip.match(/Native first paragraph/g) || []).length,
      1,
    );
    assert.ok(paragraphRoundTrip.includes("My added paragraph"));
    assert.equal(
      new JSDOM(paragraphRoundTrip).window.document.querySelector("h1"),
      null,
    );
  },
);
const fragmentRestore = await native_notes.markdownNoteHTML(
  protectedProjection.title,
  protectedProjection.body + "\n\nMy Markdown draft",
  structuredHTML,
);
check(
  "Conflict copies render the user's Markdown against its original protected fragments",
  () => {
    const doc = new JSDOM(fragmentRestore).window.document;
    assert.ok(doc.body.textContent.includes("My Markdown draft"));
    assert.equal(
      doc.querySelector("img").getAttribute("data-attachment-key"),
      "IMAG1234",
    );
    assert.equal(
      JSON.parse(
        decodeURIComponent(
          doc.querySelector("[data-citation]").getAttribute("data-citation"),
        ),
      ).citationItems[0].locator,
      "23",
    );
    assert.ok(!fragmentRestore.includes("zkb:"));
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
      "# References\n\n[@Author2026]",
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
  assert.equal(
    rich_text.richTextToMarkdown(
      '<p><a href="zotero://select/library/items/NOTE1234" title="[[stable-id|Old label]]">New label</a></p>',
    ),
    "[[stable-id|New label]]",
  );
});
const literaturePicker = await editor(
  {},
  {
    listZettels: async () => [
      {
        id: "note-1-UNIQUE01",
        reference: "@Author2026",
        title: "My literature synthesis",
      },
    ],
  },
);
await literaturePicker.win.__editorEval('setEditorMode("source", false)');
literaturePicker.$("knowledge-base-editor-body").value = "";
literaturePicker.win.__editorEval("openCardPicker()");
await literaturePicker.win.__editorEval("searchCards()");
const literaturePickerRow = literaturePicker.$(
  "knowledge-base-link-results",
).firstElementChild;
check(
  "Literature picker shows the citation key and inserts the stable note ID",
  () => {
    assert.equal(
      literaturePickerRow.querySelector(".relation-id").textContent,
      "@Author2026",
    );
    literaturePickerRow.click();
    assert.equal(
      literaturePicker.$("knowledge-base-editor-body").value,
      "[[note-1-UNIQUE01]]",
    );
  },
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
childDraft.$("knowledge-base-editor-body").value = "# Child concept\n\n";
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
      row.querySelector(".note-reference-text").textContent,
      "Target card (20261001000000)",
    );
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
check("Relationship IDs and tooltips display without wiki brackets", () => {
  const child = familyBox.querySelector(".family-link");
  assert.equal(child.querySelector(".relation-id").textContent, "0");
  assert.equal(child.title, "Child 0 (0)");
  assert.equal(
    child.querySelector(".note-reference-text").textContent,
    "Child 0 (0)",
  );
});
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
    assert.equal(ed.saved().sourceDocument, "- [x] done\n- [ ] ");
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
await chooseMode(ed, "visual");
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
missing.$("knowledge-base-editor-body").value +=
  "\n\nAn edit with the source unavailable.";
missing.win.__editorEval("setDirty()");
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
  "Force layout groups connected notes, sizes hubs and never mutates stored graph data",
  () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      title: "Note " + i,
      kind: "card",
      snippet: "",
    }));
    const edges = Array.from({ length: 9 }, (_, i) => ({
      source: "0",
      target: String(i + 1),
      kind: "link",
      ref: "",
      context: "",
    }));
    const data = { nodes, edges };
    const original = globalThis.structuredClone(data);
    const layout = graph_layout.createGraphLayout(data);
    const positions = layout.nodes();
    assert.deepEqual(data, original);
    assert.ok(positions[0].radius > positions[20].radius);
    const distance = (node) =>
      Math.hypot(node.x - positions[0].x, node.y - positions[0].y);
    const linkedDistance =
      positions.slice(1, 10).reduce((sum, node) => sum + distance(node), 0) / 9;
    const unlinkedDistance =
      positions.slice(10).reduce((sum, node) => sum + distance(node), 0) / 20;
    assert.ok(linkedDistance < unlinkedDistance);
    assert.ok(
      positions.every(
        (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
      ),
    );
    assert.equal(layout.alphaTarget(), 0);
    const saved = new Map(
      positions.map((node) => [node.id, { x: node.x, y: node.y }]),
    );
    const retained = graph_layout.createGraphLayout(data, saved, false);
    assert.deepEqual(
      retained.nodes().map((node) => [node.x, node.y]),
      positions.map((node) => [node.x, node.y]),
    );
    layout.stop();
    retained.stop();
  },
);
check(
  "A thousand-node network includes isolated notes and produces finite positions",
  () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      title: "Note",
      kind: "card",
      snippet: "",
    }));
    const layout = graph_layout.createGraphLayout({ nodes, edges: [] });
    assert.equal(layout.nodes().length, 1000);
    assert.ok(
      layout
        .nodes()
        .every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
    );
    layout.stop();
  },
);
check(
  "Canvas draws curved directed relations, tag colors and readable titles; hit testing follows pan and zoom",
  () => {
    const calls = [];
    const context = new Proxy(
      {},
      {
        get:
          (_, method) =>
          (...args) => {
            assert.ok(
              args
                .filter((value) => typeof value === "number")
                .every(Number.isFinite),
            );
            calls.push([method, ...args]);
          },
        set: (_, name, value) => {
          calls.push([name, value]);
          return true;
        },
      },
    );
    const canvas = {
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 500, height: 300 }),
      ownerDocument: { defaultView: { devicePixelRatio: 2 } },
    };
    const style = {
      getPropertyValue: (name) => (name === "--bg" ? "#fff" : "#123456"),
      fontFamily: "system-ui",
    };
    const renderer = graph_canvas.createGraphCanvas(canvas, style);
    const nodes = [
      { id: "a", x: 0, y: 0, radius: 6, kind: "card", color: "#30a46c" },
      { id: "b", x: 100, y: 80, radius: 8, kind: "source" },
    ];
    const edges = [
      { source: nodes[0], target: nodes[1], kind: "link" },
      { source: nodes[1], target: nodes[0], kind: "parent" },
      { source: nodes[0], target: nodes[0], kind: "link" },
    ];
    renderer.draw(
      nodes,
      edges,
      { x: 50, y: 30, k: 2 },
      new Map([["a", { text: "A", visible: true }]]),
      "a",
      "a",
    );
    assert.ok(calls.some(([method]) => method === "quadraticCurveTo"));
    assert.ok(calls.some(([method]) => method === "bezierCurveTo"));
    assert.ok(
      calls.some(
        ([method, color]) => method === "fillStyle" && color === "#30a46c",
      ),
    );
    assert.ok(
      calls.some(([method, text]) => method === "fillText" && text === "A"),
    );
    assert.equal(canvas.width, 1000);
    assert.equal(canvas.height, 600);
    renderer.draw(
      nodes,
      edges,
      { x: 50, y: 30, k: 2 },
      new Map(),
      undefined,
      undefined,
      new Set(),
      true,
    );
    assert.equal(canvas.width, 500);
    assert.equal(canvas.height, 300);
    renderer.draw(nodes, edges, { x: 50, y: 30, k: 2 }, new Map());
    assert.equal(canvas.width, 1000);
    assert.equal(canvas.height, 600);
    assert.equal(
      graph_canvas.hitGraphNode(nodes, { x: 50, y: 30, k: 2 }, 250, 190)?.id,
      "b",
    );
    assert.equal(
      graph_canvas.hitGraphNode(nodes, { x: 50, y: 30, k: 2 }, 400, 270),
      undefined,
    );
    calls.length = 0;
    renderer.draw(
      Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        x: i % 100,
        y: Math.floor(i / 100),
        radius: 6,
        kind: "card",
        color: i % 2 ? "#30a46c" : "#2469c9",
      })),
      [],
      { x: 0, y: 0, k: 1 },
      new Map(),
    );
    assert.equal(calls.filter(([method]) => method === "arc").length, 1000);
    assert.equal(calls.filter(([method]) => method === "fill").length, 2);
    assert.ok(calls.filter(([method]) => method === "stroke").length <= 3);
    const deniedGPU = { getContext: () => null, hidden: false };
    const fallback = graph_canvas.createGraphCanvas(canvas, style, deniedGPU);
    assert.equal(fallback.backend, "canvas");
    assert.equal(deniedGPU.hidden, true);
    calls.length = 0;
    fallback.draw(nodes, edges, { x: 0, y: 0, k: 1 }, new Map());
    assert.ok(calls.some(([method]) => method === "quadraticCurveTo"));
    fallback.dispose();
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
let graphLabelLength = 20;
let graphLocalDepth = 1;
const graphOptions = {
  outline: true,
  references: true,
  sources: true,
  hideIsolated: false,
};
let optionsChanged;
graphDom.window.Zotero = {
  ZoteroKnowledgeBase: {
    api: {
      onSourceStyleChange: () => () => {},
      getSourceBibliography: async () =>
        '<div class="csl-entry">Author (2026). <i>Linked Zotero item</i>. Journal.</div>',
      getPanelWidth: () => 28,
      setPanelWidth: () => {},
      getNoteTags: async () => [],
      getNoteHealth: async () => ({
        note: "available",
        source: "none",
        editable: true,
      }),
      prepareMarkdown: async () => {},
      loc: (key) => key,
      getGraph: async () => graphData,
      getGraphOptions: () => graphOptions,
      getGraphLabelLength: () => graphLabelLength,
      getGraphLocalDepth: () => graphLocalDepth,
      setGraphOption: (name, enabled) => {
        graphOptions[name] = enabled;
        optionsChanged?.();
      },
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
graphDom.window.requestAnimationFrame = (callback) =>
  graphDom.window.setTimeout(
    () => callback(graphDom.window.performance.now()),
    0,
  );
graphDom.window.cancelAnimationFrame = (frame) =>
  graphDom.window.clearTimeout(frame);
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
      hideIsolated: false,
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
const graphPositions = () =>
  Array.from(
    graphDom.window.document.querySelectorAll(".graph-node"),
    (node) => [
      node.getAttribute("data-node-id"),
      node.getAttribute("transform"),
    ],
  ).sort(([a], [b]) => a.localeCompare(b));
const originalPositions = graphPositions();
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
    assert.deepEqual(graphPositions(), originalPositions);
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
graphDom.window.document.getElementById("graph-sources").checked = true;
graphDom.window.document
  .getElementById("graph-sources")
  .dispatchEvent(new graphDom.window.Event("command", { bubbles: true }));
await wait();
check("Source nodes return when enabled in the graph", () => {
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
check(
  "Search highlights all matches and clearing restores the whole network",
  () => {
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.highlighted")
        .length,
      1,
    );
    searchGraph.value = "";
    searchGraph.dispatchEvent(new graphDom.window.Event("input"));
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.dimmed").length,
      0,
    );
  },
);
const hoverNode = graphDom.window.document.querySelector(".graph-node");
hoverNode.dispatchEvent(new graphDom.window.Event("pointerenter"));
check(
  "Hover reveals the title and its links without fading other nodes",
  () => {
    assert.ok(hoverNode.classList.contains("hovered"));
    assert.ok(
      graphDom.window.document.querySelectorAll(".graph-edge.highlighted")
        .length > 0,
    );
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.selected").length,
      0,
    );
    assert.equal(
      graphDom.window.document.querySelectorAll(".dimmed").length,
      0,
    );
  },
);
hoverNode.dispatchEvent(new graphDom.window.Event("pointerleave"));
hoverNode.dispatchEvent(
  new graphDom.window.MouseEvent("click", { bubbles: true }),
);
check(
  "Selection strengthens connected links while retaining the entire network",
  () => {
    assert.equal(
      graphDom.window.document.querySelectorAll(".dimmed").length,
      0,
    );
    assert.ok(
      graphDom.window.document.querySelector(".graph-edge.highlighted"),
    );
    assert.equal(
      graphDom.window.document.querySelectorAll(".graph-node.highlighted")
        .length,
      0,
    );
  },
);
graphDom.window.document
  .getElementById("graph-svg")
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
check(
  "Clicking the graph background clears selection and highlighted links",
  () => {
    assert.equal(
      graphDom.window.document.querySelectorAll(
        ".graph-node.selected,.graph-node.dimmed",
      ).length,
      0,
    );
    assert.equal(
      graphDom.window.document.getElementById("graph-selection").hidden,
      true,
    );
  },
);
const isolatedControl = graphDom.window.document.getElementById(
  "graph-hide-isolated",
);
const toggleIsolated = (checked) => {
  isolatedControl.checked = checked;
  isolatedControl.dispatchEvent(
    new graphDom.window.Event("command", { bubbles: true }),
  );
};
const beforeIsolatedPositions = graphPositions();
const beforeIsolatedViewport = graphDom.window.document
  .querySelector("#graph-svg > g")
  .getAttribute("transform");
const originalGraphData = globalThis.structuredClone(graphData);
graphDom.window.document
  .querySelector('[data-node-id="I"]')
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
toggleIsolated(true);
await wait();
check(
  "Hiding isolated nodes saves the option and clears a hidden selection",
  () => {
    assert.equal(graphOptions.hideIsolated, true);
    assert.deepEqual(
      graphPositions().map(([id]) => id),
      ["A", "B", "C", "S"],
    );
    assert.deepEqual(
      graphPositions(),
      beforeIsolatedPositions.filter(([id]) => id !== "I"),
    );
    assert.equal(
      graphDom.window.document
        .querySelector("#graph-svg > g")
        .getAttribute("transform"),
      beforeIsolatedViewport,
    );
    assert.equal(
      graphDom.window.document.getElementById("graph-selection").hidden,
      true,
    );
    assert.deepEqual(graphData, originalGraphData);
  },
);
toggleIsolated(false);
await wait();
check(
  "Showing isolated nodes restores their positions without moving the view",
  () => {
    assert.deepEqual(graphPositions(), beforeIsolatedPositions);
    assert.equal(
      graphDom.window.document
        .querySelector("#graph-svg > g")
        .getAttribute("transform"),
      beforeIsolatedViewport,
    );
  },
);
// A self reference does not connect an otherwise isolated note to another node.
graphData.edges.push({ source: "I", target: "I", kind: "link" });
toggleIsolated(true);
await wait();
check("Self references do not keep isolated notes visible", () => {
  assert.equal(
    graphDom.window.document.querySelector('[data-node-id="I"]'),
    null,
  );
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-edge").length,
    3,
  );
});
graphOptions.references = false;
optionsChanged();
await wait();
check(
  "Isolation follows visible relationships instead of hidden references",
  () => {
    assert.deepEqual(
      graphPositions().map(([id]) => id),
      ["A", "S"],
    );
  },
);
graphOptions.sources = false;
optionsChanged();
await wait();
check("A graph without visible connections has a valid empty state", () => {
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-node").length,
    0,
  );
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-edge").length,
    0,
  );
  assert.equal(
    graphDom.window.document.getElementById("graph-empty").hidden,
    false,
  );
  assert.equal(
    graphDom.window.document.getElementById("graph-error").textContent,
    "",
  );
});
graphData.edges.pop();
graphOptions.references = true;
graphOptions.sources = true;
toggleIsolated(false);
await wait();
check("Disabling isolation restores all nodes and the untouched graph", () => {
  assert.equal(
    graphDom.window.document.querySelectorAll(".graph-node").length,
    5,
  );
  assert.deepEqual(graphData, originalGraphData);
});
// The same window switches scope without writing or trimming the underlying graph.
const graphIDs = () => graphPositions().map(([id]) => id);
graphDom.window.ZoteroKnowledgeBase_showGraph("A");
await wait();
await wait();
check(
  "Local graph uses the configured one-hop neighborhood without another toolbar control",
  () => {
    assert.deepEqual(graphIDs(), ["A", "B", "S"]);
    assert.equal(
      graphDom.window.document.getElementById("graph-depth-control"),
      null,
    );
    assert.equal(
      graphDom.window.document.getElementById("graph-svg").dataset.scope,
      "local",
    );
    assert.equal(
      graphDom.window.document
        .getElementById("graph-local")
        .getAttribute("aria-pressed"),
      "true",
    );
  },
);
const setHop = (depth) => {
  graphLocalDepth = depth;
  optionsChanged();
};
setHop(2);
await wait();
check(
  "Two hops includes a neighbor's neighbor but excludes an unrelated note",
  () => assert.deepEqual(graphIDs(), ["A", "B", "C", "S"]),
);
toggleIsolated(true);
await wait();
graphOptions.references = false;
optionsChanged();
await wait();
check("Hidden relationships do not count toward local hops", () =>
  assert.deepEqual(graphIDs(), ["A", "S"]),
);
graphOptions.references = true;
optionsChanged();
await wait();
graphDom.window.ZoteroKnowledgeBase_showGraph("S");
setHop(1);
await wait();
await wait();
check("A paper can be the center of a local graph", () =>
  assert.deepEqual(graphIDs(), ["A", "S"]),
);
graphDom.window.ZoteroKnowledgeBase_showGraph("missing");
await wait();
await wait();
check(
  "A removed local center shows an empty state instead of falling back to the full graph",
  () => assert.deepEqual(graphIDs(), []),
);
toggleIsolated(false);
graphDom.window.ZoteroKnowledgeBase_showGraph();
await wait();
await wait();
check("Global entry restores the full graph without a hop selector", () => {
  assert.deepEqual(graphIDs(), ["A", "B", "C", "I", "S"]);
  assert.equal(
    graphDom.window.document.getElementById("graph-depth-control"),
    null,
  );
  assert.equal(
    graphDom.window.document
      .getElementById("graph-local")
      .hasAttribute("disabled"),
    true,
  );
  assert.deepEqual(graphData, originalGraphData);
});
graphDom.window.document
  .querySelector('[data-node-id="B"]')
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
graphDom.window.document
  .getElementById("graph-local")
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
await wait();
check("Local toolbar action uses the selected note as its center", () =>
  assert.deepEqual(graphIDs(), ["A", "B", "C"]),
);
graphDom.window.document
  .getElementById("graph-global")
  .dispatchEvent(new graphDom.window.MouseEvent("click", { bubbles: true }));
await wait();
await wait();
check(
  "Global retains the selected note and its strengthened connections",
  () => {
    assert.deepEqual(graphIDs(), ["A", "B", "C", "I", "S"]);
    assert.ok(
      graphDom.window.document.querySelector('[data-node-id="B"].selected'),
    );
    assert.equal(
      graphDom.window.document.querySelector(".graph-node.dimmed"),
      null,
    );
  },
);
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
graphLabelLength = 12;
optionsChanged();
await wait();
check(
  "Graph title limits update live, including selected nodes, while retaining full tooltips",
  () => {
    const node = graphDom.window.document.querySelector(".graph-node");
    node.dispatchEvent(
      new graphDom.window.MouseEvent("click", { bubbles: true }),
    );
    node.dispatchEvent(new graphDom.window.MouseEvent("pointerenter"));
    assert.equal(
      node.querySelector("text").textContent,
      Array.from(node.getAttribute("aria-label")).slice(0, 12).join("") + "…",
    );
    assert.ok(
      node
        .querySelector("title")
        .textContent.startsWith(node.getAttribute("aria-label")),
    );
  },
);
graphLabelLength = 20;
optionsChanged();
await wait();
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
    item_key: "SRC00001",
    library_id: 1,
    body: '<span class="highlight" data-annotation="native-annotation">An idea with a clear source and related notes.</span><img data-attachment-key="IMAGE001" />',
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
let managerChanged;
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
      onSourceStyleChange: () => () => {},
      getSourceBibliography: async () =>
        '<div class="csl-entry">Author (2026). <i>Linked Zotero item</i>. Journal.</div>',
      getPanelWidth: () => 28,
      setPanelWidth: () => {},
      getNoteTags: async () => [],
      getNoteHealth: async () => ({
        note: "available",
        source: "none",
        editable: true,
      }),
      prepareMarkdown: async () => {},
      getItemSummary: async () => ({
        key: "SRC00001",
        libraryID: 1,
        title: "Linked Zotero item",
        creatorYear: "Author 2026",
        publication: "Journal",
      }),
      selectItem: async (...args) => {
        managerCalls.sources = args;
      },
      loc: (key) => labels[key] || key,
      listEditorDrafts: async () => [],
      auditNativeNotes: async () => {},
      isAccelKey: (event) => platform.isAccelKey(event, true),
      searchZettelSummaries: async (_query, { kind }) => ({
        items: managerCards.filter(
          (card) => !kind || (card.kind || "zettel") === kind,
        ),
        cursor: null,
      }),
      listZettels: async (_query, _entries, kind) =>
        managerCards.filter(
          (card) => !kind || (card.kind || "zettel") === kind,
        ),
      copyNoteReference: (reference) => {
        managerCalls.reference = `[[${reference}]]`;
      },
      getZettel: async (id) => managerCards.find((card) => card.id === id),
      getFamily: async () => ({
        parent: null,
        children: [managerCards[1]].filter(Boolean),
      }),
      getOutgoing: async () => [],
      getBacklinks: async () => [],
      getUnresolvedRefs: async () => [],
      onDataChange: (listener) => {
        managerChanged = listener;
        return () => {};
      },
      renderMarkdown: (body) => `<p>${body}</p>`,
      openEditor: (args) => managerCalls.edits.push(args),
      openGraph: (args) => managerCalls.graphs.push(args),
      openManager: (args) => managerCalls.opens.push(args),
      openWorkbenchWindow: (args) => managerCalls.opens.push(args),
      isExternalNote: async () => false,
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
    "\nwindow.__managerLoad = load; window.__managerRefresh = refresh; window.__managerRows = () => zettels; window.__managerRenderHealth = renderHealth;",
);
await managerWin.__managerLoad();
await wait();
await wait();
const managerDoc = managerWin.document;
check("The workbench has no duplicate window-opening control", () => {
  assert.equal(managerDoc.getElementById("knowledge-base-open-window"), null);
});
check(
  "A missing original offers neither a cached copy nor a source restore",
  () => {
    const box = managerDoc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    managerWin.__managerRenderHealth(
      box,
      { note: "missing", source: "trashed", editable: true },
      managerCards[0].id,
    );
    assert.equal(box.hidden, false);
    assert.equal(box.textContent, "health-note-missing");
    assert.equal(box.children.length, 1);
  },
);
check(
  "Browser panels resize by keyboard and relations start as three collapsed groups",
  () => {
    const handle = managerDoc.getElementById("knowledge-base-splitter");
    const pane = managerDoc.getElementById("knowledge-base-list-pane");
    assert.equal(handle.getAttribute("role"), "separator");
    handle.dispatchEvent(
      new managerWin.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    assert.equal(pane.style.flexBasis, "30%");
    assert.equal(handle.getAttribute("aria-valuenow"), "30");
    const groups = [
      ...managerDoc.querySelectorAll(".card-connections details"),
    ];
    assert.equal(groups.length, 3);
    assert.ok(groups.every((group) => !group.open));
  },
);
check(
  "Card browser labels note types and uses Zotero native toolbar actions",
  () => {
    assert.deepEqual(
      [...managerDoc.querySelectorAll(".zettel-row .zid")].map(
        (el) => el.textContent,
      ),
      managerCards.map(
        (card) =>
          `note-kind-${card.kind || "zettel"} · ${card.reference || card.id}`,
      ),
    );
    const actions = [
      ...managerDoc.querySelectorAll(".card-actions toolbarbutton"),
    ];
    assert.equal(actions.length, 3);
    assert.equal(
      managerDoc.querySelector("#knowledge-base-detail .card-actions"),
      null,
    );
    for (const button of actions) {
      assert.ok(button.closest("#knowledge-base-toolbar"));
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
      managerDoc
        .querySelector(".zettel-row.active")
        .getAttribute("aria-current"),
      "true",
    );
  },
);
managerDoc.querySelector("#knowledge-base-detail-source .source-link").click();
await wait();
check(
  "Source is visibly marked as a Zotero item and opens the linked item",
  () => {
    const box = managerDoc.getElementById("knowledge-base-detail-source");
    assert.equal(
      box.querySelector(".source-item-label").textContent,
      "manager-source-item",
    );
    assert.equal(box.querySelector("i").textContent, "Linked Zotero item");
    assert.ok(box.querySelector(".csl-entry"));
    assert.deepEqual(managerCalls.sources, ["SRC00001", 1]);
  },
);
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
check(
  "Note IDs display without brackets while copying a wiki reference",
  () => {
    const button = managerDoc.getElementById("knowledge-base-detail-reference");
    assert.equal(button.textContent, managerCards[0].id);
    assert.ok(!managerDoc.querySelector(".zid").textContent.includes("[["));
    button.click();
    assert.equal(managerCalls.reference, `[[${managerCards[0].id}]]`);
    assert.equal(button.title, "note-reference-copy");
  },
);
managerDoc.querySelector("#knowledge-base-family .family-link").click();
check("Compact child entries still navigate to their card", () =>
  assert.equal(managerCalls.opens[0].selectId, managerCards[1].id),
);
check("Native highlights and images leave only readable list summaries", () => {
  const summary = managerDoc.querySelector(".card-snippet").textContent;
  assert.equal(summary, "An idea with a clear source and related notes.");
  assert.ok(!summary.includes("data-annotation"));
  assert.ok(!summary.includes("IMAGE001"));
});
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
const kindFilter = managerDoc.getElementById("knowledge-base-kind");
kindFilter.value = "thinking";
kindFilter.dispatchEvent(new managerWin.Event("change"));
await wait();
await wait();
check("Type filtering hides cards from other note kinds", () => {
  for (const button of managerDoc.querySelectorAll(
    ".card-actions toolbarbutton",
  ))
    assert.ok(button.hasAttribute("disabled"));
  assert.equal(managerDoc.querySelectorAll(".zettel-row").length, 0);
});
nativeClick(managerDoc.getElementById("knowledge-base-btn-new"), managerWin);
check("A new note inherits the selected kind", () => {
  assert.equal(managerCalls.edits.at(-1).kind, "thinking");
});
kindFilter.value = "";
kindFilter.dispatchEvent(new managerWin.Event("change"));
await wait();
await wait();
check("All notes restores the remaining card", () => {
  assert.equal(managerDoc.querySelectorAll(".zettel-row").length, 1);
});
const paginationAPI = managerWin.Zotero.ZoteroKnowledgeBase.api;
const firstPagedCard = managerCards[0];
const secondPagedCard = {
  ...firstPagedCard,
  id: "NEXT_PAGE",
  title: "Next page card",
};
let pageCalls = [];
paginationAPI.searchZettelSummaries = async (query, options) => {
  pageCalls.push({ query, ...options });
  return options.cursor
    ? { items: [firstPagedCard, secondPagedCard], cursor: null }
    : { items: [firstPagedCard], cursor: "page-two" };
};
await managerWin.__managerRefresh();
for (
  let n = 0;
  n < 50 &&
  managerDoc.getElementById("knowledge-base-list").getAttribute("aria-busy") ===
    "true";
  n++
)
  await new Promise((resolve) => setTimeout(resolve, 10));
check(
  "Automatic loading keeps existing cards, deduplicates overlap and stops at the last page",
  () => {
    assert.equal(managerDoc.querySelectorAll(".zettel-row").length, 2);
    assert.equal(pageCalls.at(-1).cursor, "page-two");
    assert.equal(pageCalls.at(-1).limit, 100);
    assert.equal(
      managerDoc
        .getElementById("knowledge-base-list")
        .getAttribute("aria-busy"),
      "false",
    );
  },
);
const manyCards = Array.from({ length: 1200 }, (_, index) => ({
  ...firstPagedCard,
  id: `VIRTUAL_${index}`,
  title: `Virtual note ${index}`,
  body: "Small summary",
}));
let metadataCalls = 0;
paginationAPI.getZettel = async (id) => manyCards.find((row) => row.id === id);
paginationAPI.searchZettelSummaries = async (_query, options) => {
  metadataCalls++;
  const offset = Number(options.cursor || 0);
  return {
    items: manyCards.slice(offset, offset + 100),
    cursor: offset + 100 < manyCards.length ? String(offset + 100) : null,
  };
};
await managerWin.__managerRefresh();
for (
  let n = 0;
  n < 100 &&
  managerDoc.getElementById("knowledge-base-list").getAttribute("aria-busy") ===
    "true";
  n++
)
  await new Promise((resolve) => setTimeout(resolve, 10));
check(
  "All twelve hundred notes load automatically while only viewport rows and short summaries stay rendered",
  () => {
    assert.equal(metadataCalls, 12);
    assert.equal(managerWin.__managerRows().length, 1200);
    assert.ok(
      managerWin
        .__managerRows()
        .every((row) => row.body === "" && row.snippet.length <= 112),
    );
    assert.ok(managerDoc.querySelectorAll(".zettel-row").length < 20);
    assert.equal(managerDoc.getElementById("knowledge-base-load-more"), null);
  },
);
managerDoc.getElementById("knowledge-base-list").dispatchEvent(
  new managerWin.KeyboardEvent("keydown", {
    key: "End",
    bubbles: true,
    cancelable: true,
  }),
);
await wait();
check(
  "Keyboard navigation reaches notes outside the initial viewport without additional data requests",
  () => {
    assert.equal(
      managerDoc.querySelector(".zettel-row.active").dataset.id,
      "VIRTUAL_1199",
    );
    assert.ok(managerDoc.querySelectorAll(".zettel-row").length < 20);
    assert.equal(metadataCalls, 12);
  },
);
paginationAPI.searchZettelSummaries = async (_query, options) => {
  metadataCalls++;
  assert.deepEqual(Array.from(options.cardIDs), ["VIRTUAL_1"]);
  return {
    items: [
      { ...manyCards[1], title: "Updated single note", updated_at: Date.now() },
    ],
    cursor: null,
  };
};
const beforeChangeScroll = managerDoc.getElementById(
  "knowledge-base-list-pane",
).scrollTop;
managerChanged({ all: false, fields: ["content"], cardIDs: ["VIRTUAL_1"] });
await wait();
await wait();
check(
  "Editing one note refreshes only its summary while preserving all loaded rows and scroll position",
  () => {
    assert.equal(metadataCalls, 13);
    assert.equal(managerWin.__managerRows().length, 1200);
    assert.equal(managerWin.__managerRows()[0].title, "Updated single note");
    assert.equal(
      managerDoc.getElementById("knowledge-base-list-pane").scrollTop,
      beforeChangeScroll,
    );
  },
);
paginationAPI.searchZettelSummaries = async (_query, options) => {
  metadataCalls++;
  assert.equal(options.cardIDs.length, 500);
  return { items: [], cursor: null };
};
managerChanged({
  all: false,
  fields: ["availability"],
  cardIDs: manyCards.slice(700).map((row) => row.id),
});
await wait();
await wait();
check(
  "Removing filtered summaries near the end clamps the recycled viewport and keeps remaining notes visible",
  () => {
    assert.equal(metadataCalls, 14);
    assert.equal(managerWin.__managerRows().length, 700);
    assert.ok(managerDoc.querySelectorAll(".zettel-row").length > 0);
    assert.ok(managerDoc.querySelectorAll(".zettel-row").length < 20);
    assert.ok(
      managerDoc.getElementById("knowledge-base-list-pane").scrollTop <
        beforeChangeScroll,
    );
  },
);
let releaseStalePage;
paginationAPI.searchZettelSummaries = async () =>
  new Promise((resolve) => {
    releaseStalePage = resolve;
  });
const stalePage = managerWin.__managerRefresh();
await wait();
const managerSearch = managerDoc.getElementById("knowledge-base-search");
managerSearch.value = "new query";
managerSearch.dispatchEvent(new managerWin.Event("input"));
releaseStalePage({
  items: [{ ...firstPagedCard, title: "Stale query title" }],
  cursor: "stale-cursor",
});
await stalePage;
check(
  "Changing a query immediately rejects pending pages and their cursor",
  () => {
    assert.ok(managerDoc.querySelectorAll(".zettel-row").length < 20);
    assert.ok(
      !managerDoc
        .getElementById("knowledge-base-list")
        .textContent.includes("Stale query title"),
    );
    assert.equal(managerDoc.getElementById("knowledge-base-load-more"), null);
  },
);
for (const win of windows) {
  win.dispatchEvent(new win.Event("unload"));
  win.close();
}
htmlWindow.close();
await rm(workspace, { recursive: true, force: true });
console.log(`OK - ${checks} Markdown, source, editing, image and graph checks`);
