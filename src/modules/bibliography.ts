import createDOMPurify from "dompurify";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getSourceRevision } from "./events";
import { getDOMWindow } from "../utils/dom";

const stylePreference = `${config.prefsPrefix}.sourceStyle`;
const defaultStyle = "http://www.zotero.org/styles/apa";
let bibliographyVersion = "";
const bibliographies = new Map<string, Promise<string>>();

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
export function getSourceBibliography(
  key: string,
  libraryID: number | null,
): Promise<string> {
  const styleID = getSourceStyle();
  const version = JSON.stringify([getSourceRevision(), styleID, Zotero.locale]);
  if (version !== bibliographyVersion) {
    bibliographyVersion = version;
    bibliographies.clear();
  }
  const library = libraryID || Zotero.Libraries.userLibraryID;
  const cacheKey = JSON.stringify([library, key]);
  let result = bibliographies.get(cacheKey);
  if (!result) {
    result = formatSourceBibliography(key, library, styleID).catch((error) => {
      if (bibliographies.get(cacheKey) === result)
        bibliographies.delete(cacheKey);
      throw error;
    });
    bibliographies.set(cacheKey, result);
  }
  return result;
}

async function formatSourceBibliography(
  key: string,
  libraryID: number,
  styleID: string,
): Promise<string> {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  if (!item || item.deleted)
    throw new Error(getString("manager-source-missing"));
  if (item.isNote()) return "";
  await Zotero.Styles.init();
  await Zotero.Items.loadDataTypes([item], ["itemData", "creators"]);
  const style = Zotero.Styles.get(styleID);
  if (!style) throw new Error(getString("source-style-missing"));
  const engine = style.getCiteProc(Zotero.locale);
  try {
    const html = Zotero.Cite.makeFormattedBibliographyOrCitationList(
      engine,
      [item],
      "html",
    );
    const win = getDOMWindow();
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

export function closeBibliographies(): void {
  bibliographies.clear();
  bibliographyVersion = "";
}
