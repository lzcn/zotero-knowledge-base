/* global Zotero */
"use strict";

// Chrome windows are XML documents. Markdown emits HTML (including <br>,
// <input> and <hr>), so inserting it through XML innerHTML would throw.
window.ZoteroKnowledgeBaseMarkdown = {
  /** @param {Element} container @param {string} id @param {string} title */
  identity(container, id, title) {
    const name = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    name.className = "relation-title";
    name.textContent = title || id;
    const index = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "small",
    );
    index.className = "relation-id";
    index.textContent = id;
    container.append(name, index);
    container.setAttribute("title", `${id} · ${title || id}`);
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
      this.identity(button, family.parent.id, family.parent.title);
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
    const children = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "details",
    );
    if (expanded ?? family.children.length <= 6)
      children.setAttribute("open", "");
    const summary = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "summary",
    );
    summary.textContent = `${api.loc("children")} · ${family.children.length}`;
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
      this.identity(button, card.id, card.title);
      button.addEventListener("click", () =>
        api.openManager({ selectId: card.id }),
      );
      list.appendChild(button);
    }
    children.append(summary, list);
    container.append(parent, children);
  },
  /** @param {Element} container @param {string} body */
  render(container, body) {
    const html = window.Zotero.ZoteroKnowledgeBase.api.renderMarkdown(body);
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    container.replaceChildren(
      ...Array.from(parsed.body.childNodes, (node) =>
        container.ownerDocument.importNode(node, true),
      ),
    );
  },
};
