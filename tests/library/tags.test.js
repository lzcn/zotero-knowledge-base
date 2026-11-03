const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function fixture() {
  const tags = new Map([
    ["Deep Learning", [1, 2]],
    ["deep-learning", [2, 3]],
    ["Other", [4]],
  ]);
  const writes = [];
  const item = {
    id: 1,
    libraryID: 1,
    deleted: false,
    names: ["Original"],
    getTags() {
      return this.names.map((tag) => ({ tag }));
    },
    isEditable: () => true,
    hasTag(name) {
      return this.names.includes(name);
    },
    addTag(name) {
      this.names.push(name);
      return true;
    },
    async save() {
      writes.push("save");
    },
    async reload() {
      this.names = ["Original"];
    },
  };
  const context = vm.createContext({
    SWPref: (name, fallback) => {
      const value = context.Zotero.Prefs.get("similar-works." + name);
      return value === undefined ? fallback : value;
    },
    Zotero: {
      Promise: { delay: async () => {} },
      Libraries: { get: () => ({ editable: true }) },
      Items: { getAsync: async () => item },
      Prefs: { get: () => undefined },
      locale: "en-US",
      HTTP: {
        request: async () => {
          throw new Error("Unexpected HTTP request");
        },
      },
      Tags: {
        getAll: async () => [...tags.keys()].map((tag) => ({ tag })),
        getID: (name) => name,
        getTagItems: async (_lib, name) => tags.get(name) || [],
        getColors: () => new Map(),
        getColor: () => ({ color: "#123456", position: 0 }),
        setColor: async (...args) => writes.push(args),
        rename: async (library, from, to) => {
          writes.push([library, from, to]);
          tags.set(to, [
            ...new Set([...(tags.get(to) || []), ...tags.get(from)]),
          ]);
          tags.delete(from);
        },
      },
      DB: {
        executeTransaction: async (work) => work(),
        queryAsync: async () => [],
      },
    },
    URL,
    swYield: async () => {},
  });
  for (const file of [
    "stemmer.js",
    "tokenizer.js",
    "search.js",
    "tags.js",
    "tag-suggestions.js",
  ])
    vm.runInContext(
      fs.readFileSync(
        path.join(__dirname, "../../src/library/" + file),
        "utf8",
      ),
      context,
    );
  const catalog = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../addon/content/library/data/tag-terms.json"),
      "utf8",
    ),
  );
  context.SWTags._terms = new Map(Object.entries(catalog.terms));
  context.SWTags._termLength = Math.max(
    ...Object.keys(catalog.terms).map((key) => key.split(" ").length),
  );
  return {
    api: context.SWTags,
    context,
    item,
    tags,
    writes,
  };
}

test("tag recommendations weight same-library neighbors, exclude current tags and deduplicate variants per paper", () => {
  const { api, item } = fixture();
  item.names = ["machine-learning"];
  const neighbor = (id, score, names, libraryID = 1) => ({
    score,
    item: { id, libraryID, getTags: () => names.map((tag) => ({ tag })) },
  });
  const result = api.recommend(item, [
    neighbor(2, 0.9, ["Machine Learning", "Deep Learning", "deep-learning"]),
    neighbor(2, 0.9, ["Deep Learning"]),
    neighbor(3, 0.6, ["Deep Learning", "Vision"]),
    neighbor(4, 0.5, ["Vision"]),
    neighbor(5, 1, ["Foreign"], 2),
    neighbor(1, 1, ["Self"]),
  ]);
  assert.deepEqual(
    Array.from(result, (tag) => [tag.name, tag.count]),
    [
      ["Deep Learning", 2],
      ["Vision", 2],
    ],
  );
});

test("duplicate grouping keeps punctuation that distinguishes C++, C# and C", () => {
  const { api } = fixture();
  const groups = api.duplicateGroups([
    "Deep Learning",
    "deep-learning",
    "deep_learning",
    "C++",
    "C#",
    "C",
    "ＡＩ",
    "AI",
  ]);
  assert.deepEqual(
    Array.from(groups, (group) => Array.from(group)),
    [
      ["Deep Learning", "deep-learning", "deep_learning"],
      ["ＡＩ", "AI"],
    ],
  );
});

