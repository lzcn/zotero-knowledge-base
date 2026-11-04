// Build a universal macOS helper against the pinned official ONNX Runtime SDK.
import { createHash } from "node:crypto";
import {
  mkdir,
  copyFile,
  writeFile,
  readFile,
  readdir,
  rm,
  rename,
  mkdtemp,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = "1.22.0";
const checksum =
  "cfa6f6584d87555ed9f6e7e8a000d3947554d589efe3723b8bfa358cd263d03c";
const url = `https://github.com/microsoft/onnxruntime/releases/download/v${version}/onnxruntime-osx-universal2-${version}.tgz`;
export const nativeRuntime = {
  url,
  sha256: checksum,
  member: `onnxruntime-osx-universal2-${version}/lib/libonnxruntime.${version}.dylib`,
};
const cache = join(root, "build/native-sdk");
const sdk = join(cache, `onnxruntime-osx-universal2-${version}`);
const output = join(root, "build/native");
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${cmd} failed: ${result.signal || result.status}`);
}
export async function prepareNativeSDK() {
  if (process.platform !== "darwin") return false;
  await mkdir(cache, { recursive: true });
  const complete = (directory) =>
    existsSync(join(directory, "include/onnxruntime_cxx_api.h")) &&
    existsSync(join(directory, `lib/libonnxruntime.${version}.dylib`));
  if (!complete(sdk)) {
    const archive = join(cache, "sdk.tgz");
    const verified = async (file) =>
      existsSync(file) &&
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") === checksum;
    if (!(await verified(archive))) {
      console.log("Downloading native build tools (first build only)...");
      const temporary = `${archive}.${process.pid}.tmp`;
      try {
        run("curl", [
          "--fail",
          "--location",
          "--show-error",
          "--progress-bar",
          "--connect-timeout",
          "15",
          "--max-time",
          "180",
          "--speed-limit",
          "1024",
          "--speed-time",
          "30",
          "--output",
          temporary,
          url,
        ]);
        if (!(await verified(temporary)))
          throw new Error("Native build tools checksum mismatch");
        await rename(temporary, archive);
      } catch (error) {
        throw new Error(
          "Could not download native build tools. Check the network or proxy and run npm run build again.",
          { cause: error },
        );
      } finally {
        await rm(temporary, { force: true });
      }
    }
    console.log("Preparing native build tools...");
    const staging = await mkdtemp(join(cache, "extract-"));
    try {
      run("tar", ["-xzf", archive, "-C", staging]);
      const extracted = join(staging, `onnxruntime-osx-universal2-${version}`);
      if (!complete(extracted))
        throw new Error("Native build tools archive is incomplete");
      await rm(sdk, { recursive: true, force: true });
      await rename(extracted, sdk);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return true;
}

async function digest(paths) {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(await readFile(path));
  return hash.digest("hex");
}

export async function buildNative() {
  if (!(await prepareNativeSDK())) return false;
  const binaries = [
    join(output, "inference"),
    join(output, `libonnxruntime.${version}.dylib`),
  ];
  const headers = (await readdir(join(sdk, "include")))
    .filter((name) => name.endsWith(".h"))
    .sort();
  const input = await digest([
    join(root, "src/native/inference.mm"),
    join(root, "src/native/inference-backend.h"),
    join(root, "src/native/coreml-backend.h"),
    join(root, "src/native/embedding.h"),
    fileURLToPath(import.meta.url),
    ...headers.map((name) => join(sdk, "include", name)),
    join(sdk, `lib/libonnxruntime.${version}.dylib`),
  ]);
  const stateFile = join(output, "state.json");
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (state.input === input && state.output === (await digest(binaries)))
      return true;
  } catch {
    /* Missing or corrupt output requires rebuilding. */
  }
  await rm(stateFile, { force: true });
  await mkdir(output, { recursive: true });
  console.log("Compiling native helper...");
  run("xcrun", [
    "clang++",
    "-std=c++17",
    "-O2",
    "-fobjc-arc",
    "-arch",
    "arm64",
    "-arch",
    "x86_64",
    "-mmacosx-version-min=13.3",
    "-I" + join(sdk, "include"),
    join(root, "src/native/inference.mm"),
    "-L" + join(sdk, "lib"),
    "-lonnxruntime",
    "-framework",
    "Foundation",
    "-Wl,-rpath,@loader_path",
    "-o",
    join(output, "inference"),
  ]);
  await copyFile(
    join(sdk, `lib/libonnxruntime.${version}.dylib`),
    join(output, `libonnxruntime.${version}.dylib`),
  );
  run("codesign", [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    join(output, "inference"),
  ]);
  await writeFile(
    stateFile,
    JSON.stringify({ input, output: await digest(binaries) }),
  );
  return true;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildNative();
