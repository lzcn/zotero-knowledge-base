/** Shared compilation options for production builds and the development server. */
export function buildOptions(pkg, environment, outputDirectory = "dist/addon") {
  return [
    {
      entryPoints: ["src/ui/graph-layout-worker.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/graph-layout-worker.js`,
    },
    {
      entryPoints: ["src/entries/markdown-source.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/markdown-source.js`,
    },
    {
      entryPoints: ["src/entries/preferences.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/preferences.js`,
    },
    {
      entryPoints: ["src/entries/editor.ts"],
      // These chrome documents expose their script scope to native host callbacks.
      format: "esm",
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/editor.js`,
    },
    {
      entryPoints: ["src/entries/manager.ts"],
      format: "esm",
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/manager.js`,
    },
    {
      entryPoints: ["src/entries/graph.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/graph.js`,
    },
    {
      entryPoints: ["src/index.ts"],
      define: { __env__: JSON.stringify(environment) },
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/scripts/${pkg.config.addonRef}.js`,
    },
  ];
}
