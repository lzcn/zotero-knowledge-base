// Note data is separate from downloaded assets and rebuildable retrieval caches.
var SWStorage = {
  root() {
    return PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base");
  },
  notes() {
    return PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base.sqlite");
  },
  assets() {
    return PathUtils.join(this.root(), "assets");
  },
  cache() {
    return PathUtils.join(this.root(), "cache", "related-papers");
  },
  model() {
    return PathUtils.join(this.root(), "models", "minilm-l6-v2");
  },
  runtime() {
    return PathUtils.join(this.root(), "runtime", "onnx");
  },
};

if (typeof module !== "undefined") module.exports = { SWStorage };
