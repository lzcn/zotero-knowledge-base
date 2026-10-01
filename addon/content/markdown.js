/* global Zotero */
"use strict";

// Chrome windows are XML documents. Markdown emits HTML (including <br>,
// <input> and <hr>), so inserting it through XML innerHTML would throw.
window.ZoteroKnowledgeBaseMarkdown = {
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
