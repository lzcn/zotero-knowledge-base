/** Measure populated-library startup and opening in a disposable real Zotero. */
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

const count = Number(process.env.KB_STARTUP_NOTES || 500);
if (!Number.isSafeInteger(count) || count < 10 || count > 2000)
  throw new Error("KB_STARTUP_NOTES must be between 10 and 2000");
const root = await mkdtemp(join(tmpdir(), "knowledge-base-startup-"));
const profile = join(root, "profile");
const data = join(root, "data");
const seeded = join(root, "seeded.json");
const output = join(root, "result.json");
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
const bundlePath = "content/scripts/knowledge-base.js";
const bundle = strFromU8(files[bundlePath]);
const step = "step = name;\n        await run();";
if (!bundle.includes(step)) throw new Error("Missing startup step boundary");
files[bundlePath] = strToU8(
  bundle.replace(
    step,
    `step = name;
        const measureStarted = Date.now();
        await run();
        (Zotero.__kbStartupSteps ||= []).push({name,ms:Date.now()-measureStarted});`,
  ),
);
files["content/editor.js"] = strToU8(
  strFromU8(files["content/editor.js"]) +
    `
for (const name of ['loadEditor','refreshRelations','refreshHealth','setEditorMode','ensureRichEditor','refreshParentItem','refreshNoteTags','refreshSourceDisplay']) {
  const original=window[name];
  window[name]=async function(...args) {
    const start=Date.now();
    try {return await original.apply(this,args);} finally {(Zotero.__kbOpeningSteps ||= []).push({name,ms:Date.now()-start});}
  };
}
const originalCreate=window.KnowledgeBaseNativeEditor.create;
window.KnowledgeBaseNativeEditor.create=async function(...args) {
  const start=Date.now();
  try {return await originalCreate.apply(this,args);} finally {(Zotero.__kbOpeningSteps ||= []).push({name:'nativeEditorCreate',ms:Date.now()-start});}
};
`,
);
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
const bootstrap = strFromU8(files["bootstrap.js"]);
if (!bootstrap.includes(trigger)) throw new Error("Missing startup hook");
files["bootstrap.js"] = strToU8(
  bootstrap.replace(
    trigger,
    `const measureStarted = Date.now();
  ${trigger}
  Zotero.__kbStartupMs = Date.now()-measureStarted;
  benchmarkStartup();`,
  ) +
    `
function benchmarkStartup() {
  const {setTimeout} = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const run = async () => {
    try {
      const kb=Zotero.ZoteroKnowledgeBase, api=kb.api, main=Zotero.getMainWindow();
      if(!main?.document.getElementById('knowledge-base-menu-open-manager'))throw new Error('Startup did not register Knowledge Base');
      if(!(await IOUtils.exists(${JSON.stringify(seeded)}))) {
        const source=new Zotero.Item('journalArticle');source.libraryID=Zotero.Libraries.userLibraryID;source.setField('title','Startup benchmark source');await source.saveTx();
        const notes=[];
        await Zotero.DB.executeTransaction(async()=>{
          for(let i=0;i<${count};i++) {
            const note=new Zotero.Item('note');note.libraryID=source.libraryID;note.parentItemID=source.id;
            const id='benchmark-'+String(i).padStart(5,'0'),title='Benchmark note '+i;
            const body='An atomic research claim with conditions, evidence and Chinese text 中文笔记。 '.repeat(80).trim();
            note.setNote('<div data-schema-version="2"><h1>'+title+'</h1><p>'+body+'</p></div>');
            await note.save({skipSelect:true});notes.push({id,title,body,key:note.key,libraryID:note.libraryID});
          }
        });
        const {Sqlite}=ChromeUtils.importESModule('resource://gre/modules/Sqlite.sys.mjs');
        const connection=await Sqlite.openConnection({path:PathUtils.join(Zotero.DataDirectory.dir,'knowledge-base.sqlite')});
        try {
          await connection.executeTransaction(async()=>{
            for(const note of notes) {
              await connection.execute('INSERT INTO zettels(id,title,title_folded,body,item_key,library_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[note.id,note.title,note.title.toLowerCase(),note.body,source.key,source.libraryID,1,1]);
              await connection.execute('INSERT INTO card_notes(card_id,note_key,library_id,original_body) VALUES(?,?,?,?)',[note.id,note.key,note.libraryID,note.body]);
              await connection.execute('INSERT INTO card_parents(card_id,parent_id) VALUES(?,NULL)',[note.id]);
            }
          });
        } finally {await connection.close();}
        await IOUtils.writeUTF8(${JSON.stringify(seeded)},JSON.stringify({sourceID:source.id,notes}));
      } else {
        const fixture=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(seeded)}));
        const result={notes:fixture.notes.length,startupMs:Zotero.__kbStartupMs,steps:Zotero.__kbStartupSteps};
        const started=Date.now();api.openManager({selectId:fixture.notes[0].id});
        let manager,editor,firstRowsMs;
        for(let i=0;i<800;i++) {
          manager=main.document.querySelector('.knowledge-base-workbench')?.contentWindow;
          if(manager?.document.querySelector('.zettel-row') && firstRowsMs===undefined)firstRowsMs=Date.now()-started;
          editor=manager?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
          if(editor?.knowledgeBaseCardId===fixture.notes[0].id && editor.document.readyState==='complete') {await editor.knowledgeBaseReady();break;}
          await pause(10);
        }
        if(editor?.knowledgeBaseCardId!==fixture.notes[0].id || !editor.eval('richEditor && !noteUnavailable && !libraryReadOnly && !recoveryPending'))throw new Error('Workbench did not load an editable original');
        result.firstRowsMs=firstRowsMs;result.editorReadyMs=Date.now()-started;result.openingSteps=Zotero.__kbOpeningSteps;
        for(let i=0;i<800 && !editor.document.querySelector('#knowledge-base-src-display .csl-entry');i++)await pause(10);
        if(!editor.document.querySelector('#knowledge-base-src-display .csl-entry'))throw new Error('Source bibliography did not finish');
        result.sourceReadyMs=Date.now()-started;
        result.auditMs=[];
        for(let i=0;i<3;i++){const start=Date.now();await api.auditNativeNotes();result.auditMs.push(Date.now()-start);}
        const page=await api.searchZettelSummaries('',{limit:500});
        if(page.items.length!==Math.min(${count},500))throw new Error('Startup lost note summaries');
        if((await api.getZettel(fixture.notes[0].id)).body!==fixture.notes[0].body)throw new Error('Startup changed note content');
        await IOUtils.writeUTF8(${JSON.stringify(output)},JSON.stringify(result));
      }
    } catch(error) {await IOUtils.writeUTF8(${JSON.stringify(output)},JSON.stringify({error:String(error),stack:error.stack}));}
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  };
  setTimeout(run,0);
}
`,
);
await writeFile(
  join(profile, "extensions/knowledge-base@lzcn.xpi"),
  zipSync(files),
);
let passed = false;
try {
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const log = await open(join(root, `zotero-${run}.log`), "w");
    const child = spawn(
      process.env.ZOTERO_BINARY ||
        "/Applications/Zotero.app/Contents/MacOS/zotero",
      ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
      { stdio: ["ignore", log.fd, log.fd] },
    );
    let timer;
    try {
      const code = await Promise.race([
        new Promise((resolve, reject) => {
          child.once("exit", resolve);
          child.once("error", reject);
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Startup benchmark timed out")),
            180000,
          );
        }),
      ]);
      if (code !== 0) throw new Error("Zotero exited with code " + code);
      if (run) {
        const result = JSON.parse(await readFile(output, "utf8"));
        if (result.error) throw new Error(JSON.stringify(result));
        runs.push(result);
      }
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      await log.close();
    }
  }
  console.log(JSON.stringify({ runs }, null, 2));
  if (process.env.KB_STARTUP_BENCHMARK_OUTPUT)
    await writeFile(
      resolve(process.env.KB_STARTUP_BENCHMARK_OUTPUT),
      JSON.stringify({ runs }, null, 2) + "\n",
    );
  passed = true;
} finally {
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error("Benchmark profile retained at " + root);
}
