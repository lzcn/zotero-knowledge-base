import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validatePackage } from "../scripts/validate-package.mjs";
const pkg = {
  name: "zotero-test",
  version: "0.1.0",
  author: "Zhi Lu",
  config: { addonRef: "test", addonName: "Test", addonID: "test@lzcn" },
};
function archive(change = {}) {
  const manifest = {
    name: "Test",
    version: "0.1.0",
    author: "Zhi Lu",
    applications: {
      zotero: {
        id: "test@lzcn",
        update_url:
          "https://github.com/lzcn/zotero-test/releases/latest/download/updates.json",
      },
    },
    icons: { 48: "icon-48.png", 96: "icon-96.png" },
  };
  const files = {
    "manifest.json": JSON.stringify(manifest),
    "bootstrap.js": "function startup() {}",
    "icon-48.png": "image",
    "icon-96.png": "image",
    "content/editor.xhtml":
      '<window><script src="chrome://test/content/editor.js" /></window>',
    "content/editor.js": "const enabled = true;",
  };
  for (const [name, value] of Object.entries(change)) {
    if (value === null) delete files[name];
    else files[name] = value;
  }
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
    ),
  );
}
test("checks actual archive metadata and all referenced assets", () => {
  assert.equal(validatePackage(archive(), pkg).manifest.version, pkg.version);
  assert.throws(
    () => validatePackage(archive({ "content/editor.js": null }), pkg),
    /missing asset/,
  );
  assert.throws(
    () => validatePackage(archive({ "icon-48.png": null }), pkg),
    /Missing package file/,
  );
  assert.throws(
    () =>
      validatePackage(
        archive({ "content/editor.js": "const label = '__addonName__';" }),
        pkg,
      ),
    /Unresolved template/,
  );
  assert.throws(
    () => validatePackage(archive({ "content/editor.js": "function (" }), pkg),
    SyntaxError,
  );
  assert.throws(
    () => validatePackage(archive(), { ...pkg, version: "0.2.0" }),
    /version mismatch/,
  );
  assert.throws(
    () => validatePackage(archive({ "../escape.js": "const value = 1;" }), pkg),
    /Unsafe archive path/,
  );
});

test("rejects untranslated locale identifiers in the shipped archive", () => {
  assert.throws(
    () =>
      validatePackage(
        archive({ "locale/en-US/test-addon.ftl": "manager-edit = Edit" }),
        pkg,
      ),
    /missing locale namespace/,
  );
  assert.doesNotThrow(() =>
    validatePackage(
      archive({ "locale/en-US/test-addon.ftl": "test-manager-edit = Edit" }),
      pkg,
    ),
  );
});

test("production package excludes personal library maintenance and test fixtures", async () => {
  const files = unzipSync(
    await readFile(
      new URL("../dist/zotero-knowledge-base.xpi", import.meta.url),
    ),
  );
  const main = strFromU8(files["content/scripts/knowledge-base.js"]);
  assert.doesNotMatch(
    main,
    /registerExistingNote|seedMappedNote|knowledge-base-adopt-existing|reviewed-plan\.json|\/Users\/zhi\/|openPaperReading|generatePaperReading|testCodex/,
  );
  assert.equal(
    Object.keys(files).some((name) => /^(?:scripts|tests|src)\//.test(name)),
    false,
  );
});

test("production package excludes retired AI and lexical suggestions", async () => {
  const files = unzipSync(
    await readFile(
      new URL("../dist/zotero-knowledge-base.xpi", import.meta.url),
    ),
  );
  assert.equal(
    Object.keys(files).some((name) =>
      /ai-preferences|ai-settings|paper-reading|codex|^content\/connections\.js$/i.test(
        name,
      ),
    ),
    false,
  );
  const main = strFromU8(files["content/scripts/knowledge-base.js"]);
  assert.doesNotMatch(
    main,
    /findRelatedNotes|cancelRelatedNotes|getAISettings|setAISettings|testAIConnection|isAIEnabled|ai-preferences|Subprocess\.sys\.mjs|api\.deepseek\.com|opencode\.ai\/inference/,
  );
  assert.doesNotMatch(strFromU8(files["prefs.js"]), /knowledge-base\.ai\./);
  assert.doesNotMatch(
    strFromU8(files["content/preferences.xhtml"]),
    /knowledge-base-ai-/,
  );
  assert.doesNotMatch(
    strFromU8(files["content/editor.xhtml"]),
    /knowledge-base-related-notes|knowledge-base-connections/,
  );
});

test("library retrieval is owned by Knowledge Base and ships assets without model weights or developer files", async () => {
  const files = unzipSync(
    await readFile(
      new URL("../dist/zotero-knowledge-base.xpi", import.meta.url),
    ),
  );
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.applications.zotero.id, "knowledge-base@lzcn");
  assert.equal(manifest.applications.zotero.strict_min_version, "10.0");
  assert.ok(files["content/library/scripts/storage.js"]);
  assert.ok(files["content/library/runtime/worker.js"]);
  assert.ok(files["locale/zh-CN/similar-works.ftl"]);
  assert.match(
    strFromU8(files["prefs.js"]),
    /extensions\.zotero\.similar-works\.maxRecommendations/,
  );
  assert.match(
    strFromU8(files["content/scripts/knowledge-base.js"]),
    /common-preferences\.js/,
  );
  for (const name of Object.keys(files)) {
    assert.ok(!/^(tests|scripts|src)\//.test(name), name);
    assert.ok(!/\.(onnx|mm|sqlite|dylib)$/.test(name), name);
  }
  assert.ok(!files["content/library/scripts/graph.js"]);
  assert.ok(!files["content/library/graph.xhtml"]);
});
