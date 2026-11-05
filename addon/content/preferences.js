/* global Zotero */
window.MozXULElement.insertFTLIfNeeded("knowledge-base-addon.ftl");
window.KnowledgeBasePreferences = (() => {
  const menus = new WeakSet();
  function getMenu(doc, id) {
    return /** @type {XULMenuListElement} */ (
      /** @type {unknown} */ (doc.getElementById(id))
    );
  }

  function bindMenu(menu, value, onChange) {
    menu.value = value;
    if (menus.has(menu)) return;
    menus.add(menu);
    menu.addEventListener("command", () => onChange(menu.value));
  }

  function bindNumber(input, read, write) {
    input.value = String(read());
    if (menus.has(input)) return;
    menus.add(input);
    input.addEventListener("change", () => {
      if (input.checkValidity() && input.value) write(Number(input.value));
      input.value = String(read());
    });
  }

  function groupButton(doc, api, action, label) {
    const button = /** @type {Element & {disabled: boolean}} */ (
      doc.createXULElement("button")
    );
    button.classList.add("graph-group-" + action);
    button.setAttribute("label", label);
    button.setAttribute("tooltiptext", api.loc("graph-group-" + action));
    button.setAttribute("aria-label", api.loc("graph-group-" + action));
    button.setAttribute("style", "min-width: 2em");
    return button;
  }

  function bindGraphControls(doc, api) {
    const labelLength = /** @type {HTMLInputElement} */ (
      doc.getElementById("knowledge-base-graph-label-length")
    );
    const depth = /** @type {HTMLInputElement} */ (
      doc.getElementById("knowledge-base-graph-local-depth")
    );
    bindNumber(
      depth,
      () => api.getGraphLocalDepth(),
      (value) => api.setGraphLocalDepth(value),
    );
    bindNumber(
      labelLength,
      () => api.getGraphLabelLength(),
      (value) => api.setGraphLabelLength(value),
    );
  }

  function bindGraphGroups(doc, api, error, addGroup, initialTags) {
    let tags = initialTags;
    menus.add(addGroup);
    const groups = api.getGraphGroups();
    const groupList = doc.getElementById("knowledge-base-graph-groups");
    const save = () => {
      try {
        api.setGraphGroups(groups);
        error.hidden = true;
      } catch (failure) {
        error.textContent = String(failure.message || failure);
        error.hidden = false;
        Zotero.logError(failure);
      }
    };
    const render = () => {
      groupList.replaceChildren();
      groups.forEach((group, index) => {
        const row = doc.createXULElement("hbox");
        row.classList.add("graph-group-row");
        row.setAttribute("align", "center");
        row.setAttribute("style", "margin-block: 3px");
        const tag = /** @type {XULMenuListElement} */ (
          /** @type {unknown} */ (doc.createXULElement("menulist"))
        );
        tag.classList.add("graph-group-tag");
        tag.setAttribute("native", "true");
        tag.setAttribute("style", "flex: 1; min-width: 12em; max-width: 32em");
        tag.setAttribute("aria-label", api.loc("graph-group-tag"));
        const popup = doc.createXULElement("menupopup");
        for (const value of [...new Set(["", ...tags, group.tag])]) {
          const option = doc.createXULElement("menuitem");
          option.setAttribute("value", value);
          option.setAttribute("label", value || api.loc("graph-group-tag"));
          popup.append(option);
        }
        tag.append(popup);
        tag.value = group.tag;
        tag.addEventListener("command", () => {
          group.tag = tag.value;
          save();
        });
        const color = /** @type {HTMLInputElement} */ (
          doc.createElementNS("http://www.w3.org/1999/xhtml", "input")
        );
        color.type = "color";
        color.className = "graph-group-color";
        color.value = group.color;
        color.setAttribute("aria-label", api.loc("graph-group-color"));
        color.setAttribute(
          "style",
          "width: 3em; height: 2em; margin-inline: 6px",
        );
        color.addEventListener("change", () => {
          group.color = color.value;
          save();
        });
        const up = groupButton(doc, api, "up", "↑");
        up.disabled = index === 0;
        up.addEventListener("command", () => {
          [groups[index - 1], groups[index]] = [
            groups[index],
            groups[index - 1],
          ];
          save();
          render();
        });
        const remove = groupButton(doc, api, "remove", "×");
        remove.addEventListener("command", () => {
          groups.splice(index, 1);
          save();
          render();
        });
        row.append(tag, color, up, remove);
        groupList.append(row);
      });
    };
    render();
    addGroup.addEventListener("command", async () => {
      if (addGroup.hasAttribute("disabled")) return;
      addGroup.setAttribute("disabled", "true");
      try {
        tags = await api.getGraphTags();
        if (!addGroup.isConnected || doc.defaultView?.closed) return;
        const palette = [
          "#3478f6",
          "#30a46c",
          "#af52de",
          "#f59e0b",
          "#0891b2",
          "#ec4899",
        ];
        groups.push({
          tag: "",
          color: palette[groups.length % palette.length],
        });
        save();
        render();
      } catch (failure) {
        error.textContent = String(failure.message || failure);
        error.hidden = false;
        Zotero.logError(failure);
      } finally {
        addGroup.removeAttribute("disabled");
      }
    });
  }

  return {
    async start(doc) {
      const api = Zotero.ZoteroKnowledgeBase.api;
      const error = doc.getElementById("knowledge-base-preferences-error");
      try {
        const types =
          /** @type {import("../../src/modules/note-types").NoteType[]} */ ([
            "literature",
            "zettel",
            "thinking",
            "entity",
          ]);
        const templates = types.map((type) => ({
          type,
          menu: getMenu(doc, "knowledge-base-" + type + "-template"),
        }));
        const refreshTemplates = () => {
          const settings = api.getLiteratureTemplateSettings();
          for (const { type, menu } of templates) {
            const popup = menu.querySelector("menupopup");
            popup.replaceChildren();
            for (const entry of [
              { id: "", name: api.loc("template-none") },
              ...settings.templates,
            ]) {
              const option = doc.createXULElement("menuitem");
              option.setAttribute("value", entry.id);
              option.setAttribute("label", entry.name);
              popup.append(option);
            }
            menu.value = api.getNoteTemplate(type) || "";
          }
        };
        refreshTemplates();
        for (const { type, menu } of templates)
          bindMenu(menu, menu.value, (value) =>
            api.setNoteTemplate(type, value || null),
          );
        const container = doc.querySelector(".settings-templates");
        if (!menus.has(container)) {
          menus.add(container);
          const observers = [
            "literatureTemplates",
            ...types
              .filter((type) => type !== "literature")
              .map((type) => "templates." + type),
          ].map((key) =>
            Zotero.Prefs.registerObserver(
              "extensions.zotero.knowledge-base." + key,
              refreshTemplates,
              true,
            ),
          );
          doc.defaultView.addEventListener(
            "unload",
            () => {
              for (const observer of observers)
                Zotero.Prefs.unregisterObserver(observer);
            },
            { once: true },
          );
        }
        const manage = doc.getElementById("knowledge-base-template-manage");
        if (!menus.has(manage)) {
          menus.add(manage);
          manage.addEventListener("command", () => {
            try {
              api.openTemplateManager();
            } catch (failure) {
              error.textContent = String(failure.message || failure);
              error.hidden = false;
              Zotero.logError(failure);
            }
          });
        }
        bindGraphControls(doc, api);
        const takeover = /** @type {XULCheckboxElement} */ (
          /** @type {unknown} */ (
            doc.getElementById("knowledge-base-native-note-takeover")
          )
        );
        takeover.checked = api.getNativeNoteTakeover();
        if (!menus.has(takeover)) {
          menus.add(takeover);
          takeover.addEventListener("command", async () => {
            takeover.disabled = true;
            try {
              await api.setNativeNoteTakeover(takeover.checked);
            } catch (failure) {
              error.textContent = String(failure.message || failure);
              error.hidden = false;
              Zotero.logError(failure);
            } finally {
              takeover.checked = api.getNativeNoteTakeover();
              takeover.disabled = false;
            }
          });
        }
        const mode = getMenu(doc, "knowledge-base-workbench-mode");
        bindMenu(mode, api.getWorkbenchMode(), (value) =>
          api.setWorkbenchMode(value),
        );
        const addGroup = doc.getElementById("knowledge-base-add-group");
        if (!menus.has(addGroup)) {
          const tags = await api.getGraphTags();
          if (!addGroup.isConnected || menus.has(addGroup)) return;
          bindGraphGroups(doc, api, error, addGroup, tags);
        }
        error.hidden = true;
      } catch (failure) {
        error.textContent = String(failure.message || failure);
        error.hidden = false;
        Zotero.logError(failure);
      }
    },
  };
})();
