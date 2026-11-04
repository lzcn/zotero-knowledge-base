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
    "tag-policy.js",
    "tag-terms.js",
    "tag-format.js",
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
  context.SWTagTerms.set(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../addon/content/library/tag-terms.json"),
        "utf8",
      ),
    ),
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

test("suggestions preserve existing spellings and format only new topics", async () => {
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
  assert.ok(
    suggestions.some(
      (tag) => tag.isNew && tag.name === "#Graph neural networks",
    ),
  );
});

test("manual names retain hyphens, CamelCase, scientific spelling and leading hashes", () => {
  const { api } = fixture();
  for (const name of [
    "co-attention",
    "CamelCase",
    "PyTorch",
    "#GNU/Linux",
    "C++",
    "sentence case",
    "Title Case",
  ])
    assert.equal(api.normalizeName("  " + name + "  "), name);
});

test("manual exclusions protect name variants, destinations and new-tag creation across libraries", async () => {
  const { api, context, item, writes } = fixture();
  context.Zotero.Tags.getColors = (library) =>
    library === 1
      ? new Map([["Deep Learning", { color: "#123456", position: 0 }]])
      : new Map();
  context.SWPref = (key, fallback) =>
    key === "excludedTags" ? "Deep Learning" : fallback;
  assert.deepEqual(Array.from(await api.catalog(1, true)), ["Other"]);
  assert.equal((await api.catalog(2, true)).length, 1);
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
  context.SWPref = (_key, fallback) => fallback;
  assert.equal((await api.catalog(1, true)).length, 3);
});

test("colored and wildcard exclusions protect only the current library and recheck before writes", async () => {
  const { api, context, tags, writes, item } = fixture();
  const colors = new Map([["Deep Learning", { color: "#123456" }]]);
  context.Zotero.Tags.getColors = (library) =>
    library === 1 ? colors : new Map();
  context.SWPref = (key, fallback) =>
    key === "excludedTags" ? "@colored, Other*" : fallback;
  assert.deepEqual(Array.from(await api.catalog(1, true)), []);
  assert.deepEqual(
    Array.from(await api.catalog(2, true)),
    ["deep-learning", "Deep Learning"].sort((a, b) => a.localeCompare(b)),
  );
  await assert.rejects(api.merge(1, ["deep-learning"], "Free"), /protected/);
  await assert.rejects(api.remove(1, ["Deep Learning"]), /protected/);
  await assert.rejects(
    api.addSelected(1, 1, ["#DeepLearning"], () => true, ["#DeepLearning"]),
    /protected/,
  );
  assert.deepEqual(writes, []);
  assert.equal(
    api.recommend(item, [
      {
        score: 1,
        item: {
          id: 2,
          libraryID: 1,
          getTags: () => [{ tag: "Deep Learning" }, { tag: "Other" }],
        },
      },
    ]).length,
    0,
  );
  colors.clear();
  assert.equal((await api.catalog(1, true)).length, 2);
  tags.set("fresh topic", [1]);
  const plan = await api.planFormat(1, ["fresh topic"]);
  colors.set("fresh topic", {});
  await assert.rejects(api.applyFormat(1, plan), /protected/);
  assert.deepEqual(writes, []);
  assert.ok(tags.has("fresh topic"));
});