test("duplicates separate related and opposite concepts while suggesting spelling variants", () => {
  const { api, writes } = fixture();
  const names = [
    "#Convex Optimization",
    "#Nonconvex Optimization",
    "#Graph Representation Learning",
    "#Representation Learning",
    "#Self-supervised Learning",
    "#Semi-supervised Learning",
    "#Supervised Learning",
    "#Unsupervised Learning",
    "#Weakly Supervised Learning",
    "Graph neural network",
    "Neural networks graph",
    "graphneuralnetwork",
    "GPT-2",
    "GPT-3",
    "C++",
    "C#",
  ];
  assert.deepEqual(Array.from(api.duplicateGroups(names)), []);
  const variants = api.duplicateGroups([
    ...names,
    "convex_optimization",
    "#GraphRepresentationLearning",
  ]);
  assert.deepEqual(
    Array.from(variants, (group) => Array.from(group)),
    [
      ["#Convex Optimization", "convex_optimization"],
      ["#Graph Representation Learning", "#GraphRepresentationLearning"],
    ],
  );
  assert.deepEqual(writes, []);
});

test("adding tags uses current native tags and refuses obsolete names or selection", async () => {
  const { api, item, writes } = fixture();
  assert.equal(
    await api.addSelected(1, 1, ["Deep Learning", "Deep Learning"]),
    1,
  );
  assert.deepEqual(item.names, ["Original", "Deep Learning"]);
  await assert.rejects(api.addSelected(1, 1, ["Missing"]), /changed/);
  await assert.rejects(
    api.addSelected(1, 1, ["Other"], () => false),
    /cancelled/,
  );
  assert.deepEqual(writes, ["save"]);
});

test("cancelled item save reloads native state instead of leaving unsaved tags", async () => {
  const { api, item } = fixture();
  let active = true;
  item.save = async () => {
    active = false;
  };
  await assert.rejects(
    api.addSelected(1, 1, ["Deep Learning"], () => active),
    /cancelled/,
  );
  assert.deepEqual(item.names, ["Original"]);
});

test("merge previews distinct items, keeps the existing target and uses library-scoped native rename", async () => {
  const { api, tags, writes } = fixture();
  assert.equal(await api.preview(1, ["Deep Learning", "deep-learning"]), 3);
  assert.equal(
    await api.merge(1, ["Deep Learning", "deep-learning"], "Deep Learning"),
    1,
  );
  assert.deepEqual(tags.get("Deep Learning"), [1, 2, 3]);
  assert.equal(tags.has("deep-learning"), false);
  assert.deepEqual(writes, [
    [1, "deep-learning", "Deep Learning"],
    [1, "Deep Learning", "#123456", 0],
  ]);
});

test("read-only and changed tags cannot merge; shutdown stops after the current native write", async () => {
  const { api, context, tags, writes } = fixture();
  context.Zotero.Libraries.get = () => ({ editable: false });
  await assert.rejects(
    api.merge(1, ["Deep Learning", "deep-learning"], "Deep Learning"),
    /readonly/,
  );
  context.Zotero.Libraries.get = () => ({ editable: true });
  await assert.rejects(
    api.merge(1, ["Deep Learning", "Missing"], "Deep Learning"),
    /changed/,
  );
  const rename = context.Zotero.Tags.rename;
  context.Zotero.Tags.rename = async (...args) => {
    await rename(...args);
    api.stop();
  };
  await assert.rejects(
    api.merge(1, ["Deep Learning", "deep-learning", "Other"], "Deep Learning"),
    /cancelled/,
  );
  await api.finishWrites();
  assert.equal(tags.has("Other"), true);
  assert.equal(
    writes.length,
    2,
    "target color restored for the completed write",
  );
});

test("new suggestions can come from the paper without neighboring support", async () => {
  const { api, context, item } = fixture();
  item.getField = (field) =>
    field === "title"
      ? "Graph Neural Networks for molecule prediction"
      : "Graph Neural Networks improve molecule prediction. Neural features form a network.";
  const neighbor = (id) => ({
    score: 0.8,
    item: {
      id,
      libraryID: 1,
      getTags: () => [{ tag: "Other" }],
      getField: () => "molecule prediction",
    },
  });
  context.Zotero.Tags.getAll = async () =>
    ["Other", "Graph Neural Networks", "Neural network"].map((tag) => ({
      tag,
    }));
  const one = await api.suggest(item, [neighbor(2), neighbor(2)]);
  assert.ok(one.some((tag) => tag.name === "Graph Neural Networks"));
  assert.ok(one.some((tag) => tag.isNew));
  const rows = [neighbor(2), neighbor(3)];
  const tags = await api.suggest(item, rows);
  assert.ok(
    tags.some((tag) => tag.name === "Graph Neural Networks" && !tag.isNew),
  );
  assert.ok(
    tags.some((tag) => tag.name === "Molecule prediction" && tag.isNew),
  );
  assert.ok(!tags.some((tag) => tag.name === "Other"));
  assert.ok(!tags.some((tag) => tag.name === "Learning"));
  assert.ok(tags.filter((tag) => /deep/i.test(tag.name)).length <= 1);
  item.getField = () => "";
  assert.deepEqual(Array.from(await api.suggest(item, [])), []);
});

