import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-pane-"));
const output = join(workspace, "pane.mjs");
const state = { cards: [], listeners: new Set(), errors: [], opens: [] };
globalThis.paneTest = state;
await build({
  entryPoints: ["src/modules/item-pane.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "pane-dependencies",
      setup(builder) {
        builder.onResolve(
          { filter: /(?:zettel|zotero|locale|events)$/ },
          (args) => ({
            path: args.path,
            namespace: "pane-test",
          }),
        );
        builder.onLoad({ filter: /.*/, namespace: "pane-test" }, (args) => ({
          contents: args.path.endsWith("zettel")
            ? `export async function listUnsourcedNotes(libraryID){ paneTest.unsourcedLibrary = libraryID; return paneTest.unsourcedCards; } export function getItemCountSync(){ return paneTest.cards.length; } export async function listByItem(key){ return paneTest.query ? paneTest.query(key) : paneTest.cards; }`
            : args.path.endsWith("zotero")
              ? `export function isPersonalKnowledgeItem(item){ return item.key === "PERSONAL"; }`
              : args.path.endsWith("locale")
                ? `export function getString(key, options){ return key + (options?.args?.count ?? ""); }`
                : `export function onDataChange(fn){ paneTest.listeners.add(fn); return () => paneTest.listeners.delete(fn); }`,
        }));
      },
    },
  ],
});
globalThis.Zotero = {
  ItemTreeManager: {
    registerColumn() {
      return "knowledge-base-count";
    },
    unregisterColumn() {},
  },
  ItemPaneManager: {
    unregisterSection(id) {
      state.removed = id;
    },
    registerSection(options) {
      state.section = options;
      return options.paneID;
    },
  },
  logError(error) {
    state.errors.push(error);
  },
};
globalThis.addon = {
  api: {
    async getHighlights() {
      throw new Error("Broken attachment");
    },
    async openLiteratureNote(key, libraryID) {
      state.literature = { key, libraryID };
    },
    openEditor(args) {
      state.opens.push(args);
    },
  },
};
const { registerItemPaneUI, unregisterItemPaneUI } = await import(
  pathToFileURL(output)
);
await registerItemPaneUI();
const dom = new JSDOM('<main><div id="body"></div></main>');
const body = dom.window.document.getElementById("body");
const item = (key) => ({ key, libraryID: 1, isRegularItem: () => true });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let count = 0;
function check(label, fn) {
  fn();
  count++;
  console.log(`PASS ${label}`);
}
state.cards = [{ id: "card-a", title: "A linked idea" }];
state.section.onRender({ body, item: item("A") });
await settle();
check(
  "The source pane shows cards without requesting or importing highlights",
  () => {
    assert.equal(body.querySelector("li").textContent, "A linked idea");
    assert.equal(body.querySelectorAll("button")[1].textContent, "section-new");
    assert.equal(body.querySelectorAll("button").length, 2);
    assert.equal(state.errors.length, 0);
  },
);
body.querySelector("button").click();
await settle();
check("The source pane opens its unique Literature Note", () =>
  assert.deepEqual(state.literature, { key: "A", libraryID: 1 }),
);
body.querySelector("li").click();
check("A source card opens its actual editor", () =>
  assert.deepEqual(state.opens[0], { zettelId: "card-a" }),
);
let refreshes = 0;
state.section.onInit({
  body,
  refresh: async () => {
    refreshes++;
    state.section.onRender({ body, item: item("A") });
  },
});
state.cards.push({ id: "card-b", title: "Newly saved card" });
for (const listener of state.listeners) listener();
await settle();
check("Saving refreshes the source's visible card list", () => {
  assert.equal(refreshes, 1);
  assert.equal(body.querySelectorAll("li").length, 2);
});
for (const listener of state.listeners)
  listener({
    all: false,
    cardIDs: ["elsewhere"],
    itemKeys: ["B"],
    fields: ["identity"],
  });
for (const listener of state.listeners)
  listener({
    all: false,
    cardIDs: ["card-a"],
    itemKeys: ["A"],
    fields: ["content"],
  });
await settle();
check(
  "Unrelated changes and body-only edits do not rebuild the source sidebar",
  () => assert.equal(refreshes, 1),
);
for (const listener of state.listeners)
  listener({
    all: false,
    cardIDs: ["card-a"],
    itemKeys: ["A"],
    fields: ["identity"],
  });
await settle();
check("A title change refreshes only the matching source sidebar", () =>
  assert.equal(refreshes, 2),
);
state.section.onDestroy({ body });
check("Closing the section removes its refresh listener", () =>
  assert.equal(state.listeners.size, 0),
);
let resolveA;
state.query = (key) =>
  key === "A"
    ? new Promise((resolve) => {
        resolveA = resolve;
      })
    : Promise.resolve([{ id: "b", title: "Source B" }]);
state.section.onRender({ body, item: item("A") });
state.section.onRender({ body, item: item("B") });
await settle();
resolveA([{ id: "a", title: "Stale source A" }]);
await settle();
check("A late source response cannot overwrite a newly selected source", () =>
  assert.equal(body.querySelector("li").textContent, "Source B"),
);
state.unsourcedCards = [{ id: "idea", title: "My project", kind: "thinking" }];
state.section.onRender({ body, item: item("PERSONAL") });
await settle();
check(
  "The personal parent shows unsourced notes without a Literature Note action",
  () => {
    assert.equal(state.unsourcedLibrary, 1);
    assert.equal(body.querySelector("li").textContent, "My project");
    assert.equal(body.querySelectorAll("button").length, 1);
  },
);
body.querySelector("button").click();
check("Creating a personal note leaves its literature source empty", () =>
  assert.deepEqual(state.opens.at(-1), { sourceItem: undefined }),
);
for (const language of ["en-US", "zh-CN"]) {
  const ftl = await readFile(`addon/locale/${language}/item-pane.ftl`, "utf8");
  check(
    `${language} labels do not replace native section or icon contents`,
    () => {
      assert.match(ftl, /pane-header =\s*\n\s+\.label = .+/);
      assert.match(ftl, /pane-sidenav =\s*\n\s+\.tooltiptext = .+/);
    },
  );
}
const registered = state.section;
await registerItemPaneUI();
check("Repeated registration keeps one current section", () => {
  assert.equal(state.section, registered);
  assert.equal(state.removed, undefined);
});
unregisterItemPaneUI();
check("Shutdown unregisters the actual section handle", () =>
  assert.equal(state.removed, state.section.paneID),
);
dom.window.close();
await rm(workspace, { recursive: true, force: true });
console.log(`OK - ${count} item pane checks`);
