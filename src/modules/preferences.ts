import { config } from "../../package.json";

export interface GraphOptions {
  outline: boolean;
  references: boolean;
  sources: boolean;
}
const optionNames = ["outline", "references", "sources"] as const;
const preferenceKey = (name: string) => `${config.prefsPrefix}.graph.${name}`;
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
  };
}

export function onGraphOptionsChange(listener: () => void): () => void {
  const observers = optionNames.map((name) =>
    Zotero.Prefs.registerObserver(preferenceKey(name), listener, true),
  );
  return () =>
    observers.forEach((observer) => Zotero.Prefs.unregisterObserver(observer));
}