test("suggested tag application rejects missing tags and invalid names", async () => {
  const { api, item } = fixture();
  await assert.rejects(
    api.addSelected(1, 1, ["Graph Neural Networks"]),
    /changed/,
  );
  await assert.rejects(
    api.addSelected(1, 1, ["bad\u0000name"]),
    /invalid-name/,
  );
  assert.deepEqual(item.names, ["Original"]);
});

test("normalization supports one native rename to a new name while preserving color and item identities", async () => {
  const { api, tags, writes } = fixture();
  assert.equal(api.normalizeName("  Graph   Networks  "), "Graph Networks");
  assert.equal(await api.preview(1, ["Other"]), 1);
  assert.equal(await api.merge(1, ["Other"], "Standard Name"), 1);
  assert.deepEqual(tags.get("Standard Name"), [4]);
  assert.equal(tags.has("Other"), false);
  assert.deepEqual(writes[0], [1, "Other", "Standard Name"]);
});

test("fixed-space naming preserves scientific and unknown mixed-case names", () => {
  const { api } = fixture();
  const format = (name, style = "sentence", hashtag = false) =>
    api.formatName(name, { style, hashtag });
  assert.equal(
    format("deep_learning GAN co-attention"),
    "Deep learning GAN co-attention",
  );
  assert.equal(
    format("deep learning GAN co-attention", "title"),
    "Deep Learning GAN Co-attention",
  );
  assert.equal(format("gan yolo openai pytorch"), "GAN YOLO OpenAI PyTorch");
  assert.equal(
    format("MyBrand X42 C++ C# .NET", "sentence", true),
    "#MyBrand X42 C++ C# .NET",
  );
  assert.equal(format("DeepLearning"), "DeepLearning");
  assert.equal(format("self-supervised learning"), "Self-supervised learning");
  assert.equal(format("zero-shot learning"), "Zero-shot learning");
  assert.equal(format("zero-shot learning", "title"), "Zero-shot Learning");
  assert.equal(format("deep-learning"), "Deep-learning");
  assert.equal(format("神经网络", "sentence", true), "#神经网络");
  const group = api.duplicateGroups([
    "#DeepLearning",
    "deep_learning",
    "deep-learning",
    "C++",
    "C#",
    "C",
  ]);
  assert.deepEqual(
    Array.from(group, (g) => Array.from(g)),
    [["#DeepLearning", "deep_learning", "deep-learning"]],
  );
});

test("suggestions preserve existing names and format supported new phrases", async () => {
  const { api, context, item } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "sentence", tagHashtag: true })[key] ?? fallback;
  item.getField = () =>
    "Deep Learning for Graph Neural Networks and molecule prediction";
  const rows = [2, 3].map((id) => ({
    score: 0.9,
    item: {
      id,
      libraryID: 1,
      getTags: () => [{ tag: "Deep Learning" }],
      getField: () => item.getField(),
    },
  }));
  const suggestions = await api.suggest(item, rows);
  assert.ok(
    suggestions.some((tag) => tag.name === "Deep Learning" && !tag.isNew),
  );
  assert.ok(suggestions.some((tag) => tag.isNew && tag.name.startsWith("#")));
});

test("colored tags and aliases are protected in their library, including merge destinations and new-tag creation", async () => {
  const { api, context, item, writes } = fixture();
  context.Zotero.Tags.getColors = (library) =>
    library === 1
      ? new Map([["Deep Learning", { color: "#123456", position: 0 }]])
      : new Map();
  assert.deepEqual(Array.from(await api.catalog(1, true)), ["Other"]);
  assert.equal((await api.catalog(2, true)).length, 3);
  const rows = [
    {
      score: 1,
      item: { id: 2, libraryID: 1, getTags: () => [{ tag: "deep-learning" }] },
    },
  ];
  assert.equal((await api.suggest(item, rows)).length, 0);
  await assert.rejects(api.preview(1, ["Deep Learning"]), /protected/);
  await assert.rejects(api.merge(1, ["deep-learning"], "Topic"), /protected/);
  await assert.rejects(api.merge(1, ["Other"], "#DeepLearning"), /protected/);
  await assert.rejects(api.addSelected(1, 1, ["#deep_learning"]), /protected/);
  assert.deepEqual(writes, []);
  assert.deepEqual(item.names, ["Original"]);
  context.SWPref = (key, fallback) =>
    key === "excludeColoredTags" ? false : fallback;
  assert.equal((await api.catalog(1, true)).length, 3);
});

