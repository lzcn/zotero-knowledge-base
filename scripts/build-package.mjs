import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  writeFile,
  mkdir,
  rm,
  rename,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { buildOptions } from "./build-options.mjs";
import { validatePackage } from "./validate-package.mjs";
import { requiredFiles } from "./package-files.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const outputRoot = join(root, "dist");
const addonDirectory = join(root, "build", "addon");
const sourceCSS = await readFile(join(root, "addon/content/manager.css"));
const nativeEditor = await readFile(join(root, "src/ui/native-editor.ts"));
const styleVersion = `${pkg.version}-${createHash("sha256").update(sourceCSS).update(nativeEditor).digest("hex").slice(0, 12)}`;
const replacements = {
  ...pkg.config,
  buildVersion: pkg.version,
  description: pkg.description,
  author: pkg.author,
  styleVersion,
};
await rm(addonDirectory, { recursive: true, force: true });

async function copyAssets(relative = "") {
  const directory = join(root, "addon", relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = join(relative, entry.name);
    if (entry.isDirectory()) {
      await copyAssets(source);
      continue;
    }
    if (!entry.isFile()) continue;
    if (
      ["content/icons/icon.png", "content/icons/icon-256.png"].includes(source)
    )
      continue;
    const target = source.startsWith("locale/")
      ? join(dirname(source), `${pkg.config.addonRef}-${entry.name}`)
      : source;
    let bytes = await readFile(join(root, "addon", source));
    if (/\.(js|json|xhtml|html|css|ftl)$/.test(source)) {
      bytes = Buffer.from(
        bytes
          .toString("utf8")
          .replace(/__([a-zA-Z]+)__/g, (token, key) =>
            Object.hasOwn(replacements, key)
              ? String(replacements[key])
              : token,
          ),
      );
    }
    if (source.endsWith(".ftl")) {
      bytes = Buffer.from(
        bytes
          .toString("utf8")
          .replace(/^([a-zA-Z][\w-]*)(\s*=)/gm, `${pkg.config.addonRef}-$1$2`),
      );
    }
    const destination = join(addonDirectory, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}
await copyAssets();
for (const options of buildOptions(pkg, "production", addonDirectory)) {
  await build({ ...options, absWorkingDir: root });
}
assert.deepEqual(
  await readFile(join(addonDirectory, "content/manager.css")),
  sourceCSS,
);
for (const name of await readdir(join(addonDirectory, "content"))) {
  if (!name.endsWith(".xhtml")) continue;
  const text = await readFile(join(addonDirectory, "content", name), "utf8");
  if (!/<window[\s>]/.test(text)) continue;
  assert.ok(
    text.includes(`manager.css?v=${styleVersion}`),
    `${name}: missing stylesheet cache key`,
  );
}

const files = {};
async function collect(relative = "") {
  const entries = await readdir(join(addonDirectory, relative), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await collect(child);
    else if (entry.isFile())
      files[child] = await readFile(join(addonDirectory, child));
  }
}
await collect();
const bytes = zipSync(files, {
  level: 9,
  mtime: new Date("2020-01-01T00:00:00Z"),
});
validatePackage(bytes, pkg, requiredFiles);
await mkdir(outputRoot, { recursive: true });
const output = join(outputRoot, `${pkg.name}.xpi`);
await writeFile(`${output}.tmp`, bytes);
await rename(`${output}.tmp`, output);
await rm(join(outputRoot, "addon"), { recursive: true, force: true });
await rename(addonDirectory, join(outputRoot, "addon"));
console.log(`Built dist/${pkg.name}.xpi`);
