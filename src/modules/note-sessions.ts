/** Shared note snapshots and serialized plugin writes; Zotero owns rich-text saves. */
export interface NativeNoteChange {
  noteID: number;
  revision: number;
  html: string;
  origin?: string;
}

interface NoteSession {
  item: Zotero.Item;
  html: string;
  revision: number;
  listeners: Set<(change: NativeNoteChange) => void>;
  pending: number;
  tail: Promise<unknown>;
}

const sessions = new Map<number, NoteSession>();
let revision = 0;
let stopped = false;
let observerID: string | undefined;

function sessionFor(item: Zotero.Item): NoteSession {
  let session = sessions.get(item.id);
  if (!session) {
    session = {
      item,
      html: item.getNote(),
      revision: ++revision,
      listeners: new Set(),
      pending: 0,
      tail: Promise.resolve(),
    };
    sessions.set(item.id, session);
  }
  return session;
}

function release(session: NoteSession): void {
  if (!session.pending && !session.listeners.size)
    sessions.delete(session.item.id);
}

function update(session: NoteSession, origin?: string): NativeNoteChange {
  const html = session.item.getNote();
  const changed = html !== session.html;
  if (changed) {
    session.html = html;
    session.revision = ++revision;
  }
  const snapshot = {
    noteID: session.item.id,
    html,
    revision: session.revision,
    origin,
  };
  if (changed && !stopped)
    for (const listener of session.listeners) {
      try {
        listener({ ...snapshot });
      } catch (error) {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  return snapshot;
}

export function onNativeNoteChange(
  noteID: number,
  listener: (change: NativeNoteChange) => void,
): () => void {
  if (stopped) throw new Error("NOTE_SESSION_CLOSED");
  const item = Zotero.Items.get(noteID);
  if (!item || !item.isNote()) throw new Error("NOTE_UNAVAILABLE");
  const session = sessionFor(item);
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
    release(session);
  };
}

export async function writeNativeNote(
  item: Zotero.Item,
  expectedHTML: string,
  html: string,
  origin?: string,
  isCurrent: () => boolean = () => true,
): Promise<NativeNoteChange> {
  if (stopped) throw new Error("NOTE_SESSION_CLOSED");
  const session = sessionFor(item);
  session.pending++;
  const operation = session.tail
    .catch(() => {})
    .then(async () => {
      let committedHTML = "";
      await Zotero.DB.executeTransaction(async () => {
        if (stopped || !isCurrent()) throw new Error("NOTE_SESSION_CLOSED");
        if (!item.isEditable() || item.isInTrash())
          throw new Error("NOTE_UNAVAILABLE");
        if (item.getNote() !== expectedHTML) throw new Error("NOTE_CONFLICT");
        if (item.setNote(html))
          await item.save({ notifierData: { noteEditorID: origin } });
        committedHTML = item.getNote();
      });
      return { ...update(session, origin), html: committedHTML };
    });
  session.tail = operation;
  try {
    return await operation;
  } finally {
    session.pending--;
    release(session);
  }
}

export function initNoteSessions(): void {
  if (observerID) return;
  stopped = false;
  observerID = Zotero.Notifier.registerObserver(
    {
      notify(_event, _type, ids, extraData) {
        for (const id of ids) {
          const session = sessions.get(Number(id));
          if (!session) continue;
          const origin =
            extraData?.[Number(id)]?.noteEditorID || extraData?.noteEditorID;
          update(session, origin);
        }
      },
    },
    ["item"],
    "knowledge-base-note-sessions",
  );
}

export function stopNoteSessions(): void {
  stopped = true;
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = undefined;
}

export async function closeNoteSessions(): Promise<void> {
  stopNoteSessions();
  await Promise.allSettled(
    [...sessions.values()].map((session) => session.tail),
  );
  sessions.clear();
}