test("manual exclusions remain protected with color exclusion off, and are reread before a write", async () => {
  const { api, context, item, writes } = fixture();
  let excluded = " Other \n#DeepLearning\r\n";
  context.SWPref = (key, fallback) =>
    ({ excludeColoredTags: false, excludedTags: excluded })[key] ?? fallback;
  assert.deepEqual(Array.from(await api.catalog(1, true)), []);
  await assert.rejects(api.merge(1, ["Other"], "Unblocked"), /protected/);
  await assert.rejects(api.addSelected(1, 1, ["Other"]), /protected/);
  excluded = "";
  assert.equal(await api.preview(1, ["Other"]), 1);
  excluded = "Other";
  await assert.rejects(api.merge(1, ["Other"], "Unblocked"), /protected/);
  assert.deepEqual(writes, []);
  excluded = "";
  item.save = async () => {
    excluded = "Other";
  };
  await assert.rejects(api.addSelected(1, 1, ["Other"]), /protected/);
  assert.deepEqual(
    item.names,
    ["Original"],
    "failed save reloads the native item",
  );
});

test("bulk formatting keeps unrelated tags separate, previews collisions and skips unchanged names", async () => {
  const { api, context, tags, writes } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "sentence", tagHashtag: true })[key] ?? fallback;
  tags.set("deep_learning", tags.get("deep-learning"));
  tags.delete("deep-learning");
  const plan = await api.planFormat(1, [
    "Deep Learning",
    "deep_learning",
    "Other",
  ]);
  assert.equal(plan.changes.length, 3);
  assert.equal(plan.collisions, 1);
  assert.equal(plan.itemCount, 4);
  assert.equal(await api.applyFormat(1, plan), 3);
  assert.deepEqual(tags.get("#Deep learning"), [1, 2, 3]);
  assert.deepEqual(tags.get("#Other"), [4]);
  const unchanged = await api.planFormat(1, ["#Other"]);
  assert.equal(unchanged.changes.length, 0);
  assert.equal(unchanged.itemCount, 0);
  assert.equal(
    writes.filter((value) => Array.isArray(value) && value.length === 3).length,
    3,
  );
});

test("bulk formatting refuses protected destinations or a changed preview, and stops after the current native write", async () => {
  const { api, context, tags } = fixture();
  let style = "sentence";
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: style, tagHashtag: true })[key] ?? fallback;
  const plan = await api.planFormat(1, ["Other"]);
  style = "title";
  await assert.rejects(api.applyFormat(1, plan), /changed/);
  style = "sentence";
  tags.set("#Other", [9]);
  await assert.rejects(api.applyFormat(1, plan), /changed/);
  context.Zotero.Tags.getColors = () =>
    new Map([["#Other", { color: "#123456" }]]);
  await assert.rejects(api.planFormat(1, ["Other"]), /protected/);
  context.Zotero.Tags.getColors = () => new Map();
  let active = true;
  const current = await api.planFormat(1, ["Deep Learning", "Other"]);
  const rename = context.Zotero.Tags.rename;
  context.Zotero.Tags.rename = async (...args) => {
    await rename(...args);
    active = false;
  };
  await assert.rejects(
    api.applyFormat(1, current, () => active),
    /cancelled/,
  );
  assert.ok(tags.has("#Deep learning"));
  assert.ok(tags.has("Other"));
  await api.finishWrites();
});

test("both case styles remain idempotent across dictionary aliases and protected spellings", () => {
  const { api } = fixture();
  for (const style of ["sentence", "title"])
    for (const name of [
      "gan yolo co-attention",
      "deep_learning NLP",
      "MyBrand self-supervised",
      ...api._terms.keys(),
    ]) {
      const result = api.formatName(name, { style, hashtag: true });
      assert.equal(
        api.formatName(result, { style, hashtag: true }),
        result,
        name,
      );
    }
});

test("bulk removal uses the native host operation, preserves protected tags and stops between writes", async () => {
  const { api, context, tags } = fixture();
  const names = Array.from({ length: 51 }, (_, i) => "Tag " + i);
  for (const name of names) tags.set(name, [4]);
  let active = true;
  const removed = [];
  context.Zotero.Tags.removeFromLibrary = async (libraryID, ids) => {
    assert.equal(libraryID, 1);
    removed.push(...ids);
    for (const id of ids) tags.delete(id);
    active = false;
  };
  await assert.rejects(
    api.remove(1, names, () => active),
    /cancelled/,
  );
  assert.deepEqual(removed, names.slice(0, 50));
  assert.ok(tags.has(names[50]));
  assert.ok(tags.has("Deep Learning"));
  context.Zotero.Tags.getColors = () => new Map([["Deep Learning", {}]]);
  await assert.rejects(api.remove(1, ["Deep Learning"]), /protected/);
  await api.finishWrites();
});

