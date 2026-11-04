// Offline quality probe using the existing local model and synthetic papers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { AutoTokenizer, env } from "@huggingface/transformers";

const model = process.env.SW_HOST_NATIVE_MODEL_DIR;
if (!model)
  throw new Error(
    "Set SW_HOST_NATIVE_MODEL_DIR to the existing MiniLM model directory.",
  );
env.allowRemoteModels = false;
const tokenizer = await AutoTokenizer.from_pretrained(model, {
  local_files_only: true,
});
const cache = await mkdtemp(join(tmpdir(), "knowledge-base-tag-semantics-"));
const child = spawn(
  new URL("../build/native/inference", import.meta.url).pathname,
  [join(model, "model.onnx"), cache, "cpu"],
);
let diagnostic = "";
child.stderr.on("data", (bytes) => {
  diagnostic += bytes.toString();
});
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
const encode = async (texts) => {
  const vectors = [];
  for (const text of texts) {
    const tokens = tokenizer(text, {
      padding: "max_length",
      truncation: true,
      max_length: 256,
    });
    child.stdin.write(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(tokens).map(([name, value]) => [
            name,
            Array.from(value.data, Number),
          ]),
        ),
      ) + "\n",
    );
    const line = await lines.next();
    if (line.done) throw new Error("Native helper exited: " + diagnostic);
    vectors.push(JSON.parse(line.value).vector);
  }
  return { vectors };
};
try {
  assert.equal(JSON.parse((await lines.next()).value).ready, true);
  const names = [
    "UAV",
    "MARL",
    "Distributed reinforcement learning",
    "Wireless sensor networks",
    "Channel allocation",
    "Decentralized control",
    "Autonomous navigation",
    "Image synthesis",
    "Personalized marketing",
  ];
  const title =
    "Multi-agent reinforcement learning for UAV spectrum allocation";
  const abstract =
    "We study distributed resource allocation for UAV networks using multi-agent reinforcement learning. Unmanned aerial vehicles coordinate channel allocation and decentralized control in wireless sensor networks. Multi-agent reinforcement learning improves autonomous navigation.";
  const body =
    "Spectrum allocation coordinates unmanned aerial vehicles. Spectrum allocation improves wireless resource allocation. Autonomous navigation uses decentralized control. ".repeat(
      3,
    );
  const item = {
    id: 1,
    libraryID: 1,
    getTags: () => [],
    getField: (name) => (name === "title" ? title : abstract),
  };
  const context = vm.createContext({
    Zotero: {
      Tags: { getAll: async () => names.map((tag) => ({ tag })) },
      logError: (error) => {
        throw error;
      },
    },
    SWPref: (_key, fallback) => fallback,
    swYield: async () => {},
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
  });
  for (const file of [
    "stemmer",
    "tokenizer",
    "search",
    "tag-policy",
    "tag-terms",
    "tag-format",
    "tags",
    "tag-suggestions",
    "semantic",
  ])
    vm.runInContext(
      await readFile(
        new URL("../src/library/" + file + ".js", import.meta.url),
        "utf8",
      ),
      context,
    );
  context.SWTagTerms.set(
    JSON.parse(
      await readFile(
        new URL("../addon/content/library/tag-terms.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const counts = await context.SWSearch.extract({ title, abstract, body });
  const corpus = {
    docs: new Map([["1/PAPER", { hash: "fixture" }]]),
    progress: { phase: "ready" },
    search: { docs: new Map([["1/PAPER", {}]]) },
    _readCounts: async () => context.SWSearch.encodeCounts(counts),
  };
  context.SWIndexer = {
    docKey: () => "1/PAPER",
    corpus,
    tagText: async () => body,
    ensureNow: () => {
      throw new Error("Unexpected document indexing");
    },
  };
  const semantic = context.SWSemantic;
  semantic.corpus = corpus;
  semantic._enabled = true;
  semantic._worker = {};
  semantic._encode = encode;
  semantic.vectors.set("1/PAPER", {
    hash: "fixture",
    vector: (await encode([title + ". " + abstract])).vectors[0],
  });
  const rows = [2, 3].map((id) => ({
    score: 0.9,
    item: {
      id,
      libraryID: 1,
      getTags: () =>
        names
          .filter(
            (name) =>
              !["Image synthesis", "Personalized marketing"].includes(name),
          )
          .map((tag) => ({ tag })),
    },
  }));
  const result = await context.SWTags.suggest(item, rows);
  console.log(
    "Suggested:",
    JSON.stringify(
      result.map((tag) => ({
        name: tag.name,
        new: tag.isNew,
        score: Number(tag.score.toFixed(3)),
      })),
    ),
  );
  assert.ok(
    result.length >= 4 && result.length <= 7,
    "The fixture should cover several useful topics without a long tail",
  );
  assert.ok(result.some((tag) => tag.name === "MARL"));
  assert.ok(result.some((tag) => tag.name === "UAV"));
  assert.ok(!result.some((tag) => /image synthesis|marketing/i.test(tag.name)));
  assert.ok(
    result.some((tag) => tag.isNew && /spectrum allocation/i.test(tag.name)),
  );
  const pairNames = [
    "image classification",
    "image categorization",
    "supervised learning",
    "unsupervised learning",
    "GPT-2",
    "GPT-3",
  ];
  const matches = await context.SWTags.potentialDuplicates(pairNames);
  console.log("Potential:", JSON.stringify(matches.groups));
  assert.ok(
    matches.groups.some(
      (group) => group.includes(pairNames[0]) && group.includes(pairNames[1]),
    ),
  );
  assert.ok(
    !matches.groups.some(
      (group) => group.includes(pairNames[2]) && group.includes(pairNames[3]),
    ),
  );
  assert.ok(
    !matches.groups.some(
      (group) => group.includes(pairNames[4]) && group.includes(pairNames[5]),
    ),
  );
  const requests = semantic._tagVectors.size;
  await semantic.tagRelations(pairNames);
  assert.equal(semantic._tagVectors.size, requests);
  console.log(
    "PASS Existing native model, useful topic coverage, new labels, semantic candidates, qualifier protection and cache reuse.",
  );
} finally {
  clearTimeout(timer);
  child.kill();
  await rm(cache, { recursive: true, force: true });
}
