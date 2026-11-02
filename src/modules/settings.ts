import { config } from "../../package.json";

const paneIDs: string[] = [];
let active = false;

export async function registerPreferences(): Promise<void> {
  if (active) return;
  active = true;
  const content = `chrome://${config.addonRef}/content/`;
  const id = await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: `${config.addonRef}-preferences`,
    image: content + "icons/icon-20.svg",
    label: config.addonName,
    src: content + "preferences.xhtml",
    scripts: ["ui.js", "common-preferences.js", "preferences.js"].map(
      (path) => content + path,
    ),
    stylesheets: [content + "preferences.css"],
  });
  if (!active) {
    Zotero.PreferencePanes.unregister(id);
    return;
  }
  paneIDs.push(id);
}

export function unregisterPreferences(): void {
  active = false;
  for (const id of paneIDs.splice(0).reverse())
    Zotero.PreferencePanes.unregister(id);
}
