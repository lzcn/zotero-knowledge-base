import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { buildOptions } from "./scripts/build-options.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Gecko caches chrome stylesheets across hot updates. Change their URL when CSS changes.
const styleVersion = `${pkg.version}-${createHash("sha256")
  .update(readFileSync(new URL("./addon/content/manager.css", import.meta.url)))
  .digest("hex")
  .slice(0, 12)}`;

export default defineConfig({
  source: ["src", "addon"],
  dist: "dist",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: pkg.name,
  updateURL: `https://github.com/lzcn/${pkg.name}/releases/latest/download/updates.json`,

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      buildVersion: pkg.version,
      styleVersion,
    },
    esbuildOptions: buildOptions(pkg, process.env.NODE_ENV ?? "development"),
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
