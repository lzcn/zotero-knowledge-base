/* global Zotero */
window.MozXULElement.insertFTLIfNeeded("knowledge-base-addon.ftl");
window.KnowledgeBasePreferences = (() => {
  const menus = new WeakSet();
  return {
    async start(doc) {
      const api = Zotero.ZoteroKnowledgeBase.api;
      const menu = /** @type {XULMenuListElement} */ (
        /** @type {unknown} */ (
          doc.getElementById("knowledge-base-source-style")
        )
      );
      const popup = doc.getElementById("knowledge-base-source-styles");
      const error = doc.getElementById("knowledge-base-preferences-error");
      try {
        const labelLength = /** @type {HTMLInputElement} */ (
          doc.getElementById("knowledge-base-graph-label-length")
        );
        const depth = /** @type {HTMLInputElement} */ (
          doc.getElementById("knowledge-base-graph-local-depth")
        );
        depth.value = String(api.getGraphLocalDepth());
        if (!menus.has(depth)) {
          menus.add(depth);
          depth.addEventListener("change", () => {
            if (depth.checkValidity() && depth.value)
              api.setGraphLocalDepth(Number(depth.value));
            depth.value = String(api.getGraphLocalDepth());
          });
        }
        labelLength.value = String(api.getGraphLabelLength());
        if (!menus.has(labelLength)) {
          menus.add(labelLength);
          labelLength.addEventListener("change", () => {
            if (labelLength.checkValidity() && labelLength.value)
              api.setGraphLabelLength(Number(labelLength.value));
            labelLength.value = String(api.getGraphLabelLength());
          });
        }
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
        const addGroup = doc.getElementById("knowledge-base-add-group");
        if (!menus.has(addGroup)) {
          let tags = await api.getGraphTags();
          if (!addGroup.isConnected || menus.has(addGroup)) return;
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
              tag.setAttribute(
                "style",
                "flex: 1; min-width: 12em; max-width: 32em",
              );
              tag.setAttribute("aria-label", api.loc("graph-group-tag"));
              const popup = doc.createXULElement("menupopup");
              for (const value of [...new Set(["", ...tags, group.tag])]) {
                const option = doc.createXULElement("menuitem");
                option.setAttribute("value", value);
                option.setAttribute(
                  "label",
                  value || api.loc("graph-group-tag"),
                );
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
              const up = /** @type {Element & {disabled: boolean}} */ (
                doc.createXULElement("button")
              );
              up.classList.add("graph-group-up");
              up.setAttribute("label", "↑");
              up.setAttribute("tooltiptext", api.loc("graph-group-up"));
              up.setAttribute("aria-label", api.loc("graph-group-up"));
              up.setAttribute("style", "min-width: 2em");
              up.disabled = index === 0;
              up.addEventListener("command", () => {
                [groups[index - 1], groups[index]] = [
                  groups[index],
                  groups[index - 1],
                ];
                save();
                render();
              });
              const remove = doc.createXULElement("button");
              remove.classList.add("graph-group-remove");
              remove.setAttribute("label", "×");
              remove.setAttribute("tooltiptext", api.loc("graph-group-remove"));
              remove.setAttribute("aria-label", api.loc("graph-group-remove"));
              remove.setAttribute("style", "min-width: 2em");
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
        const mode = /** @type {XULMenuListElement} */ (
          /** @type {unknown} */ (
            doc.getElementById("knowledge-base-workbench-mode")
          )
        );
        mode.value = api.getWorkbenchMode();
        if (!menus.has(mode)) {
          menus.add(mode);
          mode.addEventListener("command", () =>
            api.setWorkbenchMode(mode.value),
          );
        }
        const styles = await api.getSourceStyles();
        if (!menu.isConnected) return;
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
        error.hidden = true;
      } catch (failure) {
        error.textContent = String(failure.message || failure);
        error.hidden = false;
        Zotero.logError(failure);
      }
    },
  };
})();
