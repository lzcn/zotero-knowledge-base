import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "knowledge-base-math-"));
const output = join(dir, "preview.mjs");
const entry = join(dir, "entry.mjs");
await writeFile(
  entry,
  `export * from ${JSON.stringify(join(process.cwd(), "src/modules/note-preview.ts"))};\nexport * from ${JSON.stringify(join(process.cwd(), "src/modules/reader-math.ts"))};`,
);
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
});
const {
  renderPreviewMath,
  attachReaderMath,
  attachNotePreviews,
  previewCodeRanges,
  completePreviewMath,
} = await import(pathToFileURL(output).href);
const dom = new JSDOM("<div></div>");
const doc = dom.window.document;
const field = doc.querySelector("div");
const source = String.raw`$r$ Takeaway, $\frac{a_1}{b^2}$ and \(x_i\). <img src=x onerror=evil()>`;
field.textContent = source;
assert.equal(renderPreviewMath(field), true);
assert.equal(field.querySelectorAll("math").length, 3);
assert.equal(field.querySelector("img"), null);
assert.equal(field.querySelectorAll("math mfrac").length, 1);
assert.match(field.textContent, /<img src=x onerror=evil\(\)>/);
field.textContent = String.raw`Cost $5 and $10, literal \$r, code $x$ and prose $y$.`;
renderPreviewMath(field, [
  {
    from: field.textContent.indexOf("$x$"),
    to: field.textContent.indexOf("$x$") + 3,
  },
]);
assert.equal(field.querySelectorAll("math").length, 1);
assert.ok(field.textContent.includes("code $x$"));
const mixed = new JSDOM("<p>Prose $x$ and code <code>$x$</code>.</p>").window
  .document;
field.textContent = "Prose $x$ and code $x$.";
renderPreviewMath(field, previewCodeRanges(mixed, field.textContent));
assert.equal(field.querySelectorAll("math").length, 1);
assert.ok(field.textContent.endsWith("code $x$."));
const longFormula = "\\frac{" + "a_1+".repeat(120) + "a_n}{b}";
const longDoc = new JSDOM("<p>Risk $" + longFormula + "$ after.</p>").window
  .document;
const partial = (longDoc.body.textContent || "").slice(0, 200);
const complete = completePreviewMath(longDoc, partial);
assert.ok(complete.includes(longFormula));
field.textContent = complete;
renderPreviewMath(field);
assert.equal(field.querySelectorAll("math").length, 1);
assert.equal(
  completePreviewMath(
    new JSDOM("<pre>$unfinished</pre>").window.document,
    "$unfin",
  ),
  "$unfin",
);
const errors = [];
let previewEnabled = true,
  preferenceChanged;
globalThis.Zotero = {
  getMainWindow: () => dom.window,
  Prefs: {
    get: () => previewEnabled,
    registerObserver: (_key, callback) => {
      preferenceChanged = callback;
      return 1;
    },
    unregisterObserver: () => {},
  },
  Items: {
    get: () => ({
      isNote: () => true,
      getNote: () => "<h1>Math</h1><p>$r$ Takeaway; <code>$literal$</code></p>",
    }),
  },
  logError: (e) => errors.push(e),
};
const row = doc.createElement("note-row");
row.note = { id: 10, parentItemType: "journalArticle" };
row.innerHTML =
  '<div class="parent-title">Paper</div><div class="note-title">Math $x^2$</div><div class="note-content">$r$ Takeaway; $literal$</div>';
