import { isAccelKey } from "./platform";
import { select as d3Select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { edgePath, filterGraph } from "../modules/graph";
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
const centerId = /** @type {{ centerId?: string }} */ (
  window.arguments[0] || {}
).centerId;
let selectedId = centerId;

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
  if (options.hideIsolated) {
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
  const rect = $("graph-canvas").getBoundingClientRect();
  return {
    width: Math.max(300, rect.width),
    height: Math.max(240, rect.height),
  };
}
function applyTransform() {
  updatePositions();
  scene?.setAttribute(
    "transform",
    `translate(${transform.x},${transform.y}) scale(${transform.k})`,
  );
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
  const { width: viewportWidth, height: viewportHeight } = size();
  const labelLimit = Math.max(
    24,
    Math.min(160, Math.floor((viewportWidth * viewportHeight) / 6500)),
  );
  for (const node of $("graph-svg").querySelectorAll("marker")) {
    const marker = /** @type {SVGMarkerElement} */ (node);
    marker.setAttribute("markerWidth", String(5 / transform.k));
    marker.setAttribute("markerHeight", String(5 / transform.k));
  }
  const occupied = [];
  const circles = layoutNodes.map((node) => ({
    id: node.id,
    x: node.x * transform.k + transform.x,
    y: node.y * transform.k + transform.y,
    radius: displayRadius(node) * transform.k + 3,
  }));
  const nodes = [...layoutNodes].sort(
    (a, b) =>
      Number(b.id === hoveredId) - Number(a.id === hoveredId) ||
      Number(b.id === selectedId) - Number(a.id === selectedId) ||
      b.radius - a.radius ||
      Number(b.kind === "card") - Number(a.kind === "card"),
  );
  for (const node of nodes) {
    const group = nodeElements.get(node.id);
    if (!group) continue;
    const focused = node.id === selectedId || node.id === hoveredId;
    const hub = node.radius >= 12;
    group.classList.toggle("hub", hub);
    const radius = displayRadius(node);
    group.querySelector(".graph-node-dot").setAttribute("r", String(radius));
    group
      .querySelector(".graph-node-ring")
      .setAttribute("r", String(radius + 4 / transform.k));
    const label = group.querySelector("text");
    label.textContent = titleLabel(node.title);
    label.style.fontSize = `${12 / transform.k}px`;
    label.style.strokeWidth = `${4 / transform.k}px`;
    label.setAttribute("y", String(radius + 16 / transform.k));
    if (
      !focused &&
      (occupied.length >= labelLimit ||
        (transform.k < 0.18 && !group.classList.contains("highlighted")))
    ) {
      group.classList.add("label-hidden");
      continue;
    }
    const width = Array.from(label.textContent).reduce(
      (sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7),
      0,
    );
    const x = node.x * transform.k + transform.x - width / 2;
    const y = (node.y + radius) * transform.k + transform.y + 4;
    const rect = { x, y, right: x + width + 8, bottom: y + 22 };
    const overlaps = occupied.some(
      (other) =>
        rect.x < other.right &&
        rect.right > other.x &&
        rect.y < other.bottom &&
        rect.bottom > other.y,
    );
    const coversNode =
      !overlaps &&
      circles.some(
        (circle) =>
          circle.id !== node.id &&
          rect.x < circle.x + circle.radius &&
          rect.right > circle.x - circle.radius &&
          rect.y < circle.y + circle.radius &&
          rect.bottom > circle.y - circle.radius,
      );
    const visible =
      focused ||
      ((transform.k >= 0.18 || group.classList.contains("highlighted")) &&
        occupied.length < labelLimit &&
        rect.right > 0 &&
        rect.x < viewportWidth &&
        rect.bottom > 0 &&
        rect.y < viewportHeight &&
        !overlaps &&
        (hub || !coversNode));
    group.classList.toggle("label-hidden", !visible);
    if (visible) occupied.push(rect);
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
  ]);
  const retainLayout = nextKey === layoutKey;
  simulation?.stop();
  drag = null;
  hoveredId = undefined;
  for (const node of layoutNodes)
    savedPositions.set(node.id, { x: node.x, y: node.y });
  for (const id of savedPositions.keys())
    if (!graphNodes.has(id)) savedPositions.delete(id);
  const firstLayout = !layoutKey || !layoutNodes.length;
  layoutKey = nextKey;
  simulation = createAsyncGraphLayout(data, savedPositions, !retainLayout);
  const nodes = simulation.nodes();
  const edges = data.edges.map((edge) => ({ ...edge }));
  const svg = $("graph-svg");
  const { width, height } = size();
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
  scene = svgElement("g");
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
  nodeElements = new Map();
  for (const node of nodes) {
    const group = svgElement("g", {
      class: `graph-node ${node.kind}`,
      tabindex: 0,
      role: "button",
      "aria-label": node.title,
      "data-node-id": node.id,
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
    nodeElements.set(node.id, group);
    scene.appendChild(group);
  }
  layoutNodes = nodes;
  const tick = () => {
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
    for (const node of nodes)
      nodeElements
        .get(node.id)
        .setAttribute("transform", `translate(${node.x},${node.y})`);
    updateLabels();
  };
  tick();
  updatePositions = tick;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  simulation.on("tick", () => {
    if (!reduceMotion || drag) tick();
  });
  simulation.on("worker", () => {
    svg.dataset.layoutThread = "worker";
  });
  simulation.on("end", () => {
    tick();
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
}
function select(id) {
  selectedId = id;
  const node = graphNodes.get(id);
  if (!node || !nodeElements.has(id)) {
    selectedId = undefined;
    $("graph-selection").hidden = true;
    highlight();
    return;
  }
  const connections = visibleGraph().edges.filter(
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
  selectedId = id;
  run(refresh);
};
async function load() {
  document.title = api.loc("graph-title");
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
  for (const id of ["graph-fit", "graph-refresh"]) {
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
  const release = () => {
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
  window.addEventListener("resize", () => {
    const { width, height } = size();
    $("graph-svg").setAttribute("viewBox", `0 0 ${width} ${height}`);
  });
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
    syncOptions();
    run(render);
  });
  await refresh();
}
window.addEventListener("load", () => run(load));
window.addEventListener("unload", () => {
  simulation?.stop();
  drag = null;
  d3Select($("graph-svg")).on(".zoom", null);
  refreshVersion++;
  unsubscribe?.();
  unsubscribeOptions?.();
  clearTimeout(refreshTimer);
});