test("supported topics remain relevance-ranked and bounded without reserving slots by tag type", async () => {
  const { api, context, item } = fixture();
  const names = [
    "Graph clustering",
    "Molecule prediction",
    "Image retrieval",
    "Object detection",
    "Semantic segmentation",
    "Domain adaptation",
    "Attention mechanism",
    "Contrastive learning",
    "Matrix factorization",
  ];
  context.Zotero.Tags.getAll = async () => names.map((tag) => ({ tag }));
  item.getField = () => names.join(" and ");
  const existing = await api.suggest(item, []);
  assert.equal(existing.length, 6);
  assert.ok(existing.every((tag) => !tag.isNew));
  context.Zotero.Tags.getAll = async () => [];
  const rows = [2, 3].map((id) => ({
    score: 0.9,
    item: {
      id,
      libraryID: 1,
      getTags: () => [],
      getField: () => item.getField(),
    },
  }));
  const fresh = await api.suggest(item, rows);
  assert.equal(fresh.length, 6);
  assert.ok(fresh.every((tag) => tag.isNew));
  assert.equal(
    (await api.suggest(item, [rows[0], rows[0]])).length,
    fresh.length,
  );
  const phrase = fresh[0].name;
  await assert.rejects(api.addSelected(1, 1, [phrase]), /changed/);
  assert.equal(await api.addSelected(1, 1, [phrase], () => true, [phrase]), 1);
  assert.ok(item.hasTag(phrase));
});

test("new title phrases require abstract corroboration and all statuses share one ranking", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () => [
    { tag: "Combinatorial optimization" },
    { tag: "Discrete diffusion solvers" },
  ];
  item.getField = (field) =>
    field === "title"
      ? "Combinatorial adjoint matching for discrete diffusion solvers in combinatorial optimization"
      : "Combinatorial adjoint matching trains discrete diffusion solvers for combinatorial optimization.";
  const tags = await api.suggest(item, []);
  assert.ok(
    tags.some(
      (tag) => tag.isNew && tag.name === "Combinatorial adjoint matching",
    ),
  );
  assert.ok(tags.some((tag) => !tag.isNew));
  assert.ok(tags.every((tag, i) => !i || tags[i - 1].score >= tag.score));
  item.getField = (field) =>
    field === "title"
      ? "Combinatorial adjoint matching for discrete diffusion solvers in combinatorial optimization"
      : "We evaluate several unrelated methods.";
  assert.ok((await api.suggest(item, [])).every((tag) => !tag.isNew));
});

test("new title topics do not duplicate existing terminology or use single abstract fragments", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () => [{ tag: "Graph Neural Network" }];
  item.getField = (field) =>
    field === "title"
      ? "Graph Neural Networks for molecule prediction"
      : "Graph neural networks support molecule prediction.";
  const tags = await api.suggest(item, []);
  assert.ok(
    tags.some((tag) => tag.name === "Molecule prediction" && tag.isNew),
  );
  assert.ok(
    tags.some((tag) => tag.name === "Graph Neural Network" && !tag.isNew),
  );
  assert.ok(
    !tags.some((tag) => tag.name === "Graph Neural Networks" && tag.isNew),
  );
  item.getField = (field) =>
    field === "abstractNote" ? "We evaluate molecule prediction." : "";
  assert.deepEqual(Array.from(await api.suggest(item, [])), []);
});

test("incidental abstract catalogs cannot displace corroborated title topics", async () => {
  const { api, context, item } = fixture();
  const names = Array.from({ length: 30 }, (_, i) => "Existing topic " + i);
  context.Zotero.Tags.getAll = async () => names.map((tag) => ({ tag }));
  item.getField = (field) =>
    field === "title"
      ? "Combinatorial adjoint matching for discrete diffusion solvers"
      : "Combinatorial adjoint matching trains discrete diffusion solvers. " +
        names.join("; ");
  const rows = [
    {
      score: 0.99,
      item: {
        id: 2,
        libraryID: 1,
        getTags: () => names.map((tag) => ({ tag })),
      },
    },
  ];
  context.SWSemantic = {
    _enabled: true,
    tagSimilarity: async (_item, candidates) => candidates.map(() => 0.99),
  };
  const tags = await api.suggest(item, rows);
  assert.deepEqual(
    new Set(tags.map((tag) => tag.name.toLowerCase())),
    new Set(["combinatorial adjoint matching", "discrete diffusion solvers"]),
  );
});

