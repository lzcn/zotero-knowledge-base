// Synthetic persisted-index loading benchmark; never opens a user library.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createContext, runInContext } from "node:vm";
import { performance } from "node:perf_hooks";

const baseline = process.argv[2];
const documentCount = 1200;
function scope(ref) {
  let yieldedMs = 0;
  const context = createContext({
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    Zotero: {
      logError(error) {
        throw error;
      },
      Promise: {
        delay: async (ms) => {
          yieldedMs += ms;
        },
      },
    },
  });
  for (const name of ["search", ...(ref ? [] : ["search-cache"]), "corpus"]) {
    const file = "src/library/" + name + ".js";
    const code = ref
      ? execFileSync("git", ["show", ref + ":" + file], { encoding: "utf8" })
      : readFileSync(file, "utf8");
    runInContext(code, context);
  }
  return { context, yielded: () => yieldedMs };
}
const fixture = scope().context;
const rows = [];
for (let n = 0; n < documentCount; n++) {
  const counts = new Map();
  counts.fields = [12, 50, 1600].map(
    (size, field) =>
      new Map(
        Array.from({ length: size }, (_, i) => [
          field * 100000 + i + (n % 17),
          (i % 5) + 1,
        ]),
      ),
  );
  for (const field of counts.fields)
    for (const [key, value] of field) counts.set(key, value);
  const index = new fixture.SWSearch.Index();
  const doc = index.add("1/" + String(n).padStart(6, "0"), counts, false);
  rows.push({
    key: doc.key,
    hash: "source-" + n,
    weak: 0,
    counts: doc.counts,
    signature: fixture.SWSearch.encodeSignature(doc.vector),
    epoch: 1,
    simhash: fixture.SWSearch.encodeSimhash(doc.simhash),
  });
}
async function measure(ref) {
  const { context, yielded } = scope(ref);
  const corpus = new context.SWCorpus();
  corpus.search.epoch = 1;
  corpus._loadedChanges = 0;
  corpus._maintainEpoch = () => {};
  corpus._db = {
    execute: async (sql, params) => {
      if (sql.startsWith("SELECT COUNT"))
        return [{ getResultByName: () => documentCount }];
      if (sql.startsWith("SELECT d.key"))
        return rows
          .filter((row) => row.key > params[0])
          .slice(0, params[1])
          .map((row) => ({ getResultByName: (name) => row[name] }));
      return [];
    },
  };
  const start = performance.now();
  await corpus._loadAll();
  return {
    cpuMs: Math.round(performance.now() - start),
    scheduledWaitMs: yielded(),
    documents: corpus.n,
    ...(ref
      ? {}
      : await (async () => {
          const bytes = await context.SWSearchCache.encode(
            corpus,
            async () => {},
            () => true,
          );
          const start = performance.now();
          const restored = await context.SWSearchCache.decode(
            bytes,
            corpus.revision,
            async () => {},
            () => true,
          );
          return {
            cacheRestoreMs: Math.round(performance.now() - start),
            cacheBytes: bytes.length,
            restoredDocuments: restored.docs.size,
          };
        })()),
  };
}
const results = {};
for (const [name, ref] of [
  ...(baseline ? [["baseline", baseline]] : []),
  ["current", null],
]) {
  const runs = [];
  for (let n = 0; n < 3; n++) runs.push(await measure(ref));
  runs.sort((a, b) => a.cpuMs - b.cpuMs);
  results[name] = runs[1];
}
console.log(
  JSON.stringify(
    { synthetic: true, baselineRef: baseline, ...results },
    null,
    2,
  ),
);
