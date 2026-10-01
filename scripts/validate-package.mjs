import assert from "node:assert/strict";
import { Script } from "node:vm";
import { unzipSync, strFromU8 } from "fflate";

/** Validate the actual installable archive, including referenced local assets. */
export function validatePackage(bytes, pkg, required = []) {
  const files = unzipSync(bytes);
  assert.ok(files["manifest.json"], "Missing manifest.json");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.version, pkg.version, "Package version mismatch");
  assert.equal(manifest.name, pkg.config.addonName, "Plugin name mismatch");
  assert.equal(manifest.author, pkg.author, "Author mismatch");
  assert.equal(
    manifest.applications.zotero.id,
    pkg.config.addonID,
    "Plugin ID mismatch",
  );
  assert.equal(
    manifest.applications.zotero.update_url,
    `https://github.com/lzcn/${pkg.name}/releases/latest/download/updates.json`,
  );
  const icons = Object.values(manifest.icons ?? {});
  assert.ok(icons.length >= 2, "Missing plugin manager icons");
  for (const name of ["bootstrap.js", ...icons, ...required]) {
    assert.ok(files[name]?.length, `Missing package file: ${name}`);
  }
  const resourcePrefix = `chrome://${pkg.config.addonRef}/`;
  for (const [name, content] of Object.entries(files)) {
    assert.ok(
      !name.startsWith("/") && !name.split("/").includes(".."),
      `Unsafe archive path: ${name}`,
    );
    if (!/\.(js|json|xhtml|css|ftl)$/.test(name)) continue;
    const text = strFromU8(content);
    assert.ok(
      !/__(?:addon\w*|buildVersion|description|author|styleVersion|updateURL|env)__|\{\{(?:owner|repo|buildTime)\}\}/.test(
        text,
      ),
      `Unresolved template in ${name}`,
    );
    if (name.endsWith(".ftl")) {
      for (const match of text.matchAll(/^([a-zA-Z][\w-]*)\s*=/gm)) {
        assert.ok(
          match[1].startsWith(`${pkg.config.addonRef}-`),
          `${name}: missing locale namespace for ${match[1]}`,
        );
      }
    }
    if (name.endsWith(".js")) new Script(text, { filename: name });
    if (name.endsWith(".xhtml")) {
      for (const match of text.matchAll(
        /(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g,
      )) {
        if (!match[1].startsWith(resourcePrefix)) continue;
        const target = match[1].slice(resourcePrefix.length);
        assert.ok(files[target]?.length, `${name}: missing asset ${target}`);
      }
    }
  }
  return { files, manifest };
}