test("duplicate strategies explain plural, explicit abbreviations and spelling without transitive guessing", () => {
  const { api } = fixture();
  assert.equal(
    api.duplicateReason("Graph neural networks", "Graph neural network"),
    "alias",
  );
  assert.equal(
    api.duplicateReason("GNN", "Graph neural network (GNN)"),
    "abbreviation",
  );
  assert.equal(
    api.duplicateReason("Representation learning", "Representaton learning"),
    "spelling",
  );
  assert.equal(api.duplicateReason("GPT-2", "GPT-3"), null);
  assert.equal(
    api.duplicateReason("Supervised learning", "Unsupervised learning"),
    null,
  );
  assert.equal(api.duplicateReason("GNN", "Graph neural network"), "alias");
  const groups = api.duplicateGroups([
    "GNN",
    "Graph neural network (GNN)",
    "Graph neural network",
  ]);
  assert.equal(groups[0].length, 3);
});

test("existing suggestions accept abstract evidence and reject unsupported neighbor tags", async () => {
  const { api, item } = fixture();
  item.getField = (field) =>
    field === "title" ? "A new approach" : "Deep learning improves accuracy";
  assert.ok(
    (await api.suggest(item, [])).some((tag) => tag.name === "Deep Learning"),
  );
  const rows = [
    {
      score: 0.9,
      item: { id: 2, libraryID: 1, getTags: () => [{ tag: "Other" }] },
    },
  ];
  assert.ok(
    !(await api.suggest(item, rows)).some((tag) => tag.name === "Other"),
  );
});

test("a shared diffusion method cannot import neighboring application tags", async () => {
  const { api, context, item } = fixture();
  // Topic scope: https://proceedings.mlr.press/v306/feng26o.html
  item.getField = (field) =>
    field === "title"
      ? "Unsupervised diffusion solver for combinatorial optimization via combinatorial adjoint matching"
      : "We train discrete diffusion models for combinatorial optimization without labelled solutions. Combinatorial adjoint matching propagates optimization signals along trajectories of continuous-time Markov chains.";
  const supported = [
    "#Combinatorial Optimization",
    "#Optimization",
    "#Diffusion Model",
    "#Continuous-Time Markov Chains",
  ];
  const unrelated = [
    "#Image Synthesis",
    "#Personalized Marketing",
    "#Recommender Systems Systems",
    "#Stable Diffusion",
    "#Denoising Diffusion Probabilistic Models",
    "#Constraint Satisfaction",
    "#Probabilistic Reasoning",
  ];
  context.Zotero.Tags.getAll = async () =>
    [...supported, ...unrelated].map((tag) => ({ tag }));
  const rows = [2, 3, 4].map((id) => ({
    score: 0.99,
    item: {
      id,
      libraryID: 1,
      getTags: () => unrelated.map((tag) => ({ tag })),
      getField: () =>
        "Diffusion models for image synthesis and personalized marketing",
    },
  }));
  for (const tag of await context.SWTagSuggestions.rank(item, rows, [
    ...supported,
    ...unrelated,
  ]))
    assert.ok(!unrelated.includes(tag.name));
  context.SWSemantic = {
    _enabled: true,
    tagSimilarity: async (_item, names) => {
      assert.ok(names.every((name) => !unrelated.includes(name)));
      return names.map(() => 0.95);
    },
  };
  const result = await api.suggest(item, rows);
  assert.ok(result.some((tag) => tag.name === "#Combinatorial Optimization"));
  assert.ok(!result.some((tag) => tag.name === "#Diffusion Model"));
  assert.ok(
    !result.some((tag) => tag.name === "#Continuous-Time Markov Chains"),
  );
  assert.ok(
    result.length < 5,
    "Core topics must displace peripheral method tags",
  );
  assert.ok(result.every((tag) => !unrelated.includes(tag.name)));
  assert.ok(result.length > 0);
  assert.ok(result.every((tag, i) => !i || result[i - 1].score >= tag.score));
  assert.ok(result.some((tag) => tag.isNew));
});

test("direct topic evidence accepts equivalent acronyms without losing task qualifiers", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () =>
    ["Graph Neural Networks", "Conditional GAN", "Image generation"].map(
      (tag) => ({ tag }),
    );
  item.getField = (field) =>
    field === "title"
      ? "GNN for molecule prediction"
      : "A GAN improves molecular representations.";
  const tags = await api.suggest(item, []);
  assert.ok(tags.some((tag) => tag.name === "Graph Neural Networks"));
  assert.ok(
    !tags.some(
      (tag) =>
        tag.name === "Conditional GAN" || tag.name === "Image generation",
    ),
  );
});

