/** Graph type views, relationship filters and fresh layouts, using disposable Zotero data only. */
export default async function graphViewsHost({
  Zotero,
  IOUtils,
  PathUtils,
  Services,
  Components,
  setTimeout,
  marker,
  restartMarker,
  screenshots,
}) {
  const api = Zotero.ZoteroKnowledgeBase.api;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (read, message) => {
    for (let i = 0; i < 400; i++) {
      const value = await read();
      if (value) return value;
      await pause(25);
    }
    throw new Error(message);
  };
  const restart = await IOUtils.exists(marker);
  let state = restart ? JSON.parse(await IOUtils.readUTF8(marker)) : null;
  if (!state) {
    const papers = [];
    const abstracts = [
      "Building change detection in paired remote sensing images uses multi scale temporal attention and dense feature fusion to identify changed buildings. Experiments evaluate building footprints using segmentation masks and temporal image pairs.",
      "Building change detection in paired remote sensing images uses multi scale temporal attention and dense feature fusion to identify changed buildings. Experiments evaluate building footprints using segmentation masks and temporal image pairs.",
      "Protein folding and molecular binding describe amino acid sequences and biochemical reaction energies using cellular structure measurements and laboratory assays.",
      "An unrelated paper with no notes must not appear among parent items.",
    ];
    for (let i = 0; i < 4; i++) {
      const paper = new Zotero.Item("journalArticle");
      paper.libraryID = Zotero.Libraries.userLibraryID;
      paper.setField(
        "title",
        [
          "Temporal attention for building change detection",
          "Multi scale fusion for building change detection",
          "Protein folding and molecular binding",
          "Paper without a note",
        ][i],
      );
      paper.setField("abstractNote", abstracts[i]);
      paper.setField("date", "2026");
      await paper.saveTx();
      papers.push({ key: paper.key, libraryID: paper.libraryID });
    }
    const types = ["literature", "zettel", "thinking", "entity"];
    const ids = [];
    for (let i = 0; i < types.length; i++)
      ids.push(
        await api.saveZettel({
          noteType: types[i],
          title: [
            "An independently readable literature synthesis",
            "A focused claim about dense temporal features",
            "Questions about the next experiment",
            "LEVIR dataset",
          ][i],
          body:
            i === 1
              ? "[[LiteratureReferenceWithALongIdentifier]]"
              : i === 2
                ? "[[FocusedClaimReference]]"
                : "Original note content.",
          customKey:
            i === 0
              ? "LiteratureReferenceWithALongIdentifier"
              : i === 1
                ? "FocusedClaimReference"
                : undefined,
          itemKey: papers[Math.min(i, 2)].key,
          libraryID: papers[0].libraryID,
          parentId: i === 3 ? ids[0] : null,
        }),
      );
    state = { papers, ids, types };
  }
  const paper = await Zotero.Items.getByLibraryAndKeyAsync(
    state.papers[0].libraryID,
    state.papers[0].key,
  );
  paper.addTag("Remote sensing");
  await paper.saveTx();
  await Zotero.DB.executeTransaction(() =>
    Zotero.Tags.setColor(paper.libraryID, "Remote sensing", "#3478f6", 0),
  );
  assert(
    (await api.getGraph()).nodes.find((node) => node.id === state.ids[0])
      .color === "#3478f6",
    "Graph did not inherit the paper's topic color",
  );
  api.setGraphOption("hideIsolated", false);
  api.openGraph();
  const graph = await wait(
    () => Services.wm.getMostRecentWindow("knowledge-base:graph"),
    "Graph window did not open",
  );
  await wait(
    () => graph.document.querySelectorAll(".graph-node.card").length === 4,
    "Note graph did not load all types",
  );
  const doc = graph.document;
  graph.ZoteroKnowledgeBase_showGraph(state.ids[0]);
  await wait(
    () => doc.querySelector("#graph-connections li[data-node-id]"),
    "Graph relationship links did not load",
  );
  const firstConnection = doc.querySelector(
    "#graph-connections li[data-node-id]",
  );
  const expectedConnection = firstConnection.dataset.nodeId;
  const originalOpenEditor = api.openEditor;
  let openedConnection;
  try {
    api.openEditor = (args) => {
      openedConnection = args.zettelId;
    };
    firstConnection.dispatchEvent(
      new graph.MouseEvent("click", { bubbles: true, detail: 1 }),
    );
    const shiftedConnection = doc.querySelector(
      "#graph-connections li[data-node-id]",
    );
    assert(
      shiftedConnection &&
        shiftedConnection.dataset.nodeId !== expectedConnection,
      "Graph relationship fixture did not replace its rows",
    );
    shiftedConnection.dispatchEvent(
      new graph.MouseEvent("click", { bubbles: true, detail: 2 }),
    );
    shiftedConnection.dispatchEvent(
      new graph.MouseEvent("dblclick", { bubbles: true, detail: 2 }),
    );
    await wait(
      () => openedConnection,
      "Graph relationship double-click did not open a note",
    );
    assert(
      openedConnection === expectedConnection,
      "Graph double-click opened the replacement row instead of the first target",
    );
  } finally {
    api.openEditor = originalOpenEditor;
  }
  graph.ZoteroKnowledgeBase_showGraph(undefined);
  assert(
    !doc.getElementById("graph-sources"),
    "The removed Sources switch returned",
  );
  assert(
    [...doc.getElementById("graph-view").options]
      .map((option) => option.value)
      .join() === "all,literature,zettel,thinking,entity",
    "Graph type choices are incomplete",
  );
  const choose = async (type, kind, count) => {
    const view = doc.getElementById("graph-view");
    view.value = type;
    view.dispatchEvent(new graph.Event("change", { bubbles: true }));
    await wait(
      () =>
        doc.querySelectorAll(".graph-node." + kind).length === count &&
        doc.getElementById("graph-canvas").getAttribute("aria-busy") !== "true",
      "Graph view did not settle: " + type,
    );
  };
  const shot = async (name) => {
    if (!screenshots) return;
    await wait(
      () => doc.getElementById("graph-svg").dataset.layoutState === "settled",
      "Graph layout did not settle for its screenshot",
    );
    await IOUtils.makeDirectory(screenshots, { ignoreExisting: true });
    const bitmap = await graph.browsingContext.currentWindowGlobal.drawSnapshot(
      undefined,
      1,
      "white",
    );
    const canvas = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    await IOUtils.write(
      PathUtils.join(screenshots, name + ".png"),
      new Uint8Array(await blob.arrayBuffer()),
    );
  };
  if (restart) {
    await choose("entity", "card", 1);
    assert(
      (await api.getZettel(state.ids[3])).note_type === "entity",
      "Restart changed the note type",
    );
    await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
    await IOUtils.writeUTF8(
      restartMarker,
      JSON.stringify({ connectionsOnly: true }),
    );
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
    return;
  }
  for (const type of state.types) await choose(type, "card", 1);
  await shot("graph-entity");
  await choose("all", "card", 4);
  doc
    .querySelector('[data-node-id="' + state.ids[0] + '"]')
    .dispatchEvent(new graph.MouseEvent("click", { bubbles: true }));
  await wait(
    () => doc.querySelectorAll("#graph-connections li").length > 0,
    "Note links are missing",
  );
  const titles = [
    ...doc.querySelectorAll("#graph-connections .relation-title"),
  ].map((element) => element.textContent);
  assert(
    titles.includes("A focused claim about dense temporal features") &&
      !doc.querySelector("#graph-connections .relation-id") &&
      !doc
        .getElementById("graph-connections")
        .textContent.includes("FocusedClaimReference"),
    "Relationship titles still show gray inline identifiers",
  );
  await shot("graph-clean-links");
  assert(
    !doc.getElementById("graph-legend"),
    "The footer legend should be absent",
  );
  assert(
    doc.getElementById("graph-outline").getAttribute("label") ===
      api.loc("graph-outline"),
    "Structure label is missing",
  );
  const revision = () =>
    Number(doc.getElementById("graph-svg").dataset.layoutRevision);
  let before = revision();
  api.setGraphOption("references", false);
  await wait(
    () => revision() > before && !doc.querySelector(".graph-edge.link"),
    "References did not produce a fresh layout",
  );
  before = revision();
  api.setGraphOption("references", true);
  await wait(
    () => revision() > before && doc.querySelector(".graph-edge.link"),
    "References did not return after redrawing",
  );
  before = revision();
  await choose("entity", "card", 1);
  assert(revision() > before, "Changing type did not redraw the graph");
  api.setGraphOption("hideIsolated", true);
  await wait(
    () => !doc.querySelector(".graph-node.card"),
    "Isolated entity was not hidden",
  );
  api.setGraphOption("hideIsolated", false);
  await wait(
    () => doc.querySelectorAll(".graph-node.card").length === 1,
    "Entity did not return after redrawing",
  );
  await shot("graph-final-entity");
  // Render a representative graph without writing hundreds of fixture notes.
  if (screenshots) {
    const originalGraph = api.getGraph;
    const topics = [
      "Change detection",
      "Temporal features",
      "Remote sensing",
      "Representation learning",
      "Building datasets",
      "Attention mechanisms",
    ];
    const nodes = Array.from({ length: 300 }, (_, i) => ({
      id: "preview-" + i,
      kind: "card",
      noteType: state.types[i % 4],
      color: ["#6387b7", "#76a18a", "#aa8aaf"][i % 3],
      tags: [topics[i % topics.length]],
      title: topics[i % topics.length] + (i < topics.length ? "" : " · " + i),
      snippet:
        "A focused note with manually organized structure and explicit references.",
    }));
    const edges = nodes.slice(1).flatMap((node, i) => [
      {
        source: nodes[Math.floor(i / 5)].id,
        target: node.id,
        kind: i % 4 === 0 ? "parent" : "link",
        ref: node.id,
        context: "",
      },
      ...(i % 2 === 0
        ? [
            {
              source: node.id,
              target: nodes[(i * 7 + 11) % nodes.length].id,
              kind: "link",
              ref: "",
              context: "",
            },
          ]
        : []),
    ]);
    try {
      api.getGraph = async () => ({ nodes, edges });
      await choose("all", "card", 4);
      doc
        .getElementById("graph-refresh")
        .dispatchEvent(new graph.MouseEvent("click", { bubbles: true }));
      await wait(
        () => doc.querySelectorAll(".graph-node.card").length === 300,
        "Representative graph did not load",
      );
      doc
        .querySelector('[data-node-id="preview-0"]')
        .dispatchEvent(new graph.MouseEvent("click", { bubbles: true }));
      await shot("graph-overview");
      assert(
        ["webgl2", "canvas"].includes(
          doc.getElementById("graph-svg").dataset.renderer,
        ),
        "Dense graph did not use batched rendering",
      );
    } finally {
      api.getGraph = originalGraph;
    }
  }

  await IOUtils.writeUTF8(
    marker,
    JSON.stringify({ connectionsOnly: true, ...state }),
  );
  Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
}
