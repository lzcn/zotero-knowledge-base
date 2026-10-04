import { getAll, type ZettelRow, type LinkRow, type NoteKind } from "./db";
import { getItemSummary } from "./zotero";

export interface GraphNode {
  id: string;
  title: string;
  kind: "card" | "source" | "unresolved";
  snippet: string;
  noteKind?: NoteKind;
  citation?: string;
  parentId?: string | null;
  itemKey?: string;
  libraryID?: number | null;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: "link" | "source" | "parent";
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
  relationMode?: "hierarchy" | "references" | "both";
  entriesOnly?: boolean;
}

/** No list-view LIMIT: isolated cards and cards beyond the first 500 belong
 * to the knowledge graph too. Sources are separate provenance nodes. */
export async function getGraphData(): Promise<GraphData> {
  const rows = await getAll<ZettelRow>("SELECT * FROM zettels ORDER BY id");
  const links = await getAll<LinkRow>(
    "SELECT source_id, target_id, ref FROM links",
  );
  const parents = await getAll<{ card_id: string; parent_id: string | null }>(
    "SELECT card_id, parent_id FROM card_parents",
  );
  const parentMap = new Map(parents.map((row) => [row.card_id, row.parent_id]));
  const nodes = new Map<string, GraphNode>();
  const bodies = new Map<string, string>();
  const edges: GraphEdge[] = [];
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      title: row.title || row.id,
      kind: "card",
      noteKind: row.kind,
      parentId: parentMap.get(row.id) ?? null,
      snippet: row.body,
    });
    bodies.set(row.id, row.body);
  }
  for (const row of parents)
    if (row.parent_id && nodes.has(row.parent_id) && nodes.has(row.card_id))
      edges.push({
        source: row.parent_id,
        target: row.card_id,
        kind: "parent",
        ref: row.card_id,
        context: "",
      });
  for (const link of links) {
    if (
      !nodes.has(link.source_id) ||
      (!link.target_id && link.ref.startsWith("zotero://"))
    )
      continue;
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
      let citation = "";
      try {
        const summary = await getItemSummary(row.item_key, row.library_id);
        title = summary?.title || title;
        citation = [summary?.creatorYear, summary?.publication]
          .filter(Boolean)
          .join(" · ");
      } catch {
        /* detached source is still provenance */
      }
      nodes.set(id, {
        id,
        title,
        kind: "source",
        snippet: citation,
        citation,
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
      (options.relationMode !== "hierarchy" &&
        node.kind === "source" &&
        options.includeSources) ||
      (options.relationMode !== "hierarchy" &&
        node.kind === "unresolved" &&
        options.includeUnresolved !== false),
  );
  let ids = new Set(nodes.map((node) => node.id));
  let edges = graph.edges.filter(
    (edge) =>
      ids.has(edge.source) &&
      ids.has(edge.target) &&
      (options.relationMode === "hierarchy"
        ? edge.kind === "parent"
        : options.relationMode === "references"
          ? edge.kind !== "parent"
          : true),
  );
  if (options.entriesOnly) {
    nodes = nodes.filter((node) => node.kind === "card" && !node.parentId);
    ids = new Set(nodes.map((node) => node.id));
  }
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

/** Clip endpoints to node circles and curve references away from the outline. */
export function edgePath(
  source: { x: number; y: number; id: string; radius?: number },
  target: { x: number; y: number; id: string; radius?: number },
  kind: GraphEdge["kind"],
): string {
  const dx = target.x - source.x,
    dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (source.id === target.id || length < 1)
    return `M ${source.x + 10} ${source.y - 6} C ${source.x + 54} ${source.y - 60}, ${source.x - 54} ${source.y - 60}, ${source.x - 10} ${source.y - 6}`;
  const sourceOffset = Math.min((source.radius ?? 12) + 2, length / 3);
  const targetOffset = Math.min((target.radius ?? 12) + 2, length / 3);
  const sx = source.x + (dx / length) * sourceOffset,
    sy = source.y + (dy / length) * sourceOffset;
  const tx = target.x - (dx / length) * targetOffset,
    ty = target.y - (dy / length) * targetOffset;
  if (kind === "parent") {
    const mid = (sy + ty) / 2;
    return `M ${sx} ${sy} C ${sx} ${mid}, ${tx} ${mid}, ${tx} ${ty}`;
  }
  const bend = Math.min(80, length * 0.16);
  return `M ${sx} ${sy} Q ${(sx + tx) / 2 - (dy / length) * bend} ${(sy + ty) / 2 + (dx / length) * bend}, ${tx} ${ty}`;
}
