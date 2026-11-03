const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { tmpdir } = require("node:os");
const vm = require("node:vm");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "knowledge-base-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const context = vm.createContext({
    Zotero: { DataDirectory: { dir: root } },
    PathUtils: { join: path.join, parent: path.dirname },
    IOUtils: {
      exists: async (file) =>
        fs.access(file).then(
          () => true,
          () => false,
        ),
      makeDirectory: (file, options) =>
        fs.mkdir(file, {
          recursive: !!(options.createAncestors || options.ignoreExisting),
        }),
      move: async (source, target) => {
        await assert.rejects(fs.access(target));
        await fs.rename(source, target);
      },
    },
  });
  vm.runInContext(
    readFileSync(path.join(__dirname, "../../src/library/storage.js"), "utf8"),
    context,
  );
  const storage = context.SWStorage;
  const old = path.join(storage.model(), "coreml-cache");
  await fs.mkdir(path.join(old, "compiled-model"), { recursive: true });
  await fs.writeFile(path.join(old, "compiled-model/data"), "compiled");
  await fs.writeFile(storage.notes(), "notes");
  await fs.writeFile(path.join(storage.model(), "model.onnx"), "weights");
  return { storage, old, context };
}

test("compiled models move into rebuildable cache and remain reusable on repeated preparation", async (t) => {
  const f = await fixture(t);
  const cache = await f.storage.prepareCompiledModel();
  assert.equal(
    await fs.readFile(path.join(cache, "compiled-model/data"), "utf8"),
    "compiled",
  );
  await assert.rejects(fs.access(f.old));
  assert.equal(await f.storage.prepareCompiledModel(), cache);
  assert.equal(await fs.readFile(f.storage.notes(), "utf8"), "notes");
  assert.equal(
    await fs.readFile(path.join(f.storage.model(), "model.onnx"), "utf8"),
    "weights",
  );
});

test("an existing destination is never replaced and cancelled preparation leaves files untouched", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.storage.prepareCompiledModel(() => false),
    /cancelled/,
  );
  assert.equal(
    await fs.readFile(path.join(f.old, "compiled-model/data"), "utf8"),
    "compiled",
  );
  await fs.mkdir(f.storage.compiledModel(), { recursive: true });
  await fs.writeFile(path.join(f.storage.compiledModel(), "keep"), "existing");
  await f.storage.prepareCompiledModel();
  assert.equal(
    await fs.readFile(path.join(f.storage.compiledModel(), "keep"), "utf8"),
    "existing",
  );
  assert.equal(
    await fs.readFile(path.join(f.old, "compiled-model/data"), "utf8"),
    "compiled",
  );
});

test("index relocation preserves database, WAL, shared memory and status together before opening", async (t) => {
  const f = await fixture(t);
  const previous = path.join(f.storage.root(), "cache", "related-papers");
  await fs.mkdir(previous, { recursive: true });
  const files = [
    "similarity.sqlite",
    "similarity.sqlite-wal",
    "similarity.sqlite-shm",
    "index-status.json",
  ];
  for (const file of files) await fs.writeFile(path.join(previous, file), file);
  const next = await f.storage.prepareCache();
  assert.equal(next, path.join(f.storage.root(), "cache", "similar-items"));
  await assert.rejects(fs.access(previous));
  for (const file of files)
    assert.equal(await fs.readFile(path.join(next, file), "utf8"), file);
  assert.equal(await f.storage.prepareCache(), next);
  assert.equal(await fs.readFile(f.storage.notes(), "utf8"), "notes");
});

test("index relocation never overwrites an existing cache or moves files after cancellation", async (t) => {
  const f = await fixture(t);
  const previous = path.join(f.storage.root(), "cache", "related-papers");
  await fs.mkdir(previous, { recursive: true });
  await fs.writeFile(path.join(previous, "similarity.sqlite"), "previous");
  await assert.rejects(
    f.storage.prepareCache(() => false),
    /cancelled/,
  );
  await fs.mkdir(f.storage.cache(), { recursive: true });
  await fs.writeFile(
    path.join(f.storage.cache(), "similarity.sqlite"),
    "current",
  );
  await f.storage.prepareCache();
  assert.equal(
    await fs.readFile(path.join(previous, "similarity.sqlite"), "utf8"),
    "previous",
  );
  assert.equal(
    await fs.readFile(
      path.join(f.storage.cache(), "similarity.sqlite"),
      "utf8",
    ),
    "current",
  );
});
