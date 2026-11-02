import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { buildNative, nativeRuntime } from "./build-native.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export async function buildLibrary(stage, version) {
  const source = join(root, "src/library");
  const target = join(stage, "content/library");
  await mkdir(join(target, "scripts"), { recursive: true });
  const hash = createHash("sha256");
  for (const name of (await readdir(source)).sort()) {
    if (!name.endsWith(".js")) continue;
    const bytes = await readFile(join(source, name));
    hash.update(name).update(bytes);
    await writeFile(join(target, "scripts", name), bytes);
  }
  await mkdir(join(target, "runtime"), { recursive: true });
  const worker = await build({
    entryPoints: [join(root, "src/ui/library/worker.js")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "firefox140",
    minify: true,
    legalComments: "inline",
    alias: { "onnxruntime-web": "onnxruntime-web/wasm" },
  });
  await writeFile(
    join(target, "runtime/worker.js"),
    worker.outputFiles[0].contents,
  );
  for (const [name, path] of [
    ["transformers-LICENSE", "node_modules/@huggingface/transformers/LICENSE"],
    ["jinja-LICENSE", "node_modules/@huggingface/jinja/LICENSE"],
    ["onnxruntime-LICENSE", "addon/content/licenses/onnxruntime.txt"],
    ["onnxruntime-NOTICES", "addon/content/licenses/onnxruntime-notices.txt"],
  ])
    await cp(join(root, path), join(target, "runtime", name));
  if (await buildNative()) {
    const manifest = { files: {}, runtime: nativeRuntime };
    await mkdir(join(target, "native"), { recursive: true });
    for (const name of ["inference", "libonnxruntime.1.22.0.dylib"]) {
      const bytes = await readFile(join(root, "build/native", name));
      manifest.files[name] = createHash("sha256").update(bytes).digest("hex");
      if (name === "inference")
        await writeFile(join(target, "native", name), bytes);
    }
    await writeFile(
      join(target, "native/manifest.json"),
      JSON.stringify(manifest),
    );
  }
  await writeFile(
    join(target, "build-info.json"),
    JSON.stringify({ version, id: hash.digest("hex").slice(0, 12) }),
  );
}
