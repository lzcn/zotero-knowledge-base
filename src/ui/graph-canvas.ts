import type { LayoutNode } from "./graph-layout";
import type { GraphEdge } from "../modules/graph";
import { createGraphGPU } from "./graph-gpu";

export type CanvasEdge = Omit<GraphEdge, "source" | "target"> & {
  source: LayoutNode;
  target: LayoutNode;
};
interface Label {
  text: string;
  visible: boolean;
}
export interface GraphView {
  x: number;
  y: number;
  k: number;
}

/** Batch large graphs into one drawing surface; SVG retains keyboard actions and metadata. */
export function createGraphCanvas(
  canvas: HTMLCanvasElement,
  style: CSSStyleDeclaration,
  gpuCanvas?: HTMLCanvasElement,
) {
  const ctx = canvas.getContext("2d")!;
  let gpu: ReturnType<typeof createGraphGPU>;
  if (gpuCanvas) {
    try {
      gpu = createGraphGPU(gpuCanvas, style);
    } catch (error) {
      Zotero.logError(error as Error);
    }
    gpuCanvas.hidden = !gpu?.available;
  }
  const colors = {
    bg: style.getPropertyValue("--bg").trim(),
    fg: style.getPropertyValue("--fg").trim(),
    accent: style.getPropertyValue("--accent").trim(),
    source: style.getPropertyValue("--source").trim(),
    muted: style.getPropertyValue("--muted").trim(),
    link: style.getPropertyValue("--graph-link").trim(),
  };
  const font = style.fontFamily;
  function draw(
    nodes: LayoutNode[],
    edges: CanvasEdge[],
    view: GraphView,
    labels: Map<string, Label>,
    focus?: string,
    selected?: string,
    matched = new Set<string>(),
    moving = false,
  ) {
    const { width, height } = canvas.getBoundingClientRect();
    const accelerated = gpu?.draw(
      nodes,
      edges,
      view,
      width,
      height,
      focus,
      selected,
      matched,
    );
    if (gpuCanvas) gpuCanvas.hidden = !accelerated;
    // Only CPU-rasterized geometry needs reduced resolution while moving.
    // GPU geometry and its text layer retain Retina resolution throughout.
    const deviceRatio = canvas.ownerDocument.defaultView!.devicePixelRatio || 1;
    const pixelRatio =
      moving && !accelerated ? Math.min(deviceRatio, 1) : deviceRatio;
    const pixelWidth = Math.round(width * pixelRatio),
      pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { x, y, k } = view;
    ctx.setTransform(
      pixelRatio * k,
      0,
      0,
      pixelRatio * k,
      pixelRatio * x,
      pixelRatio * y,
    );
    const radius = (node: LayoutNode) => Math.max(node.radius, 3.5 / k);
    if (!accelerated) {
      const batches = new Map<string, CanvasEdge[]>();
      for (const edge of edges) {
        const highlighted = focus
          ? edge.source.id === focus || edge.target.id === focus
          : matched.has(edge.source.id) || matched.has(edge.target.id);
        const key = edge.kind + (highlighted ? ":active" : "");
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key)!.push(edge);
      }
      for (const [key, batch] of [...batches].sort(
        ([a], [b]) => Number(a.includes(":")) - Number(b.includes(":")),
      )) {
        const active = key.includes(":"),
          kind = batch[0].kind;
        ctx.strokeStyle = active
          ? kind === "source"
            ? colors.source
            : colors.accent
          : colors.link;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.globalAlpha = active ? 1 : 0.65;
        ctx.lineWidth = (active ? 2.4 : kind === "parent" ? 1.2 : 1.1) / k;
        ctx.setLineDash(kind === "source" ? [5 / k, 4 / k] : []);
        const arrows: number[] = [];
        ctx.beginPath();
        for (const edge of batch) {
          const a = edge.source,
            b = edge.target,
            dx = b.x - a.x,
            dy = b.y - a.y,
            length = Math.hypot(dx, dy);
          if (a.id === b.id || length < 1) {
            ctx.moveTo(a.x + 10, a.y - 6);
            ctx.bezierCurveTo(
              a.x + 54,
              a.y - 60,
              a.x - 54,
              a.y - 60,
              a.x - 10,
              a.y - 6,
            );
            if (kind !== "source")
              arrows.push(a.x - 10, a.y - 6, Math.atan2(54, 44));
            continue;
          }
          const start = Math.min(radius(a) + 2, length / 3),
            end = Math.min(radius(b) + 2, length / 3);
          const sx = a.x + (dx / length) * start,
            sy = a.y + (dy / length) * start,
            tx = b.x - (dx / length) * end,
            ty = b.y - (dy / length) * end;
          ctx.moveTo(sx, sy);
          let angle;
          if (kind === "parent") {
            const mid = (sy + ty) / 2;
            ctx.bezierCurveTo(sx, mid, tx, mid, tx, ty);
            angle = Math.atan2(ty - mid, ty === mid ? tx - sx : 0);
          } else {
            const bend = Math.min(80, length * 0.16),
              cx = (sx + tx) / 2 - (dy / length) * bend,
              cy = (sy + ty) / 2 + (dx / length) * bend;
            ctx.quadraticCurveTo(cx, cy, tx, ty);
            angle = Math.atan2(ty - cy, tx - cx);
          }
          if (kind !== "source") arrows.push(tx, ty, angle);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < arrows.length; i += 3) {
          const tx = arrows[i],
            ty = arrows[i + 1],
            angle = arrows[i + 2],
            length = 5 / k,
            half = 2.5 / k;
          const bx = tx - Math.cos(angle) * length,
            by = ty - Math.sin(angle) * length;
          ctx.moveTo(tx, ty);
          ctx.lineTo(bx - Math.sin(angle) * half, by + Math.cos(angle) * half);
          ctx.lineTo(bx + Math.sin(angle) * half, by - Math.cos(angle) * half);
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const nodeBatches = new Map<string, LayoutNode[]>();
      for (const node of nodes) {
        const r = radius(node),
          sx = node.x * k + x,
          sy = node.y * k + y;
        if (
          sx + r * k < 0 ||
          sy + r * k < 0 ||
          sx - r * k > width ||
          sy - r * k > height
        )
          continue;
        const fill =
          node.kind === "source"
            ? colors.source
            : node.kind === "unresolved"
              ? colors.bg
              : node.color || colors.accent;
        const key = JSON.stringify([fill, node.kind === "unresolved"]);
        if (!nodeBatches.has(key)) nodeBatches.set(key, []);
        nodeBatches.get(key)!.push(node);
      }
      for (const [key, batch] of nodeBatches) {
        const [fill, unresolved] = JSON.parse(key) as [string, boolean];
        ctx.fillStyle = fill;
        ctx.strokeStyle = unresolved ? colors.muted : colors.bg;
        ctx.lineWidth = 1.5 / k;
        ctx.setLineDash(unresolved ? [3 / k, 2 / k] : []);
        ctx.beginPath();
        for (const node of batch) {
          const r = radius(node);
          ctx.moveTo(node.x + r, node.y);
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      for (const node of nodes) {
        if (node.id !== focus && node.id !== selected) continue;
        const r = radius(node) + 4 / k;
        ctx.moveTo(node.x + r, node.y);
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    for (const node of nodes) {
      const label = labels.get(node.id);
      if (!label?.visible) continue;
      ctx.font = `${node.radius >= 12 || matched.has(node.id) ? 500 : 400} ${12 / k}px ${font}`;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 4 / k;
      ctx.fillStyle = colors.fg;
      const y = node.y + radius(node) + 16 / k;
      ctx.strokeText(label.text, node.x, y);
      ctx.fillText(label.text, node.x, y);
    }
  }
  return {
    draw,
    get backend() {
      return gpu?.available ? "webgl2" : "canvas";
    },
    dispose() {
      gpu?.dispose();
      if (gpuCanvas) gpuCanvas.hidden = true;
    },
  };
}

export function hitGraphNode(
  nodes: LayoutNode[],
  view: GraphView,
  x: number,
  y: number,
): LayoutNode | undefined {
  let found: LayoutNode | undefined,
    distance = Infinity;
  for (const node of nodes) {
    const delta = Math.hypot(
      node.x * view.k + view.x - x,
      node.y * view.k + view.y - y,
    );
    if (delta <= Math.max(node.radius * view.k, 3.5) + 5 && delta < distance) {
      found = node;
      distance = delta;
    }
  }
  return found;
}
