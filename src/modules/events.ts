export type DataField =
  | "content"
  | "identity"
  | "source"
  | "hierarchy"
  | "links"
  | "tags"
  | "availability";

export interface DataChange {
  revision: number;
  all: boolean;
  cardIDs: string[];
  noteIDs: number[];
  itemKeys: string[];
  fields: DataField[];
}

const listeners = new Set<(change: DataChange) => void>();
let revision = 0;
let pending: Omit<DataChange, "revision"> | undefined;

export function onDataChange(
  listener: (change: DataChange) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDataChange(
  change: Partial<Omit<DataChange, "revision">> = { all: true },
): void {
  const scheduled = !!pending;
  pending = {
    all: !!pending?.all || !!change.all,
    cardIDs: [
      ...new Set([...(pending?.cardIDs ?? []), ...(change.cardIDs ?? [])]),
    ],
    noteIDs: [
      ...new Set([...(pending?.noteIDs ?? []), ...(change.noteIDs ?? [])]),
    ],
    itemKeys: [
      ...new Set([...(pending?.itemKeys ?? []), ...(change.itemKeys ?? [])]),
    ],
    fields: [
      ...new Set([...(pending?.fields ?? []), ...(change.fields ?? [])]),
    ],
  };
  if (scheduled) return;
  void Promise.resolve().then(() => {
    const event: DataChange = { ...pending!, revision: ++revision };
    pending = undefined;
    for (const listener of listeners) {
      try {
        // Each subscriber receives its own arrays so it cannot alter another view's scope.
        listener({
          ...event,
          cardIDs: [...event.cardIDs],
          noteIDs: [...event.noteIDs],
          itemKeys: [...event.itemKeys],
          fields: [...event.fields],
        });
      } catch (error) {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  });
}
