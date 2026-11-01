/** Parsing and sanitizing must also work while only note or reader windows remain. */
export function getDOMWindow(): Window & typeof globalThis {
  const win = Zotero.getMainWindow();
  return (
    win && !win.closed ? win : Services.appShell.hiddenDOMWindow
  ) as Window & typeof globalThis;
}
