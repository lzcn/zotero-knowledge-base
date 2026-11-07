import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "knowledge-base-math-"));
const output = join(dir, "preview.mjs");
await build({
  entryPoints: ["src/modules/note-preview.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
});
const {
  renderPreviewMath,
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
  assert.deepEqual(errors, []);
  console.log(
    "PASS Native card MathML, fractions, literal code, safe text, updates, new rows and cleanup",
  );
} finally {
  stop();
  dom.window.close();
  await rm(dir, { recursive: true, force: true });
}
