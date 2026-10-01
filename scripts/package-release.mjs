import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePackage } from "./validate-package.mjs";
import { requiredFiles } from "./package-files.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const source = join(root, "dist", `${pkg.name}.xpi`);
const bytes = await readFile(source);
const { manifest } = validatePackage(bytes, pkg, requiredFiles);
const directory = join(root, "release", `v${pkg.version}`);
const filename = `${pkg.name}-${pkg.version}.xpi`;
const checksum = createHash("sha256").update(bytes).digest("hex");
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await copyFile(source, join(directory, filename));
for (const name of ["README.md", "README.zh-CN.md", "LICENSE"]) {
  await copyFile(join(root, name), join(directory, name));
}
await writeFile(join(directory, "SHA256SUMS"), `${checksum}  ${filename}\n`);
const updates = {
  addons: {
    [pkg.config.addonID]: {
      updates: [
        {
          version: pkg.version,
          update_link: `https://github.com/lzcn/${pkg.name}/releases/download/v${pkg.version}/${filename}`,
          update_hash: `sha256:${checksum}`,
          applications: {
            zotero: {
              strict_min_version:
                manifest.applications.zotero.strict_min_version,
              strict_max_version:
                manifest.applications.zotero.strict_max_version,
            },
          },
        },
      ],
    },
  },
};
await writeFile(
  join(directory, "updates.json"),
  JSON.stringify(updates, null, 2) + "\n",
);
console.log(`Local release prepared: release/v${pkg.version}/${filename}`);
