/* global Zotero */
"use strict";

// A navigation can replace the document beneath the second click of a double-click.
document.addEventListener(
  "click",
  (event) => {
    if (
      event.detail > 1 &&
      /** @type {Element} */ (event.target).closest(
        "a[href], .relation-link, .source-reference, #knowledge-base-parent-display",
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

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
    container.classList.add("source-reference");
    const identity = JSON.stringify([item.libraryID, item.key]);
    if (container._sourceIdentity !== identity) {
      container._sourceIdentity = identity;
      container._sourceHTML = null;
      container.textContent = item.title;
    }
    container.setAttribute("role", "link");
    container.tabIndex = 0;
    container.title = api.loc("manager-source-open");
    container.onclick = (event) => {
      event.preventDefault();
      if (event.button !== 0 || event.detail > 1 || container._sourceOpening)
        return;
      const opening = Promise.resolve().then(() =>
        api.selectItem(item.key, item.libraryID),
      );
      container._sourceOpening = opening;
      opening
        .catch((error) => Zotero.logError(error))
        .finally(() => {
          if (container._sourceOpening === opening)
            container._sourceOpening = null;
        });
    };
    container.onkeydown = (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        container.click();
      }
    };
    const html = await api.getSourceReference(item.key, item.libraryID);
    if (container._sourceRender !== token || !container.isConnected || !html)
      return;
    if (container._sourceHTML === html) return;
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    container.replaceChildren(
      ...Array.from(parsed.body.childNodes).map((node) =>
        document.importNode(node, true),
      ),
    );
    container._sourceHTML = html;
  },
  /** @param {Element} container @param {string} id @param {string} title @param {string} [reference] */
  identity(container, id, title, reference = id) {
    const name = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    name.className = "relation-title";
    name.textContent = title || id;
    if (
      !title ||
      title === id ||
      title === reference ||
      title === `[[${id}]]` ||
      title === `[[${reference}]]`
    )
      name.textContent = reference || title || id;
    const text = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    );
    text.className = "note-reference-text";
    text.append(name);
    container.append(text);
    container.setAttribute(
      "title",
      reference && reference !== name.textContent
        ? `${name.textContent}\n${reference}`
        : name.textContent,
    );
    container.setAttribute("aria-label", name.textContent);
  },

  /** Compact, text-only previews shared by the link and Parent pickers. */
  candidate(container, card, parentLabel) {
    this.identity(container, card.id, card.title, card.reference);
    const append = (className, text) => {
      const line = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      line.className = className;
      line.textContent = text;
      container.append(line);
      return line;
    };
    append("link-option-reference", card.reference || card.id);
    if (card.parentTitle)
      append("candidate-path", `${parentLabel}: ${card.parentTitle}`);
    if (card.snippet) {
      const snippet = append("candidate-snippet", "");
      snippet.title = card.snippet;
      const terms = (card.matches || [])
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      const pattern = terms.length
        ? new RegExp(
            terms
              .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join("|"),
            "giu",
          )
        : null;
      let end = 0;
      for (const match of pattern ? card.snippet.matchAll(pattern) : []) {
        snippet.append(
          document.createTextNode(card.snippet.slice(end, match.index)),
        );
        const mark = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "mark",
        );
        mark.textContent = match[0];
        snippet.append(mark);
        end = match.index + match[0].length;
      }
      snippet.append(document.createTextNode(card.snippet.slice(end)));
    }
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
        window.ZoteroKnowledgeBase_selectZettel
          ? window.ZoteroKnowledgeBase_selectZettel(family.parent.id)
          : api.openManager({ selectId: family.parent.id }),
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
        window.ZoteroKnowledgeBase_selectZettel
          ? window.ZoteroKnowledgeBase_selectZettel(card.id)
          : api.openManager({ selectId: card.id }),
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
    if (element.classList.contains("source-reference")) {
      element.classList.remove("source-reference");
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

window.KnowledgeBasePanels = (() => {
  const bindings = new WeakMap();
  return {
    /** @param {HTMLElement} handle @param {HTMLElement} pane @param {"manager" | "graph"} name @param {import("../../src/modules/api").KnowledgeBaseAPI} api */
    attach(handle, pane, name, api) {
      bindings.get(handle)?.();
      const events = new window.AbortController();
      const options = { signal: events.signal };
      let resizeFrame = 0;
      let value = api.getPanelWidth(name);
      let dragging = false;
      let shield = null;
      const reset = () => {
        apply(name === "manager" ? 28 : 26);
        api.setPanelWidth(name, value);
      };
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
        if (!window.requestAnimationFrame)
          window.dispatchEvent(new window.Event("resize"));
        else if (!resizeFrame)
          resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = 0;
            window.dispatchEvent(new window.Event("resize"));
          });
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
        shield?.remove();
        shield = null;
        document.documentElement.classList.remove("resizing-panels");
        apply(Math.round(value));
        api.setPanelWidth(name, value);
      };
      handle.addEventListener(
        "pointerdown",
        (event) => {
          if (event.button || dragging) return;
          dragging = true;
          // Cover embedded editors so dragging across their documents keeps working.
          shield = document.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "div",
          );
          shield.className = "panel-drag-shield";
          handle.parentElement.appendChild(shield);
          document.documentElement.classList.add("resizing-panels");
          event.preventDefault();
        },
        options,
      );
      handle.addEventListener("dblclick", reset, options);
      handle.addEventListener(
        "keydown",
        (event) => {
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
        },
        options,
      );
      window.addEventListener("pointermove", move, options);
      window.addEventListener("pointerup", stop, options);
      window.addEventListener("pointercancel", stop, options);
      window.addEventListener("blur", stop, options);
      const dispose = () => {
        events.abort();
        if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
        shield?.remove();
        document.documentElement.classList.remove("resizing-panels");
        bindings.delete(handle);
      };
      bindings.set(handle, dispose);
      window.addEventListener("unload", dispose, { ...options, once: true });
      apply(value);
    },
  };
})();
