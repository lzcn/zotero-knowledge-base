// Synthetic geometry timing; excludes note storage, DOM rendering and model inference.
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

const temporary = await mkdtemp(join(tmpdir(), "graph-layout-benchmark-"));
const workerFile = join(temporary, "worker.mjs");
const source =
  process.env.KNOWLEDGE_BASE_LAYOUT_SOURCE || "src/ui/graph-layout-worker.ts";
let worker;
try {
  const bundled = await build({
    entryPoints: [resolve(source)],
    bundle: true,
    format: "esm",
    write: false,
    nodePaths: [resolve("node_modules")],
  });
  await writeFile(
    workerFile,
    `import {parentPort} from 'node:worker_threads';
    globalThis.postMessage=(value,transfer)=>parentPort.postMessage(value,transfer);
    parentPort.on('message',data=>globalThis.onmessage({data}));\n` +
      bundled.outputFiles[0].text,
  );
  const graph = {
    nodes: Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      title: "Note " + i,
      kind: "card",
      snippet: "",
    })),
    edges: Array.from({ length: 1400 }, (_, i) => ({
      source: String(i % 1000),
      target: String((i * 7 + 1) % 1000),
      kind: i % 5 === 0 ? "parent" : "link",
      ref: "",
      context: "",
    })),
  };
  const runs = [];
  for (let i = 0; i < 3; i++) {
    worker = new Worker(workerFile);
    const start = performance.now();
    let messages = 0;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Layout timed out")),
        20000,
      );
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.on("message", (data) => {
        messages++;
        if (!data.done) return;
        clearTimeout(timer);
        try {
          assert.equal(data.positions.length, graph.nodes.length * 4);
          assert.ok(data.positions.every(Number.isFinite));
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      worker.postMessage({
        revision: 1,
        graph,
        nodes: [],
        alpha: 1,
        target: 0,
      });
    });
    runs.push({ elapsedMs: performance.now() - start, messages });
    await worker.terminate();
    worker = undefined;
  }
  console.log(
    JSON.stringify(
      {
        nodes: 1000,
        edges: 1400,
        runs,
        note: "Node Worker geometry benchmark; not end-to-end Zotero opening time.",
      },
      null,
      2,
    ),
  );
} finally {
  await worker?.terminate();
  await rm(temporary, { recursive: true, force: true });
}
