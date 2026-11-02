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

  function bindTemplates(doc, api) {
    const template = getMenu(doc, "knowledge-base-literature-template");
    const templateBody = /** @type {HTMLTextAreaElement} */ (
      doc.getElementById("knowledge-base-template-body")
    );
    const templateName = /** @type {HTMLInputElement} */ (
      doc.getElementById("knowledge-base-template-name")
    );
    const templateEditor = doc.getElementById("knowledge-base-template-editor");
    const templateError = doc.getElementById("knowledge-base-template-error");
    const deleteTemplate = doc.getElementById("knowledge-base-template-delete");
    const renderTemplateMenu = () => {
      const settings = api.getLiteratureTemplateSettings();
      const popup = doc.getElementById("knowledge-base-literature-templates");
      const entries = [
        { id: "", name: api.loc("template-none") },
        ...settings.templates,
      ];
      // Native menus must retain their items while a selection closes the popup.
      const items = new Map(
        Array.from(popup.children, (item) => [
          item.getAttribute("value"),
          item,
        ]),
      );
      const ids = new Set(entries.map((entry) => entry.id));
      for (const [id, item] of items) if (!ids.has(id)) item.remove();
      for (const entry of entries) {
        let item = items.get(entry.id);
        if (!item) {
          item = doc.createXULElement("menuitem");
          item.setAttribute("value", entry.id);
          popup.append(item);
        }
        if (item.getAttribute("label") !== entry.name)
          item.setAttribute("label", entry.name);
      }
      const selectedID = settings.selected || "";
      if (template.value !== selectedID || !template.selectedItem)
        template.value = selectedID;
      return settings.templates.find((entry) => entry.id === settings.selected);
    };
    const renderTemplate = () => {
      const selected = renderTemplateMenu();
      templateEditor.hidden = !selected;
      deleteTemplate.hidden = !selected;
      templateName.value = selected?.name || "";
      templateBody.value = selected?.body || "";
      templateError.hidden = true;
    };
    const changeTemplate = (run) => {
      try {
        run();
        templateError.hidden = true;
      } catch (failure) {
        templateError.textContent = String(failure.message || failure);
        templateError.hidden = false;
      }
    };
    renderTemplate();
    if (!menus.has(template)) {
      menus.add(template);
      template.addEventListener("command", () =>
        changeTemplate(() => {
          api.setLiteratureTemplate(template.value || null);
          renderTemplate();
        }),
      );
      doc
        .getElementById("knowledge-base-template-new")
        .addEventListener("command", () =>
          changeTemplate(() => {
            api.createLiteratureTemplate();
            renderTemplate();
            templateName.focus();
            templateName.select();
          }),
        );
      templateName.addEventListener("change", () =>
        changeTemplate(() => {
          api.updateLiteratureTemplate(template.value, {
            name: templateName.value,
          });
          const selected = renderTemplateMenu();
          templateName.value = selected.name;
        }),
      );
      templateBody.addEventListener("input", () =>
        changeTemplate(() =>
          api.updateLiteratureTemplate(template.value, {
            body: templateBody.value,
          }),
        ),
      );
      deleteTemplate.addEventListener("command", () =>
        changeTemplate(() => {
          const selected = api
            .getLiteratureTemplateSettings()
            .templates.find((entry) => entry.id === template.value);
          if (
            selected &&
            doc.defaultView.confirm(
              api.loc("template-delete-confirm", { name: selected.name }),
            )
          ) {
            api.deleteLiteratureTemplate(selected.id);
            renderTemplate();
          }
        }),
      );
    }
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
    const inheritance = /** @type {HTMLElement & {checked: boolean}} */ (
      doc.getElementById("knowledge-base-inherit-tags")
    );
    inheritance.checked = api.getTagInheritance();
    if (!menus.has(inheritance)) {
      menus.add(inheritance);
      inheritance.addEventListener("command", () =>
        api.setTagInheritance(inheritance.checked),
      );
    }
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

  function bindSourceStyle(doc, api, menu, popup, error, styles) {
    popup.replaceChildren();
    for (const style of styles) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("value", style.id);
      item.setAttribute("label", style.title);
      popup.append(item);
    }
    const selected = api.getSourceStyle();
    if (!styles.some((style) => style.id === selected)) {
      const missing = doc.createXULElement("menuitem");
      missing.setAttribute("value", selected);
      missing.setAttribute("label", api.loc("source-style-missing"));
      popup.prepend(missing);
    }
    menu.value = selected;
    if (!menus.has(menu)) {
      menus.add(menu);
      menu.addEventListener("command", () => {
        try {
          api.setSourceStyle(menu.value);
          error.hidden = true;
        } catch (failure) {
          error.textContent = String(failure.message || failure);
          error.hidden = false;
          Zotero.logError(failure);
        }
      });
    }
  }

  return {
    async start(doc) {
      const api = Zotero.ZoteroKnowledgeBase.api;
      const menu = getMenu(doc, "knowledge-base-source-style");
      const popup = doc.getElementById("knowledge-base-source-styles");
      const error = doc.getElementById("knowledge-base-preferences-error");
      try {
        bindTemplates(doc, api);
        bindGraphControls(doc, api);
        const addGroup = doc.getElementById("knowledge-base-add-group");
        if (!menus.has(addGroup)) {
          const tags = await api.getGraphTags();
          if (!addGroup.isConnected || menus.has(addGroup)) return;
          bindGraphGroups(doc, api, error, addGroup, tags);
        }
        const mode = getMenu(doc, "knowledge-base-workbench-mode");
        bindMenu(mode, api.getWorkbenchMode(), (value) =>
          api.setWorkbenchMode(value),
        );
        const styles = await api.getSourceStyles();
        if (!menu.isConnected) return;
        bindSourceStyle(doc, api, menu, popup, error, styles);
        error.hidden = true;
      } catch (failure) {
        error.textContent = String(failure.message || failure);
        error.hidden = false;
        Zotero.logError(failure);
      }
    },
  };
})();
