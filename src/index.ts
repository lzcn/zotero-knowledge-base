import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const host = new BasicTool().getGlobal("Zotero") as unknown as Record<
  string,
  Addon | undefined
>;
if (!host[config.addonInstance]) {
  _globalThis.addon = new Addon();
  Object.defineProperty(_globalThis, "ztoolkit", {
    get: () => _globalThis.addon.data.ztoolkit,
  });
  host[config.addonInstance] = _globalThis.addon;
}
