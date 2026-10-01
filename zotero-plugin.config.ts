import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Gecko caches chrome stylesheets across hot updates. Change their URL when CSS changes.
const styleVersion = `${pkg.version}-${createHash("sha256")
  .update(readFileSync(new URL("./addon/content/manager.css", import.meta.url)))
  .digest("hex")
  .slice(0, 12)}`;

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      buildVersion: pkg.version,
      styleVersion,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: ["src/ui/graph.js"],
        bundle: true,
        target: "firefox115",
        outfile: "build/addon/content/graph.js",
      },
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
