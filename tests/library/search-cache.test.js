const test = require("node:test");
const assert = require("node:assert/strict");
const { SWSearch } = require("../../src/library/search.js");
global.SWSearch = SWSearch;
const { SWSearchCache } = require("../../src/library/search-cache.js");
const pause = async () => {};
const active = () => true;
async function fixture() {
  const search = new SWSearch.Index(),
    docs = new Map();
  for (const [key, fields] of [
    [
      "1/A",
      [
        [
          [1, 2],
          [2, 1],
        ],
        [[3, 4]],
        [
          [5, 2],
          [6, 3],
        ],
      ],
    ],
    [
      "1/B",
      [
        [
          [1, 2],
          [2, 2],
        ],
        [[3, 3]],
        [
          [5, 3],
          [6, 2],
        ],
      ],
    ],
    ["1/C", [[[9, 1]], [[10, 2]], [[11, 3]]]],
  ]) {
    const counts = Object.assign(new Map(fields.flat()), {
      fields: fields.map((entries) => new Map(entries)),
    });
    search.add(key, counts, false);
    docs.set(key, { hash: "hash-" + key, weak: false });
  }
  await search.rebuild();
  return { search, docs, revision: 7 };
}
async function ranks(index) {
  return index.search(
    "1/A",
    100,
    () => true,
    () => false,
    pause,
    () => {},
  );
}
test("finished search cache preserves exact ranking, DF, field vectors and subsequent incremental updates", async () => {
  const corpus = await fixture();
  const bytes = await SWSearchCache.encode(corpus, pause, active);
  const restored = await SWSearchCache.decode(bytes, 7, pause, active);
  assert.deepEqual(await ranks(restored.search), await ranks(corpus.search));
  assert.deepEqual(restored.docs, corpus.docs);
  assert.deepEqual(restored.search.df, corpus.search.df);
  assert.deepEqual(restored.search.frozenDF, corpus.search.frozenDF);
  assert.equal(restored.search.docs.get("1/A").counts, null);
  const removedCounts = corpus.search.docs.get("1/B").counts;
  for (const index of [corpus.search, restored.search]) {
    index.remove("1/B", removedCounts);
    index.add(
      "1/D",
      new Map([
        [1, 3],
        [2, 1],
        [3, 4],
        [5, 2],
      ]),
      true,
    );
  }
  assert.deepEqual(await ranks(restored.search), await ranks(corpus.search));
  assert.deepEqual(restored.search.df, corpus.search.df);
});
test("derived search cache rejects stale revisions and damaged sections, and honors cancellation", async () => {
  const corpus = await fixture();
  const bytes = await SWSearchCache.encode(corpus, pause, active);
  await assert.rejects(
    SWSearchCache.decode(bytes, 8, pause, active),
    /metadata/,
  );
  await assert.rejects(
    SWSearchCache.decode(bytes.subarray(0, bytes.length - 3), 7, pause, active),
    /Truncated/,
  );
  const damaged = bytes.slice();
  damaged[0] = 0;
  await assert.rejects(
    SWSearchCache.decode(damaged, 7, pause, active),
    /header/,
  );
  assert.equal(await SWSearchCache.encode(corpus, pause, () => false), null);
  assert.equal(await SWSearchCache.decode(bytes, 7, pause, () => false), null);
});
