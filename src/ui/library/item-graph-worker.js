import { buildItemGraph } from "./item-graph.js";

let generation = 0;
self.onmessage = async ({ data }) => {
  const token = ++generation;
  try {
    const edges = await buildItemGraph(
      data.documents,
      () => token === generation,
      () => new Promise((resolve) => self.setTimeout(resolve, 0)),
    );
    if (edges && token === generation) self.postMessage({ edges });
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
