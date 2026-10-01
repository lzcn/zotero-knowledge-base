import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const [file, name] of [
  ["assets-notes.mjs", "Asset lifecycle"],
  ["database.mjs", "SQLite storage, card lifecycle and relationship indexing"],
  ["ui.mjs", "Markdown, sources, editor and graph interactions in XML windows"],
  [
    "item-pane.mjs",
    "Native sidebar registration, localization and live card refresh",
  ],
]) {
  test(name, { timeout: 120_000 }, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(file, import.meta.url))],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
        timeout: 110_000,
      },
    );
    assert.equal(
      result.status,
      0,
      `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
    );
    console.log(result.stdout.trim());
  });
}
