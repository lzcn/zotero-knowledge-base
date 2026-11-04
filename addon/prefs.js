/* global pref */
pref("extensions.zotero.knowledge-base.workbenchMode", "tab");
pref("extensions.zotero.knowledge-base.editorMode", "visual");
pref(
  "extensions.zotero.knowledge-base.literatureTemplates",
  '{"selected":null,"templates":[]}',
);
pref("extensions.zotero.knowledge-base.graph.groups", "[]");
pref("extensions.zotero.knowledge-base.graph.outline", true);
pref("extensions.zotero.knowledge-base.graph.references", true);
pref("extensions.zotero.knowledge-base.graph.hideIsolated", false);
pref("extensions.zotero.knowledge-base.graph.labelLength", 20);
pref("extensions.zotero.knowledge-base.graph.localDepth", 1);

pref(
  "extensions.zotero.knowledge-base.sourceStyle",
  "http://www.zotero.org/styles/apa",
);

pref("extensions.zotero.knowledge-base.noteSort", "updated-desc");

// User settings and internal indexing defaults.
pref("extensions.zotero.similar-works.maxRecommendations", 20);
pref("extensions.zotero.similar-works.minimumSimilarity", "0.05");
pref("extensions.zotero.similar-works.minTokenLength", 2);
pref("extensions.zotero.similar-works.maxTextChars", 1200000);
pref("extensions.zotero.similar-works.backgroundIndexing", true);
pref("extensions.zotero.similar-works.indexDelayMs", 2000);
pref("extensions.zotero.similar-works.minFulltextTerms", 25);
pref("extensions.zotero.similar-works.requestMissingFulltext", false);
pref("extensions.zotero.similar-works.excludedTags", "");
pref("extensions.zotero.similar-works.tagNameStyle", "sentence");
pref("extensions.zotero.similar-works.tagHashtag", false);
