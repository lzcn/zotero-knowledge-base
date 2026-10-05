import createDOMPurify from "dompurify";
import { config } from "../../package.json";
import { getString } from "../utils/locale";

const stylePreference = `${config.prefsPrefix}.sourceStyle`;
const defaultStyle = "http://www.zotero.org/styles/apa";
let paneID: string | undefined;
let active = false;

export function getSourceStyle(): string {
  return String(Zotero.Prefs.get(stylePreference, true) || defaultStyle);
}

export async function getSourceStyles(): Promise<
  { id: string; title: string }[]
> {
  await Zotero.Styles.init();
  return Zotero.Styles.getVisible().map(
    (style: { styleID: string; title: string }) => ({
      id: style.styleID,
      title: style.title,
    }),
  );
}

export function setSourceStyle(id: string): void {
  if (!Zotero.Styles.get(id))
    throw new Error(getString("source-style-missing"));
  Zotero.Prefs.set(stylePreference, id, true);
}

export function onSourceStyleChange(listener: () => void): () => void {
  const observer = Zotero.Prefs.registerObserver(
    stylePreference,
    listener,
    true,
  );
  return () => Zotero.Prefs.unregisterObserver(observer);
}

/** CSL owns bibliographic content; the host interface owns spacing and wrapping. */
export async function getSourceBibliography(
  key: string,
  libraryID: number | null,
): Promise<string> {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(
    libraryID || Zotero.Libraries.userLibraryID,
    key,
  );
  if (!item || item.deleted)
    throw new Error(getString("manager-source-missing"));
  if (item.isNote()) return "";
  await Zotero.Styles.init();
  await Zotero.Items.loadDataTypes([item], ["itemData", "creators"]);
  const style = Zotero.Styles.get(getSourceStyle());
  if (!style) throw new Error(getString("source-style-missing"));
  const engine = style.getCiteProc(Zotero.locale);
  try {
    const html = Zotero.Cite.makeFormattedBibliographyOrCitationList(
      engine,
      [item],
      "html",
    );
    const win = Zotero.getMainWindow();
    const fragment = createDOMPurify(
      win as unknown as Parameters<typeof createDOMPurify>[0],
    ).sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: [
        "div",
        "span",
        "i",
        "em",
        "b",
        "strong",
        "sup",
        "sub",
        "a",
        "br",
      ],
      ALLOWED_ATTR: ["class", "href"],
    });
    fragment.querySelectorAll(".Z3988").forEach((node) => node.remove());
    const container = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    container.append(fragment);
    return container.innerHTML;
  } finally {
    engine.free();
  }
}

export async function registerPreferences(): Promise<void> {
  if (active) return;
  active = true;
  const id = await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: `${config.addonRef}-preferences`,
    label: config.addonName,
    image: `chrome://${config.addonRef}/content/icons/icon-20.svg`,
    src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    scripts: [`chrome://${config.addonRef}/content/preferences.js`],
  });
  if (active) paneID = id;
  else Zotero.PreferencePanes.unregister(id);
}

export function unregisterPreferences(): void {
  active = false;
  if (paneID) Zotero.PreferencePanes.unregister(paneID);
  paneID = undefined;
}
