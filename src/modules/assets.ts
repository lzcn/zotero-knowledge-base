import { getString } from "../utils/locale";
import { getAll } from "./db";
import { parseAssetNames } from "./markdown";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};
const ASSET_RE =
  /^knowledge-base-asset:([a-zA-Z0-9-]+\.(?:png|jpg|gif|webp|avif))$/;
const FILE_RE = /^[a-zA-Z0-9-]+\.(?:png|jpg|gif|webp|avif)$/;
const drafts = new Map<string, { refs: Set<string>; pending: Set<string> }>();
let registered = false;
let cleanupQueue: Promise<unknown> = Promise.resolve();

function draft(id: string) {
  if (!drafts.has(id)) drafts.set(id, { refs: new Set(), pending: new Set() });
  return drafts.get(id)!;
}

export function updateImageDraft(id: string, body: string): void {
  const state = draft(id);
  state.refs = parseAssetNames(body);
  for (const name of state.refs) state.pending.delete(name);
}

export async function releaseImageDraft(id: string): Promise<void> {
  drafts.delete(id);
  await cleanupUnusedImages();
}

/** Preserve references from every saved card and every open editor. */
export function cleanupUnusedImages(): Promise<number> {
  const task = cleanupQueue.then(async () => {
    if (!(await IOUtils.exists(assetDirectory()))) return 0;
    const rows = await getAll<{ body: string }>("SELECT body FROM zettels");
    const referenced = new Set(
      rows.flatMap((row) => [...parseAssetNames(row.body)]),
    );
    const files = await IOUtils.getChildren(assetDirectory());
    let removed = 0;
    for (const file of files) {
      const name = PathUtils.filename(file);
      if (!FILE_RE.test(name) || referenced.has(name)) continue;
      if (
        [...drafts.values()].some(
          (state) => state.refs.has(name) || state.pending.has(name),
        )
      )
        continue;
      await IOUtils.remove(file, { ignoreAbsent: true });
      removed++;
    }
    return removed;
  });
  cleanupQueue = task.catch(() => {});
  return task;
}

export async function cleanupImagesAfterChange(): Promise<void> {
  try {
    await cleanupUnusedImages();
  } catch (error) {
    // A file error must not make an already-committed card save look unsuccessful.
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
}

function resourceHandler() {
  return (
    Services.io.getProtocolHandler("resource") as unknown as {
      QueryInterface(iid: unknown): {
        setSubstitution(name: string, uri: nsIURI | null): void;
      };
    }
  ).QueryInterface(Components.interfaces.nsIResProtocolHandler);
}

function assetDirectory(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base", "assets");
}

async function ensureAssetDirectory(): Promise<void> {
  await IOUtils.makeDirectory(
    PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base"),
    { ignoreExisting: true },
  );
  await IOUtils.makeDirectory(assetDirectory(), { ignoreExisting: true });
}

export async function initAssets(): Promise<void> {
  await ensureAssetDirectory();
  const { FileUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/FileUtils.sys.mjs",
  );
  const handler = resourceHandler();
  const uri = Services.io.newFileURI(
    new FileUtils.File(assetDirectory() + "/"),
  );
  handler.setSubstitution("knowledge-base-assets", uri);
  registered = true;
}

export async function closeAssets(): Promise<void> {
  await cleanupQueue;
  drafts.clear();
  if (registered) {
    resourceHandler().setSubstitution("knowledge-base-assets", null);
    registered = false;
  }
}

export function resolveAssetURL(url: string): string {
  const match = ASSET_RE.exec(url);
  return match ? `resource://knowledge-base-assets/${match[1]}` : url;
}

export async function importImage(
  bytes: number[],
  mime: string,
  draftId?: string,
): Promise<string> {
  const extension = MIME_EXT[mime];
  if (!extension)
    throw new Error("Supported image formats: PNG, JPEG, GIF, WebP, AVIF");
  if (!bytes.length) throw new Error("Empty image");
  const filename = `${Services.uuid.generateUUID().toString().replace(/[{}]/g, "")}.${extension}`;
  const state = draftId ? draft(draftId) : undefined;
  state?.pending.add(filename);
  await ensureAssetDirectory();
  await IOUtils.write(
    PathUtils.join(assetDirectory(), filename),
    new Uint8Array(bytes),
  );
  if (draftId && drafts.get(draftId) !== state) {
    await IOUtils.remove(PathUtils.join(assetDirectory(), filename), {
      ignoreAbsent: true,
    });
    throw new Error("The image editor was closed before the import finished.");
  }
  return `knowledge-base-asset:${filename}`;
}

export async function pickImage(draftId?: string): Promise<{
  url: string;
  name: string;
} | null> {
  const { FilePicker } = ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  );
  const picker = new FilePicker();
  picker.init(
    Zotero.getMainWindow(),
    getString("editor-image"),
    picker.modeOpen,
  );
  picker.appendFilter("Images", "*.png; *.jpg; *.jpeg; *.gif; *.webp; *.avif");
  if ((await picker.show()) !== picker.returnOK) return null;
  const name = PathUtils.filename(picker.file);
  const extension = name.split(".").pop()?.toLowerCase();
  const mime = Object.keys(MIME_EXT).find(
    (key) =>
      MIME_EXT[key] === extension ||
      (extension === "jpeg" && key === "image/jpeg"),
  );
  if (!mime) throw new Error("Unsupported image format");
  const data = await IOUtils.read(picker.file);
  return { url: await importImage(Array.from(data), mime, draftId), name };
}
