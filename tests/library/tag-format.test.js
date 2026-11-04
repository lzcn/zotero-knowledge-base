const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const context = vm.createContext({});
for (const name of ["tag-terms", "tag-format"])
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/" + name + ".js"),
      "utf8",
    ),
    context,
  );
context.SWTagTerms.set(require("../../addon/content/library/tag-terms.json"));
const { SWTagFormat } = context;
const sentence = { style: "sentence", hashtag: false };
const title = { style: "title", hashtag: true };

test("sentence and title formatting keep punctuation and independent hash prefixes", () => {
  assert.equal(
    SWTagFormat.format("  #deep   Learning  ", sentence),
    "Deep learning",
  );
  assert.equal(SWTagFormat.format("deep Learning", title), "#Deep Learning");
  assert.equal(
    SWTagFormat.format("co-attention (graph-based)", sentence),
    "Co-attention (graph-based)",
  );
  assert.equal(
    SWTagFormat.format("co-attention (graph-based)", title),
    "#Co-Attention (Graph-Based)",
  );
  assert.equal(SWTagFormat.format("don't forget", title), "#Don't Forget");
});

test("known spellings, unknown names, scientific symbols and acronyms survive repeated switches", () => {
  for (const name of [
    "PyTorch",
    "ImageNet",
    "pH",
    "C++",
    "C#",
    "LLM",
    "LLMs",
    "FooBAR",
    "CustomName",
    "GPT-4o",
    "β2",
    "ℝ",
    "μm",
    "3D",
    "eV",
    "R",
    "C",
    "m",
    "x",
    "I",
    "Bayesian",
    "Gaussian",
  ]) {
    for (const options of [sentence, title, sentence, title]) {
      const result = SWTagFormat.format("analysis using " + name, options);
      assert.ok(result.endsWith(name), result);
      assert.equal(SWTagFormat.format(result, options), result);
    }
  }
  assert.equal(
    SWTagFormat.format("pytorch and imagenet", sentence),
    "PyTorch and ImageNet",
  );
  assert.equal(SWTagFormat.format("llm training", sentence), "LLM training");
  assert.equal(SWTagFormat.format("US and us", sentence), "US and us");
  assert.equal(SWTagFormat.format("DEEP LEARNING", sentence), "DEEP LEARNING");
  assert.equal(SWTagFormat.format("图神经网络", title), "#图神经网络");
});

test("structured labels are not flattened or given an extra hash", () => {
  for (const name of [
    "topic/deep-learning",
    "status:reading",
    "deep_learning",
    "#GNU/Linux",
    "##heading",
    "https://example.org",
    "C:\\papers",
  ]) {
    assert.equal(SWTagFormat.format(name, sentence), name);
    assert.equal(SWTagFormat.format(name, title), name);
  }
  assert.throws(
    () =>
      SWTagFormat.format("Deep Learning", { style: "camel", hashtag: false }),
    /invalid-format/,
  );
  assert.throws(
    () =>
      SWTagFormat.format("Deep Learning", { style: "title", hashtag: "false" }),
    /invalid-format/,
  );
});

test("the shared catalog protects multi-word spellings and rejects conflicting edits atomically", () => {
  assert.equal(
    SWTagFormat.format("sampling using monte carlo", sentence),
    "Sampling using Monte Carlo",
  );
  assert.equal(SWTagFormat.format("c++ using ph", sentence), "C++ using pH");
  assert.equal(SWTagFormat.format("PH sensing", sentence), "PH sensing");
  const terms = context.SWTagTerms,
    before = terms.spellings;
  assert.throws(
    () => terms.set({ spellings: ["PyTorch", "Pytorch"], aliases: [] }),
    /Duplicate tag spelling/,
  );
  assert.equal(terms.spellings, before);
  assert.throws(
    () =>
      terms.set({
        spellings: [],
        aliases: [
          { name: "one", forms: ["same"] },
          { name: "two", forms: ["same"] },
        ],
      }),
    /Conflicting tag alias/,
  );
  assert.equal(terms.spellings, before);
});
