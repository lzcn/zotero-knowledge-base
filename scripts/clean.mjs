// Remove generated development output without discarding downloaded tools or research data.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

if (process.argv.length > 2) throw new Error("clean does not accept arguments");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const name of ["dist", "build/state.json", "build/native"])
  rmSync(join(root, name), { recursive: true, force: true });
for (const [directory, temporary] of [
  ["build", /^state\.json\.\d+\.tmp$/],
  ["build/native-sdk", /^(sdk\.tgz\.\d+\.tmp|extract-[a-zA-Z0-9]{6})$/],
])
  if (existsSync(join(root, directory)))
    for (const name of readdirSync(join(root, directory)))
      if (temporary.test(name))
        rmSync(join(root, directory, name), { recursive: true, force: true });

const workspace = dirname(root);
if (
  existsSync(join(workspace, "scripts/workspace.mjs")) &&
  JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")).name ===
    "zotero-plugins"
)
  rmSync(join(workspace, `${pkg.name}.xpi`), { force: true });
console.log(
  "Cleaned build output. Downloaded tools and research data retained.",
);