doc.body.append(row);
const tick = () => new Promise((r) => setTimeout(r, 0));
const stop = attachNotePreviews(dom.window);
try {
  await tick();
  assert.equal(row.querySelectorAll("math").length, 2);
  previewEnabled = false;
  preferenceChanged();
  await tick();
  assert.equal(row.querySelectorAll("math").length, 0);
  previewEnabled = true;
  preferenceChanged();
  await tick();
  assert.equal(row.querySelectorAll("math").length, 2);
  assert.equal(row.querySelector(".parent-title").textContent, "Paper");
  const content = row.querySelector(".note-content");
  assert.ok(content.textContent.includes("$literal$"));
  content.textContent = "$z$ refreshed";
  await tick();
  assert.equal(content.querySelectorAll("math").length, 1);
  content.textContent = "$unfinished and price $5";
  await tick();
  assert.equal(content.querySelector("math"), null);
  assert.equal(content.textContent, "$unfinished and price $5");
  content.textContent = "$z$ refreshed";
  await tick();
  const added = row.cloneNode(true);
  added.note = row.note;
  added.querySelector(".note-content").textContent = "$a$ added";
  doc.body.append(added);
  await tick();
  assert.equal(added.querySelector(".note-content math").localName, "math");
  stop();
  assert.equal(row.querySelectorAll("math").length, 0);
  assert.equal(content.textContent, "$z$ refreshed");
  assert.equal(row.querySelector(".note-title").textContent, "Math $x^2$");
  content.textContent = "$q$ after shutdown";
  await tick();
  assert.equal(content.querySelector("math"), null);
  const popup = doc.createElement("div");
  popup.className = "annotation-popup";
  popup.innerHTML =
    '<div class="comment"><div class="editor"><div id="annotation-1" class="content" contenteditable="true" tabindex="-1" role="textbox"><b>Positive</b> $(T_i, I_i)$ and <i>negative</i> $\\frac{a}{b}$. <code>$literal$</code></div><div class="renderer"></div></div></div>';
  doc.body.append(popup);
  const original = popup.querySelector(".content");
  const originalHTML = original.innerHTML;
  let inputs = 0;
  original.addEventListener("input", () => inputs++);
  const stopReader = attachReaderMath(doc);
  await tick();
  let preview = popup.querySelector(".knowledge-base-annotation-preview");
  assert.equal(preview.querySelectorAll("math").length, 2);
  assert.equal(preview.querySelector("b").textContent, "Positive");
  assert.equal(preview.querySelector("code").textContent, "$literal$");
  assert.equal(preview.id, "");
  assert.equal(original.innerHTML, originalHTML);
  const nativePointer = (event) => {
    if (!event.target.closest('[contenteditable="true"]'))
      event.preventDefault();
  };
  const nativeFocus = (event) => {
    if (!event.target.closest(".annotation-popup")) popup.remove();
  };
  dom.window.addEventListener("pointerdown", nativePointer);
  dom.window.addEventListener("focusin", nativeFocus);
  preview.dispatchEvent(
    new dom.window.MouseEvent("pointerdown", {
      button: 2,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(
    popup.querySelector(".knowledge-base-annotation-preview"),
    preview,
  );
  const pointerAllowed = preview.querySelector("math").dispatchEvent(
    new dom.window.MouseEvent("pointerdown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  if (pointerAllowed)
    preview.dispatchEvent(
      new dom.window.MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  await tick();
  assert.equal(doc.activeElement, original);
  assert.equal(popup.isConnected, true);
  assert.equal(popup.querySelector(".knowledge-base-annotation-preview"), null);
  original.textContent = "Updated $x^2$";
  original.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await tick();
  assert.equal(popup.querySelector("math"), null);
  original.blur();
  await tick();
  assert.equal(popup.querySelectorAll("math").length, 1);
  assert.equal(original.textContent, "Updated $x^2$");
  previewEnabled = false;
  preferenceChanged();
  await tick();
  assert.equal(popup.querySelector(".knowledge-base-annotation-preview"), null);
  previewEnabled = true;
  preferenceChanged();
  await tick();
  preview = popup.querySelector(".knowledge-base-annotation-preview");
  preview.focus();
  await tick();
  assert.equal(doc.activeElement, original);
  assert.equal(popup.isConnected, true);
  assert.equal(popup.querySelector("math"), null);
  original.blur();
  await tick();
  original.textContent = "Price $5 and unfinished $x";
  await tick();
  assert.equal(popup.querySelector("math"), null);
  original.textContent = "Reopened $z$";
  await tick();
  assert.equal(popup.querySelectorAll("math").length, 1);
  dom.window.removeEventListener("pointerdown", nativePointer);
  dom.window.removeEventListener("focusin", nativeFocus);
  stopReader();
  assert.equal(popup.querySelector("math"), null);
  assert.equal(original.textContent, "Reopened $z$");
  assert.equal(inputs, 1);
  assert.equal(popup.querySelector(".knowledge-base-math-preview"), null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Native card MathML, fractions, literal code, safe text, updates, new rows and cleanup",
  );
} finally {
  stop();
  dom.window.close();
  await rm(dir, { recursive: true, force: true });
}
