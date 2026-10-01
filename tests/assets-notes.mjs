import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), "knowledge-base-assets-"));
let rows = [];
globalThis.__cardBodies = () => rows.map((body) => ({ body }));
const entry = path.join(dir, "entry.ts");
await writeFile(
  entry,
  ["assets", "markdown"]
    .map(
      (name) =>
        `export * as ${name} from ${JSON.stringify(path.join(root, "src/modules", name + ".ts"))};`,
    )
    .join("\n"),
);
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: path.join(dir, "bundle.mjs"),
  plugins: [
    {
      name: "saved-card-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/db$/ }, () => ({
          path: "saved-cards",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const getAll = async () => globalThis.__cardBodies();",
          loader: "js",
        }));
      },
    },
  ],
});
const win = new JSDOM("").window;
globalThis.window = win;
globalThis.document = win.document;
const { assets, markdown } = await import(
  pathToFileURL(path.join(dir, "bundle.mjs"))
);
globalThis.PathUtils = { join: path.join, filename: path.basename };
globalThis.Services = {
  uuid: { generateUUID: () => ({ toString: () => `{${randomUUID()}}` }) },
};
globalThis.IOUtils = {
  exists: async (file) => {
    try {
      await access(file);
      return true;
    } catch {
      return false;
    }
  },
  makeDirectory: async (file) => mkdir(file, { recursive: true }),
  getChildren: async (file) =>
    (await readdir(file)).map((name) => path.join(file, name)),
  remove: async (file) => rm(file, { force: true }),
  write: writeFile,
  read: readFile,
};
const items = new Map();
globalThis.Zotero = {
  DataDirectory: { dir },
  logError: (error) => {
    throw error;
  },
  Items: {
    loadDataTypes: async () => {},
    getByLibraryAndKeyAsync: async (_library, key) => items.get(key) || false,
    getAsync: async (id) => items.get(id),
  },
};
let checks = 0;
function pass(label) {
  checks++;
  console.log(`PASS ${label}`);
}
const exists = async (url) =>
  IOUtils.exists(path.join(dir, "knowledge-base/assets", url.split(":")[1]));
try {
  const saved = await assets.importImage([1, 2, 3], "image/png", "saved");
  rows = [`![figure](${saved})`];
  await assets.releaseImageDraft("saved");
  assert.ok(await exists(saved));
  pass("Saved card references retain images in knowledge-base/assets");
  const draft = await assets.importImage([4], "image/png", "draft");
  await assets.cleanupUnusedImages();
  assert.ok(await exists(draft));
  assets.updateImageDraft("draft", `![figure](${draft})`);
  await assets.cleanupUnusedImages();
  assert.ok(await exists(draft));
  await assets.releaseImageDraft("draft");
  assert.equal(await exists(draft), false);
  pass(
    "Open drafts and pending imports survive cleanup; cancelled drafts release images",
  );
  rows = [`![one](${saved})`, `![shared](${saved})`];
  rows.shift();
  await assets.cleanupUnusedImages();
  assert.ok(await exists(saved));
  rows = [];
  await assets.cleanupUnusedImages();
  assert.equal(await exists(saved), false);
  pass(
    "A shared image is removed only after its final card reference disappears",
  );
  assert.deepEqual(
    [
      ...markdown.parseAssetNames(
        '`![example](knowledge-base-asset:code.png)`\n\n<img src="knowledge-base-asset:html.png">\n\n[image][a]\n\n[a]: knowledge-base-asset:ref.png',
      ),
    ].sort(),
    ["html.png", "ref.png"],
  );
  pass(
    "Asset references include HTML and reference links but exclude code examples",
  );
  await writeFile(path.join(dir, "knowledge-base/assets/README.txt"), "keep");
  await assets.cleanupUnusedImages();
  assert.equal(
    await readFile(path.join(dir, "knowledge-base/assets/README.txt"), "utf8"),
    "keep",
  );
  pass("Cleanup leaves unrelated files untouched");
  let unblock;
  const originalWrite = IOUtils.write;
  let started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  IOUtils.write = async (...args) => {
    started();
    await new Promise((resolve) => {
      unblock = resolve;
    });
    await originalWrite(...args);
  };
  const inflight = assets.importImage([7], "image/png", "closing");
  await start;
  await assets.releaseImageDraft("closing");
  unblock();
  await assert.rejects(inflight, /closed/);
  IOUtils.write = originalWrite;
  assert.deepEqual(await readdir(path.join(dir, "knowledge-base/assets")), [
    "README.txt",
  ]);
  pass("Closing an editor during an image write does not leave an orphan file");

  console.log(`OK - ${checks} asset cleanup checks`);
} finally {
  win.close();
  await rm(dir, { recursive: true, force: true });
  delete globalThis.__cardBodies;
}
