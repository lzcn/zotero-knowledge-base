import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(
  await readFile("build/addon/manifest.json", "utf8"),
);
assert.equal(
  manifest.version,
  pkg.version,
  "Build version differs from release version",
);
assert.equal(manifest.name, pkg.config.addonName);
assert.equal(manifest.applications.zotero.id, pkg.config.addonID);
const bytes = await readFile("build/zettel-knowledge-base.xpi");
assert.equal(bytes.readUInt32LE(0), 0x04034b50, "XPI must be a ZIP archive");
const directory = `release/v${pkg.version}`;
const filename = `zettel-knowledge-base-${pkg.version}.xpi`;
await mkdir(directory, { recursive: true });
await copyFile("build/zettel-knowledge-base.xpi", `${directory}/${filename}`);
await copyFile("README.md", `${directory}/README.md`);
await copyFile("README.zh-CN.md", `${directory}/README.zh-CN.md`);
await mkdir(`${directory}/.github/badges`, { recursive: true });
for (const name of ["ai-assisted-chatgpt.svg", "ai-assisted-deepseek.svg"])
  await copyFile(
    `.github/badges/${name}`,
    `${directory}/.github/badges/${name}`,
  );
await copyFile("LICENSE", `${directory}/LICENSE`);
await writeFile(
  `${directory}/SHA256SUMS`,
  `${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`,
);
console.log(`Local release prepared: ${directory}/${filename}`);
