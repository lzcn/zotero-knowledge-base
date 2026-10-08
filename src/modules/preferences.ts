import { config } from "../../package.json";
import { notifyDataChange } from "./events";

export interface GraphGroup {
  tag: string;
  color: string;
}
export function getTagInheritance(): boolean {
  return (
    Zotero.Prefs?.get(`${config.prefsPrefix}.inheritParentTags`, true) !== false
  );
}
export function setTagInheritance(value: boolean): void {
  Zotero.Prefs.set(`${config.prefsPrefix}.inheritParentTags`, value, true);
  notifyDataChange({ all: true, fields: ["tags"] });
}
export function getGraphGroups(): GraphGroup[] {
  const value = Zotero.Prefs?.get(`${config.prefsPrefix}.graph.groups`, true);
  if (!value || typeof value !== "string") return [];
  try {
    const groups = JSON.parse(value);
    if (
      !Array.isArray(groups) ||
      groups.some(
        (group) =>
          !group ||
          typeof group.tag !== "string" ||
          typeof group.color !== "string" ||
          !/^#[\da-f]{6}$/i.test(group.color),
      )
    )
      throw new Error("Invalid graph groups");
    return groups;
  } catch (error) {
    Zotero.logError(new Error(`Knowledge Base graph groups: ${String(error)}`));
    return [];
  }
}
export function setGraphGroups(groups: GraphGroup[]): void {
  if (
    !Array.isArray(groups) ||
    groups.some(
      (group) =>
        !group ||
        typeof group.tag !== "string" ||
        typeof group.color !== "string" ||
        !/^#[\da-f]{6}$/i.test(group.color),
    )
  )
    throw new Error("Invalid graph groups");
  Zotero.Prefs.set(
    `${config.prefsPrefix}.graph.groups`,
    JSON.stringify(
      groups.map((group) => ({
        tag: group.tag.trim(),
        color: group.color.toLowerCase(),
      })),
    ),
    true,
  );
  notifyDataChange({ all: true, fields: ["tags"] });
}

export interface GraphOptions {
  outline: boolean;
  references: boolean;
  sources: boolean;
  hideIsolated: boolean;
}
const optionNames = [
  "outline",
  "references",
  "sources",
  "hideIsolated",
] as const;
const preferenceKey = (name: string) => `${config.prefsPrefix}.graph.${name}`;
export function getGraphLabelLength(): number {
  const value = Zotero.Prefs.get(preferenceKey("labelLength"), true);
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(8, Math.min(80, value))
    : 20;
}
export function setGraphLabelLength(value: number): void {
  if (!Number.isInteger(value) || value < 8 || value > 80)
    throw new Error("Graph title length must be between 8 and 80");
  Zotero.Prefs.set(preferenceKey("labelLength"), value, true);
}
export function getWorkbenchMode(): "tab" | "window" {
  return Zotero.Prefs.get(`${config.prefsPrefix}.workbenchMode`, true) ===
    "window"
    ? "window"
    : "tab";
}
export function setWorkbenchMode(value: string): void {
  if (value !== "tab" && value !== "window")
    throw new Error("Unknown workbench mode");
  Zotero.Prefs.set(`${config.prefsPrefix}.workbenchMode`, value, true);
}
export function setGraphOption(name: keyof GraphOptions, value: boolean): void {
  if (!optionNames.includes(name)) throw new Error("Unknown graph option");
  Zotero.Prefs.set(preferenceKey(name), value, true);
}
export function getPanelWidth(name: "manager" | "graph"): number {
  const value = Zotero.Prefs.get(`${config.prefsPrefix}.panels.${name}`, true);
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(18, Math.min(55, value))
    : name === "manager"
      ? 28
      : 26;
}
export function setPanelWidth(name: "manager" | "graph", value: number): void {
  if (!["manager", "graph"].includes(name) || !Number.isFinite(value)) return;
  Zotero.Prefs.set(
    `${config.prefsPrefix}.panels.${name}`,
    Math.round(Math.max(18, Math.min(55, value))),
    true,
  );
}

export function getGraphOptions(): GraphOptions {
  const enabled = (name: string) =>
    Zotero.Prefs.get(preferenceKey(name), true) !== false;
  return {
    outline: enabled("outline"),
    references: enabled("references"),
    sources: enabled("sources"),
    hideIsolated:
      Zotero.Prefs.get(preferenceKey("hideIsolated"), true) === true,
  };
}

export function onGraphOptionsChange(listener: () => void): () => void {
  const observers = [...optionNames, "labelLength"].map((name) =>
    Zotero.Prefs.registerObserver(preferenceKey(name), listener, true),
  );
  return () =>
    observers.forEach((observer) => Zotero.Prefs.unregisterObserver(observer));
}
