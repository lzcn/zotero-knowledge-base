import { getString } from "../utils/locale";
import { getSourceRevision } from "./events";
import { summaryForItem, type ItemSummary } from "./zotero";

let referenceVersion = "";
const references = new Map<string, Promise<string>>();

function escapeHTML(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  };
  return value.replace(/[&<>"]/g, (character) => entities[character]);
}

/** Concise reference from the fields Zotero exports for the item. */
export function formatSourceReference(item: ItemSummary): string {
  const parts = [
    item.creatorYear,
    item.title && `<i>${escapeHTML(item.title)}</i>`,
    item.publication,
  ].filter((part): part is string => !!part);
  return parts.length ? `${parts.join(". ")}.` : "";
}

export function getSourceReference(
  key: string,
  libraryID: number | null,
): Promise<string> {
  const version = String(getSourceRevision());
  if (version !== referenceVersion) {
    referenceVersion = version;
    references.clear();
  }
  const library = libraryID || Zotero.Libraries.userLibraryID;
  const cacheKey = JSON.stringify([library, key]);
  let result = references.get(cacheKey);
  if (!result) {
    result = formatSourceItem(key, library).catch((error) => {
      if (references.get(cacheKey) === result) references.delete(cacheKey);
      throw error;
    });
    references.set(cacheKey, result);
  }
  return result;
}

async function formatSourceItem(
  key: string,
  libraryID: number,
): Promise<string> {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  if (!item || item.deleted)
    throw new Error(getString("manager-source-missing"));
  if (!item.isRegularItem()) throw new Error(getString("source-item-required"));
  await Zotero.Items.loadDataTypes([item], ["itemData", "creators"]);
  return formatSourceReference(summaryForItem(item));
}

export function closeSourceReferences(): void {
  references.clear();
  referenceVersion = "";
}
