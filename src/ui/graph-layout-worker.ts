import { createGraphLayout, type LayoutNode } from "./graph-layout";
import type { GraphData } from "../modules/graph";

interface Job {
  revision: number;
  graph: GraphData;
  nodes: LayoutNode[];
  alpha: number;
  target: number;
}
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Job>) => void;
  postMessage(message: object, transfer: ArrayBuffer[]): void;
  setTimeout(callback: () => void, delay: number): number;
};
let generation = 0;
scope.onmessage = ({ data }) => {
  const token = ++generation;
  const positions = new Map(data.nodes.map((node) => [node.id, node]));
  const simulation = createGraphLayout(data.graph, positions, false)
    .alpha(data.alpha)
    .alphaTarget(data.target);
  let ticks = 0,
    posted = -Infinity;
  const step = () => {
    if (token !== generation) return;
    // Bound each batch so new drag jobs can interrupt even a large graph.
    const until = performance.now() + 8;
    do {
      simulation.tick(1);
      ticks++;
    } while (ticks < (data.target ? 360 : 180) && performance.now() < until);
    const done = ticks >= (data.target ? 360 : 180);
    if (done || performance.now() - posted >= 32) {
      const nodes = simulation.nodes();
      const buffer = new Float64Array(nodes.length * 4);
      nodes.forEach((node, index) =>
        buffer.set([node.x, node.y, node.vx ?? 0, node.vy ?? 0], index * 4),
      );
      scope.postMessage(
        {
          revision: data.revision,
          positions: buffer,
          alpha: simulation.alpha(),
          done,
        },
        [buffer.buffer],
      );
      posted = performance.now();
    }
    if (!done) scope.setTimeout(step, 0);
  };
  step();
};
