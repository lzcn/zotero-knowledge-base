import { config } from "../../package.json";

export interface GraphOptions {
  outline: boolean;
  references: boolean;
  sources: boolean;
}
const optionNames = ["outline", "references", "sources"] as const;
const preferenceKey = (name: string) => `${config.prefsPrefix}.graph.${name}`;
let paneID: string | undefined;
let pending = false;
let generation = 0;

export async function registerPreferences(): Promise<void> {
  if (paneID || pending) return;
  pending = true;
  const token = ++generation;
  try {
    const id = await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      id: `${config.addonRef}-preferences`,
      label: config.addonName,
      image: `chrome://${config.addonRef}/content/icons/icon-20.png`,
      src: `chrome://${config.addonRef}/content/preferences.xhtml`,
      scripts: [`chrome://${config.addonRef}/content/preferences.js`],
    });
    if (token !== generation) Zotero.PreferencePanes.unregister(id);
    else paneID = id;
  } finally {
    if (token === generation) pending = false;
  }
}

export function unregisterPreferences(): void {
  ++generation;
  pending = false;
  if (paneID) Zotero.PreferencePanes.unregister(paneID);
  paneID = undefined;
}

export function getGraphOptions(): GraphOptions {
  const enabled = (name: string) =>
    Zotero.Prefs.get(preferenceKey(name), true) !== false;
  return {
    outline: enabled("outline"),
    references: enabled("references"),
    sources: enabled("sources"),
  };
}

export function onGraphOptionsChange(listener: () => void): () => void {
  const observers = optionNames.map((name) =>
    Zotero.Prefs.registerObserver(preferenceKey(name), listener, true),
  );
  return () =>
    observers.forEach((observer) => Zotero.Prefs.unregisterObserver(observer));
}
