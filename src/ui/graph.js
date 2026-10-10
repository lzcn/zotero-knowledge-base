import { isAccelKey } from "./platform";
import { select as d3Select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { edgePath, filterGraph } from "../modules/graph";
import { createGraphCanvas, hitGraphNode } from "./graph-canvas";
import { createAsyncGraphLayout } from "./graph-layout-controller";

const api = /** @type {import("../modules/api").KnowledgeBaseAPI} */ (
  new Proxy({}, { get: (_, key) => window.Zotero.ZoteroKnowledgeBase.api[key] })
);
/** @template {keyof import("../../typings/ui").GraphElements} K
 * @param {K} id @returns {import("../../typings/ui").GraphElements[K]} */
const $ = (id) =>
  /** @type {import("../../typings/ui").GraphElements[K]} */ (
    document.getElementById(id)
  );
const svgNS = "http://www.w3.org/2000/svg";
let graph = { nodes: [], edges: [] };
let graphNodes = new Map();
let refreshVersion = 0;
let centerId = /** @type {{ centerId?: string }} */ (window.arguments[0] || {})
  .centerId;
let selectedId = centerId;
let localDepth = api.getGraphLocalDepth();
let scopeChanged = true;
let visibleData = { nodes: [], edges: [] };
let viewport;
let paintFrame = 0;
let nodeViews = new Map();
let labelNodes = [];
let labelTime = 0;
let labelScale = 0;
let labelLength = 0;
let geometryScale = 0;
let canvasRenderer;
let rendererStyle = "";
let canvasEdges = [];
let resizeObserver;
let matchedNodes = new Set();
let paintLabels = new Map();

let layoutNodes = [];
let updatePositions = () => {};
let scene;
let transform = { x: 0, y: 0, k: 1 };
let nodeElements = new Map();
let renderedEdges = [];
let zoomBehavior;
let drag = null;
let dragMoved = false;
let refreshTimer;
let unsubscribe;
let unsubscribeOptions;
let layoutKey = "";
let simulation;
let hoveredId;
let viewMoved = false;
const savedPositions = new Map();

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
  const version = ++refreshVersion;
  const next = await api.getGraph();
  if (version !== refreshVersion) return;
  graph = next;
  graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  $("graph-error").textContent = "";
  render();
}
function visibleGraph() {
  const options = api.getGraphOptions();
  const data = filterGraph(graph, {
    includeSources: options.sources,
    includeUnresolved: true,
  });
  data.edges = data.edges.filter((edge) =>
    edge.kind === "parent"
      ? options.outline
      : edge.kind === "link"
        ? options.references
        : options.sources,
  );
  const scoped = filterGraph(data, {
    includeSources: options.sources,
    centerId,
    depth: localDepth,
  });
  data.nodes = scoped.nodes;
  data.edges = scoped.edges;
  if (options.hideIsolated && !centerId) {
    const connected = new Set();
    for (const edge of data.edges) {
      if (edge.source === edge.target) continue;
      connected.add(edge.source);
      connected.add(edge.target);
    }
    data.nodes = data.nodes.filter((node) => connected.has(node.id));
    data.edges = data.edges.filter(
      (edge) => connected.has(edge.source) && connected.has(edge.target),
    );
  }
  return data;
}
function size() {
  if (!viewport) {
    const rect = $("graph-canvas").getBoundingClientRect();
    viewport = {
      width: Math.max(300, rect.width),
      height: Math.max(240, rect.height),
    };
  }
  return viewport;
}
function applyTransform() {
  if (paintFrame) return;
  paintFrame = window.requestAnimationFrame(() => {
    paintFrame = 0;
    if (!canvasRenderer && geometryScale !== transform.k) updatePositions();
    scene?.setAttribute(
      "transform",
      `translate(${transform.x},${transform.y}) scale(${transform.k})`,
    );
    updateLabels();
    drawCanvas();
  });
}
function drawCanvas() {
  canvasRenderer?.draw(
    layoutNodes,
    canvasEdges,
    transform,
    paintLabels,
    hoveredId || selectedId,
    selectedId,
    matchedNodes,
    $("graph-svg").dataset.layoutState === "running" || !!drag,
  );
  if (canvasRenderer) $("graph-svg").dataset.renderer = canvasRenderer.backend;
}
function gpuChanged() {
  applyTransform();
}
function nodeAt(event) {
  const rect = $("graph-svg").getBoundingClientRect();
  return hitGraphNode(
    layoutNodes,
    transform,
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
}
function syncScope() {
  document.title = api.loc(centerId ? "graph-local" : "graph-global");
  $("graph-global").setAttribute("aria-pressed", String(!centerId));
  $("graph-local").setAttribute("aria-pressed", String(!!centerId));
  $("graph-local").disabled = !centerId && !selectedId;
  $("graph-local").toggleAttribute("disabled", !centerId && !selectedId);
  $("graph-svg").dataset.scope = centerId ? "local" : "global";
  $("graph-svg").dataset.centerId = centerId || "";
  $("graph-svg").dataset.depth = String(localDepth);
}
function showScope(id, reload = false) {
  scopeChanged = centerId !== id;
  centerId = id;
  if (id) selectedId = id;
  if (scopeChanged) viewMoved = false;
  syncScope();
  if (reload) run(refresh);
  else render();
}
/** @param {import("./graph-layout").LayoutNode} node */
function displayRadius(node) {
  return Math.max(node.radius, 3.5 / transform.k);
}
function titleLabel(title) {
  const chars = Array.from(title);
  const limit = api.getGraphLabelLength();
  return chars.slice(0, limit).join("") + (chars.length > limit ? "…" : "");
}
// Keep visible labels compact at every zoom; tooltips and details retain full titles.
function updateLabels() {
  labelTime = window.performance.now();
  const { width: viewportWidth, height: viewportHeight } = size();
  const labelLimit = Math.max(
    24,
    Math.min(160, Math.floor((viewportWidth * viewportHeight) / 6500)),
  );
  const scaleChanged = labelScale !== transform.k;
  const lengthChanged = labelLength !== api.getGraphLabelLength();
  labelScale = transform.k;
  labelLength = api.getGraphLabelLength();
  if (scaleChanged)
    for (const element of $("graph-svg").querySelectorAll("marker")) {
      const marker = /** @type {SVGMarkerElement} */ (element);
      marker.setAttribute("markerWidth", String(5 / transform.k));
      marker.setAttribute("markerHeight", String(5 / transform.k));
    }
  // Screen-space cells keep collision checks local instead of scanning every node per label.
  const cells = new Map();
  const eachCell = (rect, fn) => {
    for (let x = Math.floor(rect.x / 64); x <= Math.floor(rect.right / 64); x++)
      for (
        let y = Math.floor(rect.y / 64);
        y <= Math.floor(rect.bottom / 64);
        y++
      )
        fn(x + ":" + y);
  };
  const insert = (rect) =>
    eachCell(rect, (key) => {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(rect);
    });
  for (const node of layoutNodes) {
    const radius = displayRadius(node) * transform.k + 3;
    const x = node.x * transform.k + transform.x,
      y = node.y * transform.k + transform.y;
    if (
      x + radius < 0 ||
      y + radius < 0 ||
      x - radius > viewportWidth ||
      y - radius > viewportHeight
    )
      continue;
    insert({
      id: node.id,
      circle: true,
      x: x - radius,
      y: y - radius,
      right: x + radius,
      bottom: y + radius,
    });
  }
  let count = 0;
  const focusedNodes = labelNodes.filter(
    (node) => node.id === hoveredId || node.id === selectedId,
  );
  for (const node of [
    ...focusedNodes,
    ...labelNodes.filter((node) => !focusedNodes.includes(node)),
  ]) {
    const view = nodeViews.get(node.id);
    if (!view) continue;
    const { group, dot, ring, label } = view;
    const focused = node.id === selectedId || node.id === hoveredId;
    const hub = node.radius >= 12;
    const radius = displayRadius(node);
    if (scaleChanged && !canvasRenderer) {
      dot.setAttribute("r", String(radius));
      ring.setAttribute("r", String(radius + 4 / transform.k));
      label.style.fontSize = `${12 / transform.k}px`;
      label.style.strokeWidth = `${4 / transform.k}px`;
      label.setAttribute("y", String(radius + 16 / transform.k));
    }
    if (lengthChanged || view.width === undefined) {
      label.textContent = titleLabel(node.title);
      view.width = Array.from(label.textContent).reduce(
        (sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7),
        0,
      );
    }
    const x = node.x * transform.k + transform.x - view.width / 2;
    const y = (node.y + radius) * transform.k + transform.y + 4;
    const rect = {
      id: node.id,
      circle: false,
      x,
      y,
      right: x + view.width + 8,
      bottom: y + 22,
    };
    let visible =
      focused ||
      ((transform.k >= 0.18 || group.classList.contains("highlighted")) &&
        count < labelLimit &&
        rect.right > 0 &&
        rect.x < viewportWidth &&
        rect.bottom > 0 &&
        rect.y < viewportHeight);
    if (visible && !focused)
      eachCell(rect, (key) => {
        if (!visible) return;
        for (const other of cells.get(key) || []) {
          if (other.id === node.id || (hub && other.circle)) continue;
          if (
            rect.x < other.right &&
            rect.right > other.x &&
            rect.y < other.bottom &&
            rect.bottom > other.y
          ) {
            visible = false;
            break;
          }
        }
      });
    paintLabels.set(node.id, { text: label.textContent, visible });
    if (!canvasRenderer) group.classList.toggle("label-hidden", !visible);
    if (visible) {
      count++;
      insert(rect);
    }
  }
}
function fit() {
  const { width, height } = size();
  const nodes = layoutNodes;
  if (!nodes.length) return;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    const halfWidth =
      Array.from(titleLabel(node.title)).reduce(
        (sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7),
        0,
      ) / 2;
    minX = Math.min(minX, node.x - halfWidth - 24);
    maxX = Math.max(maxX, node.x + halfWidth + 24);
    minY = Math.min(minY, node.y - 30);
    maxY = Math.max(maxY, node.y + 48);
  }
  const k = Math.max(
    0.0001,
    Math.min(
      1,
      Math.max(80, width - 64) / (maxX - minX),
      Math.max(80, height - 80) / (maxY - minY),
    ),
  );
  transform = {
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
    k,
  };
  if (zoomBehavior)
    d3Select($("graph-svg")).call(
      zoomBehavior.transform,
      zoomIdentity.translate(transform.x, transform.y).scale(transform.k),
    );
  else applyTransform();
}
function render() {
  $("graph-legend-sources").hidden = !api.getGraphOptions().sources;
  const data = visibleGraph();
  visibleData = data;
  syncScope();
  const legend = $("graph-groups-legend");
  legend.replaceChildren();
  const groups = new Map(
    data.nodes
      .filter((node) => node.group)
      .map((node) => [node.group, node.color]),
  );
  legend.hidden = !groups.size;
  for (const [tag, color] of groups) {
    const label = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    label.className = "graph-group-legend";
    const swatch = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    swatch.className = "graph-group-swatch";
    swatch.style.backgroundColor = color;
    label.append(swatch, document.createTextNode(tag));
    legend.append(label);
  }
  const nextKey = JSON.stringify([
    graph.nodes.map((node) => [node.id, node.group]),
    graph.edges.map(({ source, target, kind }) => [source, target, kind]),
    centerId,
    centerId ? localDepth : null,
  ]);
  const retainLayout = nextKey === layoutKey;
  simulation?.stop();
  drag = null;
  dragMoved = false;
  hoveredId = undefined;
  for (const node of layoutNodes)
    savedPositions.set(node.id, { x: node.x, y: node.y });
  for (const id of savedPositions.keys())
    if (!graphNodes.has(id)) savedPositions.delete(id);
  const firstLayout = scopeChanged || !layoutKey || !layoutNodes.length;
  scopeChanged = false;
  layoutKey = nextKey;
  simulation = createAsyncGraphLayout(data, savedPositions, !retainLayout);
  const nodes = simulation.nodes();
  const paint = $("graph-paint");
  paint.hidden = nodes.length < 400;
  if (paint.hidden) {
    canvasRenderer?.dispose();
    canvasRenderer = undefined;
    $("graph-gpu").hidden = true;
    $("graph-gpu").width = 0;
    $("graph-gpu").height = 0;
    paint.width = 0;
    paint.height = 0;
  } else {
    const style = window.getComputedStyle($("knowledge-base-graph-root"));
    const styleKey =
      ["--bg", "--fg", "--accent", "--source", "--muted", "--graph-link"]
        .map((name) => style.getPropertyValue(name))
        .join(":") + style.fontFamily;
    if (styleKey !== rendererStyle) {
      canvasRenderer?.dispose();
      canvasRenderer = undefined;
    }
    canvasRenderer ??= createGraphCanvas(paint, style, $("graph-gpu"));
    rendererStyle = styleKey;
  }
  paintLabels = new Map();
  const edges = data.edges.map((edge) => ({ ...edge }));
  const svg = $("graph-svg");
  const { width, height } = size();
  svg.dataset.renderer = canvasRenderer?.backend || "svg";
  svg.dataset.layoutState = retainLayout ? "settled" : "running";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const defs = svgElement("defs");
  for (const [id, color] of [
    ["graph-arrow", "var(--graph-link)"],
    ["graph-arrow-highlighted", "var(--accent)"],
  ]) {
    const marker = svgElement("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      markerUnits: "userSpaceOnUse",
      orient: "auto",
    });
    marker.appendChild(
      svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }),
    );
    defs.appendChild(marker);
  }
  svg.appendChild(defs);
  scene = svgElement("g", {
    transform: `translate(${transform.x},${transform.y}) scale(${transform.k})`,
  });
  svg.appendChild(scene);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  renderedEdges = edges.map((raw) => {
    const edge = {
      ...raw,
      source: nodeById.get(raw.source),
      target: nodeById.get(raw.target),
    };
    const line = svgElement("path", {
      class: `graph-edge ${edge.kind}`,
      "marker-end": edge.kind !== "source" ? "url(#graph-arrow)" : "",
    });
    const title = svgElement("title");
    title.textContent = edge.context || edge.ref;
    line.appendChild(title);
    scene.appendChild(line);
    return { edge, line };
  });
  canvasEdges = renderedEdges.map(({ edge }) => edge);
  nodeElements = new Map();
  nodeViews = new Map();
  labelScale = 0;
  for (const node of nodes) {
    const group = svgElement("g", {
      class: `graph-node ${node.kind}`,
      tabindex: 0,
      role: "button",
      "aria-label": node.title,
      "data-node-id": node.id,
      transform: `translate(${node.x},${node.y})`,
    });
    if (node.color) group.style.setProperty("--node-color", node.color);
    group.appendChild(
      svgElement("circle", { class: "graph-node-dot", r: node.radius }),
    );
    group.appendChild(
      svgElement("circle", { class: "graph-node-ring", r: node.radius + 4 }),
    );
    const label = svgElement("text", {
      x: 0,
      y: node.radius + 18,
      "text-anchor": "middle",
    });
    label.textContent = titleLabel(node.title);
    group.appendChild(label);
    const title = svgElement("title");
    title.textContent = `${node.title}\n${(node.tags || []).join(" · ")}\n${node.snippet}`;
    group.appendChild(title);
    group.addEventListener("pointerenter", () => {
      hoveredId = node.id;
      highlight();
    });
    group.addEventListener("pointerleave", () => {
      hoveredId = undefined;
      highlight();
    });
    group.addEventListener("focus", () => {
      hoveredId = node.id;
      highlight();
    });
    group.addEventListener("blur", () => {
      hoveredId = undefined;
      highlight();
    });
    group.addEventListener("click", (ev) => {
      ev.stopPropagation();
      select(node.id);
    });
    group.addEventListener("dblclick", () => run(() => openNode(node)));
    group.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") run(() => openNode(node));
    });
    group.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || (window.Zotero.isMac && ev.ctrlKey)) return;
      ev.stopPropagation();
      drag = node;
      dragMoved = false;
      node.fx = node.x;
      node.fy = node.y;
      group.setPointerCapture?.(ev.pointerId);
      select(node.id);
    });
    group.classList.toggle("hub", node.radius >= 12);
    nodeElements.set(node.id, group);
    nodeViews.set(node.id, {
      group,
      dot: group.querySelector(".graph-node-dot"),
      ring: group.querySelector(".graph-node-ring"),
      label,
    });
    scene.appendChild(group);
  }
  layoutNodes = nodes;
  labelNodes = [...nodes].sort(
    (a, b) =>
      b.radius - a.radius ||
      Number(b.kind === "card") - Number(a.kind === "card"),
  );
  const tick = () => {
    geometryScale = transform.k;
    if (!canvasRenderer)
      for (const { edge, line } of renderedEdges) {
        line.setAttribute(
          "d",
          edgePath(
            { ...edge.source, radius: displayRadius(edge.source) },
            { ...edge.target, radius: displayRadius(edge.target) },
            edge.kind,
          ),
        );
      }
    if (!canvasRenderer)
      for (const node of nodes)
        nodeElements
          .get(node.id)
          .setAttribute("transform", `translate(${node.x},${node.y})`);
    if (window.performance.now() - labelTime >= 80) updateLabels();
    drawCanvas();
  };
  tick();
  updateLabels();
  updatePositions = tick;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  simulation.on("tick", () => {
    if (!reduceMotion || drag) tick();
  });
  simulation.on("worker", () => {
    svg.dataset.layoutThread = "worker";
    svg.dataset.layoutState = "running";
  });
  simulation.on("end", () => {
    svg.dataset.layoutState = "settled";
    tick();
    updateLabels();
    if (canvasRenderer)
      for (const node of nodes)
        nodeElements
          .get(node.id)
          .setAttribute("transform", `translate(${node.x},${node.y})`);
    drawCanvas();
    if (firstLayout && !viewMoved) fit();
  });
  if (firstLayout) fit();
  else applyTransform();
  $("graph-empty").hidden = nodes.length > 0;
  $("graph-stats").textContent = api.loc("graph-stats", {
    cards: nodes.filter((node) => node.kind === "card").length,
    links: edges.length,
  });
  select(selectedId);
}
function highlight() {
  const focusId = hoveredId || selectedId;
  const query = $("graph-search").value.trim().toLowerCase();
  const matched = new Set();
  for (const node of layoutNodes) {
    if (
      query &&
      `${node.title} ${node.id} ${node.snippet}`.toLowerCase().includes(query)
    )
      matched.add(node.id);
  }
  matchedNodes = matched;
  const active = !!focusId || !!query;
  for (const [id, element] of nodeElements) {
    element.classList.toggle("selected", id === selectedId);
    element.classList.toggle("highlighted", matched.has(id));
    element.classList.toggle("hovered", id === hoveredId);
  }
  for (const { edge, line } of renderedEdges) {
    const connected = focusId
      ? edge.source.id === focusId || edge.target.id === focusId
      : matched.has(edge.source.id) || matched.has(edge.target.id);
    line.classList.toggle("highlighted", active && connected);
    if (edge.kind !== "source")
      line.setAttribute(
        "marker-end",
        connected && active
          ? "url(#graph-arrow-highlighted)"
          : "url(#graph-arrow)",
      );
  }
  const activeNode = nodeElements.get(focusId);
  if (activeNode && scene.lastElementChild !== activeNode)
    scene.appendChild(activeNode);
  updateLabels();
  drawCanvas();
}
function select(id) {
  selectedId = id;
  syncScope();
  const node = graphNodes.get(id);
  if (!node || !nodeElements.has(id)) {
    selectedId = undefined;
    syncScope();
    $("graph-selection").hidden = true;
    highlight();
    return;
  }
  const connections = visibleData.edges.filter(
    (edge) => edge.source === id || edge.target === id,
  );
  highlight();
  $("graph-selection").hidden = false;
  $("graph-node-title").textContent = node.title;
  window.ZoteroKnowledgeBaseMarkdown.tags(
    $("graph-node-tags"),
    node.tags || [],
  );
  $("graph-node-kind").textContent =
    node.kind === "card"
      ? api.loc("note-kind-" + (node.noteKind || "zettel"))
      : api.loc(`graph-kind-${node.kind}`);
  window.ZoteroKnowledgeBaseMarkdown.reference(
    $("graph-node-reference"),
    node.kind === "card" ? node.reference || node.id : "",
    api,
  );
  window.ZoteroKnowledgeBaseMarkdown.render(
    $("graph-node-snippet"),
    node.snippet,
  );
  if (node.kind === "source" && node.itemKey) {
    api
      .getItemSummary(node.itemKey, node.libraryID)
      .then((item) => {
        if (item && selectedId === id && !window.closed)
          return window.ZoteroKnowledgeBaseMarkdown.source(
            $("graph-node-snippet"),
            item,
            api,
          );
      })
      .catch((error) => window.Zotero.logError(error));
  }
  api
    .prepareMarkdown(node.snippet)
    .then(() => {
      if (!window.closed && selectedId === id && node.kind !== "source")
        window.ZoteroKnowledgeBaseMarkdown.render(
          $("graph-node-snippet"),
          node.snippet,
        );
    })
    .catch((error) => window.Zotero.logError(error));
  const openLabel = api.loc(
    node.kind === "unresolved"
      ? "graph-create"
      : node.kind === "card"
        ? "graph-open-card"
        : "graph-open-source",
  );
  $("graph-node-open").setAttribute("data-kind", node.kind);
  $("graph-node-open").setAttribute("label", openLabel);
  $("graph-node-open").setAttribute("tooltiptext", openLabel);
  $("graph-node-open").setAttribute("aria-label", openLabel);
  const list = $("graph-connections");
  const collapsed = new Set(
    Array.from(list.querySelectorAll("details:not([open])"), (section) =>
      /** @type {Element} */ (section).getAttribute("data-relation"),
    ),
  );
  list.textContent = "";
  const groups = new Map();
  for (const key of [
    "parent",
    "children",
    "manager-outgoing",
    "manager-backlinks",
    "manager-source",
  ]) {
    const section = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "details",
    );
    section.setAttribute("data-relation", key);
    if (!collapsed.has(key)) section.setAttribute("open", "");
    section.hidden = true;
    const heading = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "summary",
    );
    heading.textContent = api.loc(
      key === "manager-outgoing"
        ? "graph-outgoing"
        : key === "manager-backlinks"
          ? "graph-backlinks"
          : key,
    );
    const peers = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "ul",
    );
    peers.className = "refs";
    section.append(heading, peers);
    list.appendChild(section);
    groups.set(key, { section, peers, heading });
  }
  for (const edge of connections) {
    const peerId = edge.source === id ? edge.target : edge.source;
    const peer = graphNodes.get(peerId);
    if (!peer) continue;
    const row = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
    row.tabIndex = 0;
    if (peer.kind === "card")
      window.ZoteroKnowledgeBaseMarkdown.identity(
        row,
        peer.id,
        peer.title,
        peer.reference,
      );
    else row.textContent = peer.title;
    if (edge.kind === "source" && peer.citation) {
      const context = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "small",
      );
      context.textContent = peer.citation;
      row.appendChild(context);
    }
    row.addEventListener("click", () => select(peerId));
    row.addEventListener("dblclick", () => run(() => openNode(peer)));
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") select(peerId);
    });
    const key =
      edge.kind === "parent"
        ? edge.source === id
          ? "children"
          : "parent"
        : edge.kind === "source"
          ? "manager-source"
          : edge.source === id
            ? "manager-outgoing"
            : "manager-backlinks";
    const group = groups.get(key);
    group.section.hidden = false;
    group.peers.appendChild(row);
    group.heading.textContent = `${api.loc(key === "manager-outgoing" ? "graph-outgoing" : key === "manager-backlinks" ? "graph-backlinks" : key)} · ${group.peers.children.length}`;
  }
}
async function openNode(node) {
  if (node.kind === "card") api.openEditor({ zettelId: node.id });
  else if (node.kind === "source")
    await api.selectItem(node.itemKey, node.libraryID);
  else api.openEditor({ prefillTitle: node.title });
}
window.ZoteroKnowledgeBase_showGraph = (id) => {
  showScope(id, true);
};
async function load() {
  document.title = api.loc("graph-title");
  $("graph-gpu").addEventListener("webglcontextlost", gpuChanged);
  $("graph-gpu").addEventListener("webglcontextrestored", gpuChanged);
  /** @type {Partial<Record<keyof import("../../typings/ui").GraphElements, string>>} */
  const labels = {
    "graph-connections-title": "graph-connections",
    "graph-empty": "graph-empty",
    "graph-legend-cards": "graph-legend-cards",
    "graph-legend-sources": "graph-legend-sources",
    "graph-legend-unresolved": "graph-legend-unresolved",
  };
  for (const [id, key] of Object.entries(labels))
    $(
      /** @type {keyof import("../../typings/ui").GraphElements} */ (id),
    ).textContent = api.loc(key);
  for (const id of [
    "graph-fit",
    "graph-refresh",
    "graph-global",
    "graph-local",
  ]) {
    const button = document.getElementById(id);
    const label = api.loc(id);
    button.setAttribute("label", label);
    button.setAttribute("tooltiptext", label);
    button.setAttribute("aria-label", label);
  }
  const optionControls =
    /** @type {[keyof import("../modules/preferences").GraphOptions, string][]} */ ([
      ["outline", "graph-outline"],
      ["references", "graph-references"],
      ["sources", "graph-sources"],
      ["hideIsolated", "graph-hide-isolated"],
    ]);
  const syncOptions = () => {
    const options = api.getGraphOptions();
    for (const [name, id] of optionControls) {
      const control = /** @type {HTMLElement & {checked: boolean}} */ (
        document.getElementById(id)
      );
      control.setAttribute("label", api.loc(id));
      control.checked = options[name];
    }
  };
  syncOptions();
  $("graph-global").addEventListener("click", () => showScope(undefined));
  $("graph-local").addEventListener("click", () => {
    if (selectedId) showScope(selectedId);
  });
  for (const [name, id] of optionControls) {
    const control = /** @type {HTMLElement & {checked: boolean}} */ (
      document.getElementById(id)
    );
    control.addEventListener("command", () =>
      api.setGraphOption(name, control.checked),
    );
  }
  window.KnowledgeBasePanels.attach(
    document.getElementById("graph-splitter"),
    $("graph-inspector"),
    "graph",
    api,
  );
  $("graph-search").placeholder = api.loc("graph-search");
  $("graph-fit").addEventListener("click", fit);
  $("graph-refresh").addEventListener("click", () => run(refresh));
  $("graph-node-open").addEventListener("click", () =>
    run(() => openNode(graphNodes.get(selectedId))),
  );
  $("graph-search").addEventListener("input", () => select(undefined));
  $("graph-svg").addEventListener("click", (event) => {
    if (canvasRenderer && event.target === $("graph-svg")) {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      select(nodeAt(event)?.id);
      return;
    }
    if (!(/** @type {Element} */ (event.target).closest(".graph-node")))
      select(undefined);
  });
  $("graph-node-snippet").addEventListener("click", (event) => {
    const anchor = /** @type {Element} */ (event.target).closest("a");
    if (!anchor) return;
    event.preventDefault();
    run(async () => {
      const href = anchor.getAttribute("href");
      const card = await api.resolveCardLink(href);
      if (card?.targetId) select(card.targetId);
      else await api.openLink(href);
    });
  });
  $("graph-svg").addEventListener("dblclick", (event) => {
    if (!canvasRenderer || event.target !== $("graph-svg")) return;
    const node = nodeAt(event);
    if (node) run(() => openNode(node));
  });
  $("graph-svg").addEventListener(
    "pointerdown",
    (event) => {
      if (
        !canvasRenderer ||
        event.button !== 0 ||
        (window.Zotero.isMac && event.ctrlKey)
      )
        return;
      const node = nodeAt(event);
      if (!node) return;
      event.stopPropagation();
      drag = node;
      dragMoved = false;
      node.fx = node.x;
      node.fy = node.y;
      $("graph-svg").setPointerCapture?.(event.pointerId);
      select(node.id);
    },
    true,
  );
  $("graph-svg").addEventListener("pointerleave", () => {
    if (!canvasRenderer || drag) return;
    hoveredId = undefined;
    highlight();
  });
  zoomBehavior = zoom()
    .extent(() => {
      const { width, height } = size();
      return [
        [0, 0],
        [width, height],
      ];
    })
    .scaleExtent([0.0001, 6])
    .touchable(() => false)
    .filter(
      (event) =>
        event.type !== "dblclick" &&
        !drag &&
        (event.type === "wheel" ||
          (!event.button &&
            !(window.Zotero.isMac && event.ctrlKey) &&
            !event.target.closest(".graph-node"))),
    )
    .on("zoom", (event) => {
      if (event.sourceEvent) viewMoved = true;
      transform = {
        x: event.transform.x,
        y: event.transform.y,
        k: event.transform.k,
      };
      applyTransform();
    });
  $("graph-svg").addEventListener(
    "wheel",
    (event) => {
      if (!window.Zotero.isMac || event.ctrlKey || event.metaKey || drag)
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      viewMoved = true;
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size().height : 1;
      d3Select($("graph-svg")).call(
        zoomBehavior.transform,
        zoomIdentity
          .translate(
            transform.x - event.deltaX * unit,
            transform.y - event.deltaY * unit,
          )
          .scale(transform.k),
      );
    },
    { capture: true, passive: false },
  );
  d3Select($("graph-svg")).call(zoomBehavior).on("dblclick.zoom", null);
  $("graph-svg").addEventListener("pointermove", (ev) => {
    if (canvasRenderer && !drag) {
      const node = nodeAt(ev);
      $("graph-svg").style.cursor = node ? "pointer" : "";
      $("graph-svg").setAttribute("title", node?.title || "");
      if (hoveredId !== node?.id) {
        hoveredId = node?.id;
        highlight();
      }
    }
    if (drag) {
      const rect = $("graph-svg").getBoundingClientRect();
      const x = (ev.clientX - rect.left - transform.x) / transform.k;
      const y = (ev.clientY - rect.top - transform.y) / transform.k;
      if (!dragMoved) {
        if (Math.hypot(x - drag.x, y - drag.y) * transform.k < 3) return;
        dragMoved = true;
        simulation.alphaTarget(0.12).alpha(0.25).restart();
      }
      drag.fx = x;
      drag.fy = y;
      drag.x = drag.fx;
      drag.y = drag.fy;
      viewMoved = true;
      simulation.restart();
      updatePositions();
    }
  });
  const release = (event) => {
    if (event.type !== "pointerup") dragMoved = false;
    if (drag) {
      drag.fx = null;
      drag.fy = null;
      simulation.alphaTarget(0).restart();
      updatePositions();
    }
    drag = null;
  };
  $("graph-svg").addEventListener("pointerup", release);
  $("graph-svg").addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hoveredId = undefined;
      select(undefined);
    }
    if (isAccelKey(event) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      window.close();
    }
  });
  const resize = () => {
    viewport = undefined;
    const { width, height } = size();
    $("graph-svg").setAttribute("viewBox", `0 0 ${width} ${height}`);
    applyTransform();
  };
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) {
    resizeObserver = new window.ResizeObserver(resize);
    resizeObserver.observe($("graph-canvas"));
  }
  unsubscribe = api.onDataChange((change) => {
    if (
      change &&
      !change.all &&
      !change.cardIDs.some((id) => graphNodes.has(id)) &&
      !change.itemKeys.some((key) =>
        graph.nodes.some((node) => node.itemKey === key),
      ) &&
      !change.fields.includes("availability")
    )
      return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => run(refresh), 180);
  });
  unsubscribeOptions = api.onGraphOptionsChange(() => {
    const depth = api.getGraphLocalDepth();
    if (depth !== localDepth) {
      localDepth = depth;
      scopeChanged = !!centerId;
      if (centerId) viewMoved = false;
    }
    syncOptions();
    run(render);
  });
  await refresh();
}
window.addEventListener("load", () => run(load));
window.addEventListener("unload", () => {
  simulation?.stop();
  window.cancelAnimationFrame(paintFrame);
  resizeObserver?.disconnect();
  $("graph-paint").width = 0;
  $("graph-paint").height = 0;
  canvasRenderer?.dispose();
  $("graph-gpu").removeEventListener("webglcontextlost", gpuChanged);
  $("graph-gpu").removeEventListener("webglcontextrestored", gpuChanged);
  $("graph-gpu").width = 0;
  $("graph-gpu").height = 0;
  canvasRenderer = undefined;
  drag = null;
  d3Select($("graph-svg")).on(".zoom", null);
  refreshVersion++;
  unsubscribe?.();
  unsubscribeOptions?.();
  clearTimeout(refreshTimer);
});
