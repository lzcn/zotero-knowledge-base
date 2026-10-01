import { getString } from "../utils/locale";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};
const ASSET_RE = /^zkb-asset:([a-zA-Z0-9-]+\.(?:png|jpg|gif|webp|avif))$/;

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
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    "zettel-knowledge-base-assets",
  );
}

export async function initAssets(): Promise<void> {
  await IOUtils.makeDirectory(assetDirectory(), { ignoreExisting: true });
  const { FileUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/FileUtils.sys.mjs",
  );
  const handler = resourceHandler();
  const uri = Services.io.newFileURI(
    new FileUtils.File(assetDirectory() + "/"),
  );
  handler.setSubstitution("zettel-knowledge-base-assets", uri);
}

export function closeAssets(): void {
  const handler = resourceHandler();
  handler.setSubstitution("zettel-knowledge-base-assets", null);
}

export function resolveAssetURL(url: string): string {
  const match = ASSET_RE.exec(url);
  return match ? `resource://zettel-knowledge-base-assets/${match[1]}` : url;
}

export async function importImage(
  bytes: number[],
  mime: string,
): Promise<string> {
  const extension = MIME_EXT[mime];
  if (!extension)
    throw new Error("Supported image formats: PNG, JPEG, GIF, WebP, AVIF");
  if (!bytes.length) throw new Error("Empty image");
  const filename = `${Services.uuid.generateUUID().toString().replace(/[{}]/g, "")}.${extension}`;
  await IOUtils.makeDirectory(assetDirectory(), { ignoreExisting: true });
  await IOUtils.write(
    PathUtils.join(assetDirectory(), filename),
    new Uint8Array(bytes),
  );
  return `zkb-asset:${filename}`;
}

export async function pickImage(): Promise<{
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
  return { url: await importImage(Array.from(data), mime), name };
}
