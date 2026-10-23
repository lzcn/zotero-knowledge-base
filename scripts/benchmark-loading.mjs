/** Measure workbench loading and repeated audits in a disposable Zotero library. */
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const root = await mkdtemp(join(tmpdir(), "knowledge-base-loading-"));
const profile = join(root, "profile");
const data = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
await writeFile(
  join(profile, "user.js"),
  Object.entries({
    "extensions.zotero.dataDir": data,
    "extensions.zotero.useDataDir": true,
    "extensions.zotero.firstRun2": false,
    "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 15,
    "extensions.zotero.automaticScraperUpdates": false,
    "app.update.auto": false,
    "extensions.update.enabled": false,
  })
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)},${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const files = unzipSync(
  await readFile(resolve(process.argv[2] || "dist/zotero-knowledge-base.xpi")),
);
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
const bootstrap = strFromU8(files["bootstrap.js"]);
if (!bootstrap.includes(trigger)) throw new Error("Missing startup hook");
files["bootstrap.js"] = strToU8(
  bootstrap.replace(trigger, trigger + "\n benchmarkLoading();") +
    `
function benchmarkLoading() {
  const {setTimeout} = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const run = async () => {
    try {
      const plugin = Zotero.ZoteroKnowledgeBase;
      const api = plugin.api;
      const win = Zotero.getMainWindow();
      const now = () => win.performance.now();
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Loading benchmark source");
      item.setField("date", "2026");
      await item.saveTx();
      const ids = [];
      for (let n=0;n<100;n++) ids.push(await api.saveZettel({title:"Benchmark note "+n,body:"",itemKey:item.key,libraryID:item.libraryID}));
      for (let n=0;n<ids.length;n++) {
        const body = ("A source-backed idea with equations $x^2$ and Chinese text 中文笔记。 ".repeat(40)+"\\n\\n").repeat(4)+"[["+ids[(n+1)%ids.length]+"]]";
        await api.saveZettel({id:ids[n],title:"Benchmark note "+n,body,itemKey:item.key,libraryID:item.libraryID});
        const native = await api.acquireNativeNote({id:ids[n],title:"",body:""});
        await api.releaseNativeNote(native.noteID);
      }
      await api.auditNativeNotes();
      const audits = [];
      for(let n=0;n<3;n++) { const start=now(); await api.auditNativeNotes(); audits.push(now()-start); }
      const tagVocabulary = [];
      for(let n=0;n<3;n++) { const start=now(); await api.getGraphTags(); tagVocabulary.push(now()-start); }
      const originalGet = Zotero.Styles.get;
      let engines = 0;
      Zotero.Styles.get = function(...args) {
        const style = originalGet.apply(this,args);
        return style ? new Proxy(style,{get(target,key){
          return key === "getCiteProc" ? (...args)=>{engines++;return target.getCiteProc(...args);} : Reflect.get(target,key);
        }}) : style;
      };
      const start=now();
      api.setWorkbenchMode("window");
      api.openManager({selectId:ids[0]});
      let manager, editor;
      for(let n=0;n<400;n++) {
        const host=[...Services.wm.getEnumerator("knowledge-base:workbench")][0];
        manager=host?.document.getElementById("knowledge-base-window-browser")?.contentWindow;
        editor=manager?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
        if(editor?.knowledgeBaseCardId===ids[0] && editor.document.getElementById("knowledge-base-editor-root")?.dataset.mode==="visual") break;
        await delay(25);
      }
      if(editor?.knowledgeBaseCardId!==ids[0]) throw new Error("Workbench did not load");
      await editor.knowledgeBaseReady();
      const workbenchMs=now()-start;
      const workbenchEngines=engines;
      engines=0;
      const renderStart=now();
      await Promise.all(Array.from({length:3},()=>api.getSourceBibliography(item.key,item.libraryID)));
      const sourceMs=now()-renderStart;
      Zotero.Styles.get = originalGet;
      await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({notes:ids.length,auditsMs:audits,tagVocabularyMs:tagVocabulary,workbenchMs,workbenchEngines,threeSourceRendersMs:sourceMs,threeSourceEngines:engines}));
    } catch(error) { await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({error:String(error),stack:error.stack})); }
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  };
  setTimeout(run,250);
}
`,
);
await writeFile(
  join(profile, "extensions/knowledge-base@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero",
  ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
  { stdio: ["ignore", log.fd, log.fd] },
);
let timer,
  passed = false;
try {
  const code = await Promise.race([
    new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Loading benchmark timed out")),
        180000,
      );
    }),
  ]);
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (code !== 0 || result.error) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.KB_LOADING_BENCHMARK_OUTPUT)
    await writeFile(
      resolve(process.env.KB_LOADING_BENCHMARK_OUTPUT),
      JSON.stringify(result, null, 2) + "\n",
    );
  passed = true;
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) child.kill("SIGKILL");
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error("Benchmark profile retained at " + root);
}
