/* global Zotero */
// Shared by the independent packages. No observers or timers outlive a window.
var pluginUI = {
  apply(doc, bear) {
    if (!doc?.documentElement) return;
    const themed =
      bear && doc.documentElement.getAttribute("windowtype") !== "zotero:pref";
    const changed =
      doc.documentElement.hasAttribute("data-plugin-bear") !== themed;
    doc.documentElement.toggleAttribute("data-plugin-bear", themed);
    for (const menu of doc.querySelectorAll(
      "#knowledge-base-ui-style, #similar-works-ui-style, #ml-ui-style",
    ))
      menu.value = bear ? "bear" : "minimal";
    const visit = (root) => {
      for (const frame of root.querySelectorAll("iframe, browser")) {
        if (frame.contentDocument) this.apply(frame.contentDocument, bear);
      }
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(doc);
    const view = doc.defaultView;
    if (changed && view && !view.closed)
      view.dispatchEvent(new view.Event("plugin-ui-style-change"));
  },
  select(value) {
    const bear = value === "bear";
    Zotero.Prefs.set("extensions.zotero.plugin-ui.bear", bear, true);
    for (const view of Services.wm.getEnumerator(null))
      this.apply(view.document, bear);
  },
};
window.ZoteroPluginUI = pluginUI;
pluginUI.apply(
  document,
  typeof Zotero !== "undefined" && Zotero.Prefs
    ? Zotero.Prefs.get("extensions.zotero.plugin-ui.bear", true) === true
    : window.parent.document.documentElement.hasAttribute("data-plugin-bear"),
);
