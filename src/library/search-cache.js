// A derived cache of the finished search structures, never note or source data.
var SWSearchCache = (() => {
  const MAGIC = 0x3143424b;
  const validNumber = (n) => Number.isFinite(n) && n >= 0;
  async function encode(corpus, pause, active) {
    const index = corpus.search;
    const documents = [...index.docs.values()];
    const header = {
      format: 1,
      algorithm: 4,
      revision: corpus.revision,
      epoch: index.epoch,
      changes: index.changes,
      epochN: index.epochN,
      averageLength: index.averageLength,
      averageFieldLengths: index.averageFieldLengths,
      docs: documents.map((doc) => [
        doc.key,
        corpus.docs.get(doc.key).hash,
        doc.weak,
        doc.length,
        doc.fieldLengths,
        [...doc.titleIds],
        [...doc.simhash],
      ]),
    };
    const parts = [new TextEncoder().encode(JSON.stringify(header))];
    let started = Date.now();
    const yieldIfNeeded = async () => {
      if (Date.now() - started >= 6) {
        await pause();
        started = Date.now();
      }
      return active();
    };
    for (const map of [index.df, index.frozenDF]) {
      const bytes = new Uint8Array(map.size * 8),
        view = new DataView(bytes.buffer);
      let i = 0;
      for (const [id, count] of map) {
        view.setUint32(i * 8, id, true);
        view.setUint32(i * 8 + 4, count, true);
        if (++i % 4096 === 0 && !(await yieldIfNeeded())) return null;
      }
      parts.push(bytes);
    }
    for (const doc of documents) {
      for (const vector of [doc.vector, ...doc.fieldVectors]) {
        const bytes = new Uint8Array(vector.length * 12),
          view = new DataView(bytes.buffer);
        let i = 0;
        for (const [id, weight] of vector) {
          view.setUint32(i * 12, id, true);
          view.setFloat64(i * 12 + 4, weight, true);
          i++;
        }
        parts.push(bytes);
      }
      if (!(await yieldIfNeeded())) return null;
    }
    if (!active()) return null;
    const bytes = new Uint8Array(
      4 + parts.reduce((n, part) => n + 4 + part.length, 0),
    );
    const view = new DataView(bytes.buffer);
    view.setUint32(0, MAGIC, true);
    let offset = 4;
    for (const part of parts) {
      view.setUint32(offset, part.length, true);
      bytes.set(part, offset + 4);
      offset += part.length + 4;
    }
    return bytes;
  }

  async function decode(bytes, revision, pause, active) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8 || view.getUint32(0, true) !== MAGIC)
      throw new Error("Invalid search cache header");
    let offset = 4;
    const part = () => {
      if (offset + 4 > bytes.length) throw new Error("Truncated search cache");
      const length = view.getUint32(offset, true);
      offset += 4;
      if (offset + length > bytes.length)
        throw new Error("Truncated search cache section");
      const value = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        length,
      );
      offset += length;
      return value;
    };
    const first = part();
    if (first.byteLength > 16 * 1024 * 1024)
      throw new Error("Oversized search cache metadata");
    const header = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(first.buffer, first.byteOffset, first.byteLength),
      ),
    );
    if (
      header.format !== 1 ||
      header.algorithm !== 4 ||
      header.revision !== revision ||
      !Number.isInteger(header.epoch) ||
      header.epoch < 1 ||
      !Number.isInteger(header.changes) ||
      header.changes < 0 ||
      !validNumber(header.epochN) ||
      !validNumber(header.averageLength) ||
      !Array.isArray(header.averageFieldLengths) ||
      header.averageFieldLengths.length !== 3 ||
      !header.averageFieldLengths.every((n) => Number.isFinite(n) && n > 0) ||
      !Array.isArray(header.docs)
    )
      throw new Error("Invalid search cache metadata");
    const index = new SWSearch.Index(),
      docs = new Map();
    Object.assign(index, {
      epoch: header.epoch,
      changes: header.changes,
      epochN: header.epochN,
      averageLength: header.averageLength,
      averageFieldLengths: header.averageFieldLengths,
    });
    let started = Date.now();
    const yieldIfNeeded = async () => {
      if (Date.now() - started >= 6) {
        await pause();
        started = Date.now();
      }
      return active();
    };
    for (const map of [index.df, index.frozenDF]) {
      const data = part();
      if (data.byteLength % 8)
        throw new Error("Invalid cached document frequencies");
      for (let at = 0; at < data.byteLength; at += 8) {
        const id = data.getUint32(at, true),
          count = data.getUint32(at + 4, true);
        if (!count || map.has(id))
          throw new Error("Invalid cached document frequency");
        map.set(id, count);
        if (at % 32768 === 0 && !(await yieldIfNeeded())) return null;
      }
    }
    const vector = () => {
      const data = part(),
        pairs = [];
      if (
        data.byteLength % 12 ||
        data.byteLength > SWSearch.SIGNATURE_SIZE * 12
      )
        throw new Error("Invalid cached vector");
      let previous = -1;
      for (let at = 0; at < data.byteLength; at += 12) {
        const id = data.getUint32(at, true),
          weight = data.getFloat64(at + 4, true);
        if (
          id <= previous ||
          !Number.isFinite(weight) ||
          weight <= 0 ||
          weight > 1
        )
          throw new Error("Invalid cached vector feature");
        pairs.push([id, weight]);
        previous = id;
      }
      return new SWSearch.Vector(pairs);
    };
    const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
    for (const entry of header.docs) {
      if (!Array.isArray(entry) || entry.length !== 7)
        throw new Error("Invalid cached document");
      const [key, hash, weak, length, fieldLengths, titleIds, simhash] = entry;
      if (
        typeof key !== "string" ||
        !/^\d+\/.+/.test(key) ||
        typeof hash !== "string" ||
        typeof weak !== "boolean" ||
        !validNumber(length) ||
        !Array.isArray(fieldLengths) ||
        fieldLengths.length !== 3 ||
        !fieldLengths.every(validNumber) ||
        !Array.isArray(titleIds) ||
        !titleIds.every(uint) ||
        !Array.isArray(simhash) ||
        simhash.length !== 2 ||
        !simhash.every(uint) ||
        docs.has(key)
      )
        throw new Error("Invalid cached document metadata");
      const doc = {
        key,
        id: index.nextID++,
        weak,
        length,
        fieldLengths,
        titleIds: new Set(titleIds),
        simhash: new Uint32Array(simhash),
        counts: null,
        vector: vector(),
        fieldVectors: [vector(), vector()],
      };
      docs.set(key, { hash, weak });
      index.docs.set(key, doc);
      index.byID.set(doc.id, doc);
      index._post(doc, true);
      if (!(await yieldIfNeeded())) return null;
    }
    if (offset !== bytes.length)
      throw new Error("Unexpected search cache data");
    return active() ? { search: index, docs } : null;
  }
  return { encode, decode };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = { SWSearchCache };
