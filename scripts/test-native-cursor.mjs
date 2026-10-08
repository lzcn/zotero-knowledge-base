/** Compare native formula navigation and scrolling around Markdown integration. */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const root = await mkdtemp(join(tmpdir(), "knowledge-base-cursor-"));
const profile = join(root, "profile"),
  data = join(root, "data"),
  marker = join(root, "result.json");
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
    "app.update.auto": false,
    "extensions.update.enabled": false,
    "extensions.zotero.automaticScraperUpdates": false,
  })
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const files = unzipSync(await readFile("dist/zotero-knowledge-base.xpi"));
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
const bootstrap = strFromU8(files["bootstrap.js"]);
if (!bootstrap.includes(trigger)) throw new Error("Missing startup hook");
files["bootstrap.js"] = strToU8(
  bootstrap.replace(
    trigger,
    'ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs").setTimeout(runCursorTest, 1000);',
  ) +
    `
async function runCursorTest() {
  const {setTimeout} = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const wait = async fn => {for(let n=0;n<200;n++){const value=fn();if(value)return value;await pause(25);}throw new Error("Cursor fixture timeout: "+fn.toString());};
  const result = {version:Zotero.version, stages:[]};
  try {
    await Zotero.uiReadyPromise;
    async function probe(stage, toggleMode) {
      const item = new Zotero.Item("note"); item.libraryID = Zotero.Libraries.userLibraryID;
      item.setNote('<div data-schema-version="9"><p><span class="math">$x^2$</span> tail</p><p>Plain text</p><pre class="math">$$y^2$$</pre><p>After block</p>' + Array.from({length:45},(_,i)=>'<p>Scrolling paragraph '+i+'</p>').join('') + '<pre class="math">$$C_K = 1$$</pre><p>End marker</p></div>');
      await item.saveTx({skipSelect:true});
      let instance = await Zotero.Notes.open(item.id,null,{openInWindow:true});
      await instance._initPromise;
      const win = instance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
      win.resizeTo(720,800);await pause(200);
      if (stage !== "baseline") await wait(()=>win.document.querySelector('.knowledge-base-native-source'));
      if (toggleMode) {
        await wait(()=>instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle'));
        const clickToggle = () => instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle').click();
        clickToggle(); await wait(()=>instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle')?.getAttribute('aria-pressed')==='true' && win.document.querySelector('.knowledge-base-native-source')?.setSelectionRange);
        const source=win.document.querySelector('.knowledge-base-native-source');
        const sourceFrame=source.querySelector('iframe').contentWindow;
        const sourceDoc=sourceFrame.document;
        const sourceScroller=sourceDoc.querySelector('.cm-scroller');
        const sourceContent=sourceDoc.querySelector('.cm-content');
        const nativeFrame=instance._iframeWindow;
        const nativeStyle=nativeFrame.getComputedStyle(nativeFrame.document.querySelector('.primary-editor'));
        const sourceStyle=sourceFrame.getComputedStyle(sourceScroller);
        if(sourceStyle.fontFamily!==nativeStyle.fontFamily || sourceStyle.fontSize!==nativeStyle.fontSize) throw new Error('Markdown typography does not follow the native note: '+JSON.stringify({source:sourceStyle.fontFamily+' '+sourceStyle.fontSize,native:nativeStyle.fontFamily+' '+nativeStyle.fontSize}));
        const sourceEnd=async ()=>{sourceScroller.scrollTop=sourceScroller.scrollHeight;await pause(150);};
        const sourceMetrics=()=>({viewport:sourceFrame.innerHeight,padding:parseFloat(sourceFrame.getComputedStyle(sourceContent).paddingBottom),gap:sourceScroller.getBoundingClientRect().bottom-sourceDoc.querySelector('.cm-line:last-child').getBoundingClientRect().bottom});
        await sourceEnd();
        const sourceInitial=sourceMetrics();
        if(Math.abs(sourceInitial.padding-sourceInitial.viewport/2)>2 || Math.abs(sourceInitial.gap-sourceInitial.viewport/2)>4) throw new Error('Markdown end-space is not half its viewport: '+JSON.stringify(sourceInitial));
        win.resizeTo(win.outerWidth,win.outerHeight-120);await pause(200);await sourceEnd();
        const sourceResized=sourceMetrics();
        if(Math.abs(sourceResized.padding-sourceResized.viewport/2)>2 || Math.abs(sourceResized.gap-sourceResized.viewport/2)>4) throw new Error('Markdown end-space did not follow resize: '+JSON.stringify(sourceResized));
        const originalSource=source.value,sourceNoteHTML=item.getNote();
        source.setSelectionRange(8,11);
        const readingSelection={start:source.selectionStart,end:source.selectionEnd,scroll:source.scrollTop};
        const toolbar=nativeFrame.document.querySelector('.toolbar');
        const readingButton=toolbar.querySelector('.knowledge-base-reading-toggle');
        readingButton.click();await wait(()=>readingButton.getAttribute('aria-pressed')==='true');
        const readingPanel=nativeFrame.document.querySelector('.knowledge-base-reading-view');
        if(!source.hidden || !readingPanel.querySelector('.katex-display') || readingPanel.querySelector('[contenteditable]') || nativeFrame.document.querySelector('.toolbar')!==toolbar || item.getNote()!==sourceNoteHTML) throw new Error('Reading changed native storage/toolbar or did not render display formulas');
        readingButton.click();
        if(source.hidden || source.value!==originalSource || JSON.stringify({start:source.selectionStart,end:source.selectionEnd,scroll:source.scrollTop})!==JSON.stringify(readingSelection)) throw new Error('Reading lost source text, selection or scroll');
        result.source={initial:sourceInitial,resized:sourceResized,typography:true,readingPreserved:true};
        source.value += '\\n\\nRoundtrip saved';
        source.dispatchEvent(new win.Event('input',{bubbles:true}));
        source.dispatchEvent(new win.KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true}));
        await wait(()=>item.getNote().includes('Roundtrip saved') && win.document.querySelector('.knowledge-base-native-status').textContent===Zotero.ZoteroKnowledgeBase.api.loc('editor-saved'));
        clickToggle();
        const element=win.document.querySelector('note-editor');
        await wait(()=>element.getCurrentInstance()!==instance);
        instance = element.getCurrentInstance(); await instance._initPromise;
        await wait(()=>instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle')?.getAttribute('aria-pressed')==='false');
      }
      const frame=instance._iframeWindow, doc=frame.document;
      const nativeData=()=>frame.wrappedJSObject.getDataSync(true)||{html:item.getNote()};
      const surface=await wait(()=>doc.querySelector('.primary-editor') || doc.querySelector('.ProseMirror'));
      const exits=[];
      for (const selector of ['math-inline','math-display']) {
        const math=surface.querySelector(selector);
        const bounds=math.getBoundingClientRect();
        for(const type of ['mousedown','mouseup','click']) math.dispatchEvent(new frame.MouseEvent(type,{bubbles:true,cancelable:true,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2}));
        const mathView=math.wrappedJSObject.pmViewDesc.spec;
        await wait(()=>mathView._innerView);
        const inner=mathView._innerView, outer=mathView._outerView;
        const Selection=inner.state.selection.constructor;
        inner.dispatch(inner.state.tr.setSelection(Selection.create(inner.state.doc,0)));
        win.focus();inner.focus();await pause(80);
        inner.dom.dispatchEvent(new frame.KeyboardEvent('keydown',{key:'ArrowLeft',keyCode:37,which:37,bubbles:true,cancelable:true}));
        await pause(80);
        const expected = Selection.near(outer.state.doc.resolve(mathView._getPos()),-1).from;
        const exit={selector,expected,position:outer.state.selection.from,editing:mathView._isEditing,focused:outer.hasFocus()};
        exits.push(exit);
        if(exit.position!==exit.expected || exit.editing || !exit.focused) throw new Error('Formula left boundary failed: '+JSON.stringify(exit));
        if(selector==='math-inline') {
          if(!doc.execCommand('insertText',false,'L')) throw new Error('Line-start native typing failed');
          await pause(100);
          const html=frame.wrappedJSObject.getDataSync(true)?.html || item.getNote();
          if(!html.includes('<p>L<span class="math">$x^2$</span>')) throw new Error('Caret did not reach the beginning of the math paragraph: '+html);
        }
      }
      const scroller = doc.querySelector('.editor-core');
      const htmlBeforeScroll = nativeData().html;
      const scrollEnd = async () => {scroller.scrollTop=scroller.scrollHeight;await pause(100);};
      const metrics = () => ({viewport:frame.innerHeight,scrollHeight:scroller.scrollHeight,scrollTop:scroller.scrollTop,gap:scroller.getBoundingClientRect().bottom-surface.lastElementChild.getBoundingClientRect().bottom});
      await scrollEnd();
      const initial = metrics();
      const expectedGap = stage === 'baseline' ? 20 : frame.innerHeight/2;
      if(Math.abs(initial.gap-expectedGap)>3) throw new Error('Native end-space mismatch: '+JSON.stringify({stage,expectedGap,initial}));
      win.resizeTo(win.outerWidth,Math.max(420,win.outerHeight-160));
      await pause(200);await scrollEnd();
      const resized=metrics(), resizedGap=stage==='baseline'?20:frame.innerHeight/2;
      if(Math.abs(resized.viewport-initial.viewport)<50) throw new Error('Scroll fixture window did not resize');
      if(Math.abs(resized.gap-resizedGap)>3) throw new Error('Native end-space did not follow resize: '+JSON.stringify({stage,resizedGap,resized}));
      Zotero.Utilities.Internal.activate(win);
      win.focus();frame.focus();surface.focus();await pause(150);await scrollEnd();
      const bounds=scroller.getBoundingClientRect(), previousTop=scroller.scrollTop;
      frame.windowUtils.sendWheelEvent(bounds.left+bounds.width/2,bounds.top+bounds.height/3,0,-120,0,0,0,0,-3,0);
      try { await wait(()=>scroller.scrollTop<previousTop); }
      catch(error) {throw new Error('Wheel scroll failed: '+JSON.stringify({stage,metrics:metrics(),previousTop,rect:bounds.toJSON(),hit:doc.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/3)?.outerHTML.slice(0,300),readerHidden:doc.querySelector('.knowledge-base-reading-view')?.hidden,readerDisplay:doc.querySelector('.knowledge-base-reading-view')&&frame.getComputedStyle(doc.querySelector('.knowledge-base-reading-view')).display,focused:doc.hasFocus()})+' '+error);}
      const wheelTop=scroller.scrollTop;
      await scrollEnd();
      if(nativeData().html!==htmlBeforeScroll) throw new Error('Native scrolling changed note HTML');
      const endingMath=[...surface.querySelectorAll('math-display')].at(-1);
      endingMath.scrollIntoView({block:'center'});await pause(100);
      const endingBounds=endingMath.getBoundingClientRect();
      if(endingBounds.bottom>scroller.getBoundingClientRect().bottom || endingBounds.top<scroller.getBoundingClientRect().top) throw new Error('Ending formula is outside the viewport');
      for(const type of ['mousedown','mouseup','click']) endingMath.dispatchEvent(new frame.MouseEvent(type,{bubbles:true,cancelable:true,clientX:endingBounds.x+endingBounds.width/2,clientY:endingBounds.y+endingBounds.height/2}));
      const endingView=endingMath.wrappedJSObject.pmViewDesc.spec;
      await wait(()=>endingView._innerView);
      endingView._innerView.dom.dispatchEvent(new frame.KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
      surface.focus();
      const range=doc.createRange();range.selectNodeContents(surface.lastElementChild);range.collapse(false);
      const selection=frame.getSelection();selection.removeAllRanges();selection.addRange(range);
      if(!doc.execCommand('insertText',false,' End inserted')) throw new Error('Native last-line typing failed');
      await pause(100);
      const savedData=JSON.parse(JSON.stringify(nativeData()));
      await instance._save(savedData);
      if(!item.getNote().includes(' End inserted')) throw new Error('Native last-line edit was not saved');
      if(item.getNote()!==savedData.html) throw new Error('Native save added scroll-space content');
      let cleaned=false;
      if(stage==='roundtrip') {
        await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
        await scrollEnd();
        if(Math.abs(metrics().gap-20)>3 || nativeData().html!==savedData.html) throw new Error('Plugin shutdown did not remove native end-space cleanly');
        cleaned=true;
      }
      result.stages.push({stage,exits,scroll:{initial,resized,wheelTop,saved:true,cleaned}});
      win.close();await pause(100);
    }
    await probe('baseline',false);
    await Zotero.ZoteroKnowledgeBase.hooks.onStartup();
    await probe('enabled',false);
    await probe('roundtrip',true);
    result.ok=true;
  } catch(error){result.error=String(error)+'\\n'+error.stack;}
  await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify(result));
  Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
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
const timeout = setTimeout(() => child.kill("SIGTERM"), 45000);
try {
  await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const result = JSON.parse(await readFile(marker, "utf8"));
  console.log(JSON.stringify(result, null, 2));
  console.log(`Cursor fixture: ${root}`);
  if (!result.ok) throw new Error(result.error);
  console.log(
    "PASS Native and Markdown end-space resizing, typography and body-only Reading preservation; native math navigation, upward wheel scrolling and last-line saving before integration, with integration, and after a Markdown round trip.",
  );
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  await log.close();
}
