const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE libraries (libraryID INTEGER, type TEXT);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, libraryID INTEGER, key TEXT, itemTypeID INTEGER, dateModified TEXT, clientDateModified TEXT, version INTEGER);
    CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, contentType TEXT, linkMode INTEGER, path TEXT);
    CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
    CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, creatorTypeID INTEGER, orderIndex INTEGER);
    CREATE TABLE creators (creatorID INTEGER, firstName TEXT, lastName TEXT, fieldMode INTEGER);
    CREATE TABLE deletedItems (itemID INTEGER);
    CREATE TABLE itemNotes (itemID INTEGER);
    CREATE TABLE itemAnnotations (itemID INTEGER);
    INSERT INTO libraries VALUES (1, 'user'), (2, 'feed');`);
  const files = new Map();
  const context = vm.createContext({
    swYield: async () => {},
    Zotero: {
      DB: { queryAsync: async (sql, args) => db.prepare(sql).all(...args) },
      Fulltext: {
        isCachedMIMEType: (type) => type === "application/pdf",
        fulltextCacheFile: ".zotero-ft-cache",
      },
      Attachments: {
        getStorageDirectoryByLibraryAndKey: (_library, key) => ({
          path: key,
          append(name) {
            this.path += "/" + name;
          },
        }),
      },
    },
    IOUtils: {
      stat: async (name) => {
        if (!files.has(name))
          throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
        return files.get(name);
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/library/sources.js"),
      "utf8",
    ),
    context,
  );
  const add = (id, library = 1) =>
    db
      .prepare(
        "INSERT INTO items VALUES (?, ?, ?, 1, 'same second', 'same second', 0)",
      )
      .run(id, library, "KEY" + id);
  return {
    db,
    files,
    context,
    add,
    scan: context.SWLibrarySources.scan.bind(context.SWLibrarySources),
  };
}

test("source snapshots page through identities, excluding deleted, note, annotation and feed items", async (t) => {
  const f = fixture(t);
  for (let id = 1; id <= 405; id++) f.add(id);
  f.add(406, 2);
  f.db
    .exec(`INSERT INTO itemAttachments VALUES (2, 1, 'application/pdf', 0, 'storage:a.pdf');
    INSERT INTO deletedItems VALUES (3); INSERT INTO itemNotes VALUES (4); INSERT INTO itemAnnotations VALUES (5);`);
  const result = await f.scan();
  assert.equal(result.documents.length, 401);
  assert.equal(result.items.get(2).parentID, 1);
  assert.equal(
    result.documents.some((doc) =>
      ["1/KEY2", "1/KEY3", "1/KEY4", "1/KEY5", "2/KEY406"].includes(doc.key),
    ),
    false,
  );
  assert.equal((await f.scan()).documents[0].stamp, result.documents[0].stamp);
});

test("same-second metadata edits, creator edits, PDF availability and reparenting invalidate only affected snapshots", async (t) => {
  const f = fixture(t);
  for (let id = 1; id <= 3; id++) f.add(id);
  f.db
    .exec(`INSERT INTO itemAttachments VALUES (2, 1, 'application/pdf', 0, 'storage:a.pdf');
    INSERT INTO itemData VALUES (1, 1, 10);
    INSERT INTO creators VALUES (1, 'A', 'Author', 0);
    INSERT INTO itemCreators VALUES (1, 1, 1, 0);`);
  const snapshot = async () =>
    new Map((await f.scan()).documents.map((doc) => [doc.key, doc.stamp]));
  let previous = await snapshot();
  for (const change of [
    () => f.db.exec("UPDATE itemData SET valueID = 11"),
    () => f.db.exec("UPDATE creators SET lastName = 'Changed'"),
    () => f.files.set("KEY2/.zotero-ft-cache", { lastModified: 1, size: 100 }),
    () => f.files.set("KEY2/.zotero-ft-cache", { lastModified: 2, size: 100 }),
    () => f.files.delete("KEY2/.zotero-ft-cache"),
  ]) {
    change();
    const next = await snapshot();
    assert.notEqual(next.get("1/KEY1"), previous.get("1/KEY1"));
    assert.equal(next.get("1/KEY3"), previous.get("1/KEY3"));
    previous = next;
  }
  f.db.exec("UPDATE itemAttachments SET parentItemID = 3");
  const next = await snapshot();
  assert.notEqual(next.get("1/KEY1"), previous.get("1/KEY1"));
  assert.notEqual(next.get("1/KEY3"), previous.get("1/KEY3"));
});

test("cancelled or failed source inspection never publishes a partial live set", async (t) => {
  const f = fixture(t);
  f.add(1);
  assert.equal(await f.scan(() => true), null);
  f.db.exec(
    "INSERT INTO itemAttachments VALUES (1, NULL, 'application/pdf', 0, 'storage:a.pdf')",
  );
  f.context.IOUtils.stat = async () => {
    throw new Error("Permission denied");
  };
  await assert.rejects(f.scan(), /Permission denied/);
});

test("targeted source inspection includes only the requested paper and all its attachments", async (t) => {
  const f = fixture(t);
  for (let id = 1; id <= 405; id++) f.add(id);
  f.db.exec(
    "INSERT INTO itemAttachments VALUES (2, 1, 'application/pdf', 0, 'storage:a.pdf')",
  );
  const whole = await f.scan();
  const selected = await f.scan(() => false, 1);
  assert.deepEqual([...selected.items.keys()], [1, 2]);
  assert.equal(selected.documents.length, 1);
  assert.equal(
    selected.documents[0].stamp,
    whole.documents.find((doc) => doc.id === 1).stamp,
  );
});
