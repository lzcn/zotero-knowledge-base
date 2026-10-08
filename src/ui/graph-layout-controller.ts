import { createGraphLayout } from "./graph-layout";
import type { GraphData } from "../modules/graph";

/** Keep geometry immediately available; settle forces outside the UI thread. */
export function createAsyncGraphLayout(
  graph: GraphData,
  positions: Map<string, { x: number; y: number }>,
  settle: boolean,
) {
  const simulation = createGraphLayout(graph, positions, false);
  const nodes = simulation.nodes();
  const listeners = new Map<string, () => void>();
  let worker: Worker | undefined;
  let stopped = false,
    revision = 0,
    target = 0,
    alpha = 1,
    timer = 0;
  let ticks = 0;
  const geometry = {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      title: "",
      snippet: "",
      kind: node.kind,
      group: node.group,
    })),
    edges: graph.edges.map((edge) => ({ ...edge, ref: "", context: "" })),
  };
  const fallback = () => {
    if (stopped) return;
    simulation.alpha(alpha).alphaTarget(target).tick(1);
    alpha = simulation.alpha();
    listeners.get("tick")?.();
    if (++ticks < (target ? 360 : 180)) timer = window.setTimeout(fallback, 0);
    else listeners.get("end")?.();
  };
  const start = () => {
    window.clearTimeout(timer);
    const token = ++revision;
    timer = window.setTimeout(() => {
      if (stopped) return;
      ticks = 0;
      if (worker)
        worker.postMessage({
          revision: token,
          graph: geometry,
          nodes: nodes.map(({ id, x, y, vx, vy, fx, fy }) => ({
            id,
            x,
            y,
            vx,
            vy,
            fx,
            fy,
          })),
          alpha,
          target,
        });
      else fallback();
    }, 0);
  };
  const failed = (error: unknown) => {
    if (stopped) return;
    worker?.terminate();
    worker = undefined;
    Zotero.logError(new Error(`Knowledge Base graph worker: ${String(error)}`));
    start();
  };
  if (typeof window.Worker === "function") {
    try {
      worker = new window.Worker(
        "chrome://knowledge-base/content/graph-layout-worker.js",
      );
      worker.onerror = (event) => {
        event.preventDefault();
        failed(event.message);
      };
      worker.onmessage = (event) => {
        const data = (event as MessageEvent).data;
        if (stopped || data.revision !== revision) return;
        listeners.get("worker")?.();
        const values: Float64Array = data.positions;
        if (
          Object.prototype.toString.call(values) !== "[object Float64Array]" ||
          values.length !== nodes.length * 4 ||
          !values.every(Number.isFinite)
        ) {
          failed("Invalid geometry result");
          return;
        }
        nodes.forEach((node, index) => {
          if (node.fx != null || node.fy != null) return;
          [node.x, node.y, node.vx, node.vy] = values.subarray(
            index * 4,
            index * 4 + 4,
          );
        });
        listeners.get("tick")?.();
        if (data.done) listeners.get("end")?.();
      };
    } catch (error) {
      failed(error);
    }
  }
  if (settle) start();
  return {
    nodes: () => nodes,
    on(name: string, listener: () => void) {
      listeners.set(name, listener);
      return this;
    },
    alpha(value: number) {
      alpha = value;
      return this;
    },
    alphaTarget(value: number) {
      target = value;
      return this;
    },
    restart() {
      if (!stopped) start();
      return this;
    },
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      worker?.terminate();
      simulation.stop();
      listeners.clear();
    },
  };
}
