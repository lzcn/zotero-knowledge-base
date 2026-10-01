// Use the scaffold API so building local sources needs no npm registry access.
import { Build, Config } from "zotero-plugin-scaffold";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

process.env.NODE_ENV = "production";
await new Build(await Config.loadConfig({})).run();

// Check the emitted assets, not just source templates: missing substitution would
// silently reuse a cached stylesheet in Zotero after the next plugin update.
const sourceCSS = await readFile("addon/content/manager.css");
const emittedCSS = await readFile("build/addon/content/manager.css");
assert.deepEqual(emittedCSS, sourceCSS);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const styleVersion = `${pkg.version}-${createHash("sha256").update(sourceCSS).digest("hex").slice(0, 12)}`;
for (const name of await readdir("build/addon/content")) {
  if (!name.endsWith(".xhtml")) continue;
  const content = await readFile(`build/addon/content/${name}`, "utf8");
  assert.ok(
    content.includes(`manager.css?v=${styleVersion}`),
    `${name}: missing stylesheet cache key`,
  );
}
console.log("Verified stylesheet cache keys and packaged CSS.");
