/* global Zotero */
// Visual preferences affect display documents, never saved note content.
var pluginUI = {
  style() {
    if (Zotero.Prefs.get("extensions.zotero.plugin-ui.bear", true) !== true)
      return "minimal";
    return Zotero.Prefs.get(
      "extensions.zotero.knowledge-base.notesStyle",
      true,
    ) === true
      ? "notes"
      : "bear";
  },
  apply(doc, bear) {
    if (!doc?.documentElement) return;
    const themed =
      bear && doc.documentElement.getAttribute("windowtype") !== "zotero:pref";
    const notesStyle =
      bear &&
      (typeof Zotero !== "undefined" && Zotero.Prefs
        ? Zotero.Prefs.get(
            "extensions.zotero.knowledge-base.notesStyle",
            true,
          ) === true
        : window.parent.document.documentElement.hasAttribute(
            "data-plugin-notes",
          ));
    const notes = themed && notesStyle;
    const changed =
      doc.documentElement.hasAttribute("data-plugin-bear") !== themed ||
      doc.documentElement.hasAttribute("data-plugin-notes") !== notes;
    doc.documentElement.toggleAttribute("data-plugin-bear", themed);
    doc.documentElement.toggleAttribute("data-plugin-notes", notes);
    for (const menu of doc.querySelectorAll("#knowledge-base-ui-style"))
      menu.value = notesStyle ? "notes" : bear ? "bear" : "minimal";
    const visit = (root) => {
      for (const frame of root.querySelectorAll("iframe, browser"))
        if (frame.contentDocument) this.apply(frame.contentDocument, bear);
      for (const element of root.querySelectorAll("*"))
        if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(doc);
    const view = doc.defaultView;
    if (changed && view && !view.closed)
      view.dispatchEvent(new view.Event("plugin-ui-style-change"));
  },
  refresh() {
    const bear =
      Zotero.Prefs.get("extensions.zotero.plugin-ui.bear", true) === true;
    for (const view of Services.wm.getEnumerator(null))
      this.apply(view.document, bear);
  },
  select(value) {
    Zotero.Prefs.set(
      "extensions.zotero.plugin-ui.bear",
      value !== "minimal",
      true,
    );
    Zotero.Prefs.set(
      "extensions.zotero.knowledge-base.notesStyle",
      value === "notes",
      true,
    );
    this.refresh();
  },
};
window.ZoteroPluginUI = pluginUI;
pluginUI.apply(
  document,
  typeof Zotero !== "undefined" && Zotero.Prefs
    ? Zotero.Prefs.get("extensions.zotero.plugin-ui.bear", true) === true
    : window.parent.document.documentElement.hasAttribute("data-plugin-bear"),
);
