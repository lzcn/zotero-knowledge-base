/** Preserve macOS Control editing/right-click gestures and IME composition. */
export function isAccelKey(
  event: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
  isMac = !!Zotero.isMac,
): boolean {
  return (
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    (isMac ? event.metaKey : event.ctrlKey)
  );
}
