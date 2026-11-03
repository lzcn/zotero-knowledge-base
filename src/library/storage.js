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
    return PathUtils.join(this.root(), "cache", "similar-items");
  },
  async prepareCache(active = () => true) {
    const destination = this.cache();
    const previous = PathUtils.join(this.root(), "cache", "related-papers");
    const reusable = await IOUtils.exists(previous);
    const present = await IOUtils.exists(destination);
    if (!active()) throw new Error("Index preparation cancelled");
    await IOUtils.makeDirectory(PathUtils.parent(destination), {
      createAncestors: true,
      ignoreExisting: true,
    });
    if (!active()) throw new Error("Index preparation cancelled");
    // Called before opening SQLite; move the database and its sidecars together.
    if (reusable && !present)
      await IOUtils.move(previous, destination, { noOverwrite: true });
    else await IOUtils.makeDirectory(destination, { ignoreExisting: true });
    return destination;
  },
  searchCache() {
    return PathUtils.join(this.cache(), "search-cache.bin");
  },
  model() {
    return PathUtils.join(this.root(), "models", "minilm-l6-v2");
  },
  compiledModel() {
    return PathUtils.join(this.root(), "cache", "coreml", "minilm-l6-v2");
  },
  async prepareCompiledModel(active = () => true) {
    const destination = this.compiledModel();
    const previous = PathUtils.join(this.model(), "coreml-cache");
    if (!active()) throw new Error("Model cache preparation cancelled");
    const reusable = await IOUtils.exists(previous);
    const present = await IOUtils.exists(destination);
    if (!active()) throw new Error("Model cache preparation cancelled");
    await IOUtils.makeDirectory(PathUtils.parent(destination), {
      createAncestors: true,
      ignoreExisting: true,
    });
    if (!active()) throw new Error("Model cache preparation cancelled");
    // Move the existing compiled cache only before native inference starts.
    // Never replace a destination produced by an earlier successful run.
    if (reusable && !present)
      await IOUtils.move(previous, destination, { noOverwrite: true });
    else await IOUtils.makeDirectory(destination, { ignoreExisting: true });
    return destination;
  },
  runtime() {
    return PathUtils.join(this.root(), "runtime", "onnx");
  },
};

if (typeof module !== "undefined") module.exports = { SWStorage };
