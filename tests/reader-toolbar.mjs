import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-reader-"));
const output = join(workspace, "reader.mjs");
await build({
  entryPoints: ["src/modules/reader-toolbar.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  plugins: [
    {
      name: "locale",
      setup(builder) {
        builder.onResolve({ filter: /utils\/locale$/ }, () => ({
          path: "locale",
          namespace: "reader-test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "reader-test" }, () => ({
          contents: "export const getString = () => readerTest.label;",
        }));
      },
    },
  ],
});
const windows = [];
function document() {
  const dom = new JSDOM(
    '<div class="toolbar"><div class="end"><div class="custom-sections"></div></div></div>',
  );
  windows.push(dom.window);
  return dom.window.document;
}
const first = document();
const second = document();
const listeners = new Map();
let opened = 0;
globalThis.readerTest = { label: "Knowledge Base" };
globalThis.addon = { api: { openManager: () => opened++ } };
globalThis.Zotero = {
  File: {
    getContentsFromURL: () =>
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" /></svg>',
  },
  Reader: {
    _readers: [
      { _iframeWindow: first.defaultView },
      { _iframeWindow: second.defaultView },
      {},
    ],
    registerEventListener(type, handler, pluginID) {
      assert.equal(type, "renderToolbar");
      assert.equal(pluginID, "knowledge-base@lzcn");
      assert.equal(listeners.size, 0);
      listeners.set(type, handler);
    },
    unregisterEventListener(type, handler) {
      assert.equal(listeners.get(type), handler);
      listeners.delete(type);
    },
  },
};
const { registerReaderToolbar, unregisterReaderToolbar } = await import(
  pathToFileURL(output).href
);
function button(doc) {
  return doc.getElementById("knowledge-base-reader-button");
}
function render(doc, clear = true) {
  const target = doc.querySelector(".custom-sections");
  if (clear) target.replaceChildren();
  listeners.get("renderToolbar")({
    doc,
    append(node) {
      const section = doc.createElement("div");
      section.className = "section";
      section.append(node);
      target.append(section);
    },
  });
}
try {
  registerReaderToolbar();
  registerReaderToolbar();
  assert.equal(listeners.size, 1);
  for (const doc of [first, second]) {
    assert.ok(button(doc).closest(".toolbar .custom-sections"));
    assert.equal(button(doc).className, "toolbar-button");
    assert.equal(button(doc).getAttribute("aria-label"), "Knowledge Base");
    assert.equal(button(doc).querySelector("img").width, 20);
    assert.match(
      button(doc).querySelector("img").src,
      /^data:image\/svg\+xml,/,
    );
  }
  button(first).click();
  assert.equal(opened, 1);
  const old = button(first);
  render(first);
  old.click();
  assert.equal(opened, 1, "A replaced toolbar button kept its click handler");
  render(first, false);
  assert.equal(
    first.querySelectorAll("#knowledge-base-reader-button").length,
    1,
  );
  assert.equal(first.querySelectorAll(".section").length, 1);
  const third = document();
  globalThis.readerTest.label = "知识库";
  render(third);
  assert.equal(button(third).title, "知识库");
  button(third).click();
  assert.equal(opened, 2);
  const closing = button(third);
  third.defaultView.dispatchEvent(new third.defaultView.Event("unload"));
  assert.equal(closing.isConnected, false);
  assert.equal(third.querySelector(".custom-sections").childElementCount, 0);
  const late = listeners.get("renderToolbar");
  unregisterReaderToolbar();
  unregisterReaderToolbar();
  assert.equal(listeners.size, 0);
  assert.equal(button(first), null);
  assert.equal(button(second), null);
  assert.equal(first.querySelector(".custom-sections").childElementCount, 0);
  late({
    doc: third,
    append() {
      assert.fail("A late reader event added UI after shutdown");
    },
  });
  registerReaderToolbar();
  assert.equal(
    first.querySelectorAll("#knowledge-base-reader-button").length,
    1,
  );
  assert.equal(listeners.size, 1);
  unregisterReaderToolbar();
  console.log(
    "PASS Existing and new reader toolbars, duplicate registration, native labels and icons, replaced handlers, close cleanup, late events and re-enabling.",
  );
} finally {
  unregisterReaderToolbar();
  for (const win of windows) win.close();
  delete globalThis.Zotero;
  delete globalThis.addon;
  delete globalThis.readerTest;
  await rm(workspace, { recursive: true, force: true });
}
