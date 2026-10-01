/* global Zotero */
"use strict";

// Chrome windows are XML documents. Markdown emits HTML (including <br>,
// <input> and <hr>), so inserting it through XML innerHTML would throw.
window.ZettelKnowledgeBaseMarkdown = {
  render(container, body) {
    const html = window.Zotero.ZettelKnowledgeBase.api.renderMarkdown(body);
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    container.replaceChildren(
      ...Array.from(parsed.body.childNodes, (node) =>
        container.ownerDocument.importNode(node, true),
      ),
    );
  },
};
