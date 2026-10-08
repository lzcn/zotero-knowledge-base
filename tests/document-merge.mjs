import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const temp = await mkdtemp(join(tmpdir(), "knowledge-base-merge-"));
try {
  const output = join(temp, "merge.mjs");
  await build({
    entryPoints: [resolve("src/modules/document-merge.ts")],
    bundle: true,
    format: "esm",
    outfile: output,
  });
  const { mergeMarkdownDocuments: merge } = await import(pathToFileURL(output));
  const base = "# 标题\n\nFirst paragraph.\n\nSecond paragraph.\n";
  assert.equal(
    merge(
      base,
      base.replace("First", "Local"),
      base.replace("Second", "Remote"),
    ),
    base.replace("First", "Local").replace("Second", "Remote"),
  );
  assert.equal(
    merge(
      base,
      base.replace("First", "Local"),
      base.replace("First", "Remote"),
    ),
    null,
  );
  assert.equal(
    merge(base, base + "New paragraph\n", base.replace("First", "Remote")),
    base.replace("First", "Remote") + "New paragraph\n",
  );
  assert.equal(merge(base, base + "A", base + "B"), null);
  assert.equal(
    merge(base, base.replace("First", "Same"), base.replace("First", "Same")),
    base.replace("First", "Same"),
  );
  assert.equal(
    merge(
      base,
      base.replace("First paragraph.\n\n", ""),
      base.replace("Second", "Remote"),
    ),
    base.replace("First paragraph.\n\n", "").replace("Second", "Remote"),
  );
  const protectedBase = '<span data-citation="old">citation</span>\n\nplain';
  assert.equal(
    merge(
      protectedBase,
      protectedBase.replace('"old"', '"local"'),
      protectedBase.replace('"old"', '"remote"'),
    ),
    null,
  );
  const large = Array.from({ length: 1500 }, (_, i) => `Line ${i}`).join("\n");
  assert.equal(
    merge(
      large,
      "Local\n" + large + "\nLocal",
      "Remote\n" + large + "\nRemote",
    ),
    null,
  );
  for (let i = 0; i < 100; i++) {
    const lines = Array.from({ length: 20 }, (_, j) => `段落 ${j}`);
    const left = i % 10,
      right = 10 + (i % 10);
    const local = [...lines],
      remote = [...lines],
      expected = [...lines];
    local[left] = expected[left] = "Local " + i;
    remote[right] = expected[right] = "Remote " + i;
    assert.equal(
      merge(lines.join("\n"), local.join("\n"), remote.join("\n")),
      expected.join("\n"),
    );
  }
  console.log(
    "PASS Three-way merging preserves independent edits, deletions, Unicode and protected objects; overlapping and oversized edits retain drafts",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
