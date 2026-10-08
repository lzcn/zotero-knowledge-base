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
      entryPoints: ["src/ui/markdown-source.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/markdown-source.js`,
    },
    {
      entryPoints: ["src/ui/native-editor.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/native-editor.js`,
    },
    {
      entryPoints: ["src/ui/editor-formatting.ts"],
      bundle: true,
      target: "firefox115",
      outfile: `${outputDirectory}/content/editor-formatting.js`,
    },
    {
      entryPoints: ["src/ui/graph.js"],
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