test("terminology aliases preserve task modifiers", () => {
  const { api } = fixture();
  assert.equal(api.duplicateReason("Convolutional Nets", "CNN"), "alias");
  assert.equal(
    api.duplicateReason(
      "Conditional GAN",
      "Conditional generative adversarial network",
    ),
    "alias",
  );
  assert.equal(api.duplicateReason("GAN", "Conditional GAN"), null);
  assert.equal(api.duplicateGroups(["Convolutional Nets", "CNN"])[0].length, 2);
});

test("tag suggestions do not read full text or promote its peripheral topics", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () => [{ tag: "Image synthesis" }];
  item.getField = (field) =>
    field === "title"
      ? "Discrete solvers for combinatorial optimization"
      : "Discrete solvers address combinatorial optimization.";
  const body =
    "Lagrangian relaxation coordinates binary decisions.\n" +
    "We employ Lagrangian relaxation to enforce feasible solutions.\n" +
    "The Lagrangian relaxation objective controls constraint violations.\n" +
    "Image synthesis is an unrelated application.\nReferences\n" +
    "Image synthesis. Image synthesis. Image synthesis.";
  const counts = await context.SWSearch.extract({
    title: item.getField("title"),
    abstract: "",
    body,
  });
  let reads = 0;
  context.SWIndexer = {
    docKey: () => "1/Q",
    tagText: async () => {
      reads++;
      return body;
    },
    corpus: {
      search: {
        docs: new Map([
          ["1/Q", { counts: context.SWSearch.encodeCounts(counts) }],
        ]),
      },
    },
  };
  const tags = await api.suggest(item, []);
  assert.equal(reads, 0);
  assert.ok(tags.every((tag) => tag.name !== "Lagrangian relaxation"));
  assert.ok(tags.every((tag) => !/image synthesis/i.test(tag.name)));
  assert.ok(tags.some((tag) => /combinatorial optimization/i.test(tag.name)));
});

test("topic selection removes nested fragments but keeps distinct tasks with a shared word", () => {
  const { context } = fixture();
  const selected = context.SWTagSuggestions.select([
    { name: "Combinatorial optimization", score: 0.94, isNew: false },
    { name: "Combinatorial adjoint matching", score: 0.94, isNew: true },
    { name: "Adjoint matching", score: 0.94, isNew: false },
    { name: "Optimization", score: 0.94, isNew: false },
  ]);
  assert.deepEqual(
    Array.from(selected, (tag) => tag.name),
    ["Combinatorial adjoint matching", "Combinatorial optimization"],
  );
});

test("core topics displace incidental abstract tags even when semantic scores are high", async () => {
  const { api, context, item } = fixture();
  const incidental = [
    "Image synthesis",
    "Personalized marketing",
    "Recommender systems",
    "Probabilistic reasoning",
    "Attention mechanisms",
    "Domain adaptation",
  ];
  context.Zotero.Tags.getAll = async () =>
    ["Graph Neural Networks", "Representation learning", ...incidental].map(
      (tag) => ({ tag }),
    );
  item.getField = (field) =>
    field === "title"
      ? "Graph Neural Networks for molecule prediction"
      : "Graph neural networks improve molecule prediction. Representation learning improves the encoder. " +
        "Representation learning retains molecular structure. We discuss " +
        incidental.join("; ") +
        ".";
  context.SWSemantic = {
    _enabled: true,
    tagSimilarity: async (_item, names) => names.map(() => 0.99),
  };
  const tags = await api.suggest(item, []);
  assert.ok(tags.some((tag) => tag.name === "Graph Neural Networks"));
  assert.ok(
    tags.some((tag) => tag.isNew && tag.name === "Molecule prediction"),
  );
  assert.ok(tags.every((tag) => tag.name !== "Representation learning"));
  assert.ok(tags.every((tag) => !incidental.includes(tag.name)));
  assert.equal(tags.length, 2);
});

test("a diffusion topic remains when it is central in the title", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () =>
    ["Diffusion Model", "Markov chains", "Image synthesis"].map((tag) => ({
      tag,
    }));
  item.getField = (field) =>
    field === "title"
      ? "Diffusion models for combinatorial optimization"
      : "Diffusion models address combinatorial optimization. We use Markov chains to implement the solver.";
  const tags = await api.suggest(item, []);
  assert.ok(tags.some((tag) => tag.name === "Diffusion Model"));
  assert.ok(
    tags.some(
      (tag) => tag.isNew && /combinatorial optimization/i.test(tag.name),
    ),
  );
  assert.ok(
    tags.every(
      (tag) => tag.name !== "Markov chains" && tag.name !== "Image synthesis",
    ),
  );
});

