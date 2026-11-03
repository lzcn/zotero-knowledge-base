/* global Zotero */
window.MozXULElement.insertFTLIfNeeded("knowledge-base-addon.ftl");
window.KnowledgeBaseTemplates = (() => {
  const bound = new WeakSet();
  function bind(doc, api) {
    const list = doc.getElementById("knowledge-base-literature-templates");
    if (bound.has(list)) return;
    bound.add(list);
    const name = doc.getElementById("knowledge-base-template-name");
    const body = doc.getElementById("knowledge-base-template-body");
    const editor = doc.getElementById("knowledge-base-template-editor");
    const empty = doc.getElementById("knowledge-base-template-empty");
    const error = doc.getElementById("knowledge-base-template-error");
    const remove = doc.getElementById("knowledge-base-template-delete");
    const use = doc.getElementById("knowledge-base-template-default");
    let selected = null;
    list.setAttribute("aria-label", api.loc("pref-literature-template"));
    const change = (run) => {
      if (doc.defaultView.closed || doc.defaultView.knowledgeBaseStopping)
        return;
      try {
        run();
        error.hidden = true;
      } catch (failure) {
        error.textContent = String(failure.message || failure);
        error.hidden = false;
      }
    };
    const renderList = () => {
      const settings = api.getLiteratureTemplateSettings();
      if (!settings.templates.some((entry) => entry.id === selected))
        selected = settings.templates[0]?.id || null;
      const buttons = new Map(
        Array.from(list.children, (node) => [node.dataset.id, node]),
      );
      for (const [id, button] of buttons)
        if (!settings.templates.some((entry) => entry.id === id))
          button.remove();
      for (const entry of settings.templates) {
        let button = buttons.get(entry.id);
        if (!button) {
          button = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "button",
          );
          button.type = "button";
          button.dataset.id = entry.id;
          button.setAttribute("role", "option");
          button.addEventListener("click", () =>
            change(() => {
              selected = entry.id;
              render();
            }),
          );
          list.append(button);
        }
        button.textContent = entry.name;
        button.setAttribute("aria-selected", String(entry.id === selected));
      }
      return settings;
    };
    const render = () => {
      const settings = renderList();
      const entry = settings.templates.find((entry) => entry.id === selected);
      editor.hidden = !entry;
      empty.hidden = !!entry;
      remove.disabled = !entry;
      name.value = entry?.name || "";
      body.value = entry?.body || "";
      use.checked = !!entry && settings.selected === entry.id;
    };
    doc
      .getElementById("knowledge-base-template-new")
      .addEventListener("command", () =>
        change(() => {
          selected = api.createLiteratureTemplate();
          render();
          name.focus();
          name.select();
        }),
      );
    name.addEventListener("input", () =>
      change(() => {
        api.updateLiteratureTemplate(selected, { name: name.value });
        renderList();
      }),
    );
    body.addEventListener("input", () =>
      change(() =>
        api.updateLiteratureTemplate(selected, { body: body.value }),
      ),
    );
    use.addEventListener("command", () =>
      change(() => api.setLiteratureTemplate(use.checked ? selected : null)),
    );
    remove.addEventListener("command", () =>
      change(() => {
        const entry = api
          .getLiteratureTemplateSettings()
          .templates.find((entry) => entry.id === selected);
        if (
          entry &&
          doc.defaultView.confirm(
            api.loc("template-delete-confirm", { name: entry.name }),
          )
        ) {
          api.deleteLiteratureTemplate(selected);
          render();
        }
      }),
    );
    list.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(list.children);
      const at = buttons.indexOf(doc.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : Math.max(
                0,
                Math.min(
                  buttons.length - 1,
                  at + (event.key === "ArrowDown" ? 1 : -1),
                ),
              );
      if (buttons[next]) {
        event.preventDefault();
        buttons[next].focus();
        buttons[next].click();
      }
    });
    change(() => {
      selected = api.getLiteratureTemplateSettings().selected;
      render();
    });
  }
  return { bind };
})();
