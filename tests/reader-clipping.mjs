import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "knowledge-base-clip-"));
const output = join(dir, "clip.mjs");
await build({
  entryPoints: ["src/modules/reader-clipping.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  plugins: [
    {
      name: "host",
      setup(b) {
        b.onResolve({ filter: /utils\/locale$/ }, () => ({
          path: "locale",
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: "export const getString = key => key;",
        }));
      },
    },
  ],
});
const dom = new JSDOM("<div class='toolbar'></div><input>");
const pdf = new JSDOM("<div></div>");
dom.window.focus = () => {};
const copies = [],
  alerts = [],
  errors = [];
dom.window.document.execCommand = () => {
  const data = {
    flavors: {},
    setData(type, value) {
      this.flavors[type] = value;
    },
    mozSetDataAt(type, image) {
      this.image = image;
      assert.equal(type, "application/x-moz-nativeimage");
    },
  };
  const event = new dom.window.Event("copy", {
    cancelable: true,
    bubbles: true,
  });
  Object.defineProperty(event, "clipboardData", { value: data });
  dom.window.document.dispatchEvent(event);
  if (event.defaultPrevented) copies.push(data);
  return event.defaultPrevented;
};
const original = () => "native";
const png = "data:image/png;base64,aGVsbG8=";
const view = {
  _iframeWindow: pdf.window,
  initializedPromise: Promise.resolve(),
  _onAddAnnotation: original,
  _pdfRenderer: { _renderAnnotationImage: async () => png },
};
const internal = {
  _primaryView: view,
  _state: { tool: { type: "hand" } },
  setTool(tool) {
    this._state.tool = tool;
  },
};
const reader = {
  type: "pdf",
  itemID: 17,
  _initPromise: Promise.resolve(),
  _iframeWindow: dom.window,
  _window: dom.window,
  _internalReader: internal,
};
let handler;
const serialize = () => ({ html: "<p>keep</p>" });
globalThis.Zotero = {
  isMac: true,
  Reader: {
    _readers: [reader],
    registerEventListener(_type, fn) {
      handler = fn;
    },
    unregisterEventListener() {
      handler = undefined;
    },
  },
  EditorInstanceUtilities: { serializeAnnotations: serialize },
  getMainWindow: () => dom.window,
  Items: { getAsync: async () => ({ id: 17 }) },
  URI: { getItemURI: () => "http://zotero.org/users/local/items/TESTPDF" },
  logError: (e) => errors.push(e),
};
globalThis.Components = {
  classes: {
    "@mozilla.org/image/tools;1": {
      getService: () => ({ decodeImageFromArrayBuffer: () => png }),
    },
  },
  interfaces: { imgITools: {} },
  utils: { cloneInto: (x) => x, exportFunction: (x) => x },
};
globalThis.Services = { prompt: { alert: (...args) => alerts.push(args) } };
const clipping = await import(pathToFileURL(output).href);
const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (key = "X", target = pdf.window.document.body) =>
  target.dispatchEvent(
    new pdf.window.KeyboardEvent("keydown", {
      key,
      metaKey: key === "X",
      shiftKey: key === "X",
      bubbles: true,
      cancelable: true,
    }),
  );
const annotation = {
  type: "image",
  id: "TRANSIENT",
  position: { pageIndex: 2, rects: [[10, 10, 100, 80]] },
};
try {
  clipping.registerReaderClipping();
  clipping.registerReaderClipping();
  await tick();
  assert.equal(dom.window.document.querySelector("button"), null);
  assert.ok(handler);
  key();
  await tick();
  assert.equal(
    internal._state.tool.type,
    "image",
    "Capture required an open note",
  );
  assert.equal(view._onAddAnnotation({ type: "highlight" }), "native");
  view._onAddAnnotation(annotation);
  await tick();
  assert.equal(copies.length, 1);
  assert.equal(copies[0].image, png);
  assert.equal(
    JSON.parse(copies[0].flavors["zotero/annotation"])[0].attachmentItemID,
    17,
  );
  const img = new dom.window.DOMParser()
    .parseFromString(copies[0].flavors["text/html"], "text/html")
    .querySelector("img");
  const source = JSON.parse(decodeURIComponent(img.dataset.annotation));
  assert.deepEqual(source.position, annotation.position);
  assert.equal(
    source.attachmentURI,
    "http://zotero.org/users/local/items/TESTPDF",
  );
  assert.equal(source.id, undefined);
  assert.equal(view._onAddAnnotation, original);
  assert.equal(internal._state.tool.type, "hand");
  key();
  await tick();
  key("Escape");
  assert.equal(view._onAddAnnotation, original);
  const input = pdf.window.document.createElement("input");
  pdf.window.document.body.append(input);
  key("X", input);
  await tick();
  assert.equal(view._onAddAnnotation, original);
  let release;
  view._pdfRenderer._renderAnnotationImage = () =>
    new Promise((r) => {
      release = r;
    });
  key();
  await tick();
  view._onAddAnnotation(annotation);
  key("Escape");
  release(png);
  await tick();
  assert.equal(
    copies.length,
    1,
    "Escape did not cancel the pending clipboard write",
  );
  key();
  await tick();
  view._onAddAnnotation(annotation);
  clipping.unregisterReaderClipping();
  release(png);
  await tick();
  assert.equal(copies.length, 1, "Shutdown wrote to the clipboard");
  assert.equal(view._onAddAnnotation, original);
  assert.equal(
    globalThis.Zotero.EditorInstanceUtilities.serializeAnnotations,
    serialize,
  );
  key();
  await tick();
  assert.equal(view._onAddAnnotation, original);
  clipping.registerReaderClipping();
  await tick();
  view._pdfRenderer._renderAnnotationImage = async () => "invalid";
  key();
  await tick();
  view._onAddAnnotation(annotation);
  await tick();
  assert.equal(alerts.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(copies.length, 1);
  assert.equal(view._onAddAnnotation, original);
  view._pdfRenderer._renderAnnotationImage = async () => png;
  dom.window.document.execCommand = () => {
    throw new Error("Clipboard unavailable");
  };
  key();
  await tick();
  view._onAddAnnotation(annotation);
  await tick();
  assert.equal(alerts.length, 2);
  assert.equal(copies.length, 1);
  assert.equal(dom.window.document.querySelector("textarea"), null);
  key();
  await tick();
  dom.window.dispatchEvent(new dom.window.Event("unload"));
  assert.equal(view._onAddAnnotation, original);
  key();
  await tick();
  assert.equal(view._onAddAnnotation, original);
  console.log(
    "Reader clipping: clipboard PNG and provenance, no note required, cancellation and shutdown passed",
  );
} finally {
  clipping.unregisterReaderClipping();
  dom.window.close();
  pdf.window.close();
  await rm(dir, { recursive: true, force: true });
}
