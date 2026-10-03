// Keep this entry point self-contained for each independent repository.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!["--force", "--check"].includes(arg)) {
    throw new Error(`Unknown build argument: ${arg}`);
  }
}
const stateFile = join(root, "build", "state.json");
const output = join(root, "dist", `${pkg.name}.xpi`);

function fingerprint(paths, metadataOnly = false) {
  const hash = createHash("sha256");
  function visit(path, ancestry = new Set()) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      hash.update(JSON.stringify([path, "missing"]));
      return;
    }
    const info = lstatSync(absolute, { bigint: true });
    if (info.isSymbolicLink()) {
      hash.update(JSON.stringify([path, "link", readlinkSync(absolute)]));
    }
    const target = info.isSymbolicLink()
      ? statSync(absolute, { bigint: true })
      : info;
    if (target.isDirectory()) {
      const real = realpathSync(absolute);
      if (ancestry.has(real))
        throw new Error(`Circular directory link: ${path}`);
      const next = new Set(ancestry).add(real);
      hash.update(JSON.stringify([path, "directory"]));
      for (const entry of readdirSync(absolute).sort()) {
        if (entry === ".DS_Store") continue;
        visit(join(path, entry), next);
      }
    } else if (target.isFile()) {
      const signature = metadataOnly
        ? [String(target.size), String(target.mtimeNs), String(target.ctimeNs)]
        : createHash("sha256").update(readFileSync(absolute)).digest("hex");
      hash.update(JSON.stringify([path, String(target.mode), signature]));
    }
  }
  for (const path of paths.sort()) visit(path);
  return hash.digest("hex");
}

function inputs() {
  const paths = [
    "src",
    "addon",
    "content",
    "icons",
    "locale",
    "ml",
    "data",
    "licenses",
    "types",
    "typings",
    "scripts",
    "package.json",
    "package-lock.json",
    "manifest.json",
    "bootstrap.js",
    "prefs.js",
    "LICENSE",
    "THIRD-PARTY-NOTICES",
    ...readdirSync(root).filter((name) => /^tsconfig.*\.json$/.test(name)),
  ];
  return JSON.stringify({
    source: fingerprint(paths),
    // Check dependency file metadata without rereading large WASM runtimes.
    dependencies: fingerprint(["node_modules"], true),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });
}

function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const before = inputs();
let previous;
try {
  previous = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {
  // A missing or corrupt cache requires a rebuild.
}
const fresh =
  !args.has("--force") &&
  previous?.input === before &&
  existsSync(output) &&
  previous.output === fingerprint(["dist"]);

if (fresh && !args.has("--check")) {
  console.log(`Up to date: dist/${pkg.name}.xpi; build skipped.`);
} else {
  // Invalidate cached success before any step that can fail.
  rmSync(stateFile, { force: true });
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, "run", "typecheck"]);
  } else {
    run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "typecheck"]);
  }
  if (!fresh)
    run(process.execPath, [join(root, "scripts", "build-package.mjs")]);
  if (!existsSync(output))
    throw new Error(`Build did not produce output: ${output}`);
  const after = inputs();
  if (after !== before)
    throw new Error("Inputs changed during the build; run the build again.");
  mkdirSync(dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ input: after, output: fingerprint(["dist"]) }) + "\n",
  );
  renameSync(temporary, stateFile);
  if (fresh) console.log(`Checks passed; reusing dist/${pkg.name}.xpi.`);
}
