const test = require("node:test");
const assert = require("node:assert/strict");
const { SWSearch } = require("../../src/library/search.js");
const algorithm = import("../../src/ui/library/item-graph.js");
const vector = (terms) => new SWSearch.Vector(terms);
const document = (key, topic) => ({
  key,
  vector: vector([[topic, 1]]),
  fieldVectors: [vector([[topic, 1]]), vector([[topic, 1]])],
});

test("parent graphs reuse the retrieval scorer, reject weak pairs and never cross libraries", async () => {
  const { buildItemGraph } = await algorithm;
  const docs = [
    document("1/A", 1),
    document("1/B", 1),
    document("1/C", 2),
    document("2/D", 1),
  ];
  const edges = await buildItemGraph(docs);
  assert.deepEqual(
    edges.map((edge) => [edge.source, edge.target]),
    [["item:1/A", "item:1/B"]],
  );
  assert.equal(
    edges[0].score,
    SWSearch.Index.prototype.similarity(docs[0], docs[1]),
  );
  assert.equal(edges[0].kind, "similarity");
});

test("mutual top three makes a bounded, deterministic graph even for a dense topic", async () => {
  const { buildItemGraph } = await algorithm;
  const docs = Array.from({ length: 20 }, (_, i) =>
    document("1/" + String(i).padStart(2, "0"), 1),
  );
  const edges = await buildItemGraph(docs);
  const degree = new Map();
  for (const edge of edges)
    for (const id of [edge.source, edge.target])
      degree.set(id, (degree.get(id) || 0) + 1);
  assert.ok([...degree.values()].every((value) => value <= 3));
  assert.ok(edges.length > 0 && edges.length < (docs.length * 3) / 2);
  assert.deepEqual(await buildItemGraph([...docs].reverse()), edges);
});

test("strong semantic neighbors can connect while the usual recommendation tail is omitted", async () => {
  const { buildItemGraph } = await algorithm;
  const docs = [
    { key: "1/A", semantic: Float32Array.of(1, 0, 0) },
    { key: "1/B", semantic: Float32Array.of(0.8, 0.6, 0) },
    { key: "1/C", semantic: Float32Array.of(0.5, 0, Math.sqrt(0.75)) },
  ];
  const edges = await buildItemGraph(docs);
  assert.deepEqual(
    edges.map((edge) => [edge.source, edge.target]),
    [["item:1/A", "item:1/B"]],
  );
  assert.ok(edges[0].score >= 0.75);
});

test("parent graph comparison yields and honors cancellation before publishing edges", async () => {
  const { buildItemGraph } = await algorithm;
  const docs = Array.from({ length: 30 }, (_, i) => document("1/" + i, 1));
  let active = true,
    yields = 0;
  const cancelled = await buildItemGraph(
    docs,
    () => active,
    async () => {
      yields++;
      active = false;
    },
  );
  assert.equal(cancelled, null);
  assert.equal(yields, 1);
});
