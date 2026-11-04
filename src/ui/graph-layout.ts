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
  const structure = new Map<string, number>();
  for (const edge of graph.edges)
    if (edge.kind === "parent") {
      structure.set(edge.source, (structure.get(edge.source) || 0) + 1);
      structure.set(edge.target, (structure.get(edge.target) || 0) + 1);
    }
  const parents = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const edge of graph.edges)
    if (edge.kind === "parent") {
      parents.set(edge.target, edge.source);
      if (!children.has(edge.source)) children.set(edge.source, []);
      children.get(edge.source)!.push(edge.target);
    }
  const depth = new Map<string, number>();
  const queue = graph.nodes
    .filter((node) => structure.has(node.id) && !parents.has(node.id))
    .map((node) => node.id);
  for (const id of queue) depth.set(id, 0);
  for (let at = 0; at < queue.length; at++) {
    for (const child of children.get(queue[at]) || []) {
      if (depth.has(child)) continue;
      depth.set(child, depth.get(queue[at])! + 1);
      queue.push(child);
    }
  }
  const middleDepth =
    [...depth.values()].reduce((sum, value) => sum + value, 0) /
    Math.max(1, depth.size);
  const nodes: LayoutNode[] = graph.nodes.map(
    (node) =>
      ({
        ...node,
        ...positions.get(node.id),
        radius: Math.min(
          13,
          6 +
            1.5 * Math.sqrt(structure.get(node.id) || 0) +
            0.7 * Math.sqrt(neighbors.get(node.id)?.size || 0),
        ),
      }) as LayoutNode,
  );
  const links = graph.edges.map((edge) => ({ ...edge }));
  const groups = [...new Set(nodes.map((node) => node.group).filter(Boolean))];
  const radius = Math.max(180, Math.sqrt(nodes.length) * 18);
  const centers = new Map(
    groups.map((group, index) => [
      group,
      {
        x:
          groups.length === 1
            ? 0
            : Math.cos((index * 2 * Math.PI) / groups.length) * radius,
        y:
          groups.length === 1
            ? 0
            : Math.sin((index * 2 * Math.PI) / groups.length) * radius,
      },
    ]),
  );
  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<LayoutNode, (typeof links)[number]>(links)
        .id((node) => node.id)
        .distance((edge) => (edge.kind === "parent" ? 90 : 150))
        .strength((edge) => (edge.kind === "parent" ? 0.8 : 0.12)),
    )
    .force("charge", forceManyBody().strength(-180).distanceMax(900))
    .force(
      "x",
      forceX<LayoutNode>((node) => centers.get(node.group)?.x || 0).strength(
        (node) => (node.group ? 0.08 : 0.025),
      ),
    )
    .force(
      "y",
      forceY<LayoutNode>(
        (node) =>
          (centers.get(node.group)?.y || 0) +
          (depth.has(node.id) ? (depth.get(node.id)! - middleDepth) * 110 : 0),
      ).strength((node) =>
        depth.has(node.id) ? 0.18 : node.group ? 0.08 : 0.025,
      ),
    )
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
