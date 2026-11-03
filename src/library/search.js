// Compact document fingerprints and bounded search. No Zotero database access.
var SWSearch = (() => {
  const SIGNATURE_SIZE = 256,
    QUERY_TERMS = 48,
    CANDIDATES = 300,
    BLOCK_SIZE = 128;
  const FIELD_WEIGHTS = [4, 2, 1];
  const FIELD_NORMALIZATION = [0.3, 0.6, 0.75];
  const FIELD_MAGIC = 0x33574653;
  function mergeFields(fields) {
    const counts = new Map();
    fields.forEach((field, i) => {
      for (const [id, count] of field)
        counts.set(id, (counts.get(id) || 0) + FIELD_WEIGHTS[i] * count);
    });
    return Object.assign(counts, { fields });
  }
  function fieldsOf(counts) {
    return counts.fields || [new Map(), new Map(), counts];
  }
  function fieldLengths(counts) {
    return fieldsOf(counts).map((field) => {
      let sum = 0;
      for (const n of field.values()) sum += n;
      return sum;
    });
  }
  function hash(text, seed = 2166136261) {
    let h = seed;
    for (let i = 0; i < text.length; i++)
      h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const FNV_PRIME = 16777619,
    FNV_OFFSET = 2166136261;
  function avalanche(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // Specialized FNV-1a kernels that fold the feature prefix into the state
  // instead of allocating "w:token", "b:a b" or "c:bigram" strings first.
  function hashWord(token) {
    let h = Math.imul(FNV_OFFSET ^ 119, FNV_PRIME);
    h = Math.imul(h ^ 58, FNV_PRIME);
    for (let i = 0; i < token.length; i++)
      h = Math.imul(h ^ token.charCodeAt(i), FNV_PRIME);
    return avalanche(h);
  }
  function hashBigram(previous, token) {
    let h = Math.imul(FNV_OFFSET ^ 98, FNV_PRIME);
    h = Math.imul(h ^ 58, FNV_PRIME);
    for (let i = 0; i < previous.length; i++)
      h = Math.imul(h ^ previous.charCodeAt(i), FNV_PRIME);
    h = Math.imul(h ^ 32, FNV_PRIME);
    for (let i = 0; i < token.length; i++)
      h = Math.imul(h ^ token.charCodeAt(i), FNV_PRIME);
    return avalanche(h);
  }
  function hashCJK(word, start, size) {
    let h = Math.imul(FNV_OFFSET ^ 99, FNV_PRIME);
    h = Math.imul(h ^ 58, FNV_PRIME);
    const end = start + size;
    for (let i = start; i < end; i++)
      h = Math.imul(h ^ word.charCodeAt(i), FNV_PRIME);
    return avalanche(h);
  }
  function clean(text) {
    text = String(text || "")
      .normalize("NFKC")
      .toLowerCase();
    const heading =
      /(?:^|\n)\s*(?:references|bibliography|参考文献)\s*(?:\n|$)/g;
    for (const m of text.matchAll(heading))
      if (m.index > text.length * 0.6) {
        text = text.slice(0, m.index);
        break;
      }
    const lines = text.split("\n"),
      repeated = new Map();
    for (const line of lines) {
      const s = line.trim();
      if (s.length > 5 && s.length < 100)
        repeated.set(s, (repeated.get(s) || 0) + 1);
    }
    return lines
      .filter((line) => (repeated.get(line.trim()) || 0) < 4)
      .join("\n")
      .replace(/https?:\/\/\S+|\b10\.\d{4,9}\/[^\s]+/g, " ")
      .replace(/([a-z])-\s*\n\s*([a-z])/g, "$1$2");
  }
  function* features(text) {
    let previous = "";
    for (const match of text.matchAll(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu,
    )) {
      const word = match[0];
      if (
        /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(
          word,
        )
      ) {
        previous = "";
        if (/[\uD800-\uDBFF]/.test(word)) {
          const chars = Array.from(word);
          for (const n of [2, 3])
            for (let i = 0; i + n <= chars.length; i++)
              yield hash(`c:${chars.slice(i, i + n).join("")}`);
        } else {
          for (let n = 2; n <= 3; n++)
            for (let i = 0; i + n <= word.length; i++)
              yield hashCJK(word, i, n);
        }
      } else {
        if (
          word.length < 2 ||
          /^\d+$/.test(word) ||
          SWTokenizer.isStopword(word)
        ) {
          previous = "";
          continue;
        }
        const token = /^[a-z]+$/.test(word) ? swPorterStem(word) : word;
        yield hashWord(token);
        if (previous) yield hashBigram(previous, token);
        previous = token;
      }
    }
  }
  async function extract(
    fields,
    pause = async () => {},
    cancelled = () => false,
  ) {
    const fieldsCounts = [new Map(), new Map(), new Map()];
    let operations = 0;
    for (const [i, text] of [
      fields.title,
      fields.abstract,
      fields.body,
    ].entries()) {
      for (const feature of features(clean(text))) {
        const counts = fieldsCounts[i];
        counts.set(feature, (counts.get(feature) || 0) + 1);
        if (++operations % 2000 === 0) {
          await pause();
          if (cancelled()) return null;
        }
        if (operations >= 100000) return mergeFields(fieldsCounts);
      }
    }
    return mergeFields(fieldsCounts);
  }
  function encodeCounts(counts) {
    if (counts.fields) {
      const parts = counts.fields.map((field) => encodeCounts(field));
      const bytes = new Uint8Array(
        24 + parts.reduce((n, p) => n + p.length, 0),
      );
      const view = new DataView(bytes.buffer);
      view.setUint32(0, FIELD_MAGIC, true);
      view.setFloat32(4, NaN, true);
      view.setUint32(8, 3, true);
      let offset = 24;
      parts.forEach((part, i) => {
        view.setUint32(12 + i * 4, part.length / 8, true);
        bytes.set(part, offset);
        offset += part.length;
      });
      return bytes;
    }
    const bytes = new Uint8Array(counts.size * 8),
      view = new DataView(bytes.buffer);
    let i = 0;
    for (const [feature, count] of counts) {
      view.setUint32(i, feature, true);
      view.setFloat32(i + 4, count, true);
      i += 8;
    }
    return bytes;
  }
  function decodeCounts(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      counts = new Map();
    if (
      bytes.length >= 8 &&
      view.getUint32(0, true) === FIELD_MAGIC &&
      Number.isNaN(view.getFloat32(4, true))
    ) {
      if (bytes.length < 24 || view.getUint32(8, true) !== 3)
        throw new Error("Invalid field counts header");
      const fields = [];
      let offset = 24;
      for (let i = 0; i < 3; i++) {
        const length = view.getUint32(12 + i * 4, true) * 8;
        if (offset + length > bytes.length)
          throw new Error("Truncated field counts");
        fields.push(decodeCounts(bytes.subarray(offset, offset + length)));
        offset += length;
      }
      if (offset !== bytes.length)
        throw new Error("Invalid field counts length");
      return mergeFields(fields);
    }
    if (bytes.length % 8) throw new Error("Invalid feature counts");
    for (let i = 0; i < bytes.length; i += 8) {
      const count = view.getFloat32(i + 4, true);
      if (!(count > 0) || !Number.isFinite(count))
        throw new Error("Invalid feature count");
      counts.set(view.getUint32(i, true), count);
    }
    return counts;
  }
  class Heap {
    constructor(limit) {
      this.limit = limit;
      this.items = [];
    }
    get threshold() {
      return this.items.length < this.limit ? 0 : this.items[0][1];
    }
    // Equal-score ties favor smaller identifiers, consistently with WAND.
    less(a, b) {
      return a[1] < b[1] || (a[1] === b[1] && a[0] > b[0]);
    }
    add(pair) {
      if (!this.limit) return;
      if (this.items.length < this.limit) {
        this.items.push(pair);
        let i = this.items.length - 1;
        while (i) {
          const p = (i - 1) >>> 1;
          if (!this.less(this.items[i], this.items[p])) break;
          [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
          i = p;
        }
      } else if (this.less(this.items[0], pair)) {
        this.items[0] = pair;
        let i = 0;
        while (true) {
          let j = i * 2 + 1;
          if (j >= this.items.length) break;
          if (
            j + 1 < this.items.length &&
            this.less(this.items[j + 1], this.items[j])
          )
            j++;
          if (!this.less(this.items[j], this.items[i])) break;
          [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
          i = j;
        }
      }
    }
    sorted() {
      return [...this.items].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    }
  }
  function simhash(counts) {
    const sums = new Float64Array(64);
    for (const [id, count] of counts) {
      const text = String(id),
        bits0 = hash(text, 0x811c9dc5),
        bits1 = hash(text, 0x9e3779b9),
        weight = 1 + Math.log(count);
      for (let i = 0; i < 32; i++) {
        sums[i] += (bits0 >>> i) & 1 ? weight : -weight;
        sums[32 + i] += (bits1 >>> i) & 1 ? weight : -weight;
      }
    }
    const result = new Uint32Array(2);
    for (let i = 0; i < 64; i++)
      if (sums[i] > 0)
        result[i >>> 5] = (result[i >>> 5] | (1 << (i & 31))) >>> 0;
    return result;
  }
  function encodeSimhash(sim) {
    const bytes = new Uint8Array(8),
      view = new DataView(bytes.buffer);
    view.setUint32(0, sim[0], true);
    view.setUint32(4, sim[1], true);
    return bytes;
  }
  function decodeSimhash(data) {
    const bytes = new Uint8Array(data);
    if (bytes.length !== 8) throw new Error("Invalid SimHash");
    const view = new DataView(bytes.buffer);
    return new Uint32Array([view.getUint32(0, true), view.getUint32(4, true)]);
  }
  function distance(a, b) {
    let result = 0;
    for (let i = 0; i < 2; i++) {
      let bits = (a[i] ^ b[i]) >>> 0;
      while (bits) {
        bits = (bits & (bits - 1)) >>> 0;
        result++;
      }
    }
    return result;
  }
  function encodeSignature(vector) {
    const data = new Uint8Array(vector.length * 6),
      view = new DataView(data.buffer);
    vector.forEach(([id, weight], i) => {
      view.setUint32(i * 6, id, true);
      view.setUint16(i * 6 + 4, Math.max(1, Math.round(weight * 65535)), true);
    });
    return data;
  }
  class Vector {
    constructor(pairs) {
      this.ids = new Uint32Array(pairs.map((p) => p[0]));
      this.weights = new Float64Array(pairs.map((p) => p[1]));
      this.length = pairs.length;
    }
    *[Symbol.iterator]() {
      for (let i = 0; i < this.length; i++)
        yield [this.ids[i], this.weights[i]];
    }
    forEach(fn) {
      let i = 0;
      for (const pair of this) fn(pair, i++);
    }
    reduce(fn, initial) {
      let value = initial;
      for (const pair of this) value = fn(value, pair);
      return value;
    }
  }
  function decodeSignature(data) {
    const bytes = new Uint8Array(data),
      view = new DataView(bytes.buffer),
      vector = [];
    let sum = 0,
      previous = -1;
    if (bytes.length % 6 || bytes.length > SIGNATURE_SIZE * 6)
      throw new Error("Invalid signature");
    for (let i = 0; i < bytes.length; i += 6) {
      const id = view.getUint32(i, true),
        weight = view.getUint16(i + 4, true) / 65535;
      if (id <= previous || !weight)
        throw new Error("Invalid signature feature");
      previous = id;
      vector.push([id, weight]);
      sum += weight * weight;
    }
    const norm = Math.sqrt(sum);
    return new Vector(vector.map(([id, w]) => [id, w / norm]));
  }
  function cosine(a, b) {
    let i = 0,
      j = 0,
      sum = 0;
    while (i < a.length && j < b.length) {
      if (a.ids[i] === b.ids[j]) {
        sum += a.weights[i++] * b.weights[j++];
      } else if (a.ids[i] < b.ids[j]) i++;
      else j++;
    }
    return Math.min(1, Math.max(0, sum));
  }
  // SimHash is a heuristic. Apply only to substantial full-text vectors and
  // require a very high cosine too, avoiding false merges of short metadata.
  function isDuplicate(a, b) {
    return (
      !a.weak &&
      !b.weak &&
      a.length >= 100 &&
      b.length >= 100 &&
      distance(a.simhash, b.simhash) <= 3 &&
      cosine(a.vector, b.vector) >= 0.95
    );
  }
  function seek(entries, target, from = 0) {
    let hi = entries.length,
      lo = from;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries.ids[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function fuse(rankings, k = 50) {
    const scores = new Map();
    // Fixed equal-weight RRF, validated on local paper-to-paper retrieval.
    const normalizer = rankings.length / 61;
    for (const [channel, ranking] of rankings.entries()) {
      const seen = new Set();
      ranking.slice(0, 100).forEach((match, rank) => {
        if (seen.has(match.key)) return;
        seen.add(match.key);
        const result = scores.get(match.key) || {
          ...match,
          score: 0,
          lexicalScore: 0,
          semanticScore: 0,
        };
        result[channel === 0 ? "lexicalScore" : "semanticScore"] = match.score;
        result.score += 1 / (61 + rank) / normalizer;
        scores.set(match.key, result);
      });
    }
    return [...scores.values()]
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, k);
  }

  // Rank fusion orders results; raw channel scores decide whether they belong.
  // Relative floors remove a weak tail without imposing an output count.
  function relevant(matches, channel = "text", minimum = 0.05) {
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1) minimum = 0.05;
    if (channel === "hybrid")
      return matches.filter(
        (m) =>
          (m.lexicalScore || 0) >= minimum || (m.semanticScore || 0) >= 0.4,
      );
    const valid = matches.filter(
      (m) => Number.isFinite(m.score) && m.score > 0,
    );
    const best = Math.max(0, ...valid.map((m) => m.score));
    const floor =
      channel === "semantic"
        ? Math.max(0.4, best * 0.7)
        : Math.max(minimum, best * 0.2);
    return valid.filter((m) => m.score >= floor);
  }
  class Posting {
    constructor() {
      this.ids = new Uint32Array(4);
      this.weights = new Float64Array(4);
      this.length = 0;
      this.blocks = new Map();
      this.max = 0;
    }
    insert(id, weight) {
      const length = this.length;
      if (!length || this.ids[length - 1] < id) {
        // Documents are indexed with monotonically increasing ids, so the
        // common path appends and skips the binary search and shift.
        if (length === this.ids.length) {
          const capacity = length * 2 || 4,
            ids = new Uint32Array(capacity),
            weights = new Float64Array(capacity);
          ids.set(this.ids);
          weights.set(this.weights);
          this.ids = ids;
          this.weights = weights;
        }
        this.ids[length] = id;
        this.weights[length] = weight;
        this.length = length + 1;
      } else {
        const at = seek(this, id);
        if (length === this.ids.length) {
          const ids = new Uint32Array(length * 2),
            weights = new Float64Array(length * 2);
          ids.set(this.ids);
          weights.set(this.weights);
          this.ids = ids;
          this.weights = weights;
        }
        this.ids.copyWithin(at + 1, at, length);
        this.weights.copyWithin(at + 1, at, length);
        this.ids[at] = id;
        this.weights[at] = weight;
        this.length = length + 1;
      }
      const block = Math.floor(id / BLOCK_SIZE);
      this.blocks.set(block, Math.max(this.blocks.get(block) || 0, weight));
      this.max = Math.max(this.max, weight);
    }
    remove(id) {
      const at = seek(this, id);
      if (this.ids[at] !== id || at >= this.length) return;
      this.ids.copyWithin(at, at + 1, this.length);
      this.weights.copyWithin(at, at + 1, this.length);
      this.length--;
      // Bounds may overestimate after deletion, which is safe. Epoch rebuilds compact them.
    }
  }
  class Index {
    constructor() {
      this.docs = new Map();
      this.byID = new Map();
      this.postings = new Map();
      this.df = new Map();
      this.frozenDF = new Map();
      this.epochN = 0;
      this.averageLength = 1;
      this.averageFieldLengths = [1, 1, 1];
      this.epoch = 0;
      this.changes = 0;
      this.nextID = 1;
    }
    counts(tf) {
      if (tf.fields)
        return mergeFields(tf.fields.map((field) => this.counts(field)));
      const result = new Map();
      for (const [term, count] of tf) {
        const id =
          typeof term === "number"
            ? term
            : hash(
                `${/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(term) ? "c" : "w"}:${term}`,
              );
        if (Number.isFinite(count) && count > 0)
          result.set(id, (result.get(id) || 0) + count);
      }
      return result;
    }
    fingerprint(counts) {
      const effective = new Map(),
        top = new Heap(SIGNATURE_SIZE),
        titleTop = new Heap(64);
      const titleIds = new Set(fieldsOf(counts)[0].keys());
      const lengths = fieldLengths(counts);
      fieldsOf(counts).forEach((field, i) => {
        const b = FIELD_NORMALIZATION[i];
        const denominator =
          1 - b + (b * lengths[i]) / this.averageFieldLengths[i];
        for (const [id, count] of field)
          effective.set(
            id,
            (effective.get(id) || 0) + (FIELD_WEIGHTS[i] * count) / denominator,
          );
      });
      for (const [id, count] of effective) {
        const df = Math.min(this.epochN, this.frozenDF.get(id) || 0);
        const idf = Math.log(1 + (this.epochN - df + 0.5) / (df + 0.5));
        const pair = [id, (idf * count * 2.2) / (count + 1.2)];
        top.add(pair);
        if (titleIds.has(id)) titleTop.add(pair);
      }
      const selected = new Map(titleTop.sorted());
      for (const [id, weight] of top.sorted()) {
        if (selected.size >= SIGNATURE_SIZE) break;
        selected.set(id, weight);
      }
      const weighted = [...selected],
        norm = Math.sqrt(weighted.reduce((s, p) => s + p[1] * p[1], 0));
      return decodeSignature(
        encodeSignature(
          weighted.map(([id, w]) => [id, w / norm]).sort((a, b) => a[0] - b[0]),
        ),
      );
    }
    fieldVector(field, limit) {
      const top = new Heap(limit);
      for (const [id, count] of field) {
        const df = Math.min(this.epochN, this.frozenDF.get(id) || 0);
        const idf = Math.log(1 + (this.epochN - df + 0.5) / (df + 0.5));
        top.add([id, idf * (1 + Math.log(count))]);
      }
      const pairs = top.sorted();
      const norm = Math.sqrt(pairs.reduce((sum, p) => sum + p[1] * p[1], 0));
      return decodeSignature(
        encodeSignature(
          pairs
            .map(([id, weight]) => [id, weight / norm])
            .sort((a, b) => a[0] - b[0]),
        ),
      );
    }
    fieldVectors(counts) {
      const fields = fieldsOf(counts);
      return [
        this.fieldVector(fields[0], 64),
        this.fieldVector(fields[1], 128),
      ];
    }
    similarity(a, b) {
      // Normalize each field separately so rare PDF noise cannot drown out the title.
      let score = 0,
        weight = 0;
      const channels = [
        [a.fieldVectors[0], b.fieldVectors[0], 0.3],
        [a.fieldVectors[1], b.fieldVectors[1], 0.3],
        [a.vector, b.vector, 0.4],
      ];
      for (const [left, right, share] of channels) {
        if (!left.length || !right.length) continue;
        score += share * cosine(left, right);
        weight += share;
      }
      return weight ? score / weight : 0;
    }
    _post(doc, insert) {
      for (const [term, weight] of doc.vector) {
        let posting = this.postings.get(term);
        if (!posting) {
          if (!insert) continue;
          posting = new Posting();
          this.postings.set(term, posting);
        }
        if (insert) posting.insert(doc.id, weight);
        else posting.remove(doc.id);
        if (!posting.length) this.postings.delete(term);
      }
    }
    remove(key, storedCounts = null) {
      const old = this.docs.get(key);
      if (!old) return;
      this._post(old, false);
      for (const feature of decodeCounts(old.counts || storedCounts).keys()) {
        const n = this.df.get(feature) - 1;
        if (n) this.df.set(feature, n);
        else this.df.delete(feature);
      }
      this.docs.delete(key);
      this.byID.delete(old.id);
      this.changes++;
    }
    add(key, tf, weak, signature = null, sim = null, storedCounts = null) {
      const old = this.docs.get(key),
        id = old?.id || this.nextID++;
      if (old) this.remove(key);
      // Loaded counts are already validated, hashed and split into fields.
      const counts = storedCounts ? tf : this.counts(tf);
      for (const feature of counts.keys())
        this.df.set(feature, (this.df.get(feature) || 0) + 1);
      const doc = {
        key,
        id,
        weak,
        counts: storedCounts || encodeCounts(counts),
        length: [...counts.values()].reduce((a, b) => a + b, 0),
        fieldLengths: fieldLengths(counts),
        titleIds: new Set(fieldsOf(counts)[0].keys()),
        fieldVectors: this.fieldVectors(counts),
        vector: signature
          ? decodeSignature(signature)
          : this.fingerprint(counts),
        simhash: sim ? new Uint32Array(sim) : simhash(counts),
      };
      this.docs.set(key, doc);
      this.byID.set(id, doc);
      this._post(doc, true);
      this.changes++;
      return doc;
    }
    needsEpoch() {
      return (
        !this.epoch ||
        this.changes >=
          Math.min(500, Math.max(50, Math.ceil(this.epochN * 0.05)))
      );
    }
    async rebuild(
      pause = async () => {},
      cancelled = () => false,
      loadCounts = async (doc) => doc.counts,
    ) {
      // Run inside the corpus queue: no reader can mix old and new IDF weights.
      const startingChanges = this.changes;
      const df = new Map(this.df),
        n = this.docs.size;
      const average =
        [...this.docs.values()].reduce((s, d) => s + d.length, 0) /
          Math.max(1, n) || 1;
      const generator = new Index();
      generator.frozenDF = df;
      generator.epochN = n;
      generator.averageLength = average;
      generator.averageFieldLengths = [0, 1, 2].map(
        (i) =>
          [...this.docs.values()].reduce(
            (sum, doc) => sum + doc.fieldLengths[i],
            0,
          ) / Math.max(1, n) || 1,
      );
      const vectors = new Map();
      let i = 0;
      for (const doc of this.docs.values()) {
        if (cancelled() || this.changes !== startingChanges) return false;
        const counts = decodeCounts(await loadCounts(doc));
        vectors.set(doc.key, {
          vector: generator.fingerprint(counts),
          fieldVectors: generator.fieldVectors(counts),
        });
        if (++i % 5 === 0) {
          await pause();
          if (cancelled() || this.changes !== startingChanges) return false;
        }
      }
      if (cancelled() || this.changes !== startingChanges) return false;
      const staged = new Index();
      let built = 0;
      for (const doc of this.docs.values()) {
        const next = { ...doc, ...vectors.get(doc.key) };
        staged.docs.set(doc.key, next);
        staged.byID.set(doc.id, next);
        staged._post(next, true);
        if (++built % 5 === 0) {
          await pause();
          if (cancelled() || this.changes !== startingChanges) return false;
        }
      }
      // Publish complete vectors and postings together; foreground reads see one epoch.
      this.frozenDF = df;
      this.epochN = n;
      this.averageLength = average;
      this.averageFieldLengths = generator.averageFieldLengths;
      this.docs = staged.docs;
      this.byID = staged.byID;
      this.postings = staged.postings;
      this.epoch++;
      this.changes = 0;
      return true;
    }
    async retrieve(query, filter, pause, cancelled) {
      const top = new Heap(QUERY_TERMS),
        titleTop = new Heap(16);
      for (const pair of query.vector) {
        top.add(pair);
        if (query.titleIds.has(pair[0])) titleTop.add(pair);
      }
      const selected = new Map(titleTop.sorted());
      for (const [id, weight] of top.sorted()) {
        if (selected.size >= QUERY_TERMS) break;
        selected.set(id, weight);
      }
      let cursors = [...selected].flatMap(([term, weight]) => {
        const p = this.postings.get(term);
        return p ? [{ p, weight, at: 0 }] : [];
      });
      const heap = new Heap(CANDIDATES);
      let operations = 0,
        sliceStarted = Date.now();
      while (cursors.length) {
        if (cancelled()) return [];
        cursors.sort((a, b) => a.p.ids[a.at] - b.p.ids[b.at]);
        let bound = 0,
          pivot = -1;
        for (let i = 0; i < cursors.length; i++) {
          bound += cursors[i].p.max * cursors[i].weight;
          if (bound + 1e-12 >= heap.threshold) {
            pivot = i;
            break;
          }
        }
        if (pivot < 0) break;
        const id = cursors[pivot].p.ids[cursors[pivot].at];
        if (cursors[0].p.ids[cursors[0].at] === id) {
          const end = (Math.floor(id / BLOCK_SIZE) + 1) * BLOCK_SIZE - 1;
          let blockBound = 0;
          for (const c of cursors)
            if (c.p.ids[c.at] <= end)
              blockBound +=
                (c.p.blocks.get(Math.floor(id / BLOCK_SIZE)) || 0) * c.weight;
          if (blockBound + 1e-12 < heap.threshold) {
            for (const c of cursors) c.at = seek(c.p, end + 1, c.at);
          } else {
            let score = 0;
            for (const c of cursors)
              if (c.p.ids[c.at] === id) {
                score += c.p.weights[c.at] * c.weight;
                c.at++;
              }
            const doc = this.byID.get(id);
            if (doc && doc !== query && (!filter || filter(doc.key, doc)))
              heap.add([id, score, doc.key]);
          }
        } else
          for (let i = 0; i < pivot; i++)
            cursors[i].at = seek(cursors[i].p, id, cursors[i].at);
        cursors = cursors.filter((c) => c.at < c.p.length);
        if (++operations % 128 === 0 && Date.now() - sliceStarted >= 6) {
          await pause();
          sliceStarted = Date.now();
        }
      }
      return heap.sorted().map((pair) => pair[2]);
    }
    async search(key, k, filter, cancelled, pause, progress) {
      const query = this.docs.get(key);
      if (!query || cancelled()) return [];
      progress({ done: 0, total: 0 });
      const keys = await this.retrieve(query, filter, pause, cancelled),
        results = [];
      progress({ done: 0, total: keys.length });
      let done = 0;
      for (const candidate of keys) {
        if (cancelled()) return [];
        const doc = this.docs.get(candidate),
          score = this.similarity(query, doc);
        if (score > 0) results.push({ key: candidate, score, weak: doc.weak });
        progress({ done: ++done, total: keys.length });
        if (done % 50 === 0) await pause();
      }
      results.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
      const accepted = [];
      for (const match of results) {
        const doc = this.docs.get(match.key);
        if (
          isDuplicate(query, doc) ||
          accepted.some((m) => isDuplicate(this.docs.get(m.key), doc))
        )
          continue;
        accepted.push(match);
        if (accepted.length >= k) break;
      }
      return accepted;
    }
  }
  return {
    Index,
    Vector,
    Heap,
    hash,
    clean,
    features,
    extract,
    encodeCounts,
    decodeCounts,
    encodeSignature,
    decodeSignature,
    simhash,
    encodeSimhash,
    decodeSimhash,
    distance,
    cosine,
    isDuplicate,
    fuse,
    relevant,
    SIGNATURE_SIZE,
    CANDIDATES,
  };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = { SWSearch };
