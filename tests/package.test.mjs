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
    /registerExistingNote|seedMappedNote|kb-adopt-existing|reviewed-plan\.json|\/Users\/zhi\//,
  );
  assert.equal(
    Object.keys(files).some((name) => /^(?:scripts|tests|src)\//.test(name)),
    false,
  );
});
