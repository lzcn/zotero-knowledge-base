import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(join(tmpdir(), "knowledge-base-csl-"));
try {
  await build({
    entryPoints: ["src/modules/bibliography.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(root, "bibliography.mjs"),
  });
  const dom = new JSDOM("<div id='source'></div>", {
    runScripts: "outside-only",
  });
  const item = { id: 1, deleted: false, isNote: () => false };
  let preference = "http://www.zotero.org/styles/apa";
  let released = 0;
  let fails = false;
  globalThis.Zotero = {
    Items: {
      getByLibraryAndKeyAsync: async () => item,
      loadDataTypes: async () => {},
    },
    Libraries: { userLibraryID: 1 },
    Prefs: { get: () => preference },
    Styles: {
      init: async () => {},
      get: (id) =>
        id.endsWith("/apa")
          ? { getCiteProc: () => ({ free: () => released++ }) }
          : null,
    },
    Cite: {
      makeFormattedBibliographyOrCitationList: () => {
        if (fails) throw new Error("CSL failure");
        return '<div class="csl-entry" style="margin: 2em">Author. <i>Title</i>. <a href="https://example.com">DOI</a><script>bad()</script><span class="Z3988" title="private">metadata</span><img src="x" onerror="bad()"></div>';
      },
    },
    getMainWindow: () => dom.window,
    locale: "en-US",
  };
  globalThis.addon = {
    data: {
      locale: {
        current: { formatMessagesSync: ([entry]) => [{ value: entry.id }] },
      },
    },
  };
  const bibliography = await import(
    pathToFileURL(join(root, "bibliography.mjs"))
  );
  const html = await bibliography.getSourceBibliography("ITEM0001", 1);
  assert.match(html, /<i>Title<\/i>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /metadata|Z3988|script|onerror|style=/);
  assert.equal(released, 1);
  fails = true;
  await assert.rejects(
    bibliography.getSourceBibliography("ITEM0001", 1),
    /CSL failure/,
  );
  assert.equal(released, 2);
  preference = "missing-style";
  await assert.rejects(
    bibliography.getSourceBibliography("ITEM0001", 1),
    /source-style-missing/,
  );
  console.log(
    "PASS CSL emphasis and links survive sanitization; removed metadata and failed renders release engines",
  );

  dom.window.eval(await readFile("addon/content/markdown.js", "utf8"));
  let completeOld;
  const api = {
    loc: (key) => key,
    getSourceBibliography: (key) =>
      key === "OLD"
        ? new Promise((resolve) => {
            completeOld = resolve;
          })
        : Promise.resolve('<div class="csl-entry">New <i>source</i></div>'),
    selectItem: async () => {},
  };
  const container = dom.window.document.getElementById("source");
  const old = dom.window.ZoteroKnowledgeBaseMarkdown.source(
    container,
    { key: "OLD", title: "Old", libraryID: 1 },
    api,
  );
  await dom.window.ZoteroKnowledgeBaseMarkdown.source(
    container,
    { key: "NEW", title: "New", libraryID: 1 },
    api,
  );
  completeOld("Old source");
  await old;
  assert.equal(container.textContent, "New source");
  assert.ok(container.querySelector("i"));
  assert.equal(container.getAttribute("role"), "link");
  console.log("PASS Slow Source rendering cannot overwrite a newer source");
} finally {
  await rm(root, { recursive: true, force: true });
}
