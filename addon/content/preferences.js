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
