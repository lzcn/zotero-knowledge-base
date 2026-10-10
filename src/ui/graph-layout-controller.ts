import { createGraphLayout } from "./graph-layout";
import type { GraphData } from "../modules/graph";

/** Settle forces in a Worker and interpolate its snapshots at display refresh rate. */
export function createAsyncGraphLayout(
  graph: GraphData,
  positions: Map<string, { x: number; y: number }>,
  settle: boolean,
) {
  const simulation = createGraphLayout(graph, positions, false);
  const nodes = simulation.nodes();
  const listeners = new Map<string, () => void>();
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  )?.matches;
  let worker: Worker | undefined;
  let stopped = false,
    revision = 0,
    target = 0,
    alpha = 1,
    timer = 0;
  let frame = 0,
    ticks = 0,
    started = 0,
    done = false;
  let destination: Float64Array | undefined;
  const origin = new Float64Array(nodes.length * 2);
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
  const cancelFrame = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
  };
  const paint = () => {
    frame = 0;
    if (stopped || !destination) return;
    const progress = reduceMotion
      ? 1
      : Math.min(1, (performance.now() - started) / 50);
    nodes.forEach((node, i) => {
      if (node.fx != null || node.fy != null) return;
      node.x = origin[i * 2] + (destination![i * 4] - origin[i * 2]) * progress;
      node.y =
        origin[i * 2 + 1] +
        (destination![i * 4 + 1] - origin[i * 2 + 1]) * progress;
      node.vx = destination![i * 4 + 2];
      node.vy = destination![i * 4 + 3];
    });
    listeners.get("tick")?.();
    if (progress < 1) frame = window.requestAnimationFrame(paint);
    else {
      destination = undefined;
      if (done) listeners.get("end")?.();
    }
  };
  const fallback = () => {
    timer = 0;
    if (stopped) return;
    simulation.alpha(alpha).alphaTarget(target).tick(1);
    alpha = simulation.alpha();
    listeners.get("tick")?.();
    if (++ticks < (target ? 360 : 180)) timer = window.setTimeout(fallback, 16);
    else listeners.get("end")?.();
  };
  const start = () => {
    // Coalesce drag events without postponing work indefinitely during a continuous gesture.
    if (timer) return;
    ++revision;
    cancelFrame();
    destination = undefined;
    timer = window.setTimeout(() => {
      timer = 0;
      if (stopped) return;
      ticks = 0;
      if (worker)
        worker.postMessage({
          revision,
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
    }, 16);
  };
  const failed = (error: unknown) => {
    if (stopped) return;
    worker?.terminate();
    worker = undefined;
    window.clearTimeout(timer);
    timer = 0;
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
        if (typeof data.alpha === "number" && Number.isFinite(data.alpha))
          alpha = data.alpha;
        done = !!data.done;
        if (reduceMotion && !done) return;
        nodes.forEach((node, i) => {
          origin[i * 2] = node.x;
          origin[i * 2 + 1] = node.y;
        });
        destination = values;
        started = performance.now();
        if (!frame) frame = window.requestAnimationFrame(paint);
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
      cancelFrame();
      destination = undefined;
      worker?.terminate();
      simulation.stop();
      listeners.clear();
    },
  };
}
