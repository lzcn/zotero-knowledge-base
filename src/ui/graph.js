import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";
import { filterGraph } from "../modules/graph";

const api = new Proxy(
  {},
  { get: (_, key) => window.Zotero.ZettelKnowledgeBase.api[key] },
);
const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
let graph = { nodes: [], edges: [] };
let centerId = window.arguments?.[0]?.centerId;
let selectedId = centerId;
let scope = centerId ? "1" : "all";
let simulation;
let scene;
let transform = { x: 0, y: 0, k: 1 };
let nodeElements = new Map();
let renderedEdges = [];
let pan = null;
let drag = null;
let refreshTimer;
let unsubscribe;

function svgElement(tag, attrs = {}) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs))
    element.setAttribute(key, String(value));
  return element;
}
function run(fn) {
  Promise.resolve()
    .then(fn)
    .catch((error) => {
      $("graph-error").textContent = String(error.message || error);
    });
}
async function refresh() {
  graph = await api.getGraph();
  $("graph-error").textContent = "";
  render();
}
function visibleGraph() {
  return filterGraph(graph, {
    centerId: scope === "all" ? undefined : centerId,
    depth: Number(scope) || 1,
    query: $("graph-search").value,
    includeSources: $("graph-sources").checked,
    includeUnresolved: $("graph-unresolved").checked,
  });
}
function size() {
  const rect = $("graph-canvas").getBoundingClientRect();
  return {
    width: Math.max(300, rect.width),
    height: Math.max(240, rect.height),
  };
}
function applyTransform() {
  updateLabels();
  scene?.setAttribute(
    "transform",
    `translate(${transform.x},${transform.y}) scale(${transform.k})`,
  );
}
// Cull intersecting labels in screen coordinates; hover/focus still reveals a title.
function updateLabels() {
  const occupied = [];
  const nodes = [...(simulation?.nodes() || [])].sort(
    (a, b) => Number(b.id === selectedId) - Number(a.id === selectedId),
  );
  for (const node of nodes) {
    const group = nodeElements.get(node.id);
    if (!group) continue;
    const text = group.querySelector("text").textContent;
    const width =
      Array.from(text).reduce(
        (sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7),
        0,
      ) * transform.k;
    const x = (node.x + 12) * transform.k + transform.x;
    const y = (node.y - 10) * transform.k + transform.y;
    const rect = {
      x,
      y,
      right: x + width + 8,
      bottom: y + 18 * transform.k + 6,
    };
    const overlaps = occupied.some(
      (other) =>
        rect.x < other.right &&
        rect.right > other.x &&
        rect.y < other.bottom &&
        rect.bottom > other.y,
    );
    const visible =
      node.id === selectedId ||
      (transform.k >= 0.55 && occupied.length < 80 && !overlaps);
    group.classList.toggle("label-hidden", !visible);
    if (visible) occupied.push(rect);
  }
}
function fit() {
  const { width, height } = size();
  const nodes = simulation?.nodes() || [];
  if (!nodes.length) return;
  const minX = Math.min(...nodes.map((node) => node.x || 0)) - 80;
  const maxX = Math.max(...nodes.map((node) => node.x || 0)) + 80;
  const minY = Math.min(...nodes.map((node) => node.y || 0)) - 50;
  const maxY = Math.max(...nodes.map((node) => node.y || 0)) + 50;
  const k = Math.max(
    0.15,
    Math.min(1.8, width / (maxX - minX), height / (maxY - minY)),
  );
  transform = {
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
    k,
  };
  applyTransform();
}
function render() {
  for (const button of $("graph-scope").children)
    button.setAttribute("aria-pressed", String(button.dataset.scope === scope));
  simulation?.stop();
  const data = visibleGraph();
  const nodes = data.nodes.map((node) => ({ ...node }));
  const edges = data.edges.map((edge) => ({ ...edge }));
  const svg = $("graph-svg");
  const { width, height } = size();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: "graph-arrow",
    viewBox: "0 0 10 10",
    refX: 19,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto",
  });
  marker.appendChild(
    svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--accent)" }),
  );
  defs.appendChild(marker);
  svg.appendChild(defs);
  scene = svgElement("g");
  svg.appendChild(scene);
  renderedEdges = edges.map((edge) => {
    const line = svgElement("line", {
      class: `graph-edge ${edge.kind}`,
      "marker-end": edge.kind === "link" ? "url(#graph-arrow)" : "",
    });
    const title = svgElement("title");
    title.textContent = edge.context || edge.ref;
    line.appendChild(title);
    scene.appendChild(line);
    return { edge, line };
  });
  nodeElements = new Map();
  for (const node of nodes) {
    const group = svgElement("g", {
      class: `graph-node ${node.kind}`,
      tabindex: 0,
      role: "button",
      "aria-label": node.title,
    });
    group.appendChild(
      svgElement("circle", { r: node.kind === "card" ? 8 : 6 }),
    );
    const label = svgElement("text", { x: 12, y: 4 });
    const titleChars = Array.from(node.title);
    label.textContent =
      titleChars.slice(0, 24).join("") + (titleChars.length > 24 ? "…" : "");
    group.appendChild(label);
    const title = svgElement("title");
    title.textContent = `${node.title}\n${node.snippet}`;
    group.appendChild(title);
    group.addEventListener("click", (ev) => {
      ev.stopPropagation();
      select(node.id);
    });
    group.addEventListener("dblclick", () => run(() => openNode(node)));
    group.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") run(() => openNode(node));
    });
    group.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      drag = node;
      node.fx = node.x;
      node.fy = node.y;
      simulation.alphaTarget(0.15).restart();
      $("graph-svg").setPointerCapture?.(ev.pointerId);
    });
    nodeElements.set(node.id, group);
    scene.appendChild(group);
  }
  simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink(edges)
        .id((node) => node.id)
        .distance(130),
    )
    .force("charge", forceManyBody().strength(-280))
    .force("collide", forceCollide(30))
    .force("center", forceCenter(0, 0));
  simulation.stop();
  for (let i = 0; i < 80; i++) simulation.tick();
  const tick = () => {
    for (const { edge, line } of renderedEdges) {
      line.setAttribute("x1", edge.source.x);
      line.setAttribute("y1", edge.source.y);
      line.setAttribute("x2", edge.target.x);
      line.setAttribute("y2", edge.target.y);
    }
    for (const node of nodes)
      nodeElements
        .get(node.id)
        .setAttribute("transform", `translate(${node.x},${node.y})`);
    updateLabels();
  };
  tick();
  simulation.on("tick", tick).restart();
  fit();
  $("graph-empty").hidden = nodes.length > 0;
  $("graph-stats").textContent = api.loc("graph-stats", {
    cards: nodes.filter((node) => node.kind === "card").length,
    links: edges.length,
  });
  if (selectedId) select(selectedId);
}
function select(id) {
  selectedId = id;
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    $("graph-selection").hidden = true;
    return;
  }
  const connections = graph.edges.filter(
    (edge) => edge.source === id || edge.target === id,
  );
  const neighbors = new Set([
    id,
    ...connections.flatMap((edge) => [edge.source, edge.target]),
  ]);
  for (const [nodeId, element] of nodeElements) {
    element.classList.toggle("selected", nodeId === id);
    element.classList.toggle("dimmed", !neighbors.has(nodeId));
  }
  for (const { edge, line } of renderedEdges) {
    const source =
      typeof edge.source === "string" ? edge.source : edge.source.id;
    const target =
      typeof edge.target === "string" ? edge.target : edge.target.id;
    line.classList.toggle("dimmed", source !== id && target !== id);
  }
  updateLabels();
  $("graph-selection").hidden = false;
  $("graph-node-title").textContent = node.title;
  $("graph-node-kind").textContent = api.loc(`graph-kind-${node.kind}`);
  $("graph-node-snippet").textContent = node.snippet;
  $("graph-node-open").textContent = api.loc(
    node.kind === "unresolved" ? "graph-create" : "graph-open",
  );
  const list = $("graph-connections");
  list.textContent = "";
  for (const edge of connections) {
    const peerId = edge.source === id ? edge.target : edge.source;
    const peer = graph.nodes.find((candidate) => candidate.id === peerId);
    if (!peer) continue;
    const row = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    row.tabIndex = 0;
    row.textContent = `${edge.kind === "source" ? "◈" : edge.source === id ? "→" : "←"} ${peer.title}`;
    if (edge.context) {
      const context = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "small",
      );
      context.textContent = edge.context;
      row.appendChild(context);
    }
    row.addEventListener("click", () => select(peerId));
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") select(peerId);
    });
    list.appendChild(row);
  }
}
async function openNode(node) {
  if (node.kind === "card") api.openEditor({ zettelId: node.id });
  else if (node.kind === "source")
    await api.selectItem(node.itemKey, node.libraryID);
  else api.openEditor({ prefillTitle: node.title });
}
window.ZettelKnowledgeBase_showGraph = (id) => {
  centerId = id;
  selectedId = id;
  scope = id ? "1" : "all";
  run(refresh);
};
async function load() {
  document.title = api.loc("graph-title");
  const labels = {
    "graph-all": "graph-all",
    "graph-local-one": "graph-local-one",
    "graph-local-two": "graph-local-two",
    "graph-sources-label": "graph-sources",
    "graph-unresolved-label": "graph-unresolved",
    "graph-fit": "graph-fit",
    "graph-refresh": "graph-refresh",
    "graph-hint": "graph-hint",
    "graph-node-focus": "graph-focus",
    "graph-connections-title": "graph-connections",
    "graph-empty": "graph-empty",
    "graph-legend-cards": "graph-legend-cards",
    "graph-legend-sources": "graph-legend-sources",
    "graph-legend-unresolved": "graph-legend-unresolved",
  };
  for (const [id, key] of Object.entries(labels))
    $(id).textContent = api.loc(key);
  $("graph-search").placeholder = api.loc("graph-search");
  scope = centerId ? "1" : "all";
  for (const button of $("graph-scope").children) {
    button.addEventListener("click", () => {
      scope = button.dataset.scope;
      if (scope !== "all" && !centerId)
        centerId =
          selectedId || graph.nodes.find((node) => node.kind === "card")?.id;
      render();
    });
  }
  for (const id of ["graph-sources", "graph-unresolved"])
    $(id).addEventListener("change", render);
  $("graph-search").addEventListener("input", render);
  $("graph-fit").addEventListener("click", fit);
  $("graph-refresh").addEventListener("click", () => run(refresh));
  $("graph-node-open").addEventListener("click", () =>
    run(() => openNode(graph.nodes.find((node) => node.id === selectedId))),
  );
  $("graph-node-focus").addEventListener("click", () => {
    centerId = selectedId;
    scope = "1";
    render();
  });
  $("graph-svg").addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const rect = $("graph-svg").getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const k = Math.min(
        6,
        Math.max(0.1, transform.k * Math.exp(-ev.deltaY * 0.001)),
      );
      transform.x = x - ((x - transform.x) * k) / transform.k;
      transform.y = y - ((y - transform.y) * k) / transform.k;
      transform.k = k;
      applyTransform();
    },
    { passive: false },
  );
  $("graph-svg").addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    pan = { x: ev.clientX, y: ev.clientY, tx: transform.x, ty: transform.y };
    $("graph-svg").setPointerCapture?.(ev.pointerId);
  });
  $("graph-svg").addEventListener("pointermove", (ev) => {
    if (drag) {
      const rect = $("graph-svg").getBoundingClientRect();
      drag.fx = (ev.clientX - rect.left - transform.x) / transform.k;
      drag.fy = (ev.clientY - rect.top - transform.y) / transform.k;
    } else if (pan) {
      transform.x = pan.tx + ev.clientX - pan.x;
      transform.y = pan.ty + ev.clientY - pan.y;
      applyTransform();
    }
  });
  const release = () => {
    if (drag) {
      drag.fx = null;
      drag.fy = null;
      simulation.alphaTarget(0);
    }
    drag = null;
    pan = null;
  };
  $("graph-svg").addEventListener("pointerup", release);
  $("graph-svg").addEventListener("pointercancel", release);
  window.addEventListener("resize", () => {
    const { width, height } = size();
    $("graph-svg").setAttribute("viewBox", `0 0 ${width} ${height}`);
    fit();
  });
  unsubscribe = api.onDataChange(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => run(refresh), 180);
  });
  await refresh();
}
window.addEventListener("load", () => run(load));
window.addEventListener("unload", () => {
  unsubscribe?.();
  simulation?.stop();
  clearTimeout(refreshTimer);
});
