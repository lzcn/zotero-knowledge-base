// Deterministic synthetic workload; excludes model inference and Zotero storage.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const require = createRequire(import.meta.url);
const source = process.env.SW_BENCHMARK_SEARCH
  ? resolve(process.env.SW_BENCHMARK_SEARCH)
  : new URL(
      existsSync(new URL("../src/library/search.js", import.meta.url))
        ? "../src/library/search.js"
        : "../src/search.js",
      import.meta.url,
    ).pathname;
const { SWSearch } = require(source);
const count = Number(process.env.SW_BENCHMARK_DOCUMENTS || 1000);
assert.ok(Number.isInteger(count) && count >= 10);
const index = new SWSearch.Index();
for (let i = 0; i < count; i++) {
  const tf = new Map();
  for (let j = 0; j < 300; j++)
    tf.set(((i % 25) * 1000 + j * 7 + (i % 7)) >>> 0, 1 + ((i + j) % 8));
  index.add(`1/${String(i).padStart(6, "0")}`, tf, true);
}
let pauses = 0;
const start = performance.now();
assert.equal(
  await index.rebuild(async () => {
    pauses++;
    await delay(10);
  }),
  true,
);
const rebuildMs = performance.now() - start;
const queries = [];
const timings = [];
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  const rows = await index.search(
    `1/${String(i).padStart(6, "0")}`,
    20,
    null,
    () => false,
    async () => {},
    () => {},
  );
  timings.push(performance.now() - start);
  queries.push(rows);
}
timings.sort((a, b) => a - b);
const signature = SWSearch.encodeSignature(
  index.docs.values().next().value.vector,
);
let checksum = 0;
const decodeStarted = performance.now();
for (let i = 0; i < 10000; i++)
  checksum += SWSearch.decodeSignature(signature).weights[0];
const signatureDecodeMs = performance.now() - decodeStarted;
assert.ok(Number.isFinite(checksum) && checksum > 0);

console.log(
  JSON.stringify(
    {
      documents: count,
      rebuildMs,
      pauses,
      signatureDecodes: 10000,
      signatureDecodeMs,
      queryP50Ms: timings[10],
      queryP95Ms: timings[19],
      rankingDigest: createHash("sha256")
        .update(JSON.stringify(queries))
        .digest("hex"),
      note: "Synthetic Node benchmark; not Zotero startup or native inference timings.",
    },
    null,
    2,
  ),
);
