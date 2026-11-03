import { noteSortOrder, type NoteSort } from "./note-sort";
import { config } from "../../package.json";
import { notifyDataChange } from "./events";
import { getString } from "../utils/locale";

const literatureTemplatesKey = `${config.prefsPrefix}.literatureTemplates`;

export function getNoteEditorMode(): "visual" | "source" {
  return Zotero.Prefs.get(`${config.prefsPrefix}.editorMode`, true) === "source"
    ? "source"
    : "visual";
}

export function setNoteEditorMode(mode: "visual" | "source"): void {
  if (mode !== "visual" && mode !== "source")
    throw new Error("Invalid editor mode");
  Zotero.Prefs.set(`${config.prefsPrefix}.editorMode`, mode, true);
}

interface LiteratureTemplate {
  id: string;
  name: string;
  body: string;
}
interface LiteratureTemplateSettings {
  selected: string | null;
  templates: LiteratureTemplate[];
}

export function getLiteratureTemplateSettings(): LiteratureTemplateSettings {
  const stored = Zotero.Prefs.get(literatureTemplatesKey, true);
  if (stored === undefined) return { selected: null, templates: [] };
  try {
    if (typeof stored !== "string") throw new Error();
    const settings = JSON.parse(stored);
    if (!settings || !Array.isArray(settings.templates)) throw new Error();
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const template of settings.templates) {
      if (
        !template ||
        typeof template.id !== "string" ||
        !template.id ||
        typeof template.name !== "string" ||
        !template.name.trim() ||
        template.name !== template.name.trim() ||
        typeof template.body !== "string" ||
        ids.has(template.id) ||
        names.has(template.name.toLowerCase())
      )
        throw new Error();
      ids.add(template.id);
      names.add(template.name.toLowerCase());
    }
    if (settings.selected !== null && !ids.has(settings.selected))
      throw new Error();
    return settings;
  } catch {
    throw new Error(getString("literature-template-invalid"));
  }
}

function saveLiteratureTemplates(settings: LiteratureTemplateSettings): void {
  Zotero.Prefs.set(literatureTemplatesKey, JSON.stringify(settings), true);
}

export function setLiteratureTemplate(id: string | null): void {
  const settings = getLiteratureTemplateSettings();
  if (id !== null && !settings.templates.some((template) => template.id === id))
    throw new Error(getString("literature-template-invalid"));
  saveLiteratureTemplates({ ...settings, selected: id });
}

export function createLiteratureTemplate(): string {
  const settings = getLiteratureTemplateSettings();
  const base = getString("template-untitled");
  let name = base;
  let suffix = 2;
  while (
    settings.templates.some(
      (template) => template.name.toLowerCase() === name.toLowerCase(),
    )
  )
    name = `${base} ${suffix++}`;
  let id: string;
  do {
    id = Zotero.Utilities.randomString(12);
  } while (settings.templates.some((template) => template.id === id));
  settings.templates.push({ id, name, body: "" });
  settings.selected = id;
  saveLiteratureTemplates(settings);
  return id;
}

export function updateLiteratureTemplate(
  id: string,
  input: { name?: string; body?: string },
): void {
  const settings = getLiteratureTemplateSettings();
  const template = settings.templates.find((template) => template.id === id);
  if (
    !template ||
    !input ||
    (input.name === undefined && input.body === undefined)
  )
    throw new Error(getString("literature-template-invalid"));
  if (input.name !== undefined) {
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      settings.templates.some(
        (other) =>
          other.id !== id &&
          other.name.toLowerCase() === input.name!.trim().toLowerCase(),
      )
    )
      throw new Error(getString("literature-template-name-invalid"));
    template.name = input.name.trim();
  }
  if (input.body !== undefined) {
    if (typeof input.body !== "string")
      throw new Error(getString("literature-template-invalid"));
    template.body = input.body;
  }
  saveLiteratureTemplates(settings);
}

export function deleteLiteratureTemplate(id: string): void {
  const settings = getLiteratureTemplateSettings();
  if (!settings.templates.some((template) => template.id === id))
    throw new Error(getString("literature-template-invalid"));
  settings.templates = settings.templates.filter(
    (template) => template.id !== id,
  );
  if (settings.selected === id) settings.selected = null;
  saveLiteratureTemplates(settings);
}

export function getNewNoteBody(): string {
  const settings = getLiteratureTemplateSettings();
  return (
    settings.templates.find((template) => template.id === settings.selected)
      ?.body ?? ""
  );
}

export interface GraphGroup {
  tag: string;
  color: string;
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
export function getGraphLocalDepth(): number {
  const value = Zotero.Prefs.get(preferenceKey("localDepth"), true);
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(6, value))
    : 1;
}
export function setGraphLocalDepth(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 6)
    throw new Error("Local graph hops must be between 1 and 6");
  Zotero.Prefs.set(preferenceKey("localDepth"), value, true);
}
export function getNoteSort(): NoteSort {
  const value = Zotero.Prefs.get(`${config.prefsPrefix}.noteSort`, true);
  if (typeof value !== "string") return "updated-desc";
  noteSortOrder(value);
  return value as NoteSort;
}
export function setNoteSort(value: string): void {
  noteSortOrder(value);
  Zotero.Prefs.set(`${config.prefsPrefix}.noteSort`, value, true);
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
  const observers = [...optionNames, "labelLength", "localDepth"].map((name) =>
    Zotero.Prefs.registerObserver(preferenceKey(name), listener, true),
  );
  return () =>
    observers.forEach((observer) => Zotero.Prefs.unregisterObserver(observer));
}