test("suggestions prefer specific technical phrases over single words and generic framework names", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () =>
    [
      "Optimization",
      "Framework",
      "Novel Framework",
      "Graph Neural Networks",
      "MIMO",
      "Channel Estimation",
    ].map((tag) => ({ tag }));
  item.getField = (field) =>
    field === "title"
      ? "Optimization using a Novel Framework for Graph Neural Networks and MIMO Channel Estimation"
      : "Graph neural networks support MIMO channel estimation. The novel framework improves optimization.";
  const before = JSON.stringify(item.getTags());
  const tags = await api.suggest(item, []);
  assert.ok(tags.some((tag) => /graph neural networks/i.test(tag.name)));
  assert.ok(tags.some((tag) => /channel estimation/i.test(tag.name)));
  assert.ok(
    tags.every(
      (tag) =>
        !["optimization", "framework", "novel framework"].includes(
          tag.name.toLowerCase(),
        ),
    ),
  );
  assert.equal(context.SWTagSuggestions.isSpecific("CNN"), true);
  assert.equal(context.SWTagSuggestions.isSpecific("MIMO"), true);
  assert.equal(context.SWTagSuggestions.isSpecific("AI"), false);
  assert.equal(context.SWTagSuggestions.isSpecific("METHOD"), false);
  assert.equal(context.SWTagSuggestions.isSpecific("LEARNING"), false);
  assert.equal(JSON.stringify(item.getTags()), before);
});

test("paper topics exclude the reported PDF fragments and mix New and Existing by relevance", async () => {
  const { api, context, item } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "title", tagHashtag: true })[key] ?? fallback;
  const noise = [
    "Via Combinatorial Adjoint Matching",
    "Sanokowski Et Al",
    "Co Problems",
    "J T",
    "Trajectory-level Optimization",
    "Maximum Independent Set",
    "Continuous-time Markov",
    "Transition Rates",
    "I-th Coordinate",
    "Er Graphs",
    "State X",
    "Stochastic Optimal Control",
    "Traveling Salesman Problem",
    "Discrete Generative",
    "U Θ",
  ];
  context.Zotero.Tags.getAll = async () =>
    ["#Combinatorial Optimization", ...noise].map((tag) => ({ tag }));
  item.getField = (field) =>
    field === "title"
      ? "Unsupervised diffusion solver for combinatorial optimization via combinatorial adjoint matching"
      : "Combinatorial adjoint matching trains diffusion models for combinatorial optimization. The traveling salesman problem is one benchmark.";
  context.SWIndexer = {
    tagText: async () => {
      throw new Error("Suggestions must not read PDF prose");
    },
  };
  const rows = [
    {
      score: 0.99,
      item: {
        id: 2,
        libraryID: 1,
        getTags: () => [
          { tag: "#Combinatorial Optimization" },
          { tag: "Traveling Salesman Problem" },
        ],
      },
    },
  ];
  const tags = await api.suggest(item, rows);
  assert.deepEqual(
    Array.from(tags, (tag) => [tag.name, tag.isNew]),
    [
      ["#Combinatorial Optimization", false],
      ["#Combinatorial Adjoint Matching", true],
    ],
  );
  assert.ok(tags[0].score > tags[1].score);
  assert.ok(
    tags.every(
      (tag) =>
        !noise.some(
          (name) =>
            context.SWTagSuggestions.text(name) ===
            context.SWTagSuggestions.text(tag.name),
        ) || /adjoint matching/i.test(tag.name),
    ),
  );
});

test("weak candidates are omitted instead of padding six results and status never breaks a score tie", () => {
  const { context } = fixture();
  const selected = context.SWTagSuggestions.select([
    { name: "Molecule prediction", score: 0.98, isNew: false },
    { name: "Graph clustering", score: 0.96, isNew: true },
    { name: "Object detection", score: 0.8, isNew: true },
    { name: "Image retrieval", score: 0.7, isNew: false },
  ]);
  assert.deepEqual(
    Array.from(selected, (tag) => tag.name),
    ["Molecule prediction", "Graph clustering"],
  );
  const tied = [
    { name: "Graph clustering", score: 1, isNew: true },
    { name: "Molecule prediction", score: 1, isNew: false },
  ];
  const names = (list) =>
    Array.from(context.SWTagSuggestions.select(list), (tag) => tag.name);
  assert.deepEqual(
    names(tied),
    names(tied.map((tag) => ({ ...tag, isNew: !tag.isNew }))),
  );
});
