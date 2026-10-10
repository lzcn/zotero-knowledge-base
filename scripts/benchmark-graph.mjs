/** Compare graph renderers on the same Mac/host/geometry in disposable data. */
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  open,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const root = await mkdtemp(join(tmpdir(), "knowledge-base-graph-benchmark-"));
const profile = join(root, "profile"),
  data = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
const preferences = {
  "extensions.zotero.dataDir": data,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "app.update.auto": false,
  "extensions.update.enabled": false,
  "extensions.zotero.automaticScraperUpdates": false,
};
await writeFile(
  join(profile, "user.js"),
  Object.entries(preferences)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const bundle = await build({
  entryPoints: [resolve("src/ui/graph-canvas.ts")],
  bundle: true,
  format: "iife",
  globalName: "GraphBenchmark",
  write: false,
});
const files = unzipSync(
  await readFile(resolve("dist/zotero-knowledge-base.xpi")),
);
files["content/graph-benchmark.js"] = bundle.outputFiles[0].contents;
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
if (!strFromU8(files["bootstrap.js"]).includes(trigger))
  throw new Error("Missing startup hook");
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]).replace(
    trigger,
    trigger + "\n benchmarkGraph();",
  ) +
    `
function benchmarkGraph() {
  const {setTimeout}=ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const run=async()=>{
    const win=Zotero.getMainWindow();
    if(!win?.document.getElementById("knowledge-base-menu-open-manager")){setTimeout(run,250);return;}
    try {
      Services.scriptloader.loadSubScript("chrome://knowledge-base/content/graph-benchmark.js",win);
      const host=win.document.createElementNS("http://www.w3.org/1999/xhtml","div");
      host.style.cssText="position:fixed;inset:0;width:1000px;height:700px;z-index:99999;background:white";
      win.document.documentElement.append(host);win.focus();
      const canvas=()=>{
        const element=win.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
        element.style.cssText="position:absolute;inset:0;width:1000px;height:700px;pointer-events:none";
        host.append(element);return element;
      };
      const gpu=canvas(), paint=canvas();
      const style={getPropertyValue:name=>({"--bg":"#ffffff","--fg":"#303035","--accent":"#2469c9","--source":"#268572","--muted":"#6e6e73","--graph-link":"#929daa"}[name]),fontFamily:"system-ui"};
      const nodes=Array.from({length:1200},(_,i)=>({id:String(i),title:"Note "+i,kind:i%50===0?"source":"card",radius:6+i%5,color:["#2469c9","#30a46c","#aa22cc"][i%3],x:Math.cos(i*2.39996)*Math.sqrt(i)*9,y:Math.sin(i*2.39996)*Math.sqrt(i)*9}));
      const edges=nodes.flatMap((node,i)=>[1,7].map(step=>({source:node,target:nodes[(i+step)%nodes.length],kind:i%17===0?"source":i%13===0?"parent":"link"})));
      const labels=new Map(nodes.filter((_,i)=>i%120===0).map(node=>[node.id,{text:node.title,visible:true}]));
      const frame=()=>new Promise(resolve=>win.requestAnimationFrame(resolve));
      const summarize=values=>({mean:values.reduce((a,b)=>a+b)/values.length,p95:[...values].sort((a,b)=>a-b)[Math.floor(values.length*0.95)],max:Math.max(...values)});
      async function measure(accelerated) {
        const renderer=win.GraphBenchmark.createGraphCanvas(paint,style,accelerated?gpu:undefined);
        if(!accelerated)gpu.hidden=true;
        const drawTimes=[], intervals=[];let last=await frame();
        for(let i=0;i<42;i++){
          const now=await frame();if(i>=6)intervals.push(now-last);last=now;
          const started=win.performance.now();
          renderer.draw(nodes,edges,{x:500+Math.sin(i/8)*25,y:350,k:0.85},labels,"12","12",new Set(),true);
          if(i>=6)drawTimes.push(win.performance.now()-started);
        }
        const gl=accelerated?gpu.getContext("webgl2"):null;
        let pixels;
        if(gl){const buffer=new Uint8Array(gpu.width*gpu.height*4);gl.readPixels(0,0,gpu.width,gpu.height,gl.RGBA,gl.UNSIGNED_BYTE,buffer);pixels=buffer.some((v,i)=>i%4===3&&v);if(!pixels)throw new Error("GPU renderer produced no pixels");}
        const result={backend:renderer.backend,drawMs:summarize(drawTimes),frameMs:summarize(intervals),pixels};
        renderer.dispose();return result;
      }
      const canvasBefore=await measure(false);
      const accelerated=await measure(true);
      const canvasAfter=await measure(false);
      const gl=gpu.getContext("webgl2");const debug=gl?.getExtension("WEBGL_debug_renderer_info");
      await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({nodes:nodes.length,edges:edges.length,zotero:Zotero.version,renderer:gl?(debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null,canvasBefore,accelerated,canvasAfter}));
      host.remove();
    } catch(error){await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({error:String(error),stack:error.stack}));}
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  };setTimeout(run,250);
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
        () => reject(new Error("Graph benchmark timed out")),
        60000,
      );
    }),
  ]);
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (code !== 0 || result.error) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.KB_GRAPH_BENCHMARK_OUTPUT)
    await writeFile(
      resolve(process.env.KB_GRAPH_BENCHMARK_OUTPUT),
      JSON.stringify(result, null, 2) + "\n",
    );
  passed = true;
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) child.kill("SIGKILL");
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error(`Test profile retained at ${root}`);
}
