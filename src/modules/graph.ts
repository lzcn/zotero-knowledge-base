import { getAll, type ZettelRow, type LinkRow } from "./db";
import { getItemSummary } from "./zotero";
import type { NoteType } from "./note-types";
import { getGraphGroups } from "./preferences";
import { inheritCardTags, loadNativeTags, visibleNoteTags } from "./note-tags";

export interface GraphNode {
  id: string;
  title: string;
  reference?: string;
  tags?: string[];
  color?: string;
  group?: string;
  kind: "card" | "item" | "unresolved";
  noteType?: NoteType;
  snippet: string;
  citation?: string;
  parentId?: string | null;
  itemKey?: string;
  libraryID?: number | null;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: "link" | "similarity" | "parent";
  score?: number;
  ref: string;
  context: string;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface ItemGraphDocument {
  key: string;
  vector?: { ids: Uint32Array; weights: Float64Array; length: number };
  fieldVectors?: { ids: Uint32Array; weights: Float64Array; length: number }[];
  semantic?: Float32Array;
}
export interface GraphOptions {
  centerId?: string;
  depth?: number;
  query?: string;
  noteType?: NoteType;
  includeUnresolved?: boolean;
  relationMode?: "hierarchy" | "references" | "both";
}

/** No list-view LIMIT: isolated cards and cards beyond the first 500 belong
 * to the knowledge graph too. Parent items use their own similarity view. */
export async function getGraphData(): Promise<GraphData> {
  const rows = await getAll<ZettelRow>(
    "SELECT * FROM zettels z WHERE NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id) ORDER BY id",
  );
  const links = await getAll<LinkRow>(
    "SELECT source_id, target_id, ref FROM links",
  );
  const parents = await getAll<{ card_id: string; parent_id: string | null }>(
    "SELECT card_id, parent_id FROM card_parents",
  );
  const parentMap = new Map(parents.map((row) => [row.card_id, row.parent_id]));
  const mappings = await getAll<{
    card_id: string;
    library_id: number;
    note_key: string;
  }>("SELECT card_id, library_id, note_key FROM card_notes");
  const libraries = new Map(
    mappings.map((row) => [row.card_id, row.library_id]),
  );
  const notes = await Promise.all(
    mappings.map(async (row) => ({
      row,
      note: await Zotero.Items.getByLibraryAndKeyAsync(
        row.library_id,
        row.note_key,
      ),
    })),
  );
  const available = notes.filter(
    (entry): entry is typeof entry & { note: Zotero.Item } =>
      !!entry.note && entry.note.isNote() && !entry.note.isInTrash(),
  );
  const tagsByNote = await loadNativeTags(
    available.map(({ note }) => note),
    true,
  );
  let nativeTags = new Map<string, string[]>(rows.map((row) => [row.id, []]));
  for (const { row, note } of available)
    nativeTags.set(row.card_id, tagsByNote.get(note) || []);
  for (const row of await getAll<{ zettel_id: string; tag: string }>(
    "SELECT zettel_id, tag FROM tags",
  )) {
    const tags = nativeTags.get(row.zettel_id);
    if (tags && !tags.includes(row.tag)) tags.push(row.tag);
  }
  nativeTags = inheritCardTags(nativeTags, parentMap);
  const groups = getGraphGroups();
  const palette = [
    "#3478f6",
    "#30a46c",
    "#af52de",
    "#f59e0b",
    "#0891b2",
    "#ec4899",
    "#e5484d",
  ];
  const colorFor = (tags: string[], libraryID: number | null) => {
    const colors = libraryID
      ? (Zotero.Tags?.getColors(libraryID) as unknown as
          | Map<string, { color: string; position?: number }>
          | undefined)
      : undefined;
    const colored = tags
      .map((tag) => colors?.get(tag))
      .filter((color): color is { color: string; position?: number } => !!color)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    if (colored.length) return colored[0].color;
    const tag = tags[0];
    let hash = 0;
    for (const char of tag) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    return palette[hash % palette.length];
  };
  const nodes = new Map<string, GraphNode>();
  const bodies = new Map<string, string>();
  const edges: GraphEdge[] = [];
  for (const row of rows) {
    const libraryID = libraries.get(row.id) ?? row.library_id ?? null;
    const tags = visibleNoteTags(nativeTags.get(row.id) || [], libraryID);
    const group = groups.find((group) => group.tag && tags.includes(group.tag));
    nodes.set(row.id, {
      id: row.id,
      title: row.title || row.id,
      kind: "card",
      noteType: row.note_type,
      itemKey: row.item_key ?? undefined,
      libraryID: row.library_id,
      tags,
      color:
        group?.color || (tags.length ? colorFor(tags, libraryID) : undefined),
      group: group?.tag,
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
      (link.target_id && !nodes.has(link.target_id)) ||
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
  return { nodes: [...nodes.values()], edges };
}

/** Only parents of available managed notes belong in the paper view. */
export async function getParentItemNodes(
  active = () => true,
): Promise<GraphNode[]> {
  const rows = await getAll<{ library_id: number; item_key: string }>(
    "SELECT DISTINCT library_id, item_key FROM zettels z WHERE item_key IS NOT NULL AND library_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unavailable_notes u WHERE u.card_id = z.id) ORDER BY library_id, item_key",
  );
  const nodes: GraphNode[] = [];
  for (const row of rows) {
    if (!active()) return [];
    const item = await Zotero.Items.getByLibraryAndKeyAsync(
      row.library_id,
      row.item_key,
    );
    if (!item || !item.isRegularItem() || item.isInTrash()) continue;
    const summary = await getItemSummary(row.item_key, row.library_id);
    if (!summary) continue;
    nodes.push({
      id: `item:${row.library_id}/${row.item_key}`,
      title: summary.title,
      kind: "item",
      itemKey: row.item_key,
      libraryID: row.library_id,
      snippet: [summary.creatorYear, summary.publication]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return nodes;
}

export function filterGraph(
  graph: GraphData,
  options: GraphOptions = {},
): GraphData {
  let nodes = graph.nodes.filter(
    (node) =>
      (node.kind === "item" && !options.noteType) ||
      (node.kind === "card" &&
        (!options.noteType || node.noteType === options.noteType)) ||
      (node.kind === "unresolved" &&
        options.relationMode !== "hierarchy" &&
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
  if (options.noteType) {
    const connected = new Set(
      edges.flatMap((edge) => [edge.source, edge.target]),
    );
    nodes = nodes.filter(
      (node) => node.kind !== "unresolved" || connected.has(node.id),
    );
    ids = new Set(nodes.map((node) => node.id));
  }
  if (options.centerId) {
    const visited = new Set<string>(
      ids.has(options.centerId) ? [options.centerId] : [],
    );
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      for (const [id, peer] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ]) {
        if (!adjacency.has(id)) adjacency.set(id, []);
        adjacency.get(id)!.push(peer);
      }
    }
    let frontier = [...visited];
    const depth = Number.isFinite(options.depth)
      ? Math.max(0, Math.min(Math.floor(options.depth!), 6))
      : 1;
    for (let hop = 0; hop < depth && frontier.length; hop++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const peer of adjacency.get(id) || []) {
          if (visited.has(peer)) continue;
          visited.add(peer);
          next.push(peer);
        }
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
