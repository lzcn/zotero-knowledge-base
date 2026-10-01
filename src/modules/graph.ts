import { getAll, type ZettelRow, type LinkRow } from "./db";
import { getItemSummary } from "./zotero";

export interface GraphNode {
  id: string;
  title: string;
  kind: "card" | "source" | "unresolved";
  snippet: string;
  itemKey?: string;
  libraryID?: number | null;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: "link" | "source";
  ref: string;
  context: string;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface GraphOptions {
  centerId?: string;
  depth?: number;
  query?: string;
  includeSources?: boolean;
  includeUnresolved?: boolean;
}

/** No list-view LIMIT: isolated cards and cards beyond the first 500 belong
 * to the knowledge graph too. Sources are separate provenance nodes. */
export async function getGraphData(): Promise<GraphData> {
  const rows = await getAll<ZettelRow>("SELECT * FROM zettels ORDER BY id");
  const links = await getAll<LinkRow>(
    "SELECT source_id, target_id, ref FROM links",
  );
  const nodes = new Map<string, GraphNode>();
  const bodies = new Map<string, string>();
  const edges: GraphEdge[] = [];
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      title: row.title || row.id,
      kind: "card",
      snippet: row.body.slice(0, 400),
    });
    bodies.set(row.id, row.body);
  }
  for (const link of links) {
    if (!nodes.has(link.source_id)) continue;
    const target =
      link.target_id && nodes.has(link.target_id)
        ? link.target_id
        : `unresolved:${link.ref}`;
    if (!nodes.has(target))
      nodes.set(target, {
        id: target,
        title: link.ref,
        kind: "unresolved",
        snippet: "",
      });
    const context =
      (bodies.get(link.source_id) || "")
        .split("\n")
        .find((line) => line.includes(link.ref)) || "";
    edges.push({
      source: link.source_id,
      target,
      kind: "link",
      ref: link.ref,
      context: context.slice(0, 400),
    });
  }
  for (const row of rows) {
    if (!row.item_key) continue;
    const id = `source:${row.library_id ?? "unknown"}/${row.item_key}`;
    if (!nodes.has(id)) {
      let title = row.item_key;
      try {
        title =
          (await getItemSummary(row.item_key, row.library_id))?.title || title;
      } catch {
        /* detached source is still provenance */
      }
      nodes.set(id, {
        id,
        title,
        kind: "source",
        snippet: "",
        itemKey: row.item_key,
        libraryID: row.library_id,
      });
    }
    edges.push({
      source: row.id,
      target: id,
      kind: "source",
      ref: row.item_key,
      context: "",
    });
  }
  return { nodes: [...nodes.values()], edges };
}

export function filterGraph(
  graph: GraphData,
  options: GraphOptions = {},
): GraphData {
  let nodes = graph.nodes.filter(
    (node) =>
      node.kind === "card" ||
      (node.kind === "source" && options.includeSources) ||
      (node.kind === "unresolved" && options.includeUnresolved !== false),
  );
  let ids = new Set(nodes.map((node) => node.id));
  let edges = graph.edges.filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target),
  );
  if (options.centerId) {
    const visited = new Set<string>(
      ids.has(options.centerId) ? [options.centerId] : [],
    );
    let frontier = new Set(visited);
    for (
      let hop = 0;
      hop < Math.max(1, Math.min(options.depth || 1, 4));
      hop++
    ) {
      const next = new Set<string>();
      for (const edge of edges) {
        if (frontier.has(edge.source) && !visited.has(edge.target))
          next.add(edge.target);
        if (frontier.has(edge.target) && !visited.has(edge.source))
          next.add(edge.source);
      }
      next.forEach((id) => visited.add(id));
      frontier = next;
    }
    ids = visited;
  }
  const query = options.query?.trim().toLowerCase();
  if (query) {
    const matched = new Set(
      nodes
        .filter(
          (node) =>
            ids.has(node.id) &&
            `${node.title} ${node.id} ${node.snippet}`
              .toLowerCase()
              .includes(query),
        )
        .map((node) => node.id),
    );
    const neighbors = new Set(matched);
    for (const edge of edges) {
      if (matched.has(edge.source) && ids.has(edge.target))
        neighbors.add(edge.target);
      if (matched.has(edge.target) && ids.has(edge.source))
        neighbors.add(edge.source);
    }
    ids = neighbors;
  }
  nodes = nodes.filter((node) => ids.has(node.id));
  edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges };
}
