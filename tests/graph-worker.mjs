import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const temp = await mkdtemp(join(tmpdir(), "knowledge-base-worker-"));
const workers = new Set();
try {
  const geometry = join(temp, "geometry.mjs"),
    controller = join(temp, "controller.mjs"),
    adapter = join(temp, "adapter.mjs");
  await build({
    entryPoints: [resolve("src/ui/graph-layout-worker.ts")],
    bundle: true,
    format: "esm",
    outfile: geometry,
  });
  await build({
    entryPoints: [resolve("src/ui/graph-layout-controller.ts")],
    bundle: true,
    format: "esm",
    outfile: controller,
  });
  await writeFile(
    adapter,
    `import {parentPort} from 'node:worker_threads';
    const pending=[];let ready=false;
    globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
    parentPort.on('message',data=>ready?globalThis.onmessage({data}):pending.push(data));
    await import(${JSON.stringify(pathToFileURL(geometry).href)});
    ready=true;for(const data of pending) globalThis.onmessage({data});`,
  );
  class BackgroundWorker {
    constructor() {
      this.thread = new Worker(adapter);
      workers.add(this);
      this.thread.on("message", (data) => this.onmessage?.({ data }));
      this.thread.on("error", (error) =>
        this.onerror?.({ message: error.message, preventDefault() {} }),
      );
    }
    postMessage(data) {
      this.thread.postMessage(data);
    }
    terminate() {
      workers.delete(this);
      return this.thread.terminate();
    }
  }
  const errors = [];
  globalThis.Zotero = { logError: (error) => errors.push(error) };
  globalThis.window = { Worker: BackgroundWorker, setTimeout, clearTimeout };
  const { createAsyncGraphLayout } = await import(pathToFileURL(controller));
  const data = {
    nodes: Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      title: "Note",
      snippet: "",
      kind: "card",
      group: i < 500 ? "Topic A" : "Topic B",
    })),
    edges: Array.from({ length: 500 }, (_, i) => ({
      source: String(i),
      target: String(i + 1),
      kind: "link",
      ref: "",
      context: "",
    })),
  };
  const original = globalThis.structuredClone(data);
  const layout = createAsyncGraphLayout(data, new Map(), true);
  let heartbeat = false,
    background = false,
    frames = 0;
  setTimeout(() => {
    heartbeat = true;
  }, 0);
  const finished = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Worker geometry timed out")),
      20000,
    );
    layout.on("worker", () => {
      background = true;
    });
    layout.on("tick", () => frames++);
    layout.on("end", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await finished;
  assert.ok(heartbeat && background && frames > 1);
  assert.equal(layout.nodes().length, 1000);
  assert.ok(
    layout
      .nodes()
      .every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
  );
  assert.deepEqual(data, original);
  const centroid = (group) => {
    const nodes = layout.nodes().filter((node) => node.group === group);
    return nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
  };
  assert.ok(
    centroid("Topic A") - centroid("Topic B") > 100,
    "Worker geometry must retain tag groups and cluster each topic separately",
  );
  layout.stop();
  assert.equal(workers.size, 0);
  console.log(
    "PASS A real background Worker clusters a thousand-node graph by tag group while the UI thread remains available; shutdown terminates it",
  );

  const fakeWorkers = [];
  globalThis.window.Worker = class {
    messages = [];
    constructor() {
      fakeWorkers.push(this);
    }
    postMessage(value) {
      this.messages.push(value);
    }
    terminate() {
      this.terminated = true;
    }
  };
  const single = createAsyncGraphLayout(
    { nodes: data.nodes.slice(0, 1), edges: [] },
    new Map(),
    true,
  );
  const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
  await wait();
  const fake = fakeWorkers[0];
  const first = fake.messages[0].revision;
  single.restart();
  await wait();
  const initial = single.nodes()[0].x;
  fake.onmessage({
    data: { revision: first, positions: new Float64Array([900, 900, 0, 0]) },
  });
  assert.equal(single.nodes()[0].x, initial);
  single.nodes()[0].fx = 25;
  single.nodes()[0].x = 25;
  fake.onmessage({
    data: {
      revision: fake.messages.at(-1).revision,
      positions: new Float64Array([900, 900, 0, 0]),
    },
  });
  assert.equal(single.nodes()[0].x, 25);
  single.stop();
  fake.onmessage({
    data: {
      revision: fake.messages.at(-1).revision,
      positions: new Float64Array([900, 900, 0, 0]),
    },
  });
  assert.equal(single.nodes()[0].x, 25);
  assert.ok(fake.terminated);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Stale layouts, pinned drag positions and late results after close cannot replace current geometry",
  );
} finally {
  await Promise.all([...workers].map((worker) => worker.terminate()));
  await rm(temp, { recursive: true, force: true });
}
