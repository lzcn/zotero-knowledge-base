import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphData, GraphNode } from "../modules/graph";

export interface LayoutNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  radius: number;
}

export function createGraphLayout(
  graph: GraphData,
  positions = new Map<string, { x: number; y: number }>(),
  settle = true,
) {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    for (const [id, peer] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ]) {
      if (id === peer) continue;
      if (!neighbors.has(id)) neighbors.set(id, new Set());
      neighbors.get(id)!.add(peer);
    }
  }
  const nodes: LayoutNode[] = graph.nodes.map(
    (node) =>
      ({
        ...node,
        ...positions.get(node.id),
        radius: Math.min(
          16,
          6 + 2 * Math.sqrt(neighbors.get(node.id)?.size || 0),
        ),
      }) as LayoutNode,
  );
  const links = graph.edges.map((edge) => ({ ...edge }));
  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<LayoutNode, (typeof links)[number]>(links)
        .id((node) => node.id)
        .distance((edge) => (edge.kind === "parent" ? 100 : 80)),
    )
    .force("charge", forceManyBody().strength(-240).distanceMax(900))
    .force("x", forceX().strength(0.025))
    .force("y", forceY().strength(0.025))
    .force(
      "collide",
      forceCollide<LayoutNode>()
        .radius((node) => node.radius + 12)
        .iterations(2),
    )
    .stop();
  // Settle before fitting; only a node drag starts the animation timer.
  if (settle) simulation.tick(180);
  return simulation;
}
