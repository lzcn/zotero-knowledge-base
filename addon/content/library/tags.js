/* global Zotero */
(async () => {
  const { api, libraryID, isMac } = window.arguments[0];
  const accel = (event) =>
    (isMac ? event.metaKey : event.ctrlKey) &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229;
  let searchTimer = null;
  const search = document.getElementById("search");
  const duplicates = document.getElementById("duplicates");
  const list = document.getElementById("tags");
  const target = document.getElementById("target");
  const preview = document.getElementById("preview");
  const apply = document.getElementById("merge");
  const refresh = document.getElementById("refresh");
  const selectAll = document.getElementById("select-all");
  const mode = document.getElementById("mode");
  const clearSelection = document.getElementById("clear-selection");
  const selected = new Set();
  let names = [],
    counts = new Map(),
    visible = [],
    groups = new Map(),
    groupLists = new Map(),
    sortBy = "name",
    ascending = true,
    revision = 0,
    renderRevision = 0,
    loadRevision = 0,
    busy = false,
    closed = false,
    previewReady = false,
    formatPlan = null,
    formatLabels = new Map(),
    anchor = null;
  const fmt = (id, args) => document.l10n.formatValue(id, args);
  const active = () => !closed;
  const errorText = (error) =>
    fmt(
      String(error.message).startsWith("similar-works-")
        ? error.message
        : "similar-works-tags-error",
      { message: String(error.message || error) },
    );
  const report = async (error) => {
    if (active()) preview.textContent = await errorText(error);
  };
  const semanticReady = () => {
    if (active() && !busy) void load().catch(report);
  };
  window.addEventListener("knowledge-base-tags-semantic-ready", semanticReady);
  const colorObserver = Zotero.Notifier.registerObserver(
    {
      notify: () => {
        if (active() && !busy && api.exclusions(libraryID).colored)
          void load().catch(report);
      },
    },
    ["setting"],
    "knowledge-base-tag-colors",
  );
  const preferenceObservers = [
    "excludedTags",
    "tagNameStyle",
    "tagHashtag",
  ].map((key) =>
    Zotero.Prefs.registerObserver(
      "extensions.zotero.similar-works." + key,
      () => {
        if (active() && !busy) {
          revision++;
          formatPlan = null;
          previewReady = false;
          apply.disabled = true;
          void load().catch(report);
        }
      },
      true,
    ),
  );
  window.addEventListener(
    "unload",
    () => {
      closed = true;
      window.removeEventListener(
        "knowledge-base-tags-semantic-ready",
        semanticReady,
      );
      Zotero.Notifier.unregisterObserver(colorObserver);
      for (const observer of preferenceObservers)
        Zotero.Prefs.unregisterObserver(observer);
      window.clearTimeout(searchTimer);
      revision++;
      renderRevision++;
    },
    { once: true },
  );
  document
    .getElementById("close")
    .addEventListener("command", () => window.close());

  function updateSelection() {
    const available = visible;
    const checked = available.filter((name) => selected.has(name)).length;
    selectAll.disabled = busy || !available.length;
    selectAll.checked = !!available.length && checked === available.length;
    selectAll.indeterminate = checked > 0 && checked < available.length;
    clearSelection.disabled = busy || !selected.size;
    document.l10n.setAttributes(
      document.getElementById("selection-count"),
      "similar-works-tags-selection-count",
      {
        selected: selected.size,
        visible: visible.length,
        total: names.length,
        hidden: selected.size - checked,
      },
    );
    for (const button of list.querySelectorAll(".review-group"))
      button.disabled = busy;
    for (const input of list.querySelectorAll("input")) {
      input.checked = selected.has(input.value);
      input.disabled = busy;
    }
  }

  async function selectionChanged() {
    const token = ++revision;
    previewReady = false;
    formatPlan = null;
    apply.disabled = true;
    updateSelection();
    const merging = mode.value === "merge",
      deleting = mode.value === "delete",
      formatting = mode.value === "format",
      singleRename = mode.value === "rename" && selected.size === 1;
    document.getElementById("tag-table").dataset.mode = mode.value;
    const detailHeading = document.getElementById("sort-group");
    document.l10n.setAttributes(
      detailHeading,
      formatting
        ? "similar-works-tags-format-to"
        : "similar-works-tags-group-column",
    );
    detailHeading.disabled = formatting;
    updateFormatRows();
    document.l10n.setAttributes(
      apply,
      deleting
        ? "similar-works-tags-delete-button"
        : formatting
          ? "similar-works-tags-format-button"
          : merging
            ? "similar-works-tags-merge-button"
            : "similar-works-tags-rename-button",
    );
    apply.dataset.action = mode.value;
    target.hidden = document.getElementById("target-label").hidden = !(
      merging || singleRename
    );
    document.l10n.setAttributes(
      document.getElementById("target-label"),
      merging ? "similar-works-tags-keep" : "similar-works-tags-new-name",
    );
    target.disabled = busy || !selected.size;
    const options = document.getElementById("selected-names");
    options.replaceChildren();
    for (const name of selected) {
      const option = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "option",
      );
      option.value = option.textContent = name;
      options.appendChild(option);
    }
    target.value = merging
      ? preferredName([...selected]) || ""
      : [...selected][0] || "";
    updateCollision();
    if (
      !selected.size ||
      (merging && selected.size < 2) ||
      (mode.value === "rename" && selected.size !== 1)
    ) {
      preview.textContent = "";
      return;
    }
    preview.textContent = await fmt("similar-works-tags-preparing");
    try {
      const valid = () => active() && token === revision;
      if (formatting) {
        const plan = await api.planFormat(libraryID, [...selected], valid);
        const changes = plan.rows.filter(
          (row) => row.status === "change",
        ).length;
        const text = await fmt("similar-works-tags-format-preview", {
          tags: changes,
          count: plan.itemCount,
          skipped: plan.rows.length - changes,
        });
        const statuses = new Map(
          await Promise.all(
            [...new Set(plan.rows.map((row) => row.status))].map(
              async (status) => [
                status,
                await fmt("similar-works-tags-format-" + status),
              ],
            ),
          ),
        );
        if (!valid()) return;
        formatPlan = plan;
        formatLabels = statuses;
        updateFormatRows();
        preview.textContent = text;
        previewReady = true;
        apply.disabled = busy || !changes;
        return;
      }
      const affected = await api.preview(libraryID, [...selected], valid);
      const text = await fmt(
        deleting
          ? "similar-works-tags-delete-preview"
          : singleRename
            ? "similar-works-tags-rename-preview"
            : "similar-works-tags-preview",
        { tags: selected.size, count: affected },
      );
      if (!valid()) return;
      preview.textContent = text;
      previewReady = true;
      apply.disabled =
        busy ||
        (!deleting &&
          (!target.value.trim() ||
            (singleRename && target.value === [...selected][0])));
    } catch (error) {
      if (active() && token === revision) await report(error);
    }
  }

  function updateFormatRows() {
    if (mode.value !== "format") return;
    const rows = new Map(
      (formatPlan?.rows || []).map((row) => [row.from, row]),
    );
    for (const tr of list.querySelectorAll(".tag")) {
      const cell = tr.querySelector(".tag-detail");
      const row = rows.get(tr.querySelector("input").value);
      cell.replaceChildren();
      cell.classList.add("format-cell");
      delete cell.dataset.status;
      if (!row) continue;
      cell.dataset.status = row.status;
      const name = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      name.className = "format-name";
      name.textContent = row.to;
      const status = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      status.className = "format-status";
      status.textContent = formatLabels.get(row.status);
      cell.append(name, status);
    }
  }

  function setGroups(candidates) {
    groupLists = new Map(candidates.map((members, index) => [index, members]));
    groups = new Map(
      candidates.flatMap((members, index) =>
        members.map((name) => [name, index]),
      ),
    );
  }

  function groupMembers(group) {
    return groupLists.get(group) || [];
  }

  function preferredName(members) {
    return [...members].sort(
      (a, b) =>
        (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b),
    )[0];
  }

  async function groupHeading(members) {
    const row = document.createElementNS("http://www.w3.org/1999/xhtml", "tr");
    row.className = "duplicate-group";
    const cell = document.createElementNS("http://www.w3.org/1999/xhtml", "td");
    cell.colSpan = mode.value === "format" ? 3 : 2;
    const heading = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    heading.className = "duplicate-heading";
    const label = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "strong",
    );
    label.textContent = preferredName(members);
    const reasons = new Set();
    for (let i = 0; i < members.length; i++)
      for (const peer of members.slice(i + 1))
        reasons.add(api.duplicateReason(members[i], peer) || "semantic");
    const reason = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    reason.className = "duplicate-reason";
    reason.textContent = reasons.has("semantic")
      ? await fmt("similar-works-tags-review-semantic")
      : (
          await Promise.all(
            [...reasons].map((key) => fmt("similar-works-tags-match-" + key)),
          )
        ).join(" · ");
    const review = document.createXULElement("button");
    review.classList.add("review-group");
    document.l10n.setAttributes(review, "similar-works-tags-review-group", {
      name: preferredName(members),
    });
    review.disabled = busy;
    review.addEventListener("command", () => {
      if (busy) return;
      selected.clear();
      for (const name of members) selected.add(name);
      mode.value = "merge";
      void selectionChanged()
        .then(() => {
          if (active()) target.focus();
        })
        .catch(report);
      void render().catch(report);
    });
    heading.append(label, reason, review);
    cell.append(heading);
    row.append(cell);
    return row;
  }

  async function render() {
    const token = ++renderRevision;
    document.getElementById("tag-table").dataset.organizing = String(
      duplicates.checked,
    );
    const query = search.value.normalize("NFKC").toLowerCase().trim();
    const words = api.words(query).join(" ").toLowerCase();
    const matches = (name) =>
      name.toLowerCase().includes(query) ||
      (!!words && api.words(name).join(" ").toLowerCase().includes(words));
    const matchingGroups = new Set(
      names.filter(matches).map((name) => groups.get(name)),
    );
    visible = names.filter((name) =>
      duplicates.checked
        ? groups.has(name) && matchingGroups.has(groups.get(name))
        : matches(name),
    );
    visible.sort((a, b) => {
      const order =
        sortBy === "count"
          ? (counts.get(a) || 0) - (counts.get(b) || 0)
          : sortBy === "group"
            ? (groups.get(a) ?? Infinity) - (groups.get(b) ?? Infinity)
            : a.localeCompare(b, undefined, {
                numeric: true,
                sensitivity: "base",
              });
      if (duplicates.checked && groups.get(a) !== groups.get(b))
        return groups.get(a) - groups.get(b);
      return (ascending ? 1 : -1) * (order || a.localeCompare(b));
    });
    anchor = null;
    list.replaceChildren();
    let previousGroup = null;
    // Every tag is reachable; yield between batches instead of truncating the list.
    for (let offset = 0; offset < visible.length; offset += 100) {
      if (!active() || token !== renderRevision) return;
      const fragment = document.createDocumentFragment();
      for (const name of visible.slice(offset, offset + 100)) {
        const label = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "label",
        );
        const row = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "tr",
        );
        row.className = "tag";
        if (duplicates.checked && previousGroup !== groups.get(name))
          fragment.appendChild(
            await groupHeading(groupMembers(groups.get(name))),
          );
        previousGroup = groups.get(name);
        const input = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "input",
        );
        input.type = "checkbox";
        input.value = name;
        input.checked = selected.has(name);
        input.disabled = busy;
        const text = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "span",
        );
        text.textContent = name;
        const count = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "td",
        );
        count.className = "tag-count";
        count.textContent = (counts.get(name) || 0).toLocaleString();
        const hint = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "td",
        );
        hint.className = "tag-detail";
        input.addEventListener("click", (event) => {
          if (event.shiftKey && anchor !== null) {
            const first = visible.indexOf(anchor),
              last = visible.indexOf(name);
            for (const value of visible.slice(
              Math.min(first, last),
              Math.max(first, last) + 1,
            )) {
              if (input.checked) selected.add(value);
              else selected.delete(value);
            }
          }
          anchor = name;
        });
        input.addEventListener("change", () => {
          if (input.checked) selected.add(name);
          else selected.delete(name);
          void selectionChanged().catch(report);
        });
        if (mode.value !== "format" && groups.has(name)) {
          const members = groupMembers(groups.get(name));
          const peer = preferredName(members.filter((other) => other !== name));
          hint.textContent = peer;
          hint.title = await fmt(
            "similar-works-tags-match-" +
              (api.duplicateReason(name, peer) || "semantic"),
          );
        }
        label.append(input, text);
        const cell = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "td",
        );
        cell.appendChild(label);
        row.append(cell, count, hint);
        fragment.appendChild(row);
      }
      if (!active() || token !== renderRevision) return;
      list.appendChild(fragment);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (!visible.length) {
      const empty = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "tr",
      );
      const emptyCell = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "td",
      );
      emptyCell.colSpan = 3;
      empty.appendChild(emptyCell);
      emptyCell.textContent = await fmt("similar-works-tags-no-matches");
      if (active() && token === renderRevision) list.appendChild(empty);
    }
    updateSelection();
    updateFormatRows();
  }

  async function load() {
    const token = ++loadRevision;
    const [catalog, usage] = await Promise.all([
      api.catalog(libraryID, true),
      api.usageCounts(libraryID),
    ]);
    if (!active() || token !== loadRevision) return;
    names = catalog;
    counts = usage;
    for (const name of selected)
      if (!names.includes(name)) selected.delete(name);
    setGroups(api.duplicateGroups(names));
    await render();
    if (active() && token === loadRevision) await selectionChanged();
    void matchSemantics(token, names);
  }

  async function matchSemantics(token, catalog) {
    const valid = () => active() && token === loadRevision && !busy;
    if (!valid()) return;
    const status = document.getElementById("match-status");
    status.hidden = false;
    try {
      const preparing = await fmt("similar-works-tags-semantic-preparing");
      if (!valid()) return;
      status.textContent = preparing;
      const result = await api.potentialDuplicates(catalog, valid);
      if (!valid()) return;
      const message = result.semantic
        ? ""
        : await fmt("similar-works-tags-semantic-unavailable");
      if (!valid()) return;
      setGroups(result.groups);
      status.hidden = result.semantic;
      status.textContent = message;
      await render();
    } catch (error) {
      const message = valid()
        ? await fmt("similar-works-tags-semantic-error", {
            message: String(error.message || error),
          })
        : "";
      if (valid()) status.textContent = message;
    }
  }

  function chooseVisible(checked) {
    if (busy) return;
    for (const name of visible) {
      if (checked) selected.add(name);
      else selected.delete(name);
    }
    void selectionChanged().catch(report);
  }
  clearSelection.addEventListener("command", () => {
    if (busy) return;
    selected.clear();
    void selectionChanged().catch(report);
  });
  selectAll.addEventListener("change", () => chooseVisible(selectAll.checked));
  document.getElementById("tag-table").addEventListener("keydown", (event) => {
    if (accel(event) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      chooseVisible(true);
    }
  });
  function updateCollision() {
    const name = target.value.trim();
    document.getElementById("collision").hidden =
      target.hidden || !name || selected.has(name) || !names.includes(name);
  }
  target.addEventListener("input", () => {
    updateCollision();
    apply.disabled =
      busy ||
      !previewReady ||
      !selected.size ||
      !target.value.trim() ||
      (mode.value === "rename" && target.value === [...selected][0]) ||
      (mode.value === "merge" && selected.size < 2);
  });
  refresh.addEventListener("command", () => {
    if (busy) return;
    void load().catch(report);
  });
  const searchChanged = (event) => {
    window.clearTimeout(searchTimer);
    renderRevision++;
    if (event.isComposing) return;
    searchTimer = window.setTimeout(() => {
      if (active()) void render().catch(report);
    }, 120);
  };
  search.addEventListener("input", searchChanged);
  search.addEventListener("compositionend", searchChanged);
  search.addEventListener("compositionstart", () => {
    window.clearTimeout(searchTimer);
    renderRevision++;
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
      return;
    if (accel(event) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (accel(event) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      window.close();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (search.value) {
        search.value = "";
        searchChanged(event);
      } else window.close();
    }
  });
  function setSort(key) {
    if (busy || (key === "group" && mode.value === "format")) return;
    ascending = sortBy === key ? !ascending : key !== "count";
    sortBy = key;
    for (const column of ["name", "count", "group"])
      document
        .getElementById("sort-" + column)
        .parentElement.setAttribute(
          "aria-sort",
          column === sortBy ? (ascending ? "ascending" : "descending") : "none",
        );
    void render().catch(report);
  }
  for (const column of ["name", "count", "group"])
    document
      .getElementById("sort-" + column)
      .addEventListener("click", () => setSort(column));
  duplicates.addEventListener("change", () => {
    sortBy = "";
    setSort(duplicates.checked ? "group" : "name");
  });
  mode.addEventListener("command", () => {
    void selectionChanged().catch(report);
    void render().catch(report);
  });
  apply.addEventListener("command", async () => {
    if (busy || apply.disabled) return;
    if (!["merge", "rename", "delete", "format"].includes(mode.value)) {
      await report(new Error("similar-works-tags-changed"));
      return;
    }
    const merging = mode.value === "merge",
      deleting = mode.value === "delete",
      formatting = mode.value === "format",
      keep = api.normalizeName(target.value);
    const plan = formatPlan;
    if (formatting && !plan) return;
    busy = true;
    revision++;
    apply.disabled =
      target.disabled =
      refresh.disabled =
      search.disabled =
      duplicates.disabled =
      mode.disabled =
      selectAll.disabled =
        true;
    loadRevision++;
    renderRevision++;
    window.clearTimeout(searchTimer);
    updateSelection();
    let resultText;
    try {
      const progress = (done, total) => {
        if (active()) {
          preview.textContent = done + " / " + total;
          preview.setAttribute("aria-busy", "true");
        }
      };
      const count = deleting
        ? await api.remove(libraryID, [...selected], active, progress)
        : formatting
          ? await api.applyFormat(libraryID, plan, active, progress)
          : await api.merge(libraryID, [...selected], keep, active);
      selected.clear();
      resultText = await fmt(
        deleting
          ? "similar-works-tags-deleted"
          : formatting
            ? "similar-works-tags-formatted"
            : merging
              ? "similar-works-tags-merged"
              : "similar-works-tags-renamed",
        { count, name: keep },
      );
    } catch (error) {
      resultText = await errorText(error);
    } finally {
      busy = false;
      if (active()) {
        preview.removeAttribute("aria-busy");
        refresh.disabled =
          search.disabled =
          duplicates.disabled =
          mode.disabled =
            false;
        try {
          await load();
        } catch (error) {
          resultText = await errorText(error);
        }
        if (active()) preview.textContent = resultText;
      }
    }
  });
  try {
    await load();
  } catch (error) {
    await report(error);
  }
})();
