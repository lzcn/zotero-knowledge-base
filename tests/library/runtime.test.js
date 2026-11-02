const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { Buffer } = require("node:buffer");
const { spawn, execFileSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "knowledge-base-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const member = "sdk/lib/runtime.dylib";
  const library = Buffer.from("verified runtime library");
  await fs.mkdir(path.join(root, "source/sdk/lib"), { recursive: true });
  await fs.writeFile(path.join(root, "source", member), library);
  execFileSync("tar", [
    "-czf",
    path.join(root, "fixture.tgz"),
    "-C",
    path.join(root, "source"),
    member,
  ]);
  const archive = await fs.readFile(path.join(root, "fixture.tgz"));
  const dir = path.join(root, "runtime");
  await fs.mkdir(dir);
  let launches = 0;
  const subprocess = {
    async call({ command, arguments: args }) {
      launches++;
      const child = spawn(command, args);
      let output = "";
      child.stdout.on("data", (bytes) => {
        output += bytes;
      });
      child.stderr.on("data", (bytes) => {
        output += bytes;
      });
      const exit = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve({ exitCode: code }));
      });
      return {
        wait: () => exit,
        kill: () => {
          child.kill("SIGKILL");
          return exit;
        },
        stdout: {
          readString: async () => {
            await exit;
            return output;
          },
        },
      };
    },
  };
  const context = vm.createContext({
    SWIndexer: { _reportStatus() {} },
    Zotero: {
      logError() {},
      HTTP: { request: async () => ({ response: archive }) },
    },
    ChromeUtils: { importESModule: () => ({ Subprocess: subprocess }) },
    PathUtils: { parent: path.dirname, join: path.join },
    IOUtils: {
      createUniqueDirectory: (dir, prefix) =>
        fs.mkdtemp(path.join(dir, prefix)),
      write: fs.writeFile,
      remove: fs.rm,
      move: fs.rename,
      computeHexDigest: async (file) => sha256(await fs.readFile(file)),
    },
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    readFileSync(path.join(__dirname, "../../src/library/storage.js"), "utf8"),
    context,
  );
  vm.runInContext(
    readFileSync(path.join(__dirname, "../../src/library/semantic.js"), "utf8"),
    context,
  );
  const semantic = context.SWSemantic;
  semantic._enabled = true;
  semantic._checksum = async (bytes) => sha256(bytes);
  const asset = {
    url: "https://example.test/runtime.tgz",
    sha256: sha256(archive),
    member,
  };
  const destination = path.join(dir, "runtime.dylib");
  const prepare = (checksum = sha256(library)) =>
    semantic._downloadRuntime(
      asset,
      destination,
      checksum,
      semantic._generation,
    );
  return {
    semantic,
    context,
    subprocess,
    dir,
    destination,
    library,
    prepare,
    launches: () => launches,
  };
}

const macOnly = { skip: process.platform !== "darwin" };

test(
  "runtime preparation verifies and installs only the library, removing its archive",
  macOnly,
  async (t) => {
    const h = await fixture(t);
    await h.prepare();
    assert.deepEqual(await fs.readFile(h.destination), h.library);
    assert.deepEqual(await fs.readdir(h.dir), ["runtime.dylib"]);
    assert.equal(h.semantic._downloads.size, 0);
    assert.equal(h.semantic._extracting, null);
  },
);

test(
  "corrupt downloads never reach extraction or replace an existing cache",
  macOnly,
  async (t) => {
    const h = await fixture(t);
    await fs.writeFile(h.destination, "old library");
    h.context.Zotero.HTTP.request = async () => ({
      response: Buffer.from("corrupt"),
    });
    await assert.rejects(h.prepare(), /archive checksum mismatch/);
    assert.equal(h.launches(), 0);
    assert.equal(await fs.readFile(h.destination, "utf8"), "old library");
    assert.deepEqual(await fs.readdir(h.dir), ["runtime.dylib"]);
  },
);

test(
  "an extracted library must match its own checksum before becoming usable",
  macOnly,
  async (t) => {
    const h = await fixture(t);
    await assert.rejects(
      h.prepare("0".repeat(64)),
      /library checksum mismatch/,
    );
    assert.deepEqual(await fs.readdir(h.dir), []);
  },
);

test(
  "pausing aborts an in-flight runtime download and removes staging files",
  macOnly,
  async (t) => {
    const h = await fixture(t);
    let observed;
    const started = new Promise((resolve) => {
      observed = resolve;
    });
    h.context.Zotero.HTTP.request = (_method, _url, options) =>
      new Promise((_resolve, reject) => {
        options.requestObserver({ abort: () => reject(new Error("aborted")) });
        observed();
      });
    const preparing = h.prepare();
    const rejected = assert.rejects(preparing, /aborted/);
    await started;
    h.semantic.pause();
    await rejected;
    assert.deepEqual(await fs.readdir(h.dir), []);
    assert.equal(h.semantic._downloads.size, 0);
  },
);

test(
  "shutdown while the archive process is launching kills it and prevents installation",
  macOnly,
  async (t) => {
    const h = await fixture(t);
    let launched, release;
    const started = new Promise((resolve) => {
      launched = resolve;
    });
    let killed = 0;
    h.subprocess.call = async () => {
      launched();
      return new Promise((resolve) => {
        release = () =>
          resolve({
            kill: async () => {
              killed++;
            },
          });
      });
    };
    const preparing = h.prepare();
    const rejected = assert.rejects(preparing, /cancelled/);
    await started;
    h.semantic.stop();
    release();
    await rejected;
    assert.equal(killed, 1);
    assert.deepEqual(await fs.readdir(h.dir), []);
  },
);
