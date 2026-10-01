const listeners = new Set<() => void>();

export function onDataChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDataChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
