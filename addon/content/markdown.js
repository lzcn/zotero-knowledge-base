/* global Zotero */
"use strict";

// Chrome windows are XML documents. Markdown emits HTML (including <br>,
// <input> and <hr>), so inserting it through XML innerHTML would throw.
window.ZoteroKnowledgeBaseMarkdown = {
  /** @param {HTMLElement} container @param {string[]} tags */
  tags(container, tags) {
    container.replaceChildren(
      ...tags.map((tag) => {
        const label = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "span",
        );
        label.className = "note-tag";
        label.textContent = tag;
        label.setAttribute("role", "listitem");
        return label;
      }),
    );
    container.hidden = !tags.length;
  },
  /** @param {HTMLElement} container @param {import("../../src/modules/zotero").ItemSummary} item @param {import("../../src/modules/api").KnowledgeBaseAPI} api */
  async source(container, item, api) {
    const token = {};
    container._sourceRender = token;
    container.classList.add("bibliography-reference");
    container.textContent = item.title;
    container.setAttribute("role", "link");
    container.tabIndex = 0;
    container.title = api.loc("manager-source-open");
    container.onclick = (event) => {
      const link = /** @type {Element} */ (event.target).closest?.("a[href]");
      event.preventDefault();
      (link
        ? api.openLink(link.getAttribute("href"))
        : api.selectItem(item.key, item.libraryID)
      ).catch((error) => Zotero.logError(error));
    };
    container.onkeydown = (event) => {
      if (event.target === container && event.key === "Enter")
        container.click();
    };
    const html = await api.getSourceBibliography(item.key, item.libraryID);
    if (container._sourceRender !== token || !container.isConnected || !html)
      return;
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    container.replaceChildren(
      ...Array.from(parsed.body.childNodes).map((node) =>
        document.importNode(node, true),
      ),
    );
  },
  /** @param {Element} container @param {string} id @param {string} title @param {string} [reference] */
  identity(container, id, title, reference = id) {
    const name = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    name.className = "relation-title";
    name.textContent = title || id;
    const index = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    index.className = "relation-id";
    index.textContent = reference;
    index.hidden =
      !title ||
      title === id ||
      title === reference ||
      title === `[[${id}]]` ||
      title === `[[${reference}]]`;
    if (index.hidden) name.textContent = reference || id;
    const text = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    text.className = "note-reference-text";
    text.append(name);
    if (!index.hidden && reference) {
      text.append(
        document.createTextNode(" ("),
        index,
        document.createTextNode(")"),
      );
    } else text.append(index);
    container.append(text);
    container.setAttribute(
      "title",
      index.hidden ? reference || id : `${title} (${reference})`,
    );
    container.setAttribute("aria-label", container.getAttribute("title"));
  },
  /** @param {HTMLButtonElement} button @param {string} reference @param {import("../../src/modules/api").KnowledgeBaseAPI} api */
  reference(button, reference, api) {
    button.hidden = !reference;
    button.textContent = reference;
    button.title = api.loc("note-reference-copy");
    button.onclick = () => api.copyNoteReference(reference);
  },
  /** @param {Element} container @param {import("../../src/modules/hierarchy").CardFamily} family @param {import("../../src/modules/api").KnowledgeBaseAPI} api */
  renderFamily(container, family, api) {
    const key = JSON.stringify([
      family.parent?.id,
      family.children.map((card) => card.id),
    ]);
    const expanded =
      container.getAttribute("data-family") === key
        ? container.querySelector("details")?.open
        : undefined;
    container.setAttribute("data-family", key);
    container.replaceChildren();
    const parent = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "section",
    );
    const heading = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "h3",
    );
    heading.textContent = api.loc("parent");
    parent.appendChild(heading);
    if (family.parent) {
      const button = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      button.className = "family-link relation-link";
      this.identity(
        button,
        family.parent.id,
        family.parent.title,
        family.parent.reference,
      );
      button.addEventListener("click", () =>
        api.openManager({ selectId: family.parent.id }),
      );
      parent.appendChild(button);
    } else {
      const entry = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      entry.className = "muted";
      entry.textContent = api.loc("root");
      parent.appendChild(entry);
    }
    const list = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    list.className = "relation-list";
    for (const card of family.children) {
      const button = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      button.className = "family-link relation-link";
      this.identity(button, card.id, card.title, card.reference);
      button.addEventListener("click", () =>
        api.openManager({ selectId: card.id }),
      );
      list.appendChild(button);
    }
    const group = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "details",
    );
    if (expanded) group.setAttribute("open", "");
    const label = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "summary",
    );
    label.textContent = `${api.loc("relations-hierarchy")} · ${family.children.length + Number(!!family.parent)}`;
    const childHeading = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "h3",
    );
    childHeading.textContent = `${api.loc("children")} · ${family.children.length}`;
    group.append(label, parent, childHeading, list);
    container.append(group);
  },
  /** @param {Element} container @param {string} body */
  render(container, body) {
    const element = /** @type {HTMLElement} */ (container);
    element._sourceRender = null;
    if (element.classList.contains("bibliography-reference")) {
      element.classList.remove("bibliography-reference");
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.onclick = null;
      element.onkeydown = null;
    }
    const html = window.Zotero.ZoteroKnowledgeBase.api.renderMarkdown(body);
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    container.replaceChildren(
      ...Array.from(parsed.body.childNodes, (node) =>
        container.ownerDocument.importNode(node, true),
      ),
    );
  },
};

window.KnowledgeBasePanels = {
  /** @param {HTMLElement} handle @param {HTMLElement} pane @param {"manager" | "graph"} name @param {import("../../src/modules/api").KnowledgeBaseAPI} api */
  attach(handle, pane, name, api) {
    let value = api.getPanelWidth(name);
    let dragging = false;
    handle.classList.add("panel-splitter");
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", api.loc("panel-resize"));
    handle.setAttribute("aria-valuemin", "18");
    handle.setAttribute("aria-valuemax", "55");
    const apply = (next) => {
      value = Math.max(18, Math.min(55, next));
      pane.style.flexBasis = `${value}%`;
      handle.setAttribute("aria-valuenow", String(Math.round(value)));
      window.dispatchEvent(new window.Event("resize"));
    };
    const move = (event) => {
      if (!dragging) return;
      const rect = handle.parentElement.getBoundingClientRect();
      if (!rect.width) return;
      apply(
        ((name === "graph"
          ? rect.right - event.clientX
          : event.clientX - rect.left) /
          rect.width) *
          100,
      );
      event.preventDefault();
    };
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.documentElement.classList.remove("resizing-panels");
      apply(Math.round(value));
      api.setPanelWidth(name, value);
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.button) return;
      dragging = true;
      document.documentElement.classList.add("resizing-panels");
      event.preventDefault();
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      apply(
        event.key === "Home"
          ? name === "manager"
            ? 28
            : 26
          : value +
              (event.key === "ArrowRight" ? 2 : -2) *
                (name === "graph" ? -1 : 1),
      );
      api.setPanelWidth(name, value);
    });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    window.addEventListener(
      "unload",
      () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
      },
      { once: true },
    );
    apply(value);
  },
};
