import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-text-"));
try {
  const output = join(workspace, "text.mjs");
  await build({
    entryPoints: ["src/ui/text-format.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
  });
  const { mathSpans, markdownMathEdits } = await import(
    pathToFileURL(output).href
  );
  const apply = (text, edits) =>
    [...edits]
      .reverse()
      .reduce(
        (body, edit) =>
          body.slice(0, edit.start) + edit.replacement + body.slice(edit.end),
        text,
      );
  const example = String.raw`给定两个节点 u,v，当前时间 $t$，以及 \(t\) 之前的历史：

\[ \mathcal H_{<t} = \{(u_i,v_i,t_i)\mid t_i<t\} \]

\[ \boxed{\hat y_{uv}^t = P\left((u,v,t)\text{发生交互}\mid\mathcal H_{<t}\right)} \]`;
  const sourceEdits = markdownMathEdits(example);
  assert.equal(sourceEdits.length, 3);
  const formatted = apply(example, sourceEdits);
  assert.ok(formatted.includes("以及 $t$"));
  assert.ok(
    formatted.includes(
      "$$\n" +
        String.raw`\mathcal H_{<t} = \{(u_i,v_i,t_i)\mid t_i<t\}` +
        "\n$$",
    ),
  );
  assert.ok(formatted.includes(String.raw`\text{发生交互}`));
  assert.equal(mathSpans(example, [], true).length, 4);
  assert.equal(markdownMathEdits(formatted).length, 0);
  assert.equal(
    mathSpans(
      String.raw`Prices $5 and $10; escaped \$20; literal \\(x\\) and \\[x\\].`,
      [],
      true,
    ).length,
    0,
  );
  assert.equal(mathSpans(String.raw`Broken \(x and \[x`).length, 0);
  assert.equal(mathSpans("\\(x\ny\\)").length, 0);
  assert.equal(mathSpans(String.raw`\(\frac{x}{y\)`).length, 0);
  assert.equal(
    mathSpans(String.raw`\[\text{\]} + x\]`)[0].latex,
    String.raw`\text{\]} + x`,
  );
  assert.equal(
    mathSpans(
      String.raw`[[Note\(id\)]] [@Cite\(id\)] https://example.test/\(path\)`,
    ).length,
    0,
  );
  const protectedText = String.raw`code \(literal\), link \(target\), prose \(x\)`;
  const protectedRanges = [{ from: 0, to: protectedText.indexOf(", prose") }];
  const protectedEdits = markdownMathEdits(protectedText, protectedRanges);
  assert.equal(protectedEdits.length, 1);
  assert.equal(
    apply(protectedText, protectedEdits),
    String.raw`code \(literal\), link \(target\), prose $x$`,
  );
  const selected = String.raw`😀 中文 \(a\) and \(b\)`;
  const start = selected.indexOf(String.raw`\(b\)`);
  const selectionEdits = markdownMathEdits(selected, [], {
    from: start,
    to: selected.length,
  });
  assert.equal(selectionEdits.length, 1);
  assert.equal(
    apply(selected, selectionEdits),
    String.raw`😀 中文 \(a\) and $b$`,
  );
  assert.equal(
    markdownMathEdits(selected, [], { from: start + 1, to: selected.length })
      .length,
    0,
  );
  assert.equal(
    apply("before \\[x\\] after", markdownMathEdits("before \\[x\\] after")),
    "before \n\n$$\nx\n$$\n\n after",
  );
  console.log(
    "PASS Alternate delimiters, existing dollars, Unicode selections, multiline formulas, brace-aware closing, literal escapes, prices, protected spans, URLs, note IDs and idempotence.",
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
