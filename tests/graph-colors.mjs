import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "kb-colors-"));
try {
  const output = join(directory, "colors.mjs");
  await build({
    entryPoints: ["src/modules/graph-colors.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
  });
  const { graphColorSelector, graphTagColor } = await import(
    pathToFileURL(output)
  );
  const select = graphColorSelector([]);
  const tags = ["Machine learning", "Remote sensing"];
  const result = select(
    tags,
    "Remote sensing",
    "Satellite remote sensing imagery",
  );
  assert.equal(result.group, "Remote sensing");
  assert.equal(result.color, graphTagColor("Remote sensing"));
  assert.deepEqual(
    result,
    select(
      [...tags].reverse(),
      "Remote sensing",
      "Satellite remote sensing imagery",
    ),
  );
  assert.deepEqual(select([], "Title", "Text"), {});
  assert.equal(
    select(["Uncolored topic"], "", "").color,
    graphTagColor("Uncolored topic"),
  );
  assert.equal(
    graphTagColor("REMOTE SENSING"),
    graphTagColor("Remote sensing"),
  );
  assert.equal(
    select(["变化检测", "机器学习"], "遥感变化检测", "变化检测方法").group,
    "变化检测",
  );
  const groups = [
    { tag: "Machine learning", color: "#123456" },
    { tag: "Remote sensing", color: "#abcdef" },
  ];
  const configured = graphColorSelector(groups);
  assert.deepEqual(configured(tags, "Remote sensing", ""), {
    group: "Remote sensing",
    color: "#abcdef",
  });
  assert.deepEqual(
    graphColorSelector([...groups].reverse())(tags, "Remote sensing", ""),
    configured(tags, "Remote sensing", ""),
  );
  assert.equal(
    graphColorSelector(groups.slice(0, 1))(
      tags,
      "Remote sensing",
      "Remote sensing",
    ).group,
    "Machine learning",
  );
  assert.deepEqual(select(tags, "", ""), select([...tags].reverse(), "", ""));
  console.log(
    "PASS Internal tag colors, multilingual relevance, Group priority and stable ties",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