test("comma-separated exclusions are reread before each write without renaming native tags", async () => {
  const { api, context, item, writes } = fixture();
  let excluded = " Other , #DeepLearning， ";
  context.SWPref = (key, fallback) =>
    ({ excludedTags: excluded })[key] ?? fallback;
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
  context.SWPref = (key, fallback) =>
    key === "excludedTags" ? "DeepLearning" : fallback;
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
  assert.ok(existing.length > 6 && existing.length < names.length);
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
  assert.ok(fresh.length >= 4 && fresh.length <= names.length);
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
    tagSimilarity: async (_item, candidates) =>
      candidates.map((name) => (names.includes(name) ? 0.1 : 0.9)),
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
    if (tag.direct) assert.ok(!unrelated.includes(tag.name));
  context.SWSemantic = {
    _enabled: true,
    tagSimilarity: async (_item, names) => {
      return names.map((name) => (unrelated.includes(name) ? 0.1 : 0.95));
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

test("tag suggestions reuse cached text for repeated topics and remove references", async () => {
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
  assert.equal(reads, 1);
  assert.ok(tags.some((tag) => tag.name === "Lagrangian relaxation"));
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
  assert.ok(tags.some((tag) => tag.name === "Representation learning"));
  assert.ok(tags.every((tag) => !incidental.includes(tag.name)));
  assert.ok(tags.length >= 3 && tags.length <= 6);
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
        !["framework", "novel framework"].includes(tag.name.toLowerCase()),
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
      return "An unrelated benchmark is briefly discussed.";
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
    { name: "Object detection", score: 0.3, isNew: true },
    { name: "Image retrieval", score: 0.2, isNew: false },
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

test("format previews skip collisions, structures and invalid destinations without touching tags", async () => {
  const { api, context, tags, writes } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "title", tagHashtag: true })[key] ?? fallback;
  tags.clear();
  for (const [name, ids] of [
    ["deep learning", [1]],
    ["Deep Learning", [2]],
    ["existing topic", [3]],
    ["#Existing Topic", [4]],
    ["pytorch training", [1, 2]],
    ["topic/reading", [1]],
    ["a".repeat(255), [5]],
  ])
    tags.set(name, ids);
  const before = JSON.stringify([...tags]);
  const plan = await api.planFormat(1, [...tags.keys()]);
  const statuses = new Map(plan.rows.map((row) => [row.from, row.status]));
  for (const name of ["deep learning", "Deep Learning", "existing topic"])
    assert.equal(statuses.get(name), "collision");
  assert.equal(statuses.get("#Existing Topic"), "unchanged");
  assert.equal(statuses.get("topic/reading"), "structured");
  assert.equal(statuses.get("a".repeat(255)), "invalid");
  assert.equal(plan.itemCount, 2);
  assert.equal(JSON.stringify([...tags]), before);
  assert.equal(writes.length, 0);
  const progress = [];
  assert.equal(
    await api.applyFormat(
      1,
      plan,
      () => true,
      (...args) => progress.push(args),
    ),
    1,
  );
  assert.deepEqual(tags.get("#PyTorch Training"), [1, 2]);
  assert.deepEqual(tags.get("deep learning"), [1]);
  assert.deepEqual(tags.get("Deep Learning"), [2]);
  assert.deepEqual(progress, [[1, 1]]);
  assert.deepEqual(writes.at(-1), [1, "#PyTorch Training", "#123456", 0]);
});

test("format application rejects stale membership, settings, destinations, sources and plans before writing", async () => {
  const scenarios = [
    ({ tags }) => tags.set("Other", [99]),
    ({ context }) => {
      context.SWPref = (_key, fallback) => fallback;
    },
    ({ tags }) => tags.set("#Other", [99]),
    ({ tags }) => tags.delete("Other"),
    (_state, plan) => {
      plan.rows[0].to = "Tampered";
    },
    ({ context }) => {
      context.Zotero.Libraries.get = () => ({ editable: false });
    },
    ({ context }) => {
      context.SWPref = (key, fallback) =>
        key === "excludedTags" ? "Other" : fallback;
    },
  ];
  for (const change of scenarios) {
    const state = fixture();
    state.context.SWPref = (key, fallback) =>
      key === "tagHashtag" ? true : fallback;
    const plan = await state.api.planFormat(1, ["Other"]);
    change(state, plan);
    await assert.rejects(
      state.api.applyFormat(1, plan),
      /changed|readonly|protected/,
    );
    assert.equal(state.writes.length, 0);
  }
});

test("formatting cancellation, shutdown and native failure release the operation and stop later writes", async () => {
  for (const mode of ["cancel", "stop", "fail"]) {
    const { api, context, tags, writes } = fixture();
    context.SWPref = (key, fallback) =>
      key === "tagHashtag" ? true : fallback;
    const plan = await api.planFormat(1, ["Other", "Deep Learning"]);
    let active = true;
    const rename = context.Zotero.Tags.rename;
    context.Zotero.Tags.rename = async (...args) => {
      if (mode === "fail") throw new Error("Native rename failed");
      await rename(...args);
      if (mode === "stop") api.stop();
      else active = false;
    };
    await assert.rejects(
      api.applyFormat(1, plan, () => active),
      /cancelled|Native rename failed/,
    );
    assert.ok(tags.has("Deep Learning"));
    assert.equal(
      writes.filter((row) => Array.isArray(row) && typeof row[2] === "string")
        .length,
      mode === "fail" ? 0 : 2,
    );
    assert.equal(api._formatting.size, 0);
    await api.finishWrites();
  }
});

test("concurrent formatting refuses a duplicate operation and detects changes before later writes", async () => {
  const { api, context, tags } = fixture();
  context.SWPref = (key, fallback) => (key === "tagHashtag" ? true : fallback);
  const plan = await api.planFormat(1, ["Other", "Deep Learning"]);
  const rename = context.Zotero.Tags.rename;
  context.Zotero.Tags.rename = async (...args) => {
    await assert.rejects(api.applyFormat(1, plan), /changed/);
    await rename(...args);
    tags.set("#Deep learning", [88]);
  };
  await assert.rejects(api.applyFormat(1, plan), /changed/);
  assert.deepEqual(tags.get("Deep Learning"), [1, 2]);
  assert.deepEqual(tags.get("#Deep learning"), [88]);
  assert.equal(api._formatting.size, 0);
});

test("settings and destinations changed during the final asynchronous read stop the rename", async () => {
  for (const change of [
    ({ context }) => {
      context.SWPref = (_key, fallback) => fallback;
    },
    ({ tags }) => tags.set("#Other", [88]),
  ]) {
    const state = fixture();
    state.context.SWPref = (key, fallback) =>
      key === "tagHashtag" ? true : fallback;
    const plan = await state.api.planFormat(1, ["Other"]);
    const getItems = state.context.Zotero.Tags.getTagItems;
    let reads = 0;
    state.context.Zotero.Tags.getTagItems = async (...args) => {
      const ids = await getItems(...args);
      if (++reads === 2) change(state);
      return ids;
    };
    await assert.rejects(state.api.applyFormat(1, plan), /changed/);
    assert.equal(state.writes.length, 0);
  }
});

test("potential duplicates add semantic peers without chaining opposites, versions or weak links", async () => {
  const { api, context, writes } = fixture();
  let scans = 0;
  context.SWSemantic = {
    _enabled: true,
    version: "fixture",
    _generation: 1,
    tagRelations: async () => {
      scans++;
      return [
        {
          left: "Image classification",
          right: "Image categorization",
          score: 0.9,
        },
        {
          left: "Image categorization",
          right: "Visual categorization",
          score: 0.87,
        },
        {
          left: "Supervised learning",
          right: "Unsupervised learning",
          score: 0.99,
        },
        { left: "GPT-2", right: "GPT-3", score: 0.99 },
      ];
    },
  };
  const names = [
    "Image classification",
    "Image categorization",
    "Visual categorization",
    "Supervised learning",
    "Unsupervised learning",
    "GPT-2",
    "GPT-3",
  ];
  const result = await api.potentialDuplicates(names);
  assert.ok(result.semantic);
  assert.deepEqual(
    Array.from(result.groups, (group) => Array.from(group)),
    [["Image classification", "Image categorization"]],
  );
  await api.potentialDuplicates(names);
  assert.equal(scans, 1, "unchanged catalogs reuse the completed result");
  assert.equal(writes.length, 0);
  assert.equal(
    (await api.potentialDuplicates(names, () => false)).groups.length,
    0,
  );
  api.stop();
  assert.equal(api._duplicateCache.size, 0);
});

test("neighbor vocabulary can supply a non-literal existing label only with current-paper semantic support", async () => {
  const { api, context, item } = fixture();
  context.Zotero.Tags.getAll = async () =>
    ["Distributed reinforcement learning", "Personalized marketing"].map(
      (tag) => ({ tag }),
    );
  item.getField = (field) =>
    field === "title"
      ? "Cooperative decision making for UAV networks"
      : "Agents coordinate wireless resources in UAV networks.";
  context.SWSemantic = {
    _enabled: true,
    tagSimilarity: async (_item, names) =>
      names.map((name) =>
        name === "Distributed reinforcement learning" ? 0.62 : 0.05,
      ),
  };
  const rows = [2, 3].map((id) => ({
    score: 0.9,
    item: {
      id,
      libraryID: 1,
      getTags: () => [
        { tag: "Distributed reinforcement learning" },
        { tag: "Personalized marketing" },
      ],
    },
  }));
  const result = await api.suggest(item, rows);
  assert.ok(
    result.some(
      (tag) => tag.name === "Distributed reinforcement learning" && !tag.isNew,
    ),
  );
  assert.ok(result.every((tag) => tag.name !== "Personalized marketing"));
  context.SWSemantic._enabled = false;
  assert.ok(
    (await api.suggest(item, rows)).every(
      (tag) => tag.name !== "Distributed reinforcement learning",
    ),
  );
});

test("existing full-text fingerprints support tags beyond the cached text sample without document indexing", async () => {
  const { api, context, item } = fixture();
  item.getField = (field) =>
    field === "title"
      ? "Molecular representations"
      : "We compare several encoders.";
  context.Zotero.Tags.getAll = async () => [{ tag: "Graph pooling" }];
  const counts = await context.SWSearch.extract({
    title: item.getField("title"),
    abstract: item.getField("abstractNote"),
    body: "Graph pooling compresses molecular structures. Graph pooling retains connectivity. Graph pooling preserves features.",
  });
  let reads = 0;
  const forbidden = () => {
    throw new Error("Unexpected document indexing");
  };
  context.SWIndexer = {
    docKey: () => "1/Q",
    ensureNow: forbidden,
    extractText: forbidden,
    tagText: async (_item, _active, limit) => {
      assert.equal(limit, 1200000);
      return "";
    },
    corpus: {
      progress: { phase: "ready" },
      docs: new Map([["1/Q", { hash: "current" }]]),
      search: { docs: new Map([["1/Q", {}]]) },
      _readCounts: async () => {
        reads++;
        return context.SWSearch.encodeCounts(counts);
      },
    },
  };
  const result = await api.suggest(item, []);
  assert.equal(reads, 1);
  assert.ok(result.some((tag) => tag.name === "Graph pooling" && !tag.isNew));
});

test("selection rewards coverage, reuses existing components and never pads low-confidence labels", () => {
  const { context } = fixture();
  const select = (list) =>
    Array.from(context.SWTagSuggestions.select(list), (tag) => tag.name);
  assert.deepEqual(
    select([
      { name: "MIMO", score: 0.9, isNew: false },
      { name: "Channel estimation", score: 0.9, isNew: false },
      { name: "MIMO channel estimation", score: 0.91, isNew: true },
      { name: "Unrelated field", score: 0.2, isNew: false },
    ]),
    ["Channel estimation", "MIMO"],
  );
  const related = [
    "Image classification",
    "Image categorization",
    "Visual categorization",
  ].map((name) => ({ name, score: 0.9, isNew: false }));
  assert.equal(context.SWTagSuggestions.select(related, () => 0.9).length, 1);
});

test("paper changes during semantic inference discard the old recommendation result", async () => {
  const { api, context, item } = fixture();
  item.getField = (field) =>
    field === "title"
      ? "Deep Learning for molecule prediction"
      : "Deep Learning supports molecule prediction.";
  context.SWSemantic = {
    _enabled: true,
    tagSimilarity: async (_item, names) => {
      item.deleted = true;
      return names.map(() => 0.9);
    },
  };
  assert.deepEqual(Array.from(await api.suggest(item, [])), []);
});

test("neighbor votes count explicit aliases once per paper and reuse the supported library spelling", async () => {
  const { api, context, item } = fixture();
  item.names = [];
  const rows = [
    {
      score: 0.9,
      item: {
        id: 2,
        libraryID: 1,
        getTags: () => [{ tag: "GNN" }, { tag: "Graph Neural Networks" }],
      },
    },
  ];
  const votes = api.recommend(item, rows);
  assert.equal(votes.length, 1);
  assert.equal(votes[0].count, 1);
  context.Zotero.Tags.getAll = async () => [
    { tag: "GNN" },
    { tag: "Graph Neural Networks" },
  ];
  item.getField = () => "Graph neural networks for molecule prediction";
  assert.ok(
    (await api.suggest(item, rows)).some(
      (tag) => tag.name === "GNN" && !tag.isNew,
    ),
  );
  item.names = ["Graph Neural Networks"];
  assert.equal(api.recommend(item, rows).length, 0);
});
