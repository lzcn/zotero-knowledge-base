import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { context } from "esbuild";
import { buildOptions } from "../scripts/build-options.mjs";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url)),
);
for (const name of ["editor", "manager"]) {
  test(`${name} entry tracks its body and rebuilds it as a native chrome script`, async () => {
    let revision = "before";
    const options = buildOptions(pkg, "test").find((option) =>
      option.outfile.endsWith(`/${name}.js`),
    );
    const compiler = await context({
      ...options,
      write: false,
      metafile: true,
      plugins: [
        {
          name: "body-revision",
          setup(builder) {
            builder.onLoad(
              { filter: new RegExp(`/addon/content/${name}\\.js$`) },
              async (args) => ({
                contents:
                  (await readFile(args.path, "utf8")) +
                  `\nglobalThis.buildRevision = "${revision}";`,
                loader: "js",
              }),
            );
          },
        },
      ],
    });
    try {
      const first = await compiler.rebuild();
      assert.ok(
        Object.keys(first.metafile.inputs).includes(`addon/content/${name}.js`),
      );
      assert.match(first.outputFiles[0].text, /buildRevision = "before"/);
      revision = "after";
      const second = await compiler.rebuild();
      assert.match(second.outputFiles[0].text, /buildRevision = "after"/);
      assert.doesNotMatch(
        second.outputFiles[0].text,
        /buildRevision = "before"/,
      );
      new Script(second.outputFiles[0].text);
    } finally {
      await compiler.dispose();
    }
  });
}
