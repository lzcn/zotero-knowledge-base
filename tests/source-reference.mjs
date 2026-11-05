import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(join(tmpdir(), "knowledge-base-source-"));
try {
  await build({
    stdin: {
      contents:
        'export * from "./src/modules/source-reference.ts"; export {notifyDataChange} from "./src/modules/events.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "source-reference.mjs"),
  });
  const dom = new JSDOM("<div id='source'></div>", {
    runScripts: "outside-only",
  });
  const item = {
    id: 1,
    key: "ITEM0001",
    libraryID: 1,
    deleted: false,
    isRegularItem: () => true,
    getField: (field) => {
      if (field === "title") return "A <concise> title";
      if (field === "firstCreator") return "Yu";
      if (field === "date") return "2023";
      if (field === "publicationTitle") return "Journal";
      return "";
    },
  };
  let loads = 0;
  globalThis.Zotero = {
    Items: {
      getByLibraryAndKeyAsync: async () => item,
      loadDataTypes: async () => {
        loads++;
      },
    },
    Libraries: {
      userLibraryID: 1,
      get: () => ({ name: "My Library", libraryType: "user" }),
    },
    ItemFields: { getID: () => false },
  };
  globalThis.addon = {
    data: {
      locale: {
        current: { formatMessagesSync: ([entry]) => [{ value: entry.id }] },
      },
    },
  };
  const reference = await import(
    pathToFileURL(join(root, "source-reference.mjs"))
  );
  assert.equal(
    reference.formatSourceReference({
      creatorYear: "Yu 2023",
      title: "A <concise> title",
      publication: "Journal",
    }),
    "Yu 2023. <i>A &lt;concise&gt; title</i>. Journal.",
  );
  const initial = await Promise.all(
    Array.from({ length: 3 }, () =>
      reference.getSourceReference("ITEM0001", 1),
    ),
  );
  const html = initial[0];
  assert.deepEqual(initial, Array(3).fill(html));
  assert.equal(html, "Yu 2023. <i>A &lt;concise&gt; title</i>. Journal.");
  assert.equal(loads, 1);
  await reference.getSourceReference("ITEM0001", 1);
  assert.equal(loads, 1);
  reference.notifyDataChange({ fields: ["identity"] });
  await reference.getSourceReference("ITEM0001", 1);
  assert.equal(loads, 1);
  reference.notifyDataChange({ fields: ["source"] });
  item.getField = (field) =>
    field === "title"
      ? "Updated title"
      : field === "firstCreator"
        ? "Yu"
        : field === "date"
          ? "2024"
          : field === "publicationTitle"
            ? "Journal"
            : "";
  assert.equal(
    await reference.getSourceReference("ITEM0001", 1),
    "Yu 2024. <i>Updated title</i>. Journal.",
  );
  assert.equal(loads, 2);
  item.isRegularItem = () => false;
  reference.notifyDataChange({ fields: ["source"] });
  await assert.rejects(
    reference.getSourceReference("ITEM0001", 1),
    /source-item-required/,
  );
  item.isRegularItem = () => true;
  item.deleted = true;
  reference.notifyDataChange({ fields: ["source"] });
  await assert.rejects(
    reference.getSourceReference("ITEM0001", 1),
    /manager-source-missing/,
  );
  console.log(
    "PASS Source references use concise exported item fields, share cached loads and reject notes or missing items",
  );

  dom.window.eval(await readFile("addon/content/markdown.js", "utf8"));
  let completeOld;
  const api = {
    loc: (key) => key,
    getSourceReference: (key) =>
      key === "OLD"
        ? new Promise((resolve) => {
            completeOld = resolve;
          })
        : Promise.resolve("New <i>source</i>"),
    selectItem: async () => {},
  };
  const container = dom.window.document.getElementById("source");
  const old = dom.window.ZoteroKnowledgeBaseMarkdown.source(
    container,
    { key: "OLD", title: "Old", libraryID: 1 },
    api,
  );
  await dom.window.ZoteroKnowledgeBaseMarkdown.source(
    container,
    { key: "NEW", title: "New", libraryID: 1 },
    api,
  );
  completeOld("Old source");
  await old;
  assert.equal(container.textContent, "New source");
  assert.ok(container.querySelector("i"));
  const originalEmphasis = container.querySelector("i");
  await dom.window.ZoteroKnowledgeBaseMarkdown.source(
    container,
    { key: "NEW", title: "New", libraryID: 1 },
    api,
  );
  assert.equal(
    container.querySelector("i"),
    originalEmphasis,
    "An unchanged refresh must preserve the mouse-down target",
  );
  assert.equal(container.getAttribute("role"), "link");
  console.log("PASS Slow Source rendering cannot overwrite a newer source");
  const selected = [];
  let release;
  api.selectItem = (key, libraryID) => {
    selected.push([key, libraryID]);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  container.innerHTML = '<a href="https://example.com/doi">Citation</a>';
  const click = (detail) =>
    container.firstChild.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail,
      }),
    );
  click(1);
  click(2);
  await Promise.resolve();
  assert.deepEqual(selected, [["NEW", 1]]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dom.window.ZoteroKnowledgeBaseMarkdown.source(
    container,
    { key: "EARLY", title: "Early", libraryID: 1 },
    api,
  );
  container.click();
  await Promise.resolve();
  assert.deepEqual(selected[1], ["EARLY", 1]);
  release();
  console.log(
    "PASS Single Source click opens the item, ignores double-click repeats and works before formatting finishes",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
