const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

async function fixture(t) {
  const root = path.join(__dirname, "../../addon/content/library");
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "tags.xhtml"), "utf8"),
    {
      contentType: "application/xhtml+xml",
      runScripts: "outside-only",
    },
  );
  t.after(() => dom.window.close());
  const win = dom.window;
  const doc = win.document;
  const names = ["Deep Learning", "deep-learning", "Other", "topic/reading"];
  const writes = [];
  const api = {
    exclusions: () => ({ colored: false }),
    words: (text) => text.toLowerCase().split(/\W+/).filter(Boolean),
    catalog: async () => [...names],
    usageCounts: async () =>
      new Map([
        ["Deep Learning", 3],
        ["deep-learning", 1],
      ]),
    duplicateGroups: () => [["Deep Learning", "deep-learning"]],
    duplicateReason: () => "name",
    potentialDuplicates: async () => ({
      groups: api.duplicateGroups(),
      semantic: true,
    }),
    preview: async () => 4,
    normalizeName: (name) => name.trim(),
    merge: async (_library, selected, target) => {
      writes.push({ selected: [...selected], target });
      for (const name of selected)
        if (name !== target) names.splice(names.indexOf(name), 1);
      return selected.length - 1;
    },
    planFormat: async (_library, selected) => ({
      rows: selected.map((from) => ({
        from,
        to: from === "Other" ? "#Other" : from,
        status: from === "Other" ? "change" : "structured",
      })),
      itemCount: 1,
    }),
  };
  doc.createXULElement = (tag) =>
    doc.createElementNS(doc.documentElement.namespaceURI, tag);
  for (const node of doc.querySelectorAll("*"))
    if (!node.dataset) Object.defineProperty(node, "dataset", { value: {} });
  doc.l10n = {
    formatValue: async (id) => id,
    setAttributes: (node, id, args) => {
      node.setAttribute("data-l10n-id", id);
      if (args) node.setAttribute("data-l10n-args", JSON.stringify(args));
    },
  };
  win.Zotero = {
    Notifier: { registerObserver: () => 1, unregisterObserver() {} },
    Prefs: { registerObserver: () => 1, unregisterObserver() {} },
  };
  win.arguments = [{ api, libraryID: 1, isMac: true }];
  doc.getElementById("mode").value = "merge";
  await win.eval(fs.readFileSync(path.join(root, "tags.js"), "utf8"));
  const wait = async (read) => {
    for (let i = 0; i < 200; i++) {
      if (read()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(
      "Tag Manager did not reach the expected state: " +
        doc.getElementById("preview").textContent,
    );
  };
  await wait(() => doc.querySelectorAll(".tag").length === names.length);
  const command = (node) => node.dispatchEvent(new win.Event("command"));
  const change = (node) => node.dispatchEvent(new win.Event("change"));
  const select = (name, checked = true) => {
    const input = [...doc.querySelectorAll(".tag input")].find(
      (node) => node.value === name,
    );
    input.checked = checked;
    change(input);
  };
  return { win, doc, api, writes, wait, command, change, select };
}

test("organizing shows complete groups and reviews only that group before an explicit merge", async (t) => {
  const { doc, win, writes, wait, command, change, select } = await fixture(t);
  select("Other");
  doc.getElementById("duplicates").checked = true;
  change(doc.getElementById("duplicates"));
  await wait(() => doc.querySelector(".review-group"));
  doc.getElementById("search").value = "deep-learning";
  doc.getElementById("search").dispatchEvent(new win.Event("input"));
  await wait(() => doc.querySelectorAll(".tag").length === 2);
  const group = doc.querySelector(".duplicate-group");
  assert.equal(group.querySelector("strong").textContent, "Deep Learning");
  assert.match(
    group.querySelector(".duplicate-reason").textContent,
    /match-name$/,
  );
  command(group.querySelector(".review-group"));
  await wait(() => !doc.getElementById("merge").disabled);
  assert.equal(doc.getElementById("target").value, "Deep Learning");
  assert.equal(
    JSON.parse(
      doc.getElementById("selection-count").getAttribute("data-l10n-args"),
    ).hidden,
    0,
  );
  assert.equal(writes.length, 0);
  command(doc.getElementById("merge"));
  await wait(
    () => writes.length === 1 && !doc.getElementById("refresh").disabled,
  );
  assert.deepEqual(writes[0], {
    selected: ["Deep Learning", "deep-learning"],
    target: "Deep Learning",
  });
});

test("format preview stays beside original tags through sorting and never writes during preview", async (t) => {
  const { doc, writes, wait, command, select } = await fixture(t);
  doc.getElementById("mode").value = "format";
  command(doc.getElementById("mode"));
  await wait(
    () =>
      doc.getElementById("tag-table").dataset.mode === "format" &&
      doc.querySelectorAll(".tag").length === 4,
  );
  select("Other");
  select("topic/reading");
  await wait(
    () => doc.querySelectorAll(".format-cell[data-status]").length === 2,
  );
  const verify = () => {
    const row = [...doc.querySelectorAll(".tag")].find(
      (node) => node.querySelector("input").value === "Other",
    );
    assert.equal(row.querySelector(".format-name").textContent, "#Other");
    assert.equal(row.querySelector(".format-cell").dataset.status, "change");
    assert.equal(
      doc.querySelector(".format-cell[data-status='structured'] .format-name")
        .textContent,
      "topic/reading",
    );
    assert.ok(
      doc
        .getElementById("tag-table")
        .contains(row.querySelector(".format-name")),
    );
  };
  verify();
  doc.getElementById("sort-name").click();
  await wait(
    () => doc.querySelectorAll(".format-cell[data-status]").length === 2,
  );
  verify();
  assert.equal(writes.length, 0);
  assert.equal(doc.getElementById("format-preview"), null);
  command(doc.getElementById("clear-selection"));
  assert.equal(doc.querySelectorAll(".format-cell[data-status]").length, 0);
  assert.equal(doc.getElementById("merge").disabled, true);
});

test("late format results cannot replace a newer selection preview", async (t) => {
  const { doc, api, wait, command, select } = await fixture(t);
  let finish;
  api.planFormat = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  doc.getElementById("mode").value = "format";
  command(doc.getElementById("mode"));
  await wait(() => doc.querySelectorAll(".tag").length === 4);
  select("Other");
  await wait(() => finish);
  command(doc.getElementById("clear-selection"));
  finish({
    rows: [{ from: "Other", to: "#Other", status: "change" }],
    itemCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(doc.querySelectorAll(".format-cell[data-status]").length, 0);
  assert.equal(doc.getElementById("merge").disabled, true);
});
