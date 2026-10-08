import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = await mkdtemp(join(tmpdir(), "knowledge-base-sessions-"));
const output = join(workspace, "sessions.mjs");
await build({
  stdin: {
    contents: `export * as sessions from ${JSON.stringify(resolve("src/modules/note-sessions.ts"))}; export * as events from ${JSON.stringify(resolve("src/modules/events.ts"))};`,
    resolveDir: process.cwd(),
  },
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { sessions, events } = await import(pathToFileURL(output));
const observers = new Map();
const errors = [];
let saves = 0;
let saveHook = async () => {};
const item = {
  id: 1,
  html: "initial",
  isNote: () => true,
  isEditable: () => true,
  isInTrash: () => false,
  getNote() {
    return this.html;
  },
  setNote(html) {
    const changed = html !== this.html;
    this.html = html;
    return changed;
  },
  async save() {
    saves++;
    await saveHook();
  },
};
globalThis.Zotero = {
  Items: { get: (id) => (id === item.id ? item : null) },
  Notifier: {
    registerObserver(observer, _types, name) {
      observers.set(name, observer);
      return name;
    },
    unregisterObserver(id) {
      observers.delete(id);
    },
  },
  DB: {
    async executeTransaction(fn) {
      const previous = item.html;
      try {
        return await fn();
      } catch (error) {
        item.html = previous;
        throw error;
      }
    },
  },
  logError: (error) => errors.push(error),
};
const notify = (origin) => {
  for (const observer of observers.values())
    observer.notify("modify", "item", [1], { 1: { noteEditorID: origin } });
};
let count = 0;
const pass = (label) => {
  count++;
  console.log("PASS " + label);
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const nodeQueueMicrotask = globalThis.queueMicrotask;

try {
  // Zotero's privileged plugin sandbox does not expose queueMicrotask.
  globalThis.queueMicrotask = undefined;
  sessions.initNoteSessions();
  sessions.initNoteSessions();
  assert.equal(observers.size, 1);
  const first = [];
  const second = [];
  const unsubscribeFirst = sessions.onNativeNoteChange(1, (change) => {
    first.push({ ...change });
    change.html = "changed by subscriber";
  });
  const unsubscribeSecond = sessions.onNativeNoteChange(1, (change) =>
    second.push(change),
  );
  item.html = "external";
  notify("native-editor");
  notify("native-editor");
  assert.equal(first.length, 1);
  assert.equal(second[0].html, "external");
  assert.equal(second[0].origin, "native-editor");
  pass(
    "Editors share one host subscription, immutable snapshots and deduplicated notifications",
  );

  let finish;
  saveHook = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const accepted = sessions.writeNativeNote(
    item,
    "external",
    "first writer",
    "markdown",
  );
  const stale = sessions.writeNativeNote(
    item,
    "external",
    "stale writer",
    "other-window",
  );
  const rejected = assert.rejects(stale, /NOTE_CONFLICT/);
  await settle();
  assert.equal(saves, 1);
  finish();
  const committed = await accepted;
  await rejected;
  assert.equal(item.html, "first writer");
  assert.equal(committed.html, item.html);
  assert.ok(second.at(-1).revision > second[0].revision);
  pass(
    "Concurrent plugin writes are serialized and stale writers cannot overwrite a committed note",
  );

  saveHook = async () => {
    throw new Error("storage failure");
  };
  await assert.rejects(
    sessions.writeNativeNote(item, item.html, "failed"),
    /storage failure/,
  );
  saveHook = async () => {};
  await sessions.writeNativeNote(item, "first writer", "retry succeeds");
  assert.equal(item.html, "retry succeeds");
  pass(
    "A failed write does not poison later writes or publish an uncommitted snapshot",
  );

  let current = true;
  saveHook = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const blocking = sessions.writeNativeNote(item, item.html, "blocking writer");
  const cancelled = sessions.writeNativeNote(
    item,
    item.html,
    "closed window",
    undefined,
    () => current,
  );
  const cancellation = assert.rejects(cancelled, /NOTE_SESSION_CLOSED/);
  await settle();
  current = false;
  finish();
  await blocking;
  await cancellation;
  assert.equal(item.html, "blocking writer");
  pass(
    "Closing a window cancels its queued write before it touches note storage",
  );

  const received = [];
  const removeMutating = events.onDataChange((change) => {
    change.cardIDs.push("unrelated");
  });
  const removeScoped = events.onDataChange((change) => received.push(change));
  events.notifyDataChange({ cardIDs: ["A"], fields: ["content"] });
  events.notifyDataChange({
    cardIDs: ["A", "B"],
    itemKeys: ["SOURCE"],
    fields: ["links"],
  });
  await settle();
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].cardIDs, ["A", "B"]);
  assert.deepEqual(received[0].fields, ["content", "links"]);
  assert.equal(received[0].all, false);
  events.notifyDataChange();
  await settle();
  assert.equal(received[1].all, true);
  assert.ok(received[1].revision > received[0].revision);
  removeMutating();
  removeScoped();
  pass(
    "Burst notifications coalesce their scopes without allowing one subscriber to alter another",
  );

  saveHook = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const running = sessions.writeNativeNote(item, item.html, "already running");
  const queued = sessions.writeNativeNote(
    item,
    item.html,
    "shutdown overwrite",
  );
  const shutdownRejected = assert.rejects(queued, /NOTE_SESSION_CLOSED/);
  await settle();
  sessions.stopNoteSessions();
  const before = second.length;
  finish();
  await running;
  await shutdownRejected;
  await sessions.closeNoteSessions();
  assert.equal(item.html, "already running");
  assert.equal(second.length, before);
  assert.equal(observers.size, 0);
  unsubscribeFirst();
  unsubscribeSecond();
  await assert.rejects(
    sessions.writeNativeNote(item, item.html, "after shutdown"),
    /NOTE_SESSION_CLOSED/,
  );
  pass(
    "Shutdown rejects queued and new writes, drains started writes and releases observers",
  );
  assert.deepEqual(errors, []);
  console.log(`OK - ${count} note session and event checks`);
} finally {
  globalThis.queueMicrotask = nodeQueueMicrotask;
  await sessions.closeNoteSessions();
  await rm(workspace, { recursive: true, force: true });
}
