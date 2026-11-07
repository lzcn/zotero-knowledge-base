/** Run the real host against disposable profile/data directories. */
import { Script } from "node:vm";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  access,
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const binary =
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero";
await access(binary);
const args = process.argv.slice(2);
const settingsOnly = args.includes("--settings");
const graphViewsOnly = args.includes("--graph-views");
const noteTypesOnly = args.includes("--note-types");
const readerToolbarOnly = args.includes("--reader-toolbar");
const readingViewOnly = args.includes("--reading-view");
const mathOnly = args.includes("--math");
const textToolsOnly = args.includes("--text-tools");
const workbenchOnly = args.includes("--workbench");
const metadataOnly = args.includes("--metadata");
const viewsOnly = args.includes("--views");
const retiredOnly = args.includes("--retired-features");
const editingHost =
  mathOnly ||
  readingViewOnly ||
  settingsOnly ||
  graphViewsOnly ||
  noteTypesOnly ||
  textToolsOnly ||
  workbenchOnly ||
  metadataOnly ||
  viewsOnly ||
  retiredOnly
    ? (
        await readFile(
          new URL(
            mathOnly
              ? "./math-host.mjs"
              : readingViewOnly
                ? "./reading-view-host.mjs"
                : settingsOnly
                  ? "./settings-host.mjs"
                  : graphViewsOnly
                    ? "./graph-views-host.mjs"
                    : noteTypesOnly
                      ? "./note-types-host.mjs"
                      : retiredOnly
                        ? "./retired-features-host.mjs"
                        : viewsOnly
                          ? "./views-host.mjs"
                          : metadataOnly
                            ? "./metadata-host.mjs"
                            : workbenchOnly
                              ? "./workbench-host.mjs"
                              : "./text-tools-host.mjs",
            import.meta.url,
          ),
          "utf8",
        )
      ).replace("export default ", "")
    : "";
const contextOnly = args.includes("--context-menu");
const trashOnly = args.includes("--trash");
const appearanceOnly = args.includes("--appearance");
const toolbarOnly = args.includes("--toolbar");
const templatesOnly = args.includes("--templates");
const linksOnly = args.includes("--links");
const relationsOnly = args.includes("--relations");
const connectionsOnly =
  mathOnly ||
  readingViewOnly ||
  settingsOnly ||
  args.includes("--retired-features") ||
  linksOnly ||
  relationsOnly ||
  templatesOnly ||
  toolbarOnly ||
  appearanceOnly ||
  graphViewsOnly ||
  noteTypesOnly ||
  trashOnly ||
  contextOnly ||
  readerToolbarOnly ||
  textToolsOnly ||
  workbenchOnly ||
  metadataOnly ||
  viewsOnly;
const xpi = resolve(
  args.find((arg) => !arg.startsWith("--")) || "dist/zotero-knowledge-base.xpi",
);
const files = unzipSync(await readFile(xpi));
const root = await mkdtemp(join(tmpdir(), "knowledge-base-quit-"));
const profile = join(root, "profile");
const data = join(root, "data");
const hostTemp = join(root, "tmp");
const marker = join(root, "result.json");
const restartMarker = join(root, "restart.json");
const fakeAI = join(root, "fake-ai-cli");
const aiRequests = join(root, "ai-requests.jsonl");
await writeFile(
  fakeAI,
  `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(aiRequests)}, "unexpected legacy AI call\\n");
process.exit(1);
`,
  { mode: 0o700 },
);
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
await mkdir(hostTemp);
const readerPDF = join(root, "reader.pdf");
if (readerToolbarOnly || readingViewOnly || mathOnly) {
  const stream =
    "BT /F1 16 Tf 40 775 Td (Knowledge Base reader toolbar) Tj ET\nq 240 0 0 120 40 640 cm /Figure Do Q\nBT /F1 12 Tf 40 620 Td (Figure 1: embedded color image) Tj ET";
  const image =
    Array.from({ length: 80 * 40 }, (_, i) => {
      const x = i % 80,
        y = Math.floor(i / 80);
      return x < 40
        ? y < 20
          ? "e04030"
          : "30b060"
        : y < 20
          ? "3060e0"
          : "e0a030";
    }).join("") + ">";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Figure 6 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
    `<< /Type /XObject /Subtype /Image /Width 80 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += index + 1 + " 0 obj\n" + object + "\nendobj\n";
  });
  const xref = pdf.length;
  pdf +=
    "xref\n0 7\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF\n";
  await writeFile(readerPDF, pdf);
}
if (noteTypesOnly) {
  const legacy = new DatabaseSync(join(data, "knowledge-base.sqlite"));
  legacy.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('schemaVersion','12');
    CREATE TABLE zettels(id TEXT PRIMARY KEY,title TEXT NOT NULL DEFAULT '',title_folded TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',item_key TEXT,library_id INTEGER,annotation_key TEXT,custom_key TEXT,source_note INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX idx_literature_source ON zettels(library_id,item_key) WHERE source_note=1;
    CREATE TABLE tags(zettel_id TEXT NOT NULL,tag TEXT NOT NULL,UNIQUE(zettel_id,tag));
    CREATE TABLE card_parents(card_id TEXT PRIMARY KEY,parent_id TEXT,CHECK(card_id<>parent_id));
    CREATE TABLE links(source_id TEXT NOT NULL,target_id TEXT,ref TEXT NOT NULL,ref_folded TEXT NOT NULL DEFAULT '',UNIQUE(source_id,ref));
    CREATE TABLE card_notes(card_id TEXT PRIMARY KEY,note_key TEXT NOT NULL,library_id INTEGER NOT NULL,original_body TEXT NOT NULL,external INTEGER NOT NULL DEFAULT 0,UNIQUE(note_key,library_id));
    CREATE TABLE note_keys(key TEXT PRIMARY KEY,card_id TEXT NOT NULL);
    CREATE TABLE editor_drafts(id TEXT PRIMARY KEY,body TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE note_save_operations(id TEXT PRIMARY KEY,card_id TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL);
    INSERT INTO zettels VALUES('legacy-reading','Reading','reading','Original reading body','OLDPAPER',1,NULL,NULL,1,1,1);
    INSERT INTO zettels VALUES('legacy-thinking','Thinking','thinking','Original thinking body',NULL,NULL,NULL,'OldProject',0,2,2);
    INSERT INTO zettels VALUES('legacy-zettel','Idea','idea','Original idea body',NULL,NULL,NULL,NULL,0,3,3);
    INSERT INTO zettels VALUES('legacy-ordinary','Unclassified','unclassified','Original unclassified body',NULL,NULL,NULL,NULL,0,4,4);
    INSERT INTO tags VALUES('legacy-reading','Existing tag'),('legacy-reading','Literature Note'),('legacy-zettel','Zettel');
    INSERT INTO card_parents VALUES('legacy-reading',NULL),('legacy-thinking','legacy-reading'),('legacy-zettel',NULL);
    INSERT INTO links VALUES('legacy-thinking','legacy-reading','legacy-reading','legacy-reading');
    INSERT INTO note_keys VALUES('OldAlias','legacy-thinking'),('OldProject','legacy-thinking');
  `);
  if (process.env.KNOWLEDGE_BASE_HOST_TYPE_SCHEMA === "13") {
    legacy.exec(`
      ALTER TABLE zettels ADD COLUMN note_type TEXT NOT NULL DEFAULT 'note' CHECK(note_type IN ('note','literature','zettel','thinking','entity'));
      UPDATE zettels SET note_type=CASE id WHEN 'legacy-reading' THEN 'literature' WHEN 'legacy-thinking' THEN 'thinking' WHEN 'legacy-zettel' THEN 'zettel' ELSE 'note' END;
      UPDATE meta SET value='13' WHERE key='schemaVersion';
    `);
  }
  legacy.close();
}
const prefs = {
  "intl.locale.requested": process.env.KNOWLEDGE_BASE_HOST_LOCALE || "en-US",
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
if (retiredOnly) {
  prefs["extensions.zotero.knowledge-base.ai.enabled"] = true;
  prefs["extensions.zotero.knowledge-base.ai.provider"] = "codex";
  prefs["extensions.zotero.knowledge-base.ai.codex.path"] = fakeAI;
}
if (process.env.KNOWLEDGE_BASE_HOST_COLOR_SCHEME) {
  prefs["ui.systemUsesDarkTheme"] =
    process.env.KNOWLEDGE_BASE_HOST_COLOR_SCHEME === "dark" ? 1 : 0;
}
await writeFile(
  join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
// Add the test trigger only to this disposable copy of the installation package.
const bootstrap = strFromU8(files["bootstrap.js"]);
const trigger = "await Zotero.ZoteroKnowledgeBase.hooks.onStartup();";
if (!bootstrap.includes(trigger))
  throw new Error("Cannot find plugin startup hook");
files["bootstrap.js"] = strToU8(
  bootstrap.replace(
    trigger,
    (noteTypesOnly
      ? `
  await Zotero.initializationPromise;
  if (!(await IOUtils.exists(${JSON.stringify(marker)}))) {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote('<div data-schema-version="9"><h1>Thinking</h1><p>Original thinking body</p></div>');
    note.addTag("Thinking Note");
    note.addTag("Topic retained");
    await note.saveTx({skipSelect:true});
    const {Sqlite} = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    const connection = await Sqlite.openConnection({path:PathUtils.join(Zotero.DataDirectory.dir,"knowledge-base.sqlite")});
    try { await connection.execute("INSERT INTO card_notes (card_id,note_key,library_id,original_body) VALUES (?,?,?,?)",["legacy-thinking",note.key,note.libraryID,"Original thinking body"]); }
    finally { await connection.close(); }
    const paper = new Zotero.Item("journalArticle");
    paper.libraryID = Zotero.Libraries.userLibraryID;
    paper.setField("title","Native discovery source"); await paper.saveTx();
    Zotero.__knowledgeBaseDiscoveryFixtures = [];
    for (const parent of [paper.id,false]) {
      const original = new Zotero.Item("note");
      original.libraryID = paper.libraryID;
      original.parentItemID = parent;
      original.setNote('<div data-schema-version="9"><h1>Native discovery fixture</h1><p>Original <strong>native HTML</strong>.</p></div>');
      original.addTag("Original topic"); await original.saveTx({skipSelect:true});
      Zotero.__knowledgeBaseDiscoveryFixtures.push({id:original.id,key:original.key,parent,source:parent?paper.key:null,html:original.getNote()});
    }
  }
  `
      : "") +
      trigger +
      "\n  runQuitTest();",
  ) +
    `
function runQuitTest() {
  if (${readerToolbarOnly}) {
    if (Zotero.__knowledgeBaseReaderTestActive) return;
    Zotero.__knowledgeBaseReaderTestActive = true;
  }
  const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  async function run() {
    let restarting = false;
    try {
      const knowledgeBase = Zotero.ZoteroKnowledgeBase;
      // Permanently remove transient fixtures; normal Knowledge Base deletion retains Trash mappings.
      async function eraseFixtureCard(id) {
        await knowledgeBase.api.deleteZettel(id);
        const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
        const connection = await Sqlite.openConnection({path: PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base.sqlite")});
        let rows;
        try { rows = await connection.execute("SELECT library_id, note_key FROM card_notes WHERE card_id = ?", [id]); }
        finally { await connection.close(); }
        if (rows.length) {
          const native = await Zotero.Items.getByLibraryAndKeyAsync(rows[0].getResultByName('library_id'), rows[0].getResultByName('note_key'));
          if (native) await Zotero.Items.erase(native.id);
          await knowledgeBase.api.auditNativeNotes();
        }
      }
      // Fixture for previously linked notes; never included in production code.
      async function seedMappedNote(input) {
        const native = await Zotero.Items.getAsync(input.noteID);
        const id = "fixture-" + native.libraryID + "-" + native.key;
        const projection = knowledgeBase.api.projectNativeNote(native.getNote());
        await knowledgeBase.api.saveZettel({id, sourceNote: input.sourceNote, initialTags: input.initialTags, ...projection, itemKey: input.itemKey, libraryID: input.libraryID});
        const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
        const connection = await Sqlite.openConnection({path: PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base.sqlite")});
        try {
          await connection.execute("INSERT OR IGNORE INTO card_notes (card_id, note_key, library_id, original_body, external) VALUES (?, ?, ?, ?, 1)", [id, native.key, native.libraryID, projection.body]);
        } finally { await connection.close(); }
        return id;
      }
      if ("registerExistingNote" in knowledgeBase.api) throw new Error("One-off library adoption API leaked into the plugin");
      if (!Zotero.getMainWindow()?.document.getElementById("knowledge-base-menu-open-manager")) {
        setTimeout(run, 250);
        return;
      }
      if (${mathOnly || readingViewOnly || settingsOnly || graphViewsOnly || noteTypesOnly || textToolsOnly || workbenchOnly || metadataOnly || viewsOnly || retiredOnly}) {
        const test = ${editingHost || "null"};
        restarting = await IOUtils.exists(${JSON.stringify(marker)});
        await test({Zotero, ChromeUtils, IOUtils, PathUtils, Services, Components, setTimeout,
          readerPDF:${JSON.stringify(readerPDF)}, marker:${JSON.stringify(marker)}, restartMarker:${JSON.stringify(restartMarker)},
          benchmark:${readingViewOnly && args.includes("--benchmark")}, screenshots:${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")}, aiRequests:${JSON.stringify(aiRequests)}});
        return;
      }
      if (${readerToolbarOnly}) {
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const waitFor=async(check,label)=>{for(let n=0;n<200;n++){const value=check();if(value)return value;await pause(25);}throw new Error(label);};
        const openReader=async(id)=>{await Zotero.Reader.open(id);const reader=await waitFor(()=>Zotero.Reader._readers.find(reader=>reader.itemID===id),'Reader did not open');await reader._initPromise;await waitFor(()=>reader._iframeWindow?.document.getElementById('knowledge-base-reader-button'),'Reader button did not render');return reader;};
        const checkButton=async(reader)=>{
          const doc=reader._iframeWindow.document;
          const button=doc.getElementById('knowledge-base-reader-button');
          if(doc.querySelector('#knowledge-base-clip-figure'))throw new Error('Figure clipping icon was retained');
          if(doc.querySelectorAll('#knowledge-base-reader-button').length!==1 || button.nextElementSibling?.id!=='pageNumber' || button.title!==Zotero.ZoteroKnowledgeBase.api.loc('menu-open-manager') || button.getAttribute('aria-label')!==button.title || !button.classList.contains('toolbar-button'))throw new Error('Reader button is missing, duplicated or unnamed');
          await waitFor(()=>button.querySelector('img').complete && button.querySelector('img').naturalWidth>0,'Reader icon failed to load');
          const bounds=button.getBoundingClientRect();if(bounds.width<26 || bounds.height<26)throw new Error('Reader button does not use native toolbar geometry');
          return button;
        };
        const listeners=()=>Zotero.Reader._registeredListeners.filter(entry=>entry.pluginID==='knowledge-base@lzcn' && entry.type==='renderToolbar');
        const main=Zotero.getMainWindow();main.resizeTo(1100,850);
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          restarting=true;
          const first=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
          const reader=await openReader(first.pdfID);const button=await checkButton(reader);
          button.click();
          await waitFor(()=>main.document.querySelector('.knowledge-base-workbench')?.contentWindow?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow?.knowledgeBaseCardId===first.sourceNoteID,'Restarted reader did not open its Literature Note');
          if(listeners().length!==2 || new Set(listeners().map(entry=>entry.handler)).size!==2)throw new Error('Reader listener was duplicated after restart');
          await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
          if(reader._iframeWindow.document.querySelector('#knowledge-base-reader-button, #knowledge-base-clip-figure') || listeners().length)throw new Error('Shutdown retained reader UI');
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const paper=new Zotero.Item('journalArticle');paper.libraryID=Zotero.Libraries.userLibraryID;paper.setField('title','Reader toolbar fixture');await paper.saveTx();
        const first=await Zotero.Attachments.importFromFile({file:${JSON.stringify(readerPDF)},parentItemID:paper.id});
        const reader=await openReader(first.id);
        const initialButton=await checkButton(reader);
        const view=reader._internalReader._primaryView;await view.initializedPromise;
        await waitFor(()=>view._pdfRenderer,'PDF capture renderer did not initialize');
        main.focus();view._iframeWindow.focus();await pause(100);
        Services.clipboard.emptyClipboard(Services.clipboard.kGlobalClipboard);
        const originalAdd=view._onAddAnnotation;
        reader._iframeWindow.dispatchEvent(new reader._iframeWindow.KeyboardEvent('keydown',{key:'X',shiftKey:true,metaKey:Zotero.isMac,ctrlKey:!Zotero.isMac,bubbles:true,cancelable:true}));
        await waitFor(()=>view._onAddAnnotation!==originalAdd,'Capture without an open note did not arm');
        const canvas=await waitFor(()=>view._iframeWindow.document.querySelector('.page canvas'),'PDF page did not render');
        const page=canvas.getBoundingClientRect(), outer=reader._iframe.getBoundingClientRect(), inner=view._iframe.getBoundingClientRect();
        const x=outer.left+inner.left+page.left+45,y=outer.top+inner.top+page.top+50;
        main.windowUtils.sendMouseEvent('mousedown',x,y,0,1,0,false,0.5,1,false,false,1);await pause(30);
        main.windowUtils.sendMouseEvent('mousemove',x+230,y+110,0,1,0,false,0.5,1,false,false,1);await pause(30);
        main.windowUtils.sendMouseEvent('mouseup',x+230,y+110,0,1,0,false,0,1,false,false,0);
        await waitFor(()=>Services.clipboard.hasDataMatchingFlavors(['image/png'],Services.clipboard.kGlobalClipboard),'Capture without a note did not copy PNG');
        if(view._onAddAnnotation!==originalAdd || first.getAnnotations().length || (await Zotero.ZoteroKnowledgeBase.api.listZettels()).length)throw new Error('Clipboard capture changed the library or retained the image interceptor');
        initialButton.click();await waitFor(()=>main.document.querySelector('.knowledge-base-workbench'),'Reader button did not open Knowledge Base');
        const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
        const extension=await AddonManager.getAddonByID('knowledge-base@lzcn');
        await extension.disable();
        await waitFor(()=>!Zotero.ZoteroKnowledgeBase && !reader._iframeWindow.document.getElementById('knowledge-base-reader-button') && !listeners().length,'Disabling did not finish reader cleanup');
        if(reader._iframeWindow.document.querySelector('#knowledge-base-reader-button, #knowledge-base-clip-figure') || listeners().length)throw new Error('Disabling retained the reader button or listener');
        initialButton.click();if(main.document.querySelector('.knowledge-base-workbench'))throw new Error('A disabled reader button reopened Knowledge Base');
        await extension.enable();
        await waitFor(()=>Zotero.ZoteroKnowledgeBase?.api && reader._iframeWindow.document.getElementById('knowledge-base-reader-button'),'Re-enabling did not update the already-open PDF');
        await checkButton(reader);if(listeners().length!==2 || new Set(listeners().map(entry=>entry.handler)).size!==2)throw new Error('Re-enabling duplicated reader listeners');
        const second=await Zotero.Attachments.importFromFile({file:${JSON.stringify(readerPDF)},parentItemID:paper.id});
        const another=await openReader(second.id);await checkButton(another);
        reader._iframeWindow.document.getElementById('knowledge-base-reader-button').click();
        (await checkButton(another)).click();
        await waitFor(()=>main.document.querySelector('.knowledge-base-workbench'),'Second reader button did not open Knowledge Base');
        if(main.document.querySelectorAll('.knowledge-base-workbench').length!==1 || (await Zotero.ZoteroKnowledgeBase.api.listZettels()).length)throw new Error('Reader buttons duplicated Knowledge Base or created unwanted notes');
        await openReader(first.id);
        const folder=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        const checkSidebar=async(state)=>{
          const pane=main.document.querySelector('context-pane');pane.collapsed=false;pane.mode='item';
          const context=await waitFor(()=>pane._getItemContext(main.Zotero_Tabs.selectedID),'Reader item context did not open');
          context.render();
          const section=await waitFor(()=>[...context.querySelectorAll('item-pane-custom-section')].find(section=>section.dataset.pane?.includes('knowledge-base')),'Reader Knowledge Base sidebar did not render');
          section.querySelector('collapsible-section').open=true;
          const button=await waitFor(()=>section.querySelector('.knowledge-base-source-note'),'Reader source-note action did not render');
          await waitFor(()=>section.querySelector('.knowledge-base-source-note')?.textContent===(state==='empty'?'+':'↗'),'Source-note action did not update');
          for(const width of [280,400]) {
            pane.setAttribute('width',String(width));await pause(150);
            const actions=await waitFor(()=>{const list=[...section.querySelectorAll('.knowledge-base-section-action')];return list.length===2 && section.isConnected && list[0].textContent===(state==='empty'?'+':'↗') && list;},'Sidebar action rows did not settle: '+state+' '+section.outerHTML);
            if(!section.textContent.includes(Zotero.ZoteroKnowledgeBase.api.loc('section-source-note')))throw new Error('Sidebar label is missing: '+section.outerHTML);
            for(const action of actions) {
              const style=main.getComputedStyle(action),r=action.getBoundingClientRect();
              if(style.appearance!=='none' || style.boxShadow!=='none' || style.borderTopWidth!=='0px' || style.backgroundColor!=='rgba(0, 0, 0, 0)' || r.width!==24 || r.height!==24 || !action.getAttribute('aria-label'))throw new Error('Sidebar action has native button chrome or wrong geometry: '+JSON.stringify({html:action.outerHTML,appearance:style.appearance,shadow:style.boxShadow,border:style.borderTopWidth,background:style.backgroundColor,width:r.width,height:r.height}));
            }
            const bounds=actions.map(action=>action.getBoundingClientRect());
            if(Math.abs(bounds[0].x-bounds[1].x)>1 || bounds[1].y<=bounds[0].bottom)throw new Error('Sidebar actions do not share one aligned column');
            if(folder){await IOUtils.makeDirectory(folder,{ignoreExisting:true});section.scrollIntoView({block:'center'});await pause(100);const image=await main.browsingContext.currentWindowGlobal.drawSnapshot(section.getBoundingClientRect(),1,'white');const canvas=main.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,'sidebar-'+state+'-'+width+'.png'),new Uint8Array(await blob.arrayBuffer()));}
          }
          return section.querySelector('.knowledge-base-source-note');
        };
        (await checkSidebar('empty')).click();
        for(let n=0;n<200 && !(await Zotero.ZoteroKnowledgeBase.api.listByItem(paper.key)).some(note=>note.source_note);n++)await pause(25);
        await pause(300);await openReader(first.id);await checkSidebar('existing');
        if((await Zotero.ZoteroKnowledgeBase.api.listByItem(paper.key)).filter(note=>note.source_note).length!==1)throw new Error('Creating a source note duplicated the record');
        const api=Zotero.ZoteroKnowledgeBase.api;
        const sourceNote=(await api.listByItem(paper.key,paper.libraryID)).find(note=>note.source_note);
        const relatedID=await api.saveZettel({title:'Related Zettel',body:'Keep this independent idea.',itemKey:paper.key,libraryID:paper.libraryID});
        const currentEditor=()=>main.document.querySelector('.knowledge-base-workbench')?.contentWindow?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
        const select=async(id)=>{api.openEditor({zettelId:id});const editor=await waitFor(()=>currentEditor()?.knowledgeBaseCardId===id&&currentEditor(),'Reader target editor did not open');await editor.knowledgeBaseReady();};
        const openManager=api.openManager, opened=[];
        api.openManager=(args)=>{opened.push(args);return openManager(args);};
        try {
          for(const pdf of [first,second]) {
            await select(relatedID);
            const active=await openReader(pdf.id), button=await checkButton(active);
            await waitFor(()=>!button.disabled,'Reader action remained busy');
            button.click();
            await waitFor(()=>currentEditor()?.knowledgeBaseCardId===sourceNote.id,'PDF button did not select its Literature Note');
            await currentEditor().knowledgeBaseReady();
            if(opened.at(-1)?.selectId!==sourceNote.id)throw new Error('Reader selected a Zettel instead of its source note');
          }
          const withoutSource=new Zotero.Item('journalArticle');withoutSource.libraryID=paper.libraryID;withoutSource.setField('title','Paper without a Literature Note');await withoutSource.saveTx();
          await api.saveZettel({title:'Only a Zettel',body:'Do not open this as a Literature Note.',itemKey:withoutSource.key,libraryID:withoutSource.libraryID});
          const third=await Zotero.Attachments.importFromFile({file:${JSON.stringify(readerPDF)},parentItemID:withoutSource.id});
          const missing=await openReader(third.id), missingButton=await checkButton(missing);
          const count=(await api.listZettels()).length, calls=opened.length;
          missingButton.click();
          await waitFor(()=>opened.length>calls,'No-note reader did not open the default workbench');
          if(opened.at(-1)?.selectId || (await api.listZettels()).length!==count || (await api.listByItem(withoutSource.key,withoutSource.libraryID)).some(note=>note.source_note))throw new Error('Missing Literature Note was created or replaced by a Zettel');
          missing.close();
        } finally {api.openManager=openManager;}
        await openReader(first.id);
        if(folder){await IOUtils.makeDirectory(folder,{ignoreExisting:true});await pause(150);const image=await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');const canvas=main.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,'pdf-toolbar.png'),new Uint8Array(await blob.arrayBuffer()));}
        await checkButton(another);another.close();await waitFor(()=>!Zotero.Reader._readers.includes(another),'Closing the PDF did not release its reader');
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,pdfID:first.id,sourceNoteID:sourceNote.id}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      if (${contextOnly}) {
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const expect=(ok,message)=>{if(!ok)throw new Error(message);};
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          restarting=true;
          const first=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
          expect(!(await knowledgeBase.api.getZettel(first.removedID)),'Permanently deleted context target returned after restart');
          const card=await knowledgeBase.api.getZettel(first.keptID);
          expect(card?.body===first.body,'Context actions changed an unrelated note');
          const native=await knowledgeBase.api.acquireNativeNote({id:card.id,title:card.title,body:card.body});
          expect((await knowledgeBase.api.getOwnNoteTags(native.noteID,card.id)).includes('Context menu'),'Context tag edit did not survive restart');
          await knowledgeBase.api.releaseNativeNote(native.noteID);await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const firstID=await knowledgeBase.api.saveZettel({title:'First note',body:'Keep the original content'});
        const secondID=await knowledgeBase.api.saveZettel({title:'Second note',body:'Edit tags without changing the text',customKey:'ContextTarget'});
        const main=Zotero.getMainWindow();main.resizeTo(1200,900);knowledgeBase.api.openEditor({zettelId:firstID});
        let manager,inline;
        const waitFor=async(check,label)=>{for(let n=0;n<300;n++){if(await check())return;await pause(25);}throw new Error('Timed out: '+label);};
        await waitFor(async()=>{
          manager=main.document.querySelector('.knowledge-base-workbench')?.contentWindow;
          inline=manager?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
          if(inline?.knowledgeBaseCardId!==firstID || inline.document.readyState!=='complete')return false;
          await inline.knowledgeBaseReady();await inline.save(false);return true;
        },'initial editor');
        const popup=manager.document.getElementById('knowledge-base-note-menu');
        const row=id=>[...manager.document.querySelectorAll('.zettel-row')].find(note=>note.dataset.id===id);
        const rightClick=async id=>{
          await waitFor(()=>!!row(id),'context target row');
          main.focus();row(id).focus();
          row(id).querySelector('.title').dispatchEvent(new manager.MouseEvent('contextmenu',{bubbles:true,cancelable:true,screenX:main.mozInnerScreenX+230,screenY:main.mozInnerScreenY+260}));
          try {await waitFor(()=>popup.state==='open','native context menu');} catch(error) {throw new Error(String(error)+' '+JSON.stringify({state:popup.state,html:popup.outerHTML,error:manager.document.getElementById('knowledge-base-error').textContent,internal:manager.eval('JSON.stringify({menuVersion,deleting,selectedId,scope:currentScope(),ids:zettels.map(note=>note.id)})')}));}
        };
        const command=async action=>{
          const item=popup.querySelector('[data-action="'+action+'"]');expect(!!item,'Missing context action '+action);
          item.doCommand();popup.hidePopup();await pause(100);
        };
        await inline.eval('setEditorMode("source", false)');
        const pendingBody=inline.document.getElementById('knowledge-base-editor-body');
        pendingBody.value+='\\n\\nPending Markdown stays in the current document.';
        pendingBody.dispatchEvent(new inline.Event('input',{bubbles:true}));
        const pendingValue=pendingBody.value;
        let copied;
        const originalCopy=knowledgeBase.api.copyNoteReference;knowledgeBase.api.copyNoteReference=reference=>{copied=reference;};
        await rightClick(secondID);
        expect(inline.knowledgeBaseCardId===firstID && manager.eval('selectedId')===firstID,'Opening a context menu navigated away from the current document');
        const folder=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        if(folder) {
          await IOUtils.makeDirectory(folder,{ignoreExisting:true});
          const image=await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');
          const canvas=main.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,'context-menu.png'),new Uint8Array(await blob.arrayBuffer()));
        }
        await command('copy');expect(copied==='ContextTarget','Copy Link used the selected note instead of the context target');knowledgeBase.api.copyNoteReference=originalCopy;
        expect(inline.knowledgeBaseCardId===firstID && pendingBody.value===pendingValue,'Right-clicking lost pending Markdown edits');
        await inline.save(false);
        await rightClick(secondID);await command('tags');
        await waitFor(async()=>{inline=manager.document.getElementById('knowledge-base-workbench-editor').contentWindow;return inline?.knowledgeBaseCardId===secondID && inline.document.readyState==='complete' && !inline.document.getElementById('knowledge-base-tag-editor').hidden;},'tag editor');
        const input=inline.document.getElementById('knowledge-base-tag-input');input.value='Context menu';input.dispatchEvent(new inline.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        await waitFor(async()=>(await knowledgeBase.api.getOwnNoteTags(inline.eval('nativeNoteID'),secondID)).includes('Context menu'),'tag change');
        const preservedBody=(await knowledgeBase.api.getZettel(secondID)).body;
        await rightClick(secondID);await command('window');
        let standalone;
        await waitFor(async()=>{standalone=[...Services.wm.getEnumerator('knowledge-base:editor')].find(win=>win.knowledgeBaseCardId===secondID);if(!standalone?.knowledgeBaseReady || standalone.document.readyState!=='complete')return false;await standalone.knowledgeBaseReady();return true;},'context window');
        knowledgeBase.api.openEditor({zettelId:secondID,window:true,editTags:true});
        await waitFor(()=>!standalone.document.getElementById('knowledge-base-tag-editor').hidden,'reused window tag controls');
        await standalone.save(false);await standalone.eval('closeIfClean()');await waitFor(()=>standalone.closed,'context window close');

        manager.confirm=()=>false;await rightClick(firstID);await command('delete');
        expect((await knowledgeBase.api.getTrashNotes()).length===0,'Cancelling context deletion trashed a note');
        manager.confirm=()=>true;await rightClick(firstID);await command('delete');
        await waitFor(async()=>(await knowledgeBase.api.getTrashNotes()).some(note=>note.id===firstID),'context Trash');
        expect(inline.knowledgeBaseCardId===secondID && (await knowledgeBase.api.getZettel(secondID)).body===preservedBody,'Deleting another row replaced or changed the open document');
        const switchView=async value=>{await waitFor(()=>!manager.eval('deleting || purging'),'previous note operation');manager.document.querySelector('[data-note-view="'+value+'"]').dispatchEvent(new manager.Event('command',{bubbles:true}));await waitFor(()=>manager.eval('listScope===currentScope()') && manager.document.getElementById('knowledge-base-list').getAttribute('aria-busy')==='false','view change');await pause(100);};
        await switchView('trash');await rightClick(firstID);
        expect(!popup.querySelector('[data-action="tags"]') && !!popup.querySelector('[data-action="restore"]'),'Trash context menu exposes editing actions');
        await command('restore');await waitFor(async()=>(await knowledgeBase.api.getTrashNotes()).length===0,'context restoration');
        expect(!!(await knowledgeBase.api.getZettel(firstID)),'Restoration lost the same note identity');
        await switchView('all');await rightClick(firstID);await command('delete');
        await waitFor(async()=>(await knowledgeBase.api.getTrashNotes()).length===1,'repeated context Trash');
        await switchView('trash');manager.confirm=()=>false;await rightClick(firstID);await command('delete');
        expect(!!(await knowledgeBase.api.getZettel(firstID)),'Cancelling permanent deletion removed the note');
        manager.confirm=()=>true;await rightClick(firstID);await command('delete');
        await waitFor(async()=>!(await knowledgeBase.api.getZettel(firstID)),'context permanent deletion');
        await switchView('all');
        const selected=manager.document.querySelector('.zettel-row.active');selected.focus();
        selected.dispatchEvent(new manager.KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));
        await waitFor(()=>popup.state==='open','keyboard context menu');popup.hidePopup();
        expect(manager.document.getElementById('knowledge-base-error').hidden,'Context menu reported an error');
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,removedID:firstID,keptID:secondID,body:preservedBody}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      if (${trashOnly}) {
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const expect=(ok,message)=>{if(!ok)throw new Error(message);};
        const libraryID=Zotero.Libraries.userLibraryID;
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          restarting=true;
          const first=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
          const retained=await knowledgeBase.api.getZettel('trash-retained');
          expect(retained?.body==='Keep across restart','Trash body changed after restart');
          expect((await knowledgeBase.api.getTrashNotes()).map(note=>note.id).join()==='trash-retained','Trash state did not survive restart');
          expect((await knowledgeBase.api.getZettel('trash-active')).body.includes('[[trash-source]]'),'Referring note changed after permanent deletion');
          expect(!!(await Zotero.Items.getAsync(first.sourceID)) && !!(await Zotero.Items.getAsync(first.unrelatedID)),'Source or unrelated Trash was erased');
          expect(!(await knowledgeBase.api.getZettel('trash-source')) && !(await knowledgeBase.api.getZettel('trash-unopened')),'Deleted Knowledge Base notes returned after restart');
          await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const source=new Zotero.Item('journalArticle');source.libraryID=libraryID;source.setField('title','Source paper must survive');await source.saveTx();
        const unrelated=new Zotero.Item('note');unrelated.libraryID=libraryID;unrelated.setNote('<div data-schema-version="9"><p>Unrelated Zotero Trash</p></div>');await unrelated.saveTx();unrelated.deleted=true;await unrelated.saveTx();
        await knowledgeBase.api.saveZettel({id:'trash-source',title:'Research finding',body:'Original research body',sourceNote:true,itemKey:source.key,libraryID});
        const original=await knowledgeBase.api.acquireNativeNote({id:'trash-source',title:'Research finding',body:'Original research body'});await knowledgeBase.api.releaseNativeNote(original.noteID);
        const embedded=await Zotero.Attachments.importEmbeddedImage({parentItemID:original.noteID,blob:new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII='),character=>character.charCodeAt(0))],{type:'image/png'})});
        const embeddedKey=embedded.key;
        await knowledgeBase.api.saveZettel({id:'trash-unopened',title:'Unopened idea',body:'Never opened, still recoverable'});
        await knowledgeBase.api.saveZettel({id:'trash-active',title:'Active referring note',body:'Keep [[trash-source]]',parentId:'trash-source'});
        await knowledgeBase.api.deleteZettel('trash-source');await knowledgeBase.api.deleteZettel('trash-unopened');
        expect((await knowledgeBase.api.getTrashNotes()).length===2,'Trash did not include unopened notes');
        expect((await knowledgeBase.api.getZettel('trash-unopened')).body==='Never opened, still recoverable','Unopened deletion lost body');
        expect((await knowledgeBase.api.searchZettelSummaries('',{limit:50})).items.every(note=>!['trash-source','trash-unopened'].includes(note.id)),'Active search includes Trash');
        const main=Zotero.getMainWindow();main.resizeTo(1400,940);knowledgeBase.api.openEditor({zettelId:'trash-active'});
        let workbench;
        for(let n=0;n<200;n++) {
          workbench=main.document.querySelector('.knowledge-base-workbench')?.contentWindow;
          const inline=workbench?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
          if(inline?.knowledgeBaseCardId==='trash-active' && inline.document.readyState==='complete'){await inline.knowledgeBaseReady();await inline.save(false);break;}
          await pause(25);
        }
        expect(!!workbench,'Workbench did not open');
        expect(!workbench.document.getElementById('knowledge-base-entries'),'Entry points remains visible');
        const settle=async()=>{await pause(300);for(let n=0;n<400 && workbench.eval('deleting || purging');n++)await pause(25);const inline=workbench.document.getElementById('knowledge-base-workbench-editor').contentWindow;if(inline?.document.readyState==='complete' && inline.knowledgeBaseReady)await inline.knowledgeBaseReady();await pause(100);};
        const switchView=async(value)=>{workbench.document.querySelector('[data-note-view="'+value+'"]').dispatchEvent(new workbench.Event('command',{bubbles:true}));await settle();};
        await switchView('trash');
        expect(workbench.eval('zettels.length')===2,'Trash view failed to load');
        expect(!workbench.document.getElementById('knowledge-base-tag'),'Tag filtering remains visible in Trash');
        expect(workbench.document.getElementById('knowledge-base-btn-new').hasAttribute('disabled'),'New note should be disabled in Trash');
        expect(!workbench.document.getElementById('knowledge-base-btn-restore').hidden,'Restore action is hidden');
        workbench.confirm=()=>true;
        await workbench.eval("select('trash-source')");await settle();
        const trashedInline=workbench.document.getElementById('knowledge-base-workbench-editor').contentWindow;
        expect(trashedInline.eval('nativeNoteID')===null,'Trash opened a writable replacement original');
        workbench.document.getElementById('knowledge-base-btn-restore').dispatchEvent(new workbench.MouseEvent('click',{bubbles:true}));await settle();
        expect((await knowledgeBase.api.getTrashNotes()).length===1,'Restore button did not restore the selected original');
        expect((await Zotero.Items.getAsync(original.noteID)).deleted===false,'Restore replaced or failed to restore the original');
        expect((await knowledgeBase.api.getFamily('trash-active')).parent?.id==='trash-source','Restoration lost the parent');
        expect((await knowledgeBase.api.getOutgoing('trash-active'))[0]?.targetId==='trash-source','Restoration lost links');
        await knowledgeBase.api.deleteZettel('trash-source');await switchView('all');await switchView('trash');
        const folder=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOT_DIR || "")};
        for(const width of [1400,820]) {
          main.resizeTo(width,940);await settle();
          const bar=workbench.document.getElementById('knowledge-base-toolbar');
          const controlBounds=()=>['knowledge-base-search','knowledge-base-views'].map(id=>{const r=workbench.document.getElementById(id).getBoundingClientRect();return [r.x,r.y,r.width,r.height];});
          const trashBounds=controlBounds();
          await switchView('all');
          const noteBounds=controlBounds();
          expect(trashBounds.every((bounds,index)=>bounds.every((value,part)=>Math.abs(value-noteBounds[index][part])<=1)),'Toolbar controls shift between Notes and Trash at '+width+': '+JSON.stringify({trashBounds,noteBounds}));
          await switchView('trash');
          for(const button of bar.querySelectorAll('.knowledge-base-native-tool')) {
            if(button.hidden)continue;
            const icon=button.querySelector('.toolbarbutton-icon');
            expect(icon && icon.getBoundingClientRect().width===16 && button.getBoundingClientRect().width===28,'Toolbar icon dimensions differ: '+button.id);
          }
          expect(bar.scrollWidth<=bar.clientWidth+1,'Trash toolbar overflows at '+width);
          if(folder) {
            await IOUtils.makeDirectory(folder,{ignoreExisting:true});
            const image=await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');
            const canvas=main.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
            const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,width===1400?'trash.png':'trash-narrow.png'),new Uint8Array(await blob.arrayBuffer()));
          }
        }
        workbench.confirm=()=>false;
        workbench.document.getElementById('knowledge-base-empty-trash').dispatchEvent(new workbench.Event('command'));await settle();
        expect((await knowledgeBase.api.getTrashNotes()).length===2,'Cancelling confirmation changed Trash');
        await workbench.eval("select('trash-unopened')");await settle();workbench.confirm=()=>true;
        workbench.document.getElementById('knowledge-base-btn-delete').dispatchEvent(new workbench.MouseEvent('click',{bubbles:true}));await settle();
        expect(!(await knowledgeBase.api.getZettel('trash-unopened')),'Permanent delete button did not remove the selected note: '+JSON.stringify({state:workbench.eval('JSON.stringify({selectedId,deleting,purging,ids:zettels.map(row=>row.id)})'),error:workbench.document.getElementById('knowledge-base-error').textContent,trash:await knowledgeBase.api.getTrashNotes()}));
        workbench.document.getElementById('knowledge-base-search').value='No matching title';await workbench.eval('refresh(false)');
        workbench.document.getElementById('knowledge-base-empty-trash').dispatchEvent(new workbench.Event('command'));await settle();
        expect((await knowledgeBase.api.getTrashNotes()).length===0 && !(await knowledgeBase.api.getZettel('trash-source')),'Empty Trash depended on the search filter');
        expect(!(await Zotero.Items.getByLibraryAndKeyAsync(libraryID,embeddedKey)),'An attachment of a permanently deleted note survived');
        expect(!!(await Zotero.Items.getAsync(source.id)) && !!(await Zotero.Items.getAsync(unrelated.id)),'Knowledge Base Empty Trash erased other Zotero data');
        expect((await knowledgeBase.api.getOutgoing('trash-active'))[0]?.targetId===null,'Deleted target did not become unresolved');
        expect(!(await knowledgeBase.api.getFamily('trash-active')).parent,'Permanent deletion left a dangling parent');
        for(const id of ['trash-cancel-a','trash-cancel-b']) {await knowledgeBase.api.saveZettel({id,title:id,body:'Batch'});await knowledgeBase.api.deleteZettel(id);}
        let cancelled=false;const batch=await knowledgeBase.api.permanentlyDeleteNotes(['trash-cancel-a','trash-cancel-b'],()=>cancelled,()=>{cancelled=true;});
        expect(batch.deleted===1 && batch.cancelled && !!(await knowledgeBase.api.getZettel('trash-cancel-b')),'Batch cancellation erased the next note');
        const restored=(await knowledgeBase.api.getTrashNotes()).find(note=>note.id==='trash-cancel-b');
        await knowledgeBase.api.restoreNote(restored.id);
        expect((await knowledgeBase.api.permanentlyDeleteNotes([restored.id])).skipped===1,'A restored original was permanently erased');
        await knowledgeBase.api.saveZettel({id:'trash-retained',title:'Retained Trash',body:'Keep across restart'});await knowledgeBase.api.deleteZettel('trash-retained');
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,sourceID:source.id,unrelatedID:unrelated.id}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      const auditUI=(view,scope=view.document)=>{
        for(const control of scope.querySelectorAll('button, toolbarbutton, menulist, checkbox')) {
          const box=control.getBoundingClientRect();
          if(!box.width || !box.height || view.getComputedStyle(control).visibility==='hidden')continue;
          const native=control.namespaceURI==='http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
          const text=(control.getAttribute('label') || control.textContent || '').trim();
          if(!text && !control.getAttribute('aria-label') && !control.getAttribute('tooltiptext') && !control.getAttribute('title') && !control.getAttribute('image') && control.localName!=='menulist')throw new Error('Unnamed control: '+control.id);
          const label=native && control.shadowRoot?.querySelector('.button-text, .toolbarbutton-text, .menulist-label, .checkbox-label');
          if(label && text) {
            const bounds=label.getBoundingClientRect();
            if(bounds.height && (bounds.top<box.top-2 || bounds.bottom>box.bottom+2))throw new Error('Clipped native control text: '+control.id+': '+text);
            if(control.localName==='button' && bounds.width && (bounds.left<box.left-2 || bounds.right>box.right+2 || label.scrollWidth>label.clientWidth+2))throw new Error('Clipped native button label: '+control.id+': '+text);
          }
          if(!native && text && !control.matches('.sw-row, .zettel-row, .relation-link')) {
            const line=parseFloat(view.getComputedStyle(control).lineHeight);
            if(Number.isFinite(line) && control.clientHeight+2<line)throw new Error('Control is shorter than its text: '+control.id+': '+text);
          }
        }
      };
      if (${appearanceOnly}) {
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          restarting=true;
          const first=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
          if(Zotero.Prefs.get('extensions.zotero.plugin-ui.bear',true)!==true || !Zotero.getMainWindow().document.documentElement.hasAttribute('data-plugin-bear'))throw new Error('Interface style was not restored after restart');
          for(const expected of first.notes) {
            const card=await knowledgeBase.api.getZettel(expected.id);
            if(!card || card.body!==expected.body || card.source_note!==expected.sourceNote || card.reference!==expected.reference)throw new Error('Note content or ID changed after restart');
            const acquired=await knowledgeBase.api.acquireNativeNote({id:card.id,title:card.title,body:card.body});
            const tags=await knowledgeBase.api.getOwnNoteTags(acquired.noteID,card.id);
            if(JSON.stringify(tags)!==JSON.stringify(expected.tags))throw new Error('Removed or edited tags changed after restart: '+JSON.stringify(tags));
            await knowledgeBase.api.releaseNativeNote(acquired.noteID);
          }
          await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const source=new Zotero.Item("journalArticle");source.libraryID=Zotero.Libraries.userLibraryID;
        source.setField("title","Efficient collaborative perception with information bottleneck");source.setField("date","2026");source.setCreators([{firstName:"A",lastName:"Researcher",creatorType:"author"}]);await source.saveTx();
        const literature=await knowledgeBase.api.ensureLiteratureNote(source.key,source.libraryID);
        const longID='InfoComKilobytescaleCommunicationEfficientCollaborativePerceptionWithInformationBottleneckWei26';
        const notes=[{id:literature}];
        await knowledgeBase.api.saveZettel({id:literature,sourceNote:true,customKey:longID,title:source.getField("title"),body:"## Takeaway\\n\\n一条笔记只表达一个清晰的研究判断，保留来源与关键证据。\\n\\n## Insight\\n\\n先理解任务需要什么，再决定保留哪些信息。Information efficiency starts with the task.\\n\\n## Evidence\\n\\nCompare communication cost and task performance.",itemKey:source.key,libraryID:source.libraryID});
        notes.push({id:await knowledgeBase.api.saveZettel({initialTags:["Zettel"],title:"Communicate what the task needs",body:"A useful representation keeps task-relevant information and removes redundant details.",customKey:"TaskRelevantInformation"})});
        notes.push({id:await knowledgeBase.api.saveZettel({initialTags:["Thinking Note"],title:"Questions for the next experiment",body:"## Open questions\\n\\n- What information does the downstream task actually need?\\n- How should we measure the tradeoff?",customKey:"NextExperiment"})});
        const main=Zotero.getMainWindow();main.resizeTo(1400,940);
        let workbench,inline;
        for(const expected of notes) {
          knowledgeBase.api.openEditor({zettelId:expected.id});
          for(let n=0;n<200;n++) {
            workbench=main.document.querySelector('.knowledge-base-workbench')?.contentWindow;
            inline=workbench?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
            if(inline?.knowledgeBaseCardId===expected.id && inline.document.readyState==='complete'){if(inline.knowledgeBaseReady)await inline.knowledgeBaseReady();break;}
            await pause(25);
          }
          await pause(150);
          for(let n=0;n<100 && inline.eval('dirty || !!saving');n++){await knowledgeBase.api.auditNativeNotes();await inline.refreshSavedCard();await pause(50);}
          if(inline.eval('dirty || !!saving'))throw new Error('Native initialization stayed dirty: '+JSON.stringify({input:inline.snapshot(),card:await knowledgeBase.api.getZettel(expected.id)}));
          const nativeFrame=inline.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow;
          const prose=nativeFrame.document.querySelector('.primary-editor');
          if(nativeFrame.getComputedStyle(prose).fontFamily.includes('Avenir Next') || prose.getBoundingClientRect().width>761)throw new Error('Knowledge Base prose did not adopt the reference typography and reading width');
          if(workbench.getComputedStyle(workbench.document.getElementById('knowledge-base-root')).fontFamily.includes('Avenir Next'))throw new Error('The note list kept its old UI font');
          if(!inline.document.getElementById('knowledge-base-note-type'))throw new Error('Note type selector is missing');
          const tags=await knowledgeBase.api.getOwnNoteTags(inline.eval('nativeNoteID'),expected.id);
          if(!tags.length)throw new Error('Initial tag did not reach the native note');

        }
        const rows=[...workbench.document.querySelectorAll('.zettel-row')];
        if(rows.length!==3)throw new Error("Appearance fixtures are missing from the list");
        for(const row of rows) {
          if(row.querySelector('.note-kind-badge') || !row.querySelector('.note-row-reference'))throw new Error('The list still shows note types');
          if(Math.abs(row.getBoundingClientRect().height-workbench.eval('ROW_HEIGHT'))>1)throw new Error("Visual changes broke the virtual row height");
          if(row.querySelector('.card-snippet').getBoundingClientRect().top-row.querySelector('.title').getBoundingClientRect().bottom>6)throw new Error("A short title leaves an unnecessary gap before its preview");
          if(!row.classList.contains('active')) {
            const divider=workbench.getComputedStyle(row,'::after');
            if(divider.content==='none' || parseFloat(divider.height)!==1 || divider.backgroundColor==='rgba(0, 0, 0, 0)')throw new Error("Adjacent notes have no visible separator");
          }
        }
        const sort=workbench.document.getElementById('knowledge-base-sort');
        const sortRect=sort.getBoundingClientRect(),toolbarRect=sort.parentElement.getBoundingClientRect();
        if(sortRect.top-toolbarRect.top<8 || toolbarRect.bottom-sortRect.bottom<8 || sortRect.left-toolbarRect.left<12)throw new Error("The sorting control has insufficient breathing room: "+JSON.stringify({sort:sortRect.toJSON(),toolbar:toolbarRect.toJSON(),padding:workbench.getComputedStyle(sort.parentElement).padding}));
        if(workbench.getComputedStyle(sort).backgroundColor!=="rgba(0, 0, 0, 0)")throw new Error("The sorting control should not look like a filled button");
        knowledgeBase.api.openEditor({zettelId:literature});
        for(let n=0;n<100;n++){inline=workbench.document.getElementById('knowledge-base-workbench-editor').contentWindow;if(inline?.knowledgeBaseCardId===literature && inline.document.readyState==='complete'){await inline.knowledgeBaseReady();await pause(150);break;}await pause(25);}
        if(inline.knowledgeBaseCardId!==literature)throw new Error('Source note navigation failed');
        if(!(await inline.save(false)))throw new Error('Could not settle native note initialization');
        await knowledgeBase.api.auditNativeNotes();await inline.refreshSavedCard();
        const before=await knowledgeBase.api.getZettel(literature);
        inline.document.getElementById('knowledge-base-tags-edit').click();
        for(let n=0;n<100 && inline.document.getElementById('knowledge-base-tag-editor').hidden;n++)await pause(25);
        const oldTag=[...inline.document.querySelectorAll('#knowledge-base-own-tags button')].find(button=>button.textContent.startsWith('Literature Note'));
        if(!oldTag)throw new Error('The classification tag is not editable: '+JSON.stringify({card:inline.knowledgeBaseCardId,noteID:inline.eval('nativeNoteID'),tagEditing:inline.eval('tagEditing'),own:await knowledgeBase.api.getOwnNoteTags(inline.eval('nativeNoteID'),literature),html:inline.document.getElementById('knowledge-base-tag-editor').outerHTML}));oldTag.click();
        for(let n=0;n<100 && (await knowledgeBase.api.getOwnNoteTags(inline.eval('nativeNoteID'),literature)).includes('Literature Note');n++)await pause(25);
        const tagInput=inline.document.getElementById('knowledge-base-tag-input');tagInput.value='Research idea';tagInput.dispatchEvent(new inline.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        for(let n=0;n<100 && !(await knowledgeBase.api.getOwnNoteTags(inline.eval('nativeNoteID'),literature)).includes('Research idea');n++)await pause(25);
        const own=await knowledgeBase.api.getOwnNoteTags(inline.eval('nativeNoteID'),literature);
        if(own.includes('Literature Note') || !own.includes('Research idea') || (await knowledgeBase.api.getZettel(literature)).body!==before.body || (await knowledgeBase.api.ensureLiteratureNote(source.key,source.libraryID))!==literature)throw new Error('Tag editing changed note content or source identity: '+JSON.stringify({own,before:before.body,after:(await knowledgeBase.api.getZettel(literature)).body}));
        tagInput.dispatchEvent(new inline.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        if(workbench.document.getElementById('knowledge-base-tag'))throw new Error('Workbench exposes tag filtering');
        for(const expected of notes) {
          const card=await knowledgeBase.api.getZettel(expected.id);expected.body=card.body;expected.sourceNote=card.source_note;expected.reference=card.reference;
          const acquired=await knowledgeBase.api.acquireNativeNote({id:card.id,title:card.title,body:card.body});expected.tags=await knowledgeBase.api.getOwnNoteTags(acquired.noteID,card.id);await knowledgeBase.api.releaseNativeNote(acquired.noteID);
        }
        const settings=Zotero.Utilities.Internal.openPreferences('knowledge-base-preferences');
        let styleChoice;
        for(let n=0;n<150;n++){styleChoice=settings.document.getElementById('knowledge-base-ui-style');if(styleChoice?.selectedItem)break;await pause(25);}
        if(styleChoice?.value!=='minimal')throw new Error('Minimal is not the default interface style');
        const addGroup=settings.document.getElementById('knowledge-base-add-group');
        const settingsFont=settings.getComputedStyle(addGroup).fontFamily;
        addGroup.dispatchEvent(new settings.Event('command',{bubbles:true}));
        settings.document.getElementById('knowledge-base-graph-appearance').open=true;
        await pause(150);
        if(settingsFont.includes('Avenir Next'))throw new Error('Settings inherited the Bear font');
      if([...settings.document.styleSheets].some(sheet=>sheet.href?.includes('knowledge-base/content/ui.css')))throw new Error('Settings loaded the operational theme stylesheet');
        const folder=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        for(const uiStyle of ['minimal','bear']) {
          styleChoice.value=uiStyle;styleChoice.dispatchEvent(new settings.Event('command',{bubbles:true}));await pause(150);
          if(Zotero.Prefs.get('extensions.zotero.plugin-ui.bear',true)!==(uiStyle==='bear'))throw new Error('Style selection was not saved');
          const nativeFrame=inline.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow;
          const prose=nativeFrame.document.querySelector('.primary-editor');
          if(workbench.getComputedStyle(workbench.document.getElementById('knowledge-base-root')).fontFamily.includes('Avenir Next') || workbench.document.documentElement.hasAttribute('data-plugin-bear')!==(uiStyle==='bear') || nativeFrame.getComputedStyle(prose).fontFamily.includes('Avenir Next')!==(uiStyle==='bear'))throw new Error('Interface style did not update existing views: '+uiStyle+': '+workbench.getComputedStyle(workbench.document.getElementById('knowledge-base-root')).fontFamily+' / '+nativeFrame.getComputedStyle(prose).fontFamily);
          if(settings.document.documentElement.hasAttribute('data-plugin-bear') || settings.getComputedStyle(addGroup).fontFamily!==settingsFont)throw new Error('Style selection changed native Settings typography');
          auditUI(settings,settings.document.querySelector('.plugin-preferences'));
          for(const view of [workbench,inline])auditUI(view);
          for(const settingsWidth of [1000,740]) {
            settings.resizeTo(settingsWidth,850);addGroup.scrollIntoView({block:'end'});await pause(100);
            auditUI(settings,settings.document.querySelector('.plugin-preferences'));
            if(folder){await IOUtils.makeDirectory(folder,{ignoreExisting:true});const image=await settings.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');const canvas=settings.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,'settings-'+uiStyle+'-'+settingsWidth+'.png'),new Uint8Array(await blob.arrayBuffer()));}
          }

        for(const width of [1400,900,700]) {
          main.resizeTo(width,940);await pause(200);
          for(const row of workbench.document.querySelectorAll('.zettel-row')) {
            const title=row.querySelector('.title').getBoundingClientRect(),preview=row.querySelector('.card-snippet').getBoundingClientRect(),footer=row.querySelector('.zid').getBoundingClientRect();
            if(title.bottom>preview.top+1 || preview.bottom>footer.top+1)throw new Error("List title, preview and metadata overlap at width "+width);
          }
          const control=sort.getBoundingClientRect(),bar=sort.parentElement.getBoundingClientRect();
          if(control.top-bar.top<8 || bar.bottom-control.bottom<8 || control.right>bar.right-8)throw new Error("Sorting control is cramped at width "+width);
          const key=inline.document.getElementById('knowledge-base-editor-key');
          const keyStyle=inline.getComputedStyle(key),keyRect=key.getBoundingClientRect();
          if(key.localName!=='input' || key.value!==longID || key.hidden)throw new Error('Note ID is not a plain copyable reference');
          if(parseFloat(keyStyle.borderLeftWidth)!==1 || keyStyle.backgroundColor!=='rgba(0, 0, 0, 0)')throw new Error('Note ID still has a framed field appearance');
          if(key.scrollHeight>key.clientHeight+1 || keyRect.right>inline.innerWidth)throw new Error('Note ID is clipped at width '+width+': '+JSON.stringify({clientWidth:key.clientWidth,scrollWidth:key.scrollWidth,clientHeight:key.clientHeight,scrollHeight:key.scrollHeight}));
          if(keyRect.height<=24)throw new Error('Long note ID did not wrap');
          key.click();await pause(25);
          if(Zotero.Utilities.Internal.getClipboard('text/plain')!=='[['+longID+']]')throw new Error('Long note ID cannot be copied');
          if(folder) {
            await IOUtils.makeDirectory(folder,{ignoreExisting:true});
            const image=await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,"white");
            const canvas=main.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
            const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,uiStyle+'-'+(width===1400?'workbench.png':width===900?'workbench-narrow.png':'note-id-narrow.png')),new Uint8Array(await blob.arrayBuffer()));
          }
        }
        }
        await inline.setEditorMode('source',false);
        const sourceSurface=inline.document.getElementById('knowledge-base-editor-body');
        const sourceView=sourceSurface.querySelector('iframe').contentWindow;
        for(const value of ['minimal','bear']) {
          styleChoice.value=value;styleChoice.dispatchEvent(new settings.Event('command',{bubbles:true}));await pause(100);
          if(sourceView.getComputedStyle(sourceView.document.querySelector('.cm-content')).fontFamily.includes('Avenir Next')!==(value==='bear'))throw new Error('Markdown typography did not follow the selected note style: '+JSON.stringify({value,font:sourceView.getComputedStyle(sourceView.document.querySelector('.cm-content')).fontFamily,native: inline.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow.getComputedStyle(inline.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow.document.querySelector('.primary-editor')).fontFamily,editorBear:inline.document.documentElement.hasAttribute('data-plugin-bear'),sourceBear:sourceView.document.documentElement.hasAttribute('data-plugin-bear')}));
          const toolbarFrame=inline.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow;
          if(toolbarFrame.getComputedStyle(toolbarFrame.document.querySelector('[data-text-action=normalize]')).fontFamily.includes('Avenir Next'))throw new Error('Note typography leaked into toolbar controls');
        }
        await inline.setEditorMode('visual',false);
        settings.close();
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,notes}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      if (${toolbarOnly}) {
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          restarting=true;
          const first=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
          const card=await knowledgeBase.api.getZettel(first.cardID);
          if(!card || card.body!==first.body)throw new Error("Toolbar interaction changed the saved note after restart");
          await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const screenshot=async(name,win)=>{
          const folder=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};if(!folder)return;
          await IOUtils.makeDirectory(folder,{ignoreExisting:true});
          const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,"white");
          const canvas=win.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
          canvas.width=image.width;canvas.height=image.height;canvas.getContext("2d").drawImage(image,0,0);image.close();
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(folder,name+".png"),new Uint8Array(await blob.arrayBuffer()));
        };
        const checkMenu=async(frame,outer,name)=>{
          const doc=frame.document;
          const button=doc.querySelector('.more-dropdown > button');
          if(!button)throw new Error("Native More button is missing");
          const native=frame.browsingContext.embedderElement;
          const parent=native.ownerDocument;
          const pressMore=()=>{
            const offset=native.getBoundingClientRect();const bounds=button.getBoundingClientRect();
            const x=offset.left+bounds.left+bounds.width/2;const y=offset.top+bounds.top+bounds.height/2;
            parent.defaultView.windowUtils.sendMouseEvent("mousedown",x,y,0,1,0);
            parent.defaultView.windowUtils.sendMouseEvent("mouseup",x,y,0,1,0);
          };
          pressMore();
          let popup;
          for(let n=0;n<100;n++) {popup=doc.querySelector('.more-dropdown .popup');if(popup)break;await pause(20);}
          await pause(100);
          const item=popup?.querySelector('button.option');
          if(!item)throw new Error("Native More menu has no clickable command");
          const offset=native.getBoundingClientRect();
          const bounds=item.getBoundingClientRect();
          const x=offset.left+bounds.left+bounds.width/2;
          const y=offset.top+bounds.top+bounds.height/2;
          const hit=parent.elementFromPoint(x,y);
          await screenshot(name,outer);
          if(hit!==native || !popup.contains(doc.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)))throw new Error("Markdown surface covers the More menu: "+JSON.stringify({hit:hit?.localName,id:hit?.id,cls:hit?.className,native:native.localName,clip:native.style.clipPath,z:native.style.zIndex,x,y}));
          const toolbarBottom=doc.querySelector('.toolbar').getBoundingClientRect().bottom;
          const freeX=offset.left+10;
          const freeY=offset.top+Math.min(frame.innerHeight-30,Math.max(popup.getBoundingClientRect().bottom+40,toolbarBottom+100));
          if(parent.elementFromPoint(freeX,freeY)===native)throw new Error("Showing the native menu blocks the Markdown editor outside its bounds");
          let clicked=false;
          item.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();clicked=true;},{capture:true,once:true});
          parent.defaultView.windowUtils.sendMouseEvent("mousedown",x,y,0,1,0);
          parent.defaultView.windowUtils.sendMouseEvent("mouseup",x,y,0,1,0);
          await pause(100);
          if(!clicked)throw new Error("An actual pointer click did not reach the exposed More command");
          if(doc.querySelector('.more-dropdown .popup'))pressMore();await pause(100);
          if(doc.querySelector('.more-dropdown .popup'))throw new Error("More menu did not close");
          if(native.style.clipPath || native.style.zIndex)throw new Error("Closing the menu did not restore the original frame layers");
          pressMore();await pause(100);
          parent.defaultView.windowUtils.sendMouseEvent("mousedown",freeX,freeY,0,1,0);
          parent.defaultView.windowUtils.sendMouseEvent("mouseup",freeX,freeY,0,1,0);
          await pause(100);
          if(doc.querySelector('.more-dropdown .popup') || native.style.clipPath || native.style.zIndex)throw new Error("Clicking Markdown outside the menu did not dismiss it and restore the frame: "+JSON.stringify({popup:!!doc.querySelector('.more-dropdown .popup'),clip:native.style.clipPath,z:native.style.zIndex,focus:doc.hasFocus(),parentFocus:parent.activeElement?.localName,hit:parent.elementFromPoint(freeX,freeY)?.outerHTML?.slice(0,200)}));
        };
        const cardID=await knowledgeBase.api.saveZettel({initialTags:["Zettel"],title:"InfoCom: kilobyte-scale communication-efficient collaborative perception",body:("## Research note\\n\\nMarkdown body must remain visible below the menu.\\n\\n"+"Text below the toolbar.\\n\\n".repeat(20)).trimEnd()});
        knowledgeBase.api.openEditor({window:true,zettelId:cardID});
        let editor;
        for(let n=0;n<200;n++) {
          editor=[...Services.wm.getEnumerator("knowledge-base:editor")].find(win=>win.knowledgeBaseCardId===cardID);
          if(editor?.knowledgeBaseReady){await editor.knowledgeBaseReady();break;}await pause(25);
        }
        if(!editor)throw new Error("Knowledge Base editor did not open");
        const nativeElement=editor.document.getElementById("knowledge-base-rich-frame");
        for(const width of [480,900]) {
          editor.resizeTo(width,720);await pause(100);
          await editor.setEditorMode("source",false);
          const savedHTML=nativeElement.getCurrentInstance()._item.getNote();
          await checkMenu(nativeElement.getCurrentInstance()._iframeWindow,editor,"knowledge-base-markdown-more-"+width);
          await editor.setEditorMode("visual",false);
          if(nativeElement.getCurrentInstance()._item.getNote()!==savedHTML)throw new Error("Opening More in Markdown changed the note");
        }
        await knowledgeBase.api.setNativeNoteTakeover(false);
        const note=new Zotero.Item("note");note.libraryID=Zotero.Libraries.userLibraryID;note.setNote('<div data-schema-version="9"><h1>Ordinary Zotero note</h1><p>Unchanged note body.</p></div>');await note.saveTx();
        const instance=await Zotero.Notes.open(note.id,null,{openInWindow:true});
        await instance._initPromise;
        const outer=instance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
        for(let n=0;n<100 && !instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle');n++)await pause(25);
        for(const width of [480,900]) {
          outer.resizeTo(width,720);await pause(100);
          instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle').click();
          for(let n=0;n<100 && !instance._iframeWindow.document.body.classList.contains('knowledge-base-source-mode');n++)await pause(20);
          const original=note.getNote();
          await checkMenu(instance._iframeWindow,outer,"native-markdown-more-"+width);
          instance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle').click();
          for(let n=0;n<100 && instance._iframeWindow.document.body.classList.contains('knowledge-base-source-mode');n++)await pause(20);
          if(note.getNote()!==original)throw new Error("Opening More in ordinary Markdown changed the note");
        }
        outer.close();
        await editor.knowledgeBasePrepareNavigation();editor.close();
        const saved=await knowledgeBase.api.getZettel(cardID);
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,cardID,body:saved.body}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      if (${templatesOnly}) {
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const makeNote=async(title)=>{
          const source=new Zotero.Item("journalArticle");
          source.libraryID=Zotero.Libraries.userLibraryID;source.setField("title",title);await source.saveTx();
          const id=await knowledgeBase.api.ensureLiteratureNote(source.key,source.libraryID);
          return {source,id,card:await knowledgeBase.api.getZettel(id)};
        };
        const assertBody=async(id,body)=>{
          if((await knowledgeBase.api.getZettel(id))?.body!==body)throw new Error("Existing Literature Note changed: "+id);
        };
        const screenshot=async(name,win)=>{
          const folder=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};if(!folder)return;
          await IOUtils.makeDirectory(folder,{ignoreExisting:true});
          const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,"white");
          const canvas=win.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
          canvas.width=image.width;canvas.height=image.height;canvas.getContext("2d").drawImage(image,0,0);image.close();
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(folder,name+".png"),new Uint8Array(await blob.arrayBuffer()));
        };
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          restarting=true;
          const first=JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
          const settings=knowledgeBase.api.getLiteratureTemplateSettings();
          if(settings.selected!==first.selected || JSON.stringify(settings.templates)!==JSON.stringify(first.templates))throw new Error("Restart lost named templates or their selected ID");
          for(const card of first.notes)await assertBody(card.id,card.body);
          const next=await makeNote("Named template after restart");
          if(next.card.body!==first.custom)throw new Error("Restart did not use the chosen named template for a new note");
          knowledgeBase.api.deleteLiteratureTemplate(first.selected);
          const remaining=knowledgeBase.api.getLiteratureTemplateSettings();
          if(remaining.selected!==null || remaining.templates.length!==1)throw new Error("Deleting the selected template did not fall back to no template");
          for(const card of first.notes)await assertBody(card.id,card.body);
          const blank=await makeNote("Blank after template deletion");if(blank.card.body!=="")throw new Error("Deleting the selected template still inserted a template");
          knowledgeBase.api.setLiteratureTemplate(remaining.templates[0].id);
          const existing=await knowledgeBase.api.getZettel(first.notes[0].id);
          await knowledgeBase.api.ensureLiteratureNote(existing.item_key,existing.library_id);
          await assertBody(existing.id,first.notes[0].body);
          await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true,templatesOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const initial=knowledgeBase.api.getLiteratureTemplateSettings();
        if(initial.selected!==null || initial.templates.length)throw new Error("Fresh install contains preset templates");
        const blank=await makeNote("Blank Literature Note");if(blank.card.body!=="")throw new Error("Fresh install did not create a blank Literature Note");
        const settingsWindow=Zotero.Utilities.Internal.openPreferences("knowledge-base-preferences");
        for(let n=0;n<100 && !settingsWindow.document.getElementById('knowledge-base-template-manage');n++) await pause(50);
        if(settingsWindow.document.getElementById('knowledge-base-template-body') || settingsWindow.document.getElementById('knowledge-base-inherit-tags') || settingsWindow.document.querySelector('[preference$="allowMetadataOnlyRecommendations"]')) throw new Error('Settings still expose template editor or retired options');
        settingsWindow.document.getElementById('knowledge-base-template-manage').dispatchEvent(new settingsWindow.Event('command'));
        const preferences=knowledgeBase.api.openTemplateManager();
        if(preferences !== knowledgeBase.api.openTemplateManager()) throw new Error('Duplicate template managers opened');
        let choice;
        for(let n=0;n<100;n++) {
          choice=preferences.document.getElementById("knowledge-base-literature-templates");
          if(choice && preferences.KnowledgeBaseTemplates) break;
          await pause(50);
        }
        const details=preferences.document.getElementById("knowledge-base-template-editor");
        const content=preferences.document.getElementById("knowledge-base-template-body");
        const name=preferences.document.getElementById("knowledge-base-template-name");
        const use=preferences.document.getElementById("knowledge-base-template-default");
        const add=preferences.document.getElementById("knowledge-base-template-new");
        const remove=preferences.document.getElementById("knowledge-base-template-delete");
        const selectedID=()=>choice.querySelector('[aria-selected="true"]')?.dataset.id;
        if(!choice || choice.children.length || !details?.hidden || !add.label)throw new Error("Template manager did not start with an empty list");
        const command=(control)=>control.dispatchEvent(new preferences.Event("command"));
        const rename=(text)=>{name.value=text;name.dispatchEvent(new preferences.Event("input"));};
        const write=(text)=>{content.value=text;content.dispatchEvent(new preferences.Event("input",{bubbles:true}));};
        const chooseTemplate=async(id)=>{
          if(id) {
            const button=choice.querySelector('[data-id="'+id+'"]');
            if(!button) throw new Error("Template list is missing its target");
            button.click();
          }
          use.checked=!!id;command(use);
          if(knowledgeBase.api.getLiteratureTemplateSettings().selected!==id) throw new Error("Default template was not saved");
        };
        command(add);
        const firstID=selectedID();
        if(!firstID || details.hidden || content.value!=="" || preferences.document.activeElement!==name)throw new Error("New template is not empty or did not focus its name");
        rename("阅读记录");
        const firstBody="## Takeaway\\n\\n- One research insight\\n\\n## Evidence\\n\\n- Supporting experiment";
        write(firstBody);
        if(choice.querySelector('[data-id="'+firstID+'"]').textContent!=="阅读记录")throw new Error("Naming the first template did not refresh its menu label");
        await chooseTemplate(null);await chooseTemplate(firstID);await chooseTemplate(firstID);
        const research=await makeNote("Named-template Literature Note");
        if(research.card.body!==firstBody || await knowledgeBase.api.ensureLiteratureNote(research.source.key,research.source.libraryID)!==research.id)throw new Error("New Literature Note did not use the named template exactly once");
        knowledgeBase.api.openEditor({window:true,zettelId:research.id});
        let editor;
        for(let n=0;n<200;n++) {
          editor=[...Services.wm.getEnumerator("knowledge-base:editor")].find(win=>win.knowledgeBaseCardId===research.id);
          if(editor?.knowledgeBaseReady){await editor.knowledgeBaseReady();break;}
          await pause(25);
        }
        if(!editor)throw new Error("Templated native editor did not open");
        const frame=editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow.wrappedJSObject;
        if(frame.document.querySelectorAll('.primary-editor h2').length!==2 || !frame.document.querySelector('.primary-editor li'))throw new Error("User template headings and lists did not render in the native editor");
        await editor.setEditorMode("source",false);
        const markdown=editor.document.getElementById("knowledge-base-editor-body");
        if((markdown.value.match(/^## /gm)||[]).length!==2)throw new Error("User template structure did not survive switching to Markdown");
        markdown.value+="\\n\\nReader's own takeaway.";markdown.dispatchEvent(new editor.Event("input",{bubbles:true}));
        if(!(await editor.save(false)))throw new Error("Edited template note did not save");
        const savedResearch=await knowledgeBase.api.getZettel(research.id);
        if(!savedResearch.body.includes("Reader's own takeaway."))throw new Error("Template note lost the reader's own text");
        command(add);const secondID=selectedID();
        if(secondID===firstID || content.value!=="")throw new Error("A second new template reused the first template or its content");
        rename("实验计划");
        const custom="## Questions\\n\\nWhat should I investigate next?";
        write(custom);
        await chooseTemplate(firstID);await chooseTemplate(secondID);await chooseTemplate(null);await chooseTemplate(secondID);
        const customNote=await makeNote("Second-template Literature Note");
        if(customNote.card.body!==custom)throw new Error("The selected second template was not used");
        command(add);const temporaryID=selectedID();rename("Temporary template");
        const realConfirm=preferences.confirm;
        preferences.confirm=()=>false;command(remove);
        if(knowledgeBase.api.getLiteratureTemplateSettings().templates.length!==3)throw new Error("Cancelled template deletion removed content");
        preferences.confirm=()=>true;command(remove);preferences.confirm=realConfirm;
        if(details.hidden || knowledgeBase.api.getLiteratureTemplateSettings().templates.some(entry=>entry.id===temporaryID))throw new Error("Deleting a template did not keep the remaining templates editable");
        const without=await makeNote("Opted-out Literature Note");if(without.card.body!=="")throw new Error("No template did not produce a blank note");
        await chooseTemplate(firstID);
        if(content.value!==firstBody || name.value!=="阅读记录")throw new Error("Switching templates did not preserve independent names and bodies");
        const rootStyle=preferences.getComputedStyle(preferences.document.querySelector(".template-manager"));
        if(rootStyle.backgroundColor==='rgba(0, 0, 0, 0)' || rootStyle.backgroundColor===rootStyle.color) throw new Error('Template manager has no matching theme background');
        if (${process.env.KNOWLEDGE_BASE_HOST_COLOR_SCHEME === "dark"}) {
          const channels=rootStyle.backgroundColor.match(/\\d+/g)?.map(Number);
          if(!channels || channels.slice(0,3).some(value=>value>128)) throw new Error('Dark template manager kept a light background: '+JSON.stringify({background:rootStyle.backgroundColor,color:rootStyle.color,dark:preferences.matchMedia('(prefers-color-scheme: dark)').matches}));
        }

        const inputStyle=preferences.getComputedStyle(content);
        if(parseFloat(inputStyle.borderTopWidth)<1 || inputStyle.borderTopStyle==='none' || content.getBoundingClientRect().height<150)throw new Error('Template content does not look like an editable text field');
        preferences.focus();await pause(100);content.focus();await pause(50);
        if(preferences.document.hasFocus() && preferences.getComputedStyle(content).outlineStyle==='none')throw new Error('Template editor has no visible focus state: '+JSON.stringify({active:preferences.document.activeElement?.id,focused:preferences.document.hasFocus(),outline:preferences.getComputedStyle(content).outline,border:preferences.getComputedStyle(content).border}));
        rename("阅读记录（更新）");await chooseTemplate(secondID);await chooseTemplate(firstID);write(firstBody+"\\n\\nUpdated template instructions.");
        const edited=await makeNote("Updated-template Literature Note");
        if(!edited.card.body.endsWith("Updated template instructions."))throw new Error("Editing a template was not autosaved for future notes");
        await assertBody(blank.id,"");await assertBody(research.id,savedResearch.body);await assertBody(customNote.id,custom);await assertBody(without.id,"");
        if(await knowledgeBase.api.ensureLiteratureNote(blank.source.key,blank.source.libraryID)!==blank.id || (await knowledgeBase.api.getZettel(blank.id)).body!=="")throw new Error("Choosing a template modified an existing blank note");
        choice.scrollIntoView({block:"start"});await pause(100);
        await screenshot("literature-template-settings",preferences);
        await editor.setEditorMode("visual",false);
        await screenshot("literature-template-note",editor);
        await chooseTemplate(secondID);
        const settings=knowledgeBase.api.getLiteratureTemplateSettings();
        const notes=[{id:blank.id,body:""},{id:research.id,body:savedResearch.body},{id:customNote.id,body:custom},{id:without.id,body:""}];
        await editor.knowledgeBasePrepareNavigation();editor.close();preferences.close();
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,templatesOnly:true,notes,custom,selected:settings.selected,templates:settings.templates}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      if (${relationsOnly}) {
        if(await IOUtils.exists(${JSON.stringify(marker)})) {
          await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        const center=await knowledgeBase.api.saveZettel({initialTags:["Zettel"],title:"Responsive relations",body:"Central idea"});
        const native=await knowledgeBase.api.acquireNativeNote({id:center,initialTags:["Zettel"],title:"Responsive relations",body:"Central idea"});
        await knowledgeBase.api.releaseNativeNote(native.noteID);
        const titles=["Unsupervised Multiple-Change Detection in Very High Resolution Multisensor Images Via Deep-Learning Based Adaptation", "Large-Area Land-Cover Changes Monitoring With Time-Series Remote Sensing Images Using Transferable Deep Models", "窄窗口下用于验证长标题和笔记标识自动换行而且不重叠的中文笔记"];
        for(let i=0;i<titles.length;i++) {
          const input={initialTags:["Zettel"],title:titles[i],body:'[['+center+']]',customKey:i===2?'Layout'+"LongUnbrokenReference".repeat(8):'LayoutReference'+i,parentId:center};
          const id=await knowledgeBase.api.saveZettel(input);
          const note=await knowledgeBase.api.acquireNativeNote({id,...input});await knowledgeBase.api.releaseNativeNote(note.noteID);
        }
        await knowledgeBase.api.openEditor({window:true,zettelId:center});
        const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        let viewer;
        for(let n=0;n<200;n++) {
          viewer=[...Services.wm.getEnumerator('knowledge-base:editor')].find(win=>win.knowledgeBaseCardId===center);
          if(viewer?.knowledgeBaseReady){await viewer.knowledgeBaseReady();break;}
          await pause(25);
        }
        if(!viewer) throw new Error("Relation layout editor did not open");
        await viewer.refreshRelations();
        const metrics=[];
        for(const width of [1100,640,360]) {
          viewer.resizeTo(width,760);await pause(150);
          for(const group of ["children","backlinks"]) {
            viewer.document.getElementById('knowledge-base-editor-'+group+'-label').click();
            await pause(50);
            const list=viewer.document.getElementById('knowledge-base-editor-'+(group==='children'?'family':group));
            const buttons=[...list.querySelectorAll('.relation-link')];
            if(buttons.length!==3) throw new Error("Relation layout fixtures missing: "+group+" "+buttons.length);
            let previous=-Infinity;
            const rows=buttons.map(button=>{
              const text=button.querySelector('.note-reference-text');
              const bounds=button.getBoundingClientRect(),content=text.getBoundingClientRect(),style=viewer.getComputedStyle(button);
              const row={top:bounds.top,bottom:bounds.bottom,height:bounds.height,contentHeight:content.height,contentBottom:content.bottom,parentHeight:button.parentElement.getBoundingClientRect().height,maxHeight:style.maxHeight,boxSizing:style.boxSizing,display:style.display};
              const overlaps=previous>bounds.top+1 || content.bottom>bounds.bottom+1;
              previous=bounds.bottom;
              if(overlaps || button.scrollWidth>button.clientWidth+1 || text.scrollWidth>text.clientWidth+1) row.invalid=true;
              return row;
            });
            metrics.push({width,actualWidth:viewer.innerWidth,group,rows});
            const shots=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
            if(shots && group==='backlinks') {
              await IOUtils.makeDirectory(shots,{ignoreExisting:true});
              const section=viewer.document.getElementById('knowledge-base-editor-relations');
              const image=await viewer.browsingContext.currentWindowGlobal.drawSnapshot(section.getBoundingClientRect(),1,'white');
              const canvas=viewer.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
              const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await IOUtils.write(PathUtils.join(shots,'relations-'+width+'.png'),new Uint8Array(await blob.arrayBuffer()));
            }
          }
        }
        if(metrics.some(item=>item.rows.some(row=>row.invalid))) throw new Error("Wrapped relation rows overlap or overflow: "+JSON.stringify(metrics));
        await viewer.knowledgeBasePrepareNavigation();viewer.close();
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,relationsOnly:true,metrics}));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      if (await IOUtils.exists(${JSON.stringify(marker)})) {
        restarting = true;
        const first = JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
        if (first.linksOnly) {
          const card = await knowledgeBase.api.getZettel(first.cardID);
          const restoredNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID,first.noteKey);
          if(!card || !restoredNote || !knowledgeBase.api.getMarkdownSource(restoredNote.getNote()).body.includes('[[ProxyThinkerTestTimeGuidanceXiao26]]') || (restoredNote.getNote().split('title="[[ProxyThinkerTestTimeGuidanceXiao26]]"').length-1)!==3 || !(await knowledgeBase.api.getOutgoing(first.cardID)).some(link=>link.targetId===first.targetID)) throw new Error("Restart lost pasted or completed note links");
          await knowledgeBase.hooks.onShutdown();
          await IOUtils.writeUTF8(${JSON.stringify(restartMarker)},JSON.stringify({connectionsOnly:true}));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
        }
        if(knowledgeBase.api.getNoteSort()!=='created-desc') throw new Error('Restart lost the note sort preference');
        if(knowledgeBase.api.getWorkbenchMode()!=="window") throw new Error('Restart lost the workbench opening preference');
        if(knowledgeBase.api.getGraphLabelLength()!==18) throw new Error("Restart lost the graph title length");
        if(!knowledgeBase.api.getGraphOptions().hideIsolated) throw new Error('Restart lost the isolated-node filter preference');
        if(JSON.stringify(knowledgeBase.api.getGraphGroups())!==JSON.stringify([{tag:"#Ideas",color:"#aa22cc"}])) throw new Error('Restart lost tag inheritance or graph group settings');
        knowledgeBase.api.setWorkbenchMode("tab");
        const cards = await knowledgeBase.api.listZettels();
        const card = cards.find(row => row.id === first.cardID);
        if (cards.length !== 4 || card?.body !== "Recovered draft body" || (await knowledgeBase.api.getFamily(card.id)).children.length !== 1) throw new Error("Restart lost saved card content or hierarchy");
        const restartTrashNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.restartTrashKey);
        if (!restartTrashNote?.isInTrash() || !(await knowledgeBase.api.getZettel(first.restartTrashID)) || !(await knowledgeBase.api.searchZettelSummaries('',{availability:'trash',cardIDs:[first.restartTrashID]})).items.length) throw new Error('Restart lost the mapping for a note still in Zotero Trash');
        restartTrashNote.deleted = false; await restartTrashNote.saveTx();
        for (let n=0; n<100 && !(await knowledgeBase.api.searchZettelSummaries('',{availability:'active',cardIDs:[first.restartTrashID]})).items.length; n++) await new Promise(resolve=>setTimeout(resolve,25));
        const rebound = await knowledgeBase.api.acquireNativeNote({id:first.restartTrashID,title:'Trash across restart',body:''});
        const restoredTrashSource = knowledgeBase.api.getMarkdownSource(restartTrashNote.getNote());
        const originalTrashSource = knowledgeBase.api.getMarkdownSource(first.restartTrashHTML);
        const expectedTrashBody = originalTrashSource.body.replace('[Linked card](knowledge-base://card/' + first.cardID + ')', '[[' + first.cardID + '|Linked card]]');
        if (rebound.noteID !== restartTrashNote.id || restartTrashNote.key !== first.restartTrashKey || restoredTrashSource.title !== originalTrashSource.title || restoredTrashSource.body !== expectedTrashBody || !restartTrashNote.getNote().includes('<span class="math">$x^2$</span>') || !(await knowledgeBase.api.searchZettelSummaries('',{availability:'active',cardIDs:[first.restartTrashID]})).items.length || !(await knowledgeBase.api.getOutgoing(first.restartTrashID)).some(link=>link.targetId===first.cardID)) throw new Error('Native restore after restart lost identity, content or card links: ' + JSON.stringify({restoredTrashSource, expectedTrashBody, noteID:rebound.noteID, nativeID:restartTrashNote.id}));
        await knowledgeBase.api.releaseNativeNote(rebound.noteID);
        const keyedThinking = await knowledgeBase.api.getZettel(first.keyedThinkingID);
        if (!keyedThinking || keyedThinking.custom_key !== "HostProjectRevised" || keyedThinking.reference !== "HostProjectRevised" || (await knowledgeBase.api.resolveCardLink("knowledge-base://card/HostProject")).targetId !== first.keyedThinkingID) throw new Error("Restart lost Thinking keys or old links");
        if (keyedThinking.body !== "Interrupted host save" || (await knowledgeBase.api.listEditorDrafts()).some(draft => draft.draftId === "host-interrupted-save")) throw new Error("Restart did not reconcile the interrupted cross-database save");
        const organizedNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.noteKey);
        const organizedLoose = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.looseNoteKey);
        const organizedParent = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.personalParentKey);
        await Zotero.Items.loadDataTypes([organizedLoose], ["collections"]);
        if (!organizedNote.parentItemID || organizedLoose.parentItemID !== organizedParent.id || organizedLoose.getCollections().length) throw new Error("Startup did not organize existing linked notes");
        if (organizedParent.hasTag("Personal Knowledge") || !organizedParent.hasTag("User marker") || Zotero.Tags.getColors(organizedParent.libraryID).get("Personal Knowledge")?.color !== "#805ad5") throw new Error("Restart added an automatic tag or changed user tags/colors");
        const unmanaged = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.unmanagedKey);
        if (!unmanaged || unmanaged.getNote() !== "<p>Unmanaged library note</p>" || unmanaged.parentItemID !== organizedNote.parentItemID || cards.some(row => row.title === "Unmanaged library note")) throw new Error("Startup imported or moved an unmanaged library note");
        const projectCard = await knowledgeBase.api.getZettel(first.thinkingID);
        const readingCard = await knowledgeBase.api.getZettel(first.literatureID);
        const projectNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.thinkingKey);
        if (!projectCard || projectCard.item_key || !readingCard?.source_note || projectNote.parentItemID !== organizedNote.parentItemID || projectNote.getNote() !== first.thinkingHTML) throw new Error("Restart changed an linked note's type, content or placement");
        const linked = await knowledgeBase.api.acquireNativeNote({ id: card.id, title: card.title, body: card.body });
        const restoredNote = await Zotero.Items.getAsync(linked.noteID);
        if (!restoredNote.parentItemID || restoredNote.key !== first.noteKey || !restoredNote.getNote().includes("Recovered draft body")) throw new Error("Restart duplicated or lost the linked note");
        await knowledgeBase.api.releaseNativeNote(linked.noteID);
        if (!(await knowledgeBase.api.listEditorDrafts()).some(draft => draft.body === "Last keystroke before quitting")) throw new Error("Restart lost the recovery draft");
        if (!(await knowledgeBase.api.getEditorDraft(first.quittingWorkbenchDraftID))?.body.includes("Independent pending quit edit.")) throw new Error("Restart lost the independent workbench's final unsaved edit");
        if (!(await IOUtils.exists(PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base", "assets", first.legacyImage)))) throw new Error("Migration cleanup removed the original backup image");
        const nativeMarkdownNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.nativeMarkdownKey);
        if (!nativeMarkdownNote.getNote().includes('External edit preserved') || nativeMarkdownNote.getNote().includes('Conflicting native draft')) throw new Error("Quit overwrote a conflicting native note");
        const resumedInstance = await Zotero.Notes.open(nativeMarkdownNote.id, null, {openInWindow:true});
        const resumedWin = resumedInstance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
        for (let n = 0; n < 100 && !resumedWin.document.querySelector('.knowledge-base-native-markdown'); n++) await new Promise(resolve => setTimeout(resolve, 50));
        await openMarkdownToolbar(resumedInstance._iframeWindow);
        let resumedSource;
        for (let n = 0; n < 100; n++) {
          resumedSource = resumedWin.document.querySelector('.knowledge-base-native-source');
          if (resumedSource?.setSelectionRange && !resumedSource.hidden) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!resumedSource.value.includes('Conflicting native draft')) throw new Error("Restart lost native Markdown recovery draft");
        knowledgeBase.api.openManager({ window:true, selectId: card.id });
        knowledgeBase.api.openGraph({ centerId: card.id });
        for (const [name, paneID] of [["manager", "knowledge-base-list-pane"], ["graph", "graph-inspector"]]) {
          let pane;
          for (let n = 0; n < 100 && !pane?.style.flexBasis; n++) {
            const win = [...Services.wm.getEnumerator("knowledge-base:" + name)][0];
            pane = win?.document.getElementById(paneID);
            if (!pane?.style.flexBasis) await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (knowledgeBase.api.getPanelWidth(name) !== first.panelWidths[name] || pane?.style.flexBasis !== first.panelWidths[name] + "%") throw new Error("Restart did not restore the " + name + " panel width");
        }
        const restartedGraph = [...Services.wm.getEnumerator("knowledge-base:graph")][0];
        if(!restartedGraph.document.getElementById("graph-hide-isolated").checked) throw new Error('Restart did not restore the native isolated-node checkbox');
        knowledgeBase.api.setGraphOption("hideIsolated", false);
        await IOUtils.writeUTF8(${JSON.stringify(restartMarker)}, JSON.stringify({ cards: (await knowledgeBase.api.listZettels()).length, hiddenCards: cards.length, noteKey: restoredNote.key }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        return;
      }
      if ((await knowledgeBase.api.listZettels()).length) throw new Error("Fresh install contains preloaded user cards");
      const emptyClipboard = Zotero.Utilities.Internal.getClipboard("text/plain");
      if (await knowledgeBase.api.copyZettelList(()=>false) !== 0 || Zotero.Utilities.Internal.getClipboard("text/plain") !== emptyClipboard) throw new Error("Copying an empty Zettel list replaced the clipboard");
      const mainWindow=Zotero.getMainWindow();
      {
        const source = new Zotero.Item("journalArticle");
        source.libraryID = Zotero.Libraries.userLibraryID;
        source.setField("title", "Initial Literature ID fixture");
        await source.saveTx();
        const initialID = await knowledgeBase.api.ensureLiteratureNote(source.key, source.libraryID);
        if (!/^[0-9]{14}$/.test(initialID) || (await knowledgeBase.api.getZettel(initialID)).reference !== initialID || await knowledgeBase.api.ensureLiteratureNote(source.key, source.libraryID) !== initialID) throw new Error("New Literature Notes do not retain a unique initial timestamp ID");
        await eraseFixtureCard(initialID);
        await Zotero.Items.erase(source.id);
      }
      const entryButton=mainWindow.document.getElementById("knowledge-base-toolbar-button");
      if(entryButton?.parentElement.id!=="zotero-items-toolbar" || entryButton.getBoundingClientRect().width<20 || !mainWindow.getComputedStyle(entryButton).listStyleImage.includes("icon-20.svg") || mainWindow.document.getElementById("knowledge-base-menu-open-workbench-window")) throw new Error('Knowledge Base did not have one menu entry and its native library toolbar icon');
      async function openMarkdownToolbar(frameWindow) {
        let entry;
        for (let n = 0; n < 80 && !entry; n++) {
          entry = frameWindow.document.querySelector(".knowledge-base-markdown-toggle");
          if (!entry) await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (!entry || entry.getAttribute("aria-label") !== knowledgeBase.api.loc("editor-format-markdown")) throw new Error("Markdown switch is missing from the native toolbar");
        if (!entry.closest(".toolbar .start") || entry.closest(".popup")) throw new Error("Markdown switch is hidden inside a menu");
        entry.click();
      }
      function checkNativeEndSpace(frameWindow) {
        const surface=frameWindow.document.querySelector('.primary-editor');
        const style=frameWindow.getComputedStyle(surface);
        if(Math.abs(parseFloat(style.paddingBlockEnd)-frameWindow.innerHeight/2)>1 || style.paddingBlockStart!==style.getPropertyValue('--editor-padding-block').trim() || style.paddingInlineStart!==style.getPropertyValue('--editor-padding-inline').trim()) throw new Error('Native end-space changed the original top or side padding');
      }
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Isolated test source");
      item.setField("date", "2026");
      item.setCreators([{ firstName: "A", lastName: "Smith", creatorType: "author" }]);
      item.setField("publicationTitle", "Journal of Test Studies");
      item.setField("DOI", "10.1000/host-test");
      item.setField("extra", "Citation Key: Host2026");
      if (Zotero.ItemFields.getID("citationKey")) item.setField("citationKey", "Host2026");
      await item.saveTx();
      const note = new Zotero.Item("note");
      note.libraryID = item.libraryID;
      note.setNote("<p>Linked Zotero note</p>");
      await note.saveTx();
      if (!(await knowledgeBase.api.searchItems("Linked Zotero note")).some(match => match.key === note.key)) throw new Error("Zotero note search failed");
      if (!(await knowledgeBase.api.searchItems("Host2026")).some(match => match.key === item.key)) throw new Error("Citation key search failed");
      if ((await knowledgeBase.api.searchItems("NoSuchCitation2026")).length) throw new Error("Source search returned unrelated items");
      await knowledgeBase.api.openLink("zotero://select/library/items/" + note.key);
      if (Zotero.getMainWindow().ZoteroPane.getSelectedItems()[0]?.key !== note.key) throw new Error("Note hyperlink did not select its Zotero note");
      const unmanaged = new Zotero.Item("note");
      unmanaged.libraryID = item.libraryID;
      unmanaged.parentItemID = item.id;
      unmanaged.setNote("<p>Unmanaged library note</p>");
      await unmanaged.saveTx({skipSelect: true});

      // Exercise the optional native layout independently of full editor takeover.
      await knowledgeBase.api.setNativeNoteTakeover(false);
      const nativeMarkdownNote = new Zotero.Item("note");
      nativeMarkdownNote.libraryID = item.libraryID;
      nativeMarkdownNote.parentItemID = item.id;
      nativeMarkdownNote.addTag("Native Markdown test");
      nativeMarkdownNote.setNote('<div data-schema-version="9"><h1>Native Markdown</h1><p style="color: rgb(34,34,34); background-color: white">Ordinary <strong>text</strong></p><p><span class="math">$\\\\psi_1$</span>-norm</p><pre class="math">$$e=mc^2$$</pre></div>');
      await nativeMarkdownNote.saveTx({skipSelect: true});
      async function openNativeMarkdown() {
        const nativeInstance = await Zotero.Notes.open(nativeMarkdownNote.id, null, {openInWindow: true});
        const nativeWindow = nativeInstance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
        for (let n = 0; n < 100 && !nativeWindow.document.querySelector('.knowledge-base-native-markdown'); n++) await new Promise(resolve => setTimeout(resolve, 50));
        let source = nativeWindow.document.querySelector('.knowledge-base-native-source');
        if (source?.querySelector('iframe')) throw new Error('Native mode eagerly allocated a Markdown frame');
        if (!source) throw new Error("Native note Markdown switch was not attached");
        if (!nativeWindow.document.querySelector('.knowledge-base-native-markdown').hidden) throw new Error('Markdown adds a redundant toolbar in native mode');
        await openMarkdownToolbar(nativeInstance._iframeWindow);
        const toggle = nativeInstance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle');
        for (let n = 0; n < 100; n++) {
          source = nativeWindow.document.querySelector('.knowledge-base-native-source');
          if (source?.setSelectionRange && !source.hidden) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (source.hidden || !nativeInstance._disableSaving || nativeInstance._iframeWindow.browsingContext.embedderElement.hidden || toggle.getAttribute("aria-pressed") !== "true") throw new Error("Native Markdown did not disable the hidden host writer");
        return {nativeInstance, nativeWindow, source, toggle};
      }
      let nativeMD = await openNativeMarkdown();
      if (!nativeMD.source.value.startsWith('# Native Markdown') || !nativeMD.source.value.includes('Ordinary **text**') || !nativeMD.source.value.includes('e=mc^2') || nativeMD.source.value.includes('style=')) throw new Error("Native Markdown remains opaque for ordinary content");
      if(nativeMD.nativeInstance._iframeWindow.document.querySelector('.knowledge-base-reading-toggle,.knowledge-base-reading-view')) throw new Error('Ordinary notes still expose browsing mode');
      const beforeNativeSwitch = nativeMarkdownNote.getNote();
      nativeMD.toggle.click();
      for (let n = 0; n < 100 && !nativeMD.source.hidden; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMD.source.hidden || nativeMarkdownNote.getNote() !== beforeNativeSwitch) throw new Error("Unchanged native Markdown switch rewrote the note: " + JSON.stringify({hidden:nativeMD.source.hidden, before:beforeNativeSwitch, after:nativeMarkdownNote.getNote(), status:nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent}));
      nativeMD.toggle.click();
      for (let n = 0; n < 100 && nativeMD.source.hidden; n++) await new Promise(resolve => setTimeout(resolve, 50));
      const otherNativeInstance = await Zotero.Notes.open(nativeMarkdownNote.id, null, {allowDuplicate: true});
      if (otherNativeInstance === nativeMD.nativeInstance) throw new Error('Concurrent editor test reused the same instance');
      await otherNativeInstance._save({html: nativeMarkdownNote.getNote().replace('Ordinary', 'Updated in another editor')});
      for (let n = 0; n < 100 && !nativeMD.source.value.includes('Updated in another editor'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMD.source.value.includes('Updated in another editor') || !nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-markdown').hidden || (await knowledgeBase.api.getEditorDraft('native-document:' + nativeMarkdownNote.libraryID + ':' + nativeMarkdownNote.key))) throw new Error('Clean native Markdown did not follow a save from another editor: ' + JSON.stringify({sameInstance: otherNativeInstance === nativeMD.nativeInstance, html: nativeMarkdownNote.getNote(), source: nativeMD.source.value, bar: nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-markdown').outerHTML, draft: await knowledgeBase.api.getEditorDraft('native-document:' + nativeMarkdownNote.libraryID + ':' + nativeMarkdownNote.key)}));
      Zotero.getMainWindow().Zotero_Tabs.close(otherNativeInstance._tabID);
      await new Promise(resolve => setTimeout(resolve, 100));
      nativeMD.source.value += "\\n\\nNative Markdown saved **in place**\\n\\n$$T_{i,k}\\n=\\n\\\\sum_{u=1}^{a_{i,k}} X_{i,k}^{(u)}$$" + Array.from({length:40},(_,n)=>"\\n\\nScroll paragraph " + n).join("");
      nativeMD.source.value = nativeMD.source.value.replace('# Native Markdown', 'Native Markdown\\n===============');
      const unformattedNativeSource = nativeMD.source.value;
      if (unformattedNativeSource.includes('\\\\-norm')) throw new Error('Inline math added an unnecessary escape before prose');
      const nativeCursor = nativeMD.source.value.indexOf('Scroll paragraph 20') + 8;
      nativeMD.nativeWindow.focus(); nativeMD.source.focus();
      nativeMD.source.setSelectionRange(nativeCursor,nativeCursor);
      await new Promise(resolve => setTimeout(resolve,100));
      nativeMD.source.scrollTop = 450;
      await new Promise(resolve => setTimeout(resolve,100));
      const nativeScroll = nativeMD.source.scrollTop;
      if(nativeScroll < 400) throw new Error('Native Markdown scroll fixture was not laid out');
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.Event('input'));
      for (let n = 0; n < 100 && !nativeMarkdownNote.getNote().includes('in place'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMarkdownNote.getNote().includes('<strong>in place</strong>') || nativeMarkdownNote.parentItemID !== item.id || !nativeMarkdownNote.hasTag('Native Markdown test') || (nativeMarkdownNote.getNote().match(/<h1/g) || []).length !== 1 || (await knowledgeBase.api.listZettels()).length) throw new Error("Native Markdown changed identity/placement or silently imported a note");
      for (let n = 0; n < 100 && nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent !== knowledgeBase.api.loc('editor-saved'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      await new Promise(resolve => setTimeout(resolve,600));
      const ownSaveStatus = nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent;
      if (nativeMD.source.value !== unformattedNativeSource) throw new Error('Saving automatically formatted native Markdown source');
      const normalizedNativeHTML = nativeMarkdownNote.getNote().replace(/data-schema-version="[^"]+"/, 'data-schema-version="9" data-knowledge-base-host-normalization="true"');
      nativeMarkdownNote.setNote(normalizedNativeHTML);
      await nativeMarkdownNote.saveTx();
      await new Promise(resolve => setTimeout(resolve,200));
      if (nativeMD.source.value !== unformattedNativeSource) throw new Error('Equivalent HTML normalization reformatted the author source');
      if(nativeMD.source.selectionStart !== nativeCursor || nativeMD.source.selectionEnd !== nativeCursor || Math.abs(nativeMD.source.scrollTop-nativeScroll)>5 || ownSaveStatus !== knowledgeBase.api.loc('editor-saved') || nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent === knowledgeBase.api.loc('native-markdown-conflict')) throw new Error('Own native Markdown save reset cursor/viewport or reported a conflict: ' + JSON.stringify({cursor:nativeMD.source.selectionStart,expected:nativeCursor,scroll:nativeMD.source.scrollTop,expectedScroll:nativeScroll,status:ownSaveStatus}));
      const mathSourceDoc=nativeMD.source.querySelector('iframe').contentDocument;
      const normAt = nativeMD.source.value.indexOf('-norm');
      nativeMD.source.setSelectionRange(normAt,normAt);
      await new Promise(resolve => setTimeout(resolve,100));
      const normLine = [...mathSourceDoc.querySelectorAll('.cm-line')].find(line=>line.textContent.includes('-norm'));
      if (!normLine || [...normLine.querySelectorAll('span')].some(span => mathSourceDoc.defaultView.getComputedStyle(span).color !== mathSourceDoc.defaultView.getComputedStyle(normLine).color)) throw new Error('Formula-adjacent prose has incorrect syntax colors');
      // Force the formula into the viewport so CodeMirror mounts its styled lines.
      const formulaAt=nativeMD.source.value.indexOf('$$T_{i,k}');
      nativeMD.source.setSelectionRange(formulaAt,formulaAt);
      await new Promise(resolve => setTimeout(resolve,100));
      const equalsLine=[...mathSourceDoc.querySelectorAll('.cm-line')].find(line=>line.textContent.trim()==='=');
      if(!equalsLine || [...equalsLine.querySelectorAll('span')].some(span=>['700','bold'].includes(mathSourceDoc.defaultView.getComputedStyle(span).fontWeight))) throw new Error('LaTeX equals line is still styled as a heading');
      if(!nativeMarkdownNote.getNote().includes('T_{i,k}') || (nativeMarkdownNote.getNote().match(/<pre class="math"/g) || []).length !== 2) throw new Error('Multiline equation did not save as native display math');
      nativeMD.source.value = nativeMD.source.value.replace('Updated in another editor', 'Local first paragraph');
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.Event('input'));
      nativeMarkdownNote.setNote(nativeMarkdownNote.getNote().replace('in place', 'Remote independent paragraph'));
      await nativeMarkdownNote.saveTx();
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.KeyboardEvent('keydown', {key:'s', metaKey:true, bubbles:true, cancelable:true}));
      for (let n = 0; n < 100 && (!nativeMarkdownNote.getNote().includes('Local first paragraph') || !nativeMarkdownNote.getNote().includes('Remote independent paragraph')); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMarkdownNote.getNote().includes('Local first paragraph') || !nativeMarkdownNote.getNote().includes('Remote independent paragraph')) throw new Error('Independent native Markdown edits were not merged');
      for (let n = 0; n < 100 && nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent !== knowledgeBase.api.loc('editor-saved'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      nativeMarkdownNote.setNote(nativeMarkdownNote.getNote().replace('Remote independent paragraph', 'in place'));
      await nativeMarkdownNote.saveTx();
      nativeMD.source.value = nativeMD.source.value.replace('in place', 'Conflicting native draft');
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.Event('input'));
      nativeMarkdownNote.setNote(nativeMarkdownNote.getNote().replace('in place', 'External edit preserved'));
      await nativeMarkdownNote.saveTx();
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.KeyboardEvent('keydown', {key:'s', metaKey:true, bubbles:true, cancelable:true}));
      const nativeStatus = nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status');
      for (let n = 0; n < 100 && !nativeStatus.textContent.includes(knowledgeBase.api.loc('native-markdown-conflict')); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMarkdownNote.getNote().includes('External edit preserved') || nativeMarkdownNote.getNote().includes('Conflicting native draft') || nativeStatus.textContent !== knowledgeBase.api.loc('native-markdown-conflict')) throw new Error("Native Markdown overwrote an external change: " + JSON.stringify({html: nativeMarkdownNote.getNote(), status:nativeStatus.outerHTML, alive:nativeMD.source.isConnected, draft:await knowledgeBase.api.getEditorDraft("native-document:" + nativeMarkdownNote.libraryID + ":" + nativeMarkdownNote.key)}));
      let nativeCloseAsked = 0;
      let nativeCloseDialog;
      const nativeChoices = ['cancel', 'extra1'];
      const nativeCloseObserver = {observe(win, topic) {
        if (topic !== 'domwindowopened') return;
        win.addEventListener('load', () => {
          if (win.document.documentURI !== 'chrome://global/content/commonDialog.xhtml') return;
          setTimeout(() => {
            nativeCloseDialog=win;
            nativeCloseAsked++;
            win.document.getElementById('commonDialog').getButton(nativeChoices.shift()).click();
          }, 100);
        }, {once:true});
      }};
      Services.ww.registerNotification(nativeCloseObserver);
      try {
        await new Promise(resolve => setTimeout(() => {
          nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.KeyboardEvent('keydown', {key:'w', metaKey:true, bubbles:true, cancelable:true}));
          resolve();
        }, 0));
        for (let n = 0; n < 100 && nativeCloseAsked < 1 && !nativeMD.nativeWindow.closed; n++) await new Promise(resolve => setTimeout(resolve, 50));
        for(let n=0;n<100 && !nativeCloseDialog?.closed;n++) await new Promise(resolve=>setTimeout(resolve,25));
        await new Promise(resolve=>setTimeout(resolve,50));
        if (nativeMD.nativeWindow.closed || nativeCloseAsked !== 1 || !nativeCloseDialog?.closed) throw new Error("Native Markdown Command-W cancellation failed");
        await new Promise(resolve => setTimeout(() => {
          nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.KeyboardEvent('keydown', {key:'w', metaKey:true, bubbles:true, cancelable:true}));
          resolve();
        }, 0));
        for (let n = 0; n < 100 && !nativeMD.nativeWindow.closed; n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (!nativeMD.nativeWindow.closed) throw new Error("Native Markdown keep-draft close failed");
      } finally { Services.ww.unregisterNotification(nativeCloseObserver); }
      nativeMD = await openNativeMarkdown();
      if (!nativeMD.source.value.includes('Conflicting native draft') || (await knowledgeBase.api.listEditorDrafts()).some(draft => draft.nativeDocument)) throw new Error("Native Markdown draft did not restore separately from card recovery");
      // Keep this conflicting native draft open until quit, then verify recovery after restart.
      const thinking = new Zotero.Item("note");
      thinking.libraryID = item.libraryID;
      thinking.parentItemID = item.id;
      thinking.setNote('<div data-schema-version="9"><h1>Existing project</h1><p>[[]] Original thinking</p></div>');
      thinking.setTags([{tag: "#Ideas"}]);
      await thinking.saveTx({skipSelect: true});
      const originalThinking = thinking.getNote();
      const thinkingID = await seedMappedNote({noteID: thinking.id, initialTags:["Thinking Note"]});
      const sameThinkingID = await seedMappedNote({noteID: thinking.id, initialTags:["Thinking Note"]});
      if (thinkingID !== sameThinkingID || thinking.getNote() !== originalThinking || thinking.parentItemID !== item.id || thinking.getTags()[0]?.tag !== "#Ideas") throw new Error("Registering an existing note copied or changed it");
      const acquiredThinking = await knowledgeBase.api.acquireNativeNote({id: thinkingID, title: "", body: ""});
      if (acquiredThinking.noteID !== thinking.id || thinking.parentItemID !== item.id) throw new Error("Existing project note identity or placement changed on open");
      await knowledgeBase.api.releaseNativeNote(thinking.id);
      const literatureID = await seedMappedNote({noteID: note.id, sourceNote:true, itemKey: item.key, libraryID: item.libraryID});
      let duplicateLiteratureRejected = false;
      try { await seedMappedNote({noteID: thinking.id, sourceNote:true, itemKey: item.key, libraryID: item.libraryID}); } catch (error) { duplicateLiteratureRejected = String(error).includes("LITERATURE_EXISTS"); }
      if (!duplicateLiteratureRejected || (await knowledgeBase.api.getZettel(thinkingID)).source_note !== 0) throw new Error("Duplicate Literature Note was not rejected atomically");
      await knowledgeBase.api.saveZettel({id: thinkingID, initialTags:["Thinking Note"], title: "Existing project", body: "[Reading](zotero://note/u/" + note.key + "/)"});
      if ((await knowledgeBase.api.getOutgoing(thinkingID))[0]?.targetId !== literatureID) throw new Error("Native note links did not enter the graph");
      await Promise.all([knowledgeBase.api.openLiteratureNote(item.key, item.libraryID), knowledgeBase.api.openLiteratureNote(item.key, item.libraryID)]);
      const literatureMain = Zotero.getMainWindow();
      let literatureInline;
      for (let n = 0; n < 150; n++) {
        const manager = literatureMain.document.querySelector(".knowledge-base-workbench")?.contentWindow;
        literatureInline = manager?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
        if (literatureInline?.knowledgeBaseCardId === literatureID && literatureInline.document.getElementById("knowledge-base-rich-frame")?.getCurrentInstance()?._item.id === note.id) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (literatureInline?.knowledgeBaseCardId !== literatureID || literatureInline.document.getElementById("knowledge-base-rich-frame")?.getCurrentInstance()?._item.id !== note.id || literatureMain.document.querySelectorAll(".knowledge-base-workbench").length !== 1) throw new Error("Literature requests did not reuse the native note in one Tab");
      literatureMain.Zotero_Tabs.close(literatureMain.Zotero_Tabs.selectedID);
      for (let n = 0; n < 100 && literatureMain.document.querySelector(".knowledge-base-workbench"); n++) await new Promise(resolve => setTimeout(resolve, 25));
      await knowledgeBase.api.openEditor({window:true, zettelId:literatureID});
      let literatureEditors = [];
      for (let n = 0; n < 100; n++) {
        literatureEditors = [...Services.wm.getEnumerator("knowledge-base:editor")];
        if (literatureEditors.length) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (literatureEditors.length !== 1 || (await knowledgeBase.api.listByItem(item.key)).length !== 1) throw new Error("Repeated literature requests opened duplicate notes or windows: " + literatureEditors.length + "/" + (await knowledgeBase.api.listByItem(item.key)).length);
      const literatureEditor = literatureEditors[0];
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (literatureEditor.document.getElementById("knowledge-base-note-kind") || literatureEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== note.id) throw new Error("Literature UI did not reuse the linked native note");
      const literatureIDField = literatureEditor.document.getElementById("knowledge-base-editor-key");
      const literatureIDCopy = literatureEditor.document.getElementById("knowledge-base-key-copy");
      if (literatureIDField.value !== "Host2026" || (await knowledgeBase.api.getZettel(literatureID)).reference !== "Host2026" || literatureIDField.hidden) throw new Error("An existing Literature Note has no copyable ID");
      literatureIDCopy.click();
      for(let n=0;n<100 && Zotero.Utilities.Internal.getClipboard('text/plain')!=='[[Host2026]]';n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(Zotero.Utilities.Internal.getClipboard('text/plain')!=='[[Host2026]]')throw new Error('Clicking the ID did not copy the note reference');
      if ((await knowledgeBase.api.resolveCardLink("knowledge-base://card/%40Host2026"))?.targetId !== literatureID) throw new Error("Literature citation-key navigation failed");
      const noteLink = "[[@Host2026]]";
      const noteLinkHTML = await knowledgeBase.api.nativeNoteHTML("", noteLink);
      if (!knowledgeBase.api.getMarkdownSource(noteLinkHTML).body.includes("[[Host2026]]") || !noteLinkHTML.includes('href="zotero://select/library/items/' + note.key + '"') || (await knowledgeBase.api.getDraftLinks(noteLink + " [@Host2026]")).length !== 1) throw new Error("Native Markdown roundtrip confused note links with item citations");
      if(!noteLinkHTML.includes('>Smith 2026</a>') || !(await knowledgeBase.api.nativeNoteHTML('', '[[' + literatureID + '|My reading]]')).includes('>My reading</a>')) throw new Error('Literature native link labels do not use author-year or lost explicit aliases');
      await knowledgeBase.api.saveZettel({id: thinkingID, initialTags:["Thinking Note"], title: "Existing project", body: noteLink});
      if ((await knowledgeBase.api.getOutgoing(thinkingID))[0]?.targetId !== literatureID || !(await knowledgeBase.api.getBacklinks(literatureID)).some(link => link.sourceId === thinkingID)) throw new Error("Literature reference was not indexed into backlinks");
      await openMarkdownToolbar(literatureEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow);
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "source"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      const literatureBody = literatureEditor.document.getElementById("knowledge-base-editor-body");
      const concurrentLiterature = await Zotero.Notes.open(note.id, null, {openInWindow: true});
      concurrentLiterature._postMessage({action: 'insertHTML', html: '<p>Shared session update</p>'});
      for (let n = 0; n < 100 && (!note.getNote().includes('Shared session update') || !literatureBody.value.includes('Shared session update')); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!note.getNote().includes('Shared session update') || !literatureBody.value.includes('Shared session update') || literatureEditor.document.getElementById('knowledge-base-editor-status').textContent === knowledgeBase.api.loc('editor-save-conflict')) throw new Error('Knowledge Base Markdown did not follow its shared native note session');
      concurrentLiterature._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      literatureBody.value += "\\n\\nLiterature synthesis";
      literatureBody.dispatchEvent(new literatureEditor.Event("input", {bubbles: true}));
      if (!(await literatureEditor.save(false)) || (note.getNote().match(/Linked Zotero note/g) || []).length !== 1) throw new Error("Markdown editing duplicated an existing note's title paragraph");
      if (note.parentItemID !== item.id) throw new Error("Saving an existing note with the same source did not attach it to that source");
      literatureEditor.document.getElementById("knowledge-base-editor-format").dispatchEvent(new literatureEditor.Event("command", {bubbles: true}));
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      const otherParent = new Zotero.Item("book");
      otherParent.libraryID = item.libraryID;
      otherParent.setField("title", "Other parent");
      await otherParent.saveTx({skipSelect:true});
      note.parentItemID = otherParent.id; await note.saveTx({skipSelect:true});
      const beforeSourceReselect = {id:note.id, key:note.key, html:note.getNote()};
      literatureEditor.document.getElementById("knowledge-base-src-pick").click();
      const reselectSearch = literatureEditor.document.getElementById("knowledge-base-src-search");
      reselectSearch.value = "Isolated test source";
      reselectSearch.dispatchEvent(new literatureEditor.Event("input", {bubbles:true}));
      let reselectRow;
      for (let n = 0; n < 100; n++) {
        reselectRow = [...literatureEditor.document.querySelectorAll("#knowledge-base-src-results li")].find(row => row.querySelector(".sr-title")?.textContent === "Isolated test source");
        if (reselectRow) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!reselectRow) throw new Error("Existing-note source picker did not find its source");
      reselectRow.click();
      if (!(await literatureEditor.save(false)) || note.parentItemID !== item.id || note.id !== beforeSourceReselect.id || note.key !== beforeSourceReselect.key || note.getNote() !== beforeSourceReselect.html) throw new Error("Reselecting the same source did not move the existing note intact: " + JSON.stringify({before:beforeSourceReselect, after:{id:note.id,key:note.key,html:note.getNote(),parent:note.parentItemID}, status:literatureEditor.document.getElementById("knowledge-base-editor-status").textContent}));
      if (literatureEditor.document.getElementById("knowledge-base-metadata") || literatureEditor.document.getElementById("knowledge-base-tag") || literatureEditor.document.getElementById("knowledge-base-editor-mode")) throw new Error("Editor still exposes metadata, a type selector or Browse mode");
      if (literatureEditor.document.getElementById("knowledge-base-editor-status").textContent.includes(literatureID)) throw new Error("Editor exposes its internal note ID");
      item.setField("extra", "Citation Key: HostRenamed2026");
      if (Zotero.ItemFields.getID("citationKey")) item.setField("citationKey", "HostRenamed2026");
      await item.saveTx();
      for (let n = 0; n < 100 && (!(await knowledgeBase.api.resolveCardLink("knowledge-base://card/%40HostRenamed2026"))?.targetId || literatureIDField.value !== "HostRenamed2026"); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (literatureIDField.value !== "HostRenamed2026" || (await knowledgeBase.api.resolveCardLink("knowledge-base://card/%40Host2026"))?.targetId !== literatureID) throw new Error("Citation-key change lost the stable note reference");
      item.setField("publicationTitle", "Journal of Test Studies");
      item.setField("DOI", "10.1000/host-test");
      item.setField("extra", "Citation Key: Host2026");
      if (Zotero.ItemFields.getID("citationKey")) item.setField("citationKey", "Host2026");
      await item.saveTx();
      const originalLiteratureHTML = note.getNote();
      item.setField("title", "Updated parent item title");
      item.setField("publisher", "Live metadata publisher");
      await item.saveTx();
      const parentDisplay = literatureEditor.document.getElementById("knowledge-base-src-display");
      for (let n = 0; n < 100 && !parentDisplay.textContent.includes("Updated parent item title"); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!parentDisplay.textContent.includes("Updated parent item title") || note.getNote() !== originalLiteratureHTML) throw new Error("Parent item title did not refresh without rewriting note content");
      const formatted = await knowledgeBase.api.getSourceReference(item.key, item.libraryID);
      if (!formatted.includes("Smith") || !formatted.includes("2026") || !formatted.includes("<i>Updated parent item title</i>") || !formatted.includes("Journal of Test Studies") || formatted.includes("csl-")) throw new Error("Source reference did not follow item fields: " + formatted);
      if (!Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === "knowledge-base-preferences") || note.getNote() !== originalLiteratureHTML) throw new Error("Source Settings are missing or rendering rewrote the note");
      const preferences = Zotero.Utilities.Internal.openPreferences("knowledge-base-preferences");
      if (preferences.document.getElementById("knowledge-base-source-style")) throw new Error("Source style control remains");
      if(preferences.document.getElementById("knowledge-base-ai-open") || Zotero.PreferencePanes.pluginPanes.some(pane=>pane.id==="knowledge-base-ai-preferences"))throw new Error("Retired AI Settings remain available");
      Zotero.Utilities.Internal.openPreferences("knowledge-base-preferences");
      for(let n=0;n<100 && !preferences.document.getElementById("knowledge-base-workbench-mode")?.getBoundingClientRect().width;n++) await new Promise(resolve=>setTimeout(resolve,20));
      const modeMenu=preferences.document.getElementById("knowledge-base-workbench-mode");
      if(modeMenu?.value!=="tab" || modeMenu.getAttribute("native")!=="true" || !modeMenu.querySelector('menuitem[value="window"]').label) throw new Error('Native Settings workbench mode did not initialize');
      modeMenu.value="window";modeMenu.dispatchEvent(new preferences.Event("command",{bubbles:true}));
      if(knowledgeBase.api.getWorkbenchMode()!=="window") throw new Error('Native Settings did not persist separate-window mode');
      modeMenu.value="tab";modeMenu.dispatchEvent(new preferences.Event("command",{bubbles:true}));
      preferences.document.getElementById("knowledge-base-graph-appearance").open=true;
      const labelLengthControl=preferences.document.getElementById("knowledge-base-graph-label-length");
      if(labelLengthControl?.value !== "20" || labelLengthControl.getBoundingClientRect().width < 30) throw new Error('Graph title length setting is missing or invisible');
      labelLengthControl.value="18";labelLengthControl.dispatchEvent(new preferences.Event("change",{bubbles:true}));
      if(knowledgeBase.api.getGraphLabelLength()!==18) throw new Error('Graph title length did not autosave');
      labelLengthControl.value="0";labelLengthControl.dispatchEvent(new preferences.Event("change",{bubbles:true}));
      if(labelLengthControl.value!=="18" || knowledgeBase.api.getGraphLabelLength()!==18) throw new Error('Invalid graph title length was accepted');
      const metadataShots = ${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
      if(preferences.document.getElementById('knowledge-base-inherit-tags')) throw new Error('Fixed tag inheritance is still configurable');
      const expectedGraphTags=[...new Set((await knowledgeBase.api.getGraph()).nodes.flatMap(node=>node.tags||[]))].sort((a,b)=>a.localeCompare(b));
      if(JSON.stringify(await knowledgeBase.api.getGraphTags())!==JSON.stringify(expectedGraphTags)) throw new Error("Settings tag vocabulary differs from graph inheritance");
      const addGroup=preferences.document.getElementById("knowledge-base-add-group");
      if(!addGroup.label || !addGroup.querySelector(".button-text")) throw new Error('Native Add Group button lost its localized label or content');
      const configureGroup=async (color)=>{
        const count=preferences.document.querySelectorAll(".graph-group-row").length;
        addGroup.dispatchEvent(new preferences.Event("command",{bubbles:true}));
        for(let n=0;n<100 && preferences.document.querySelectorAll(".graph-group-row").length===count;n++) await new Promise(resolve=>setTimeout(resolve,25));
        const group=preferences.document.querySelector(".graph-group-row:last-child");
        const tag=group.querySelector(".graph-group-tag");tag.value="#Ideas";tag.dispatchEvent(new preferences.Event("command",{bubbles:true}));
        const picker=group.querySelector(".graph-group-color");picker.value=color;picker.dispatchEvent(new preferences.Event("change",{bubbles:true}));
        if(!tag.querySelector('menuitem[value="#Ideas"]') || tag.getBoundingClientRect().width<100 || picker.getBoundingClientRect().width<20) throw new Error('Native graph-group controls did not render');
      };
      await configureGroup("#aa22cc");await configureGroup("#2288aa");
      preferences.document.querySelector(".graph-group-row:last-child .graph-group-up").dispatchEvent(new preferences.Event("command",{bubbles:true}));
      if(knowledgeBase.api.getGraphGroups()[0].color!=="#2288aa") throw new Error('Native Settings did not reorder graph-group priority');
      preferences.document.querySelector(".graph-group-row .graph-group-remove").dispatchEvent(new preferences.Event("command",{bubbles:true}));
      if(JSON.stringify(knowledgeBase.api.getGraphGroups())!==JSON.stringify([{tag:"#Ideas",color:"#aa22cc"}]) || preferences.document.querySelectorAll(".graph-group-row").length!==1) throw new Error('Native Settings did not save graph tag/color rules');
      if (metadataShots) {
        await IOUtils.makeDirectory(metadataShots, {ignoreExisting: true});
        for(const [name,view] of [["literature-editor",literatureEditor],["library-toolbar",mainWindow],["preferences",preferences]]) {
        const image = await view.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = view.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        await IOUtils.write(PathUtils.join(metadataShots, name+".png"), new Uint8Array(await blob.arrayBuffer()));
        }
      }
      preferences.close();
      item.setField("title", "Isolated test source");
      await item.saveTx();
      Zotero.debug('Knowledge Base host stage: persisted reference labels and inline wiki input');
      const referenceID = await knowledgeBase.api.saveZettel({title:'Reference label probe', body:'[[' + literatureID + ']] [[' + literatureID + '|Pinned label]] $x^2$'});
      const referenceMapping = await knowledgeBase.api.acquireNativeNote({id:referenceID,title:'Reference label probe',body:''});
      const referenceNote = await Zotero.Items.getAsync(referenceMapping.noteID);
      await knowledgeBase.api.releaseNativeNote(referenceNote.id);
      const literatureBeforeLabels = note.getNote();
      item.setCreators([{firstName:'B',lastName:'Jones',creatorType:'author'}]);
      item.setField('date','2027');
      await item.saveTx();
      for(let n=0;n<150 && !referenceNote.getNote().includes('>Jones 2027</a>');n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!referenceNote.getNote().includes('>Jones 2027</a>') || !referenceNote.getNote().includes('>Pinned label</a>') || note.getNote() !== literatureBeforeLabels) throw new Error('Author-year metadata updates changed Literature titles, aliases or failed to update native link text');
      const unchangedReferenceHTML = referenceNote.getNote();
      item.setField('publisher','Reference label invariant'); await item.saveTx();
      await knowledgeBase.api.prepareMarkdown('[[' + literatureID + ']]');
      await new Promise(resolve=>setTimeout(resolve,100));
      if(referenceNote.getNote() !== unchangedReferenceHTML) throw new Error('Unrelated source metadata rewrote a note with unchanged reference labels');
      await knowledgeBase.api.openEditor({window:true,zettelId:referenceID});
      let quickLinkEditor;
      for(let n=0;n<150;n++) {
        quickLinkEditor = [...Services.wm.getEnumerator('knowledge-base:editor')].find(view=>view.knowledgeBaseCardId === referenceID);
        const candidate = quickLinkEditor?.document.getElementById('knowledge-base-rich-frame')?.getCurrentInstance()?._iframeWindow;
        if(quickLinkEditor?.document.getElementById('knowledge-base-editor-root')?.dataset.mode === 'visual' && candidate?.document.querySelector('.primary-editor') && candidate.getSelection()) break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      if(!quickLinkEditor) throw new Error('Inline wiki input editor did not open');
      const quickFrame = quickLinkEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow;
      const quickParagraph = quickFrame.document.querySelector('.primary-editor p');
      quickLinkEditor.focus(); quickParagraph.closest('.primary-editor').focus();
      const quickRange = quickFrame.document.createRange(); quickRange.selectNodeContents(quickParagraph); quickRange.collapse(false);
      quickFrame.getSelection().removeAllRanges(); quickFrame.getSelection().addRange(quickRange);
      await new Promise(resolve=>setTimeout(resolve,50));
      quickFrame.document.execCommand('insertText',false,' [[Host2026]]');
      for(let n=0;n<150 && [...quickFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[Host2026]]').length !== 2;n++) await new Promise(resolve=>setTimeout(resolve,25));
      if([...quickFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[Host2026]]').length !== 2) throw new Error('Typing [[id]] in the native Knowledge Base editor did not insert the resolved native link: ' + quickFrame.document.querySelector('.primary-editor').innerHTML);
      if(!quickFrame.wrappedJSObject.doUndo()) throw new Error('Native undo cannot reverse inline wiki insertion');
      for(let n=0;n<100 && [...quickFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[Host2026]]').length === 2;n++) await new Promise(resolve=>setTimeout(resolve,25));
      if([...quickFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[Host2026]]').length === 2) throw new Error('Native undo left the inserted wiki link unchanged');
      if(!quickFrame.wrappedJSObject.doRedo()) throw new Error('Native redo cannot restore inline wiki insertion');
      for(let n=0;n<100 && [...quickFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[Host2026]]').length !== 2;n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!(await quickLinkEditor.save(false)) || referenceNote.getNoteTitle() !== 'Reference label probe' || !referenceNote.getNote().includes('>Jones 2027</a>') || !referenceNote.getNote().includes('$x^2$')) throw new Error('Inline wiki input did not save a native link while preserving title and math');
      const quickCore = quickFrame.wrappedJSObject._currentEditorInstance._editorCore;
      const readStarted = quickFrame.performance.now();
      for(let n=0;n<1000;n++) quickFrame.wrappedJSObject.getDataSync(false);
      const fullReadMs = quickFrame.performance.now() - readStarted;
      const htmlStarted = quickFrame.performance.now();
      for(let n=0;n<1000;n++) quickCore.getHTML();
      const editorSnapshotTiming = {iterations:1000,fullStateMs:fullReadMs,htmlOnlyMs:quickFrame.performance.now()-htmlStarted};
      Zotero.debug('Knowledge Base editor snapshot timing: ' + JSON.stringify(editorSnapshotTiming));
      const quickSelection = quickFrame.getSelection();
      if(!quickSelection.isCollapsed || quickSelection.anchorNode?.parentElement?.closest('h1')) throw new Error('Inline wiki replacement reset the editing cursor');
      if(${linksOnly}) {
        const targetID=await knowledgeBase.api.saveZettel({initialTags:["Zettel"],customKey:"ProxyThinkerTestTimeGuidanceXiao26",title:"Link completion target",body:"A linked idea"});
        const target=await knowledgeBase.api.acquireNativeNote({id:targetID,initialTags:["Zettel"],title:"Link completion target",body:"A linked idea"});await knowledgeBase.api.releaseNativeNote(target.noteID);
        const waitFor=async(fn,label)=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(label);};
        const countLinks=()=>[...quickFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[ProxyThinkerTestTimeGuidanceXiao26]]').length;
        const endParagraph=async()=>{const surface=quickFrame.document.querySelector('.primary-editor');surface.focus();const range=quickFrame.document.createRange();range.selectNodeContents(surface.lastElementChild);range.collapse(false);quickFrame.getSelection().removeAllRanges();quickFrame.getSelection().addRange(range);await new Promise(resolve=>setTimeout(resolve,50));quickFrame.document.execCommand('insertParagraph');await new Promise(resolve=>setTimeout(resolve,80));};
        await endParagraph();
        quickFrame.document.execCommand('insertText',false,'[[');
        await waitFor(()=>!quickLinkEditor.document.getElementById('knowledge-base-link-drop').hidden && quickLinkEditor.document.getElementById('knowledge-base-link-results').children.length,"Native [[ did not show candidates");
        quickFrame.document.execCommand('insertText',false,'ProxyThinker');
        await waitFor(()=>quickLinkEditor.document.getElementById('knowledge-base-link-results').firstElementChild?.textContent.includes('ProxyThinkerTestTimeGuidanceXiao26'),"Native note query did not filter by ID");
        quickFrame.document.querySelector('.primary-editor').dispatchEvent(new quickFrame.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        await waitFor(()=>countLinks()===1,"Native autocomplete did not replace the query");
        await endParagraph();
        await knowledgeBase.api.copyNoteReference('ProxyThinkerTestTimeGuidanceXiao26');
        quickFrame.document.querySelector('.primary-editor').focus();
        const pasteStarted=quickFrame.document.execCommand('paste');
        await waitFor(()=>countLinks()===2,"Pasted note ID did not become a native link; paste command="+pasteStarted);
        if(!quickFrame.wrappedJSObject.doUndo()) throw new Error("Cannot undo pasted note link");
        await waitFor(()=>countLinks()<2,"Undo retained the pasted link");
        if(!quickFrame.wrappedJSObject.doRedo()) throw new Error("Cannot redo pasted note link");
        await waitFor(()=>countLinks()===2,"Redo did not restore pasted link");
        await quickLinkEditor.setEditorMode('source');
        const source=quickLinkEditor.document.getElementById('knowledge-base-editor-body');
        if(!source.value.includes('[[ProxyThinkerTestTimeGuidanceXiao26]]') || source.value.includes('\\\\[\\\\[ProxyThinker')) throw new Error("Native link round trip escaped the wiki reference");
        source.value+='\\n\\n[[ProxyThinker';source.setSelectionRange(source.value.length,source.value.length);source.dispatchEvent(new quickLinkEditor.Event('input',{bubbles:true}));
        await waitFor(()=>!quickLinkEditor.document.getElementById('knowledge-base-link-drop').hidden && quickLinkEditor.document.getElementById('knowledge-base-link-results').firstElementChild?.textContent.includes('ProxyThinkerTestTimeGuidanceXiao26'),"Markdown [[ did not show candidates");
        source.dispatchEvent(new quickLinkEditor.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
        await waitFor(()=>source.value.endsWith('[[ProxyThinkerTestTimeGuidanceXiao26]]'),"Markdown completion did not replace the query");
        if(!(await quickLinkEditor.save(false))) throw new Error("Completed links did not save");
        await quickLinkEditor.setEditorMode('visual');
        const finalFrame=quickLinkEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()._iframeWindow;
        if([...finalFrame.document.querySelectorAll('.primary-editor a')].filter(link=>link.getAttribute('title')==='[[ProxyThinkerTestTimeGuidanceXiao26]]').length!==3) throw new Error("Mode switch lost completed links");
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify({connectionsOnly:true,linksOnly:true,cardID:referenceID,noteKey:referenceNote.key,targetID}));
        await quickLinkEditor.knowledgeBasePrepareNavigation();quickLinkEditor.close();
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);return;
      }
      quickLinkEditor.close();
      for(let n=0;n<100 && !quickLinkEditor.closed;n++) await new Promise(resolve=>setTimeout(resolve,25));
      {
        literatureEditor.document.getElementById("knowledge-base-editor-key").focus();
        const editableID = literatureEditor.document.getElementById("knowledge-base-editor-key");
        const beforeIDHTML = note.getNote();
        editableID.value = "HostLiteratureID";
        editableID.dispatchEvent(new literatureEditor.Event("input",{bubbles:true}));
        if (!(await literatureEditor.save(false))) throw new Error("Literature ID edit did not save");
        for(let n=0;n<150 && !referenceNote.getNote().includes('title="[[HostLiteratureID]]"');n++) await new Promise(resolve=>setTimeout(resolve,25));
        if ((await knowledgeBase.api.getZettel(literatureID)).reference !== "HostLiteratureID" || note.getNote() !== beforeIDHTML || !referenceNote.getNote().includes('>HostLiteratureID</a>') || !referenceNote.getNote().includes('title="[[HostLiteratureID|Pinned label]]"') || !knowledgeBase.api.getMarkdownSource(referenceNote.getNote()).body.includes('[[HostLiteratureID]]') || (await knowledgeBase.api.resolveCardLink("knowledge-base://card/"+literatureID))?.targetId !== literatureID) throw new Error("Literature ID edit did not preserve native content, custom labels, references and note identity");
        if (literatureIDField.value !== "HostLiteratureID") throw new Error("The displayed ID kept the previous value");
        editableID.value = literatureID;
        editableID.dispatchEvent(new literatureEditor.Event("input",{bubbles:true}));
        if (!(await literatureEditor.save(false)) || (await knowledgeBase.api.resolveCardLink("knowledge-base://card/HostLiteratureID"))?.targetId !== literatureID) throw new Error("Resetting an ID broke its historical alias");
      }
      await eraseFixtureCard(referenceID);
      item.setCreators([{firstName:'A',lastName:'Smith',creatorType:'author'}]); item.setField('date','2026'); await item.saveTx();
      // Explicitly detach this fixture to cover a surviving note with a trashed source.
      note.parentItemID = false; await note.saveTx({skipSelect:true});
      item.deleted = true; await item.saveTx();
      const standaloneHealth = await knowledgeBase.api.getNoteHealth(literatureID);
      if (standaloneHealth.source !== "trashed" || standaloneHealth.note !== "available") throw new Error("A standalone Literature Note was treated as deleted with its source");
      if (!(await literatureEditor.save(false)) || (await knowledgeBase.api.getZettel(literatureID)).item_key !== item.key || note.parentItemID) throw new Error("Unavailable source prevented saving or moved a standalone Literature Note");
      await knowledgeBase.api.restoreNote(literatureID);
      await literatureEditor.save(false);
      literatureEditor.close();
      for (let n = 0; n < 100 && !literatureEditor.closed; n++) await new Promise(resolve => setTimeout(resolve, 25));
      await knowledgeBase.api.deleteZettel(literatureID);
      await knowledgeBase.api.deleteZettel(thinkingID);
      if (!thinking.deleted || !note.deleted || thinking.getNote() !== originalThinking || !(await knowledgeBase.api.getZettel(thinkingID)) || !(await knowledgeBase.api.getZettel(literatureID)) || (await knowledgeBase.api.listZettels()).some(card => [thinkingID,literatureID].includes(card.id))) throw new Error("Deleting linked notes did not trash, hide and retain their original cards");
      Zotero.debug("Knowledge Base host stage: stable native links and rename updates");
      const linkPreviousSelection = Zotero.getMainWindow().ZoteroPane.getSelectedItems().map(selected=>selected.id);
      const linkTargetID = await knowledgeBase.api.saveZettel({initialTags:["Thinking Note"], customKey:"LinkTarget", title:"Link target", body:""});
      const linkTargetMapping = await knowledgeBase.api.acquireNativeNote({id:linkTargetID, title:"Link target", body:""});
      const linkTargetNote = await Zotero.Items.getAsync(linkTargetMapping.noteID);
      await knowledgeBase.api.releaseNativeNote(linkTargetNote.id);
      const linkBody = "[[" + linkTargetID + "]] [[" + linkTargetID + "|My label]]";
      const linkSourceID = await knowledgeBase.api.saveZettel({title:"Link source", body:linkBody});
      const linkSourceMapping = await knowledgeBase.api.acquireNativeNote({id:linkSourceID, title:"Link source", body:linkBody});
      const linkSourceNote = await Zotero.Items.getAsync(linkSourceMapping.noteID);
      linkSourceNote.setNote('<div data-schema-version="9"><h1>Link source</h1><p><a href="knowledge-base://card/' + linkTargetID + '">Link target</a> <a href="knowledge-base://card/' + linkTargetID + '">My label</a> <a href="zotero://select/library/items/' + linkTargetNote.key + '">Plain native label</a></p><pre class="math">$$x^2$$</pre></div>');
      await linkSourceNote.saveTx();
      const linkInstance = await Zotero.Notes.open(linkSourceNote.id, null, {openInWindow:true});
      const linkWindow = linkInstance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
      const nativeHref = "zotero://select/library/items/" + linkTargetNote.key;
      for(let n=0;n<100 && !linkSourceNote.getNote().includes('title="[[LinkTarget]]"');n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!linkSourceNote.getNote().includes('title="[[LinkTarget]]"') || !linkSourceNote.getNote().includes('title="[[LinkTarget|My label]]"') || !linkSourceNote.getNote().includes('$$x^2$$')) throw new Error("Opening an ordinary native editor did not convert legacy links safely: " + linkSourceNote.getNote());
      // Follow the real native editor message handler through Zotero's protocol handler.
      await linkInstance._messageHandler({source:linkInstance._iframeWindow, data:{instanceID:linkInstance.instanceID, message:{action:"openURL", url:nativeHref}}});
      for(let n=0;n<100 && !Zotero.getMainWindow().ZoteroPane.getSelectedItems().some(selected=>selected.id===linkTargetNote.id);n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!Zotero.getMainWindow().ZoteroPane.getSelectedItems().some(selected=>selected.id===linkTargetNote.id)) throw new Error("Native note link did not jump through Zotero's own protocol handler");
      linkTargetNote.setNote('<div data-schema-version="9"><h1>Renamed link target</h1></div>');
      await linkTargetNote.saveTx();
      for(let n=0;n<100 && (await knowledgeBase.api.getZettel(linkTargetID)).title !== 'Renamed link target';n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!linkSourceNote.getNote().includes('>LinkTarget</a>') || linkSourceNote.getNote().includes('>Renamed link target</a>')) throw new Error('A title rename replaced a key-based default link label');
      await knowledgeBase.api.saveZettel({id:linkTargetID, title:'Renamed link target', body:'', customKey:'RenamedLinkTarget'});
      for(let n=0;n<150 && !linkSourceNote.getNote().includes('>RenamedLinkTarget</a>');n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!linkSourceNote.getNote().includes('>RenamedLinkTarget</a>') || !linkSourceNote.getNote().includes('>My label</a>') || !linkSourceNote.getNote().includes(nativeHref)) throw new Error("Native key change lost link identity or did not update default labels");
      if(!linkSourceNote.getNote().includes('>Plain native label</a>')) throw new Error('An ordinary native link label was unexpectedly rewritten');
      const linkFrame = linkInstance._iframeWindow;
      for(let n=0;n<100 && !linkFrame.document.querySelector('.primary-editor a')?.textContent.includes('RenamedLinkTarget');n++) await new Promise(resolve=>setTimeout(resolve,25));
      const linkData = linkFrame.wrappedJSObject.getDataSync(false);
      if(!linkData?.html.includes('title="[[RenamedLinkTarget]]"')) throw new Error("Zotero's native link schema discarded the current Markdown reference: " + JSON.stringify({data:linkData, note:linkSourceNote.getNote(), dom:linkFrame.document.querySelector('.primary-editor')?.innerHTML}));
      linkWindow.focus();
      linkFrame.document.querySelector('.primary-editor').focus();
      const editableLink = [...linkFrame.document.querySelectorAll('.primary-editor a')].find(anchor=>anchor.getAttribute('title')==='[[RenamedLinkTarget]]');
      const linkRange = linkFrame.document.createRange();
      linkRange.setStart(editableLink.firstChild, 1);
      linkRange.setEnd(editableLink.firstChild, editableLink.textContent.length - 1);
      const linkSelection = linkFrame.getSelection(); linkSelection.removeAllRanges(); linkSelection.addRange(linkRange);
      await new Promise(resolve=>setTimeout(resolve,50));
      if(!linkFrame.document.execCommand('insertText', false, 'evisedLinkTarge')) throw new Error('Native link label insertion failed');
      for(let n=0;n<150 && !linkSourceNote.getNote().includes('title="[[RenamedLinkTarget|RevisedLinkTarget]]"');n++) await new Promise(resolve=>setTimeout(resolve,25));
      if(!knowledgeBase.api.getMarkdownSource(linkSourceNote.getNote()).body.includes('[[RenamedLinkTarget|RevisedLinkTarget]]')) throw new Error('Editing link text in the native editor was lost instead of becoming an alias: ' + JSON.stringify({html:linkSourceNote.getNote(), dom:linkFrame.document.querySelector('.primary-editor')?.innerHTML.slice(0,500)}));
      linkWindow.close();
      for(let n=0;n<100 && !linkWindow.closed;n++) await new Promise(resolve=>setTimeout(resolve,25));
      await knowledgeBase.api.releaseNativeNote(linkSourceNote.id);
      await eraseFixtureCard(linkSourceID);
      await eraseFixtureCard(linkTargetID);
      if(linkPreviousSelection.length) await Zotero.getMainWindow().ZoteroPane.selectItems(linkPreviousSelection);
      const migrationCanvas=Zotero.getMainWindow().document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
      migrationCanvas.width=240;migrationCanvas.height=90;
      const migrationContext=migrationCanvas.getContext("2d");
      migrationContext.fillStyle="#eaf1ff";migrationContext.fillRect(0,0,240,90);
      migrationContext.fillStyle="#3478f6";migrationContext.fillRect(16,16,48,58);migrationContext.fillRect(80,36,48,38);migrationContext.fillRect(144,26,80,48);
      const png=migrationCanvas.toDataURL("image/png").split(",")[1];
      const imageURL = await knowledgeBase.api.importImage([...atob(png)].map(char => char.charCodeAt(0)), "image/png", "host-migration");
      await knowledgeBase.api.saveZettel({ title: "Shutdown test", body: "Inline $E = mc^2$.\\n\\n![Migration image](" + imageURL + ")", itemKey: item.key, libraryID: item.libraryID });
      const rows = await knowledgeBase.api.listZettels();
      await knowledgeBase.api.saveZettel({ title: "Child card", body: "[[" + rows[0].id + "]]", parentId: rows[0].id });
      knowledgeBase.api.openManager({ window:true, selectId: rows[0].id });
      knowledgeBase.api.openEditor({window:true, zettelId: rows[0].id });
      knowledgeBase.api.openGraph({ centerId: rows[0].id });
      setTimeout(async () => {
        try {
        const manager = [...Services.wm.getEnumerator("knowledge-base:manager")][0];
        const graph = [...Services.wm.getEnumerator("knowledge-base:graph")][0];
        if (Zotero.isMac) {
          for (const view of [manager,graph]) {
            view.dispatchEvent(new view.KeyboardEvent("keydown",{key:"w",metaKey:true,isComposing:true,cancelable:true}));
            view.dispatchEvent(new view.KeyboardEvent("keydown",{key:"w",ctrlKey:true,cancelable:true}));
            if (view.closed) throw new Error("IME or Control-W closed Knowledge Base");
          }
        }
        for (let n = 0; n < 100 && graph.document.getElementById('graph-svg').dataset.layoutThread !== 'worker'; n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (graph.document.getElementById('graph-svg').dataset.layoutThread !== 'worker') throw new Error('Graph force layout did not run in a background Worker');
        if (Zotero.isMac) {
          const canvas = graph.document.getElementById("graph-svg");
          const before = canvas.__zoom;
          canvas.dispatchEvent(new graph.WheelEvent("wheel",{deltaX:14,deltaY:21,bubbles:true,cancelable:true}));
          if (canvas.__zoom.k !== before.k || canvas.__zoom.x !== before.x-14 || canvas.__zoom.y !== before.y-21) throw new Error("Trackpad scrolling did not pan the graph");
          canvas.dispatchEvent(new graph.WheelEvent("wheel",{deltaY:-20,ctrlKey:true,bubbles:true,cancelable:true}));
          if (canvas.__zoom.k <= before.k) throw new Error("Trackpad pinch did not zoom");
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        const buttons = [...manager.document.querySelectorAll(".knowledge-base-native-tool"), ...graph.document.querySelectorAll(".knowledge-base-native-tool")];
        const iconsVisible = buttons.filter(button => !button.hidden).every(button => {
          const icon = button.querySelector(".toolbarbutton-icon");
          const text = button.querySelector(".toolbarbutton-text");
          const size = 16;
          return icon?.getBoundingClientRect().width === size && icon.getBoundingClientRect().height === size
            && text && button.ownerGlobal.getComputedStyle(text).display === "none"
            && button.getBoundingClientRect().width === 28;
        });
        const actions = [...manager.document.querySelectorAll(".card-actions toolbarbutton")];
        if (actions.length !== 4 || actions.some(button => !button.closest("#knowledge-base-toolbar")) || manager.document.querySelector("#knowledge-base-detail .card-actions")) throw new Error("Note actions are not confined to the top toolbar");
        const toolbar = manager.document.getElementById("knowledge-base-toolbar");
        if (toolbar.getBoundingClientRect().height > 55) throw new Error("Default-width toolbar wraps note actions onto another row");
        const sourceBox = manager.document.getElementById("knowledge-base-detail-source");
        if (sourceBox.querySelector(".source-item-label")?.textContent !== knowledgeBase.api.loc("manager-source-item") || !sourceBox.querySelector(".source-reference i")) throw new Error("Source is not identified as a Zotero item");
        const iconSVG = (await Zotero.HTTP.request("GET", "chrome://zotero/skin/16/universal/book.svg")).responseText;
        if (!iconSVG.includes("<svg")) throw new Error("Native source item icon is unavailable");
        const preview = manager.document.getElementById("knowledge-base-preview");
        const imageCanvas = manager.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        imageCanvas.width = 800; imageCanvas.height = 200;
        const context = imageCanvas.getContext("2d");
        context.fillStyle = "#e9f1ff"; context.fillRect(0,0,800,200);
        context.fillStyle = "#2469c9"; context.fillRect(30,30,140,140);
        const probe = manager.document.createElementNS("http://www.w3.org/1999/xhtml", "img");
        probe.width = 800; probe.height = 200; probe.src = imageCanvas.toDataURL("image/png");
        preview.append(probe); await probe.decode(); preview.append(probe);
        const imageBounds = probe.getBoundingClientRect();
        if (imageBounds.width >= 800 || imageBounds.width > preview.clientWidth || Math.abs(imageBounds.height * 4 - imageBounds.width) > 1) throw new Error("Wide preview image stretched instead of shrinking proportionally");
        probe.width = 120; probe.height = 400;
        const smallBounds = probe.getBoundingClientRect();
        if (Math.abs(smallBounds.width - 120) > 1 || Math.abs(smallBounds.height - 30) > 1) throw new Error("Stored image height distorted a small preview image: " + JSON.stringify({bounds:smallBounds.toJSON(), connected:probe.isConnected, width:probe.naturalWidth, height:probe.naturalHeight}));
        const imageShots = ${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        if (imageShots) {
          probe.width = 800; probe.height = 200;
          await IOUtils.makeDirectory(imageShots, {ignoreExisting:true});
          const image = await manager.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = manager.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(imageShots, "image-proportions.png"), new Uint8Array(await blob.arrayBuffer()));
        }
        probe.remove();
        for (const group of manager.document.querySelectorAll(".card-connections details")) group.open = true;
        const relations = [...manager.document.querySelectorAll(".relation-link")];
        const identitiesVisible = relations.length >= 2 && relations.every(button => {
          return !button.querySelector(".relation-id") && !!button.getAttribute("title") && button.querySelector(".relation-title").getBoundingClientRect().width > 0;
        });
        const listId = manager.document.querySelector("#knowledge-base-list .zid");
        if (!listId || manager.getComputedStyle(listId).userSelect !== "none") throw new Error("Card IDs still select on click");
        const selectionRange = manager.document.createRange();
        selectionRange.selectNodeContents(listId);
        manager.getSelection().addRange(selectionRange);
        listId.dispatchEvent(new manager.MouseEvent("mousedown", { bubbles: true, detail: 1 }));
        if (manager.getSelection().toString()) throw new Error("Card ID selection was not cleared");
        const mathVisible = !!manager.document.querySelector("#knowledge-base-preview .katex") && !!graph.document.querySelector("#graph-node-snippet .katex");
        for (const group of manager.document.querySelectorAll(".card-connections details")) group.open = true;
        for (const group of manager.document.querySelectorAll(".card-connections details")) group.open = false;
        const controls = [...graph.document.querySelectorAll("#graph-outline,#graph-references,#graph-hide-isolated")];
        const graphControlsVisible = controls.length === 3 && !!graph.document.getElementById("graph-view") && controls.every(control => control.label && control.getBoundingClientRect().width > 0);
        const sourcesHidden = !graph.document.querySelector("#graph-sources,.graph-node.source,.graph-edge.source");
        const editor = [...Services.wm.getEnumerator("knowledge-base:editor")][0];
        let body = editor.document.getElementById("knowledge-base-editor-body");
        const rootElement = editor.document.getElementById("knowledge-base-editor-root");
        for (let n = 0; n < 80 && rootElement.dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (rootElement.dataset.mode !== "visual") throw new Error("The editor did not start in visual mode");
        if (editor.document.getElementById("knowledge-base-editor-mode")) throw new Error("Browse mode is still exposed");
        async function switchMode(mode) {
          if (rootElement.dataset.mode !== mode) {
            await openMarkdownToolbar(editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow);
          }
          for (let n = 0; n < 80 && rootElement.dataset.mode !== mode; n++) await new Promise(resolve => setTimeout(resolve, 100));
          body = editor.document.getElementById("knowledge-base-editor-body");
          const nativeElement = editor.document.getElementById("knowledge-base-rich-frame");
          const nativeFrame = nativeElement.getCurrentInstance()._iframeWindow;
          const toggle = nativeFrame.document.querySelector(".toolbar .start .knowledge-base-markdown-toggle");
          const sourceMode = mode === "source";
          if (rootElement.dataset.mode !== mode || body.hidden === sourceMode || nativeElement.hidden || !editor.document.getElementById("knowledge-base-editor-preview").hidden || toggle?.getAttribute("aria-pressed") !== String(sourceMode)) throw new Error("Editor did not retain its toolbar and single body: " + mode);
          if (sourceMode && (!nativeElement.getCurrentInstance()._disableSaving || nativeFrame.getComputedStyle(nativeFrame.document.querySelector(".primary-editor")).visibility !== "hidden")) throw new Error("The hidden rich-text writer remained active");
        }
        const migratedNote = editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item;
        const editingFrame = editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow;
        if(editingFrame.document.querySelector('.knowledge-base-reading-toggle,.knowledge-base-reading-view')) throw new Error('Knowledge Base still exposes browsing mode');
        await switchMode("source");
        await switchMode("visual");
        if (migratedNote.parentItemID !== item.id) throw new Error("Sourced note was not filed under its source");
        if (Zotero.getActiveZoteroPane().getSelectedItems().some(selected => selected.id === migratedNote.id)) throw new Error("Native note creation changed the library selection");
        editor.document.getElementById("knowledge-base-src-pick").click();
        editor.document.getElementById("knowledge-base-src-none").click();
        let personal;
        for (let n = 0; n < 160; n++) {
          personal = await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID, Zotero.Prefs.get("extensions.zotero.knowledge-base.notes.parent." + item.libraryID, true));
          if (!(await knowledgeBase.api.getZettel(rows[0].id)).item_key && personal && migratedNote.parentItemID === personal.id && !migratedNote.getCollections().length && editor.document.getElementById("knowledge-base-editor-status").textContent === knowledgeBase.api.loc("editor-saved")) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!personal || migratedNote.parentItemID !== personal.id || migratedNote.getCollections().length) throw new Error("The clear-source control did not organize the note");
        editor.document.getElementById("knowledge-base-src-pick").click();
        const sourceSearch = editor.document.getElementById("knowledge-base-src-search");
        sourceSearch.value = "Isolated test source";
        sourceSearch.dispatchEvent(new editor.Event("input", { bubbles: true }));
        let sourceRow;
        for (let n = 0; n < 100; n++) {
          sourceRow = [...editor.document.querySelectorAll("#knowledge-base-src-results li")].find(row => row.querySelector(".sr-title")?.textContent === "Isolated test source");
          if (sourceRow) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!sourceRow) throw new Error("The native source picker did not find the source");
        sourceRow.click();
        for (let n = 0; n < 160 && ((await knowledgeBase.api.getZettel(rows[0].id)).item_key !== item.key || migratedNote.parentItemID !== item.id || editor.document.getElementById("knowledge-base-editor-status").textContent !== knowledgeBase.api.loc("editor-saved")); n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (migratedNote.parentItemID !== item.id || item.getCollections().length) throw new Error("The source picker did not reparent the existing note cleanly");

        const unsourced = (await knowledgeBase.api.listZettels()).find(card => card.id !== rows[0].id);
        await knowledgeBase.api.saveEditorCard({id: unsourced.id, title:unsourced.title, body:unsourced.body, initialTags:["Thinking Note"]});
        const loose = await knowledgeBase.api.acquireNativeNote({ id: unsourced.id, title: unsourced.title, body: unsourced.body });
        const looseNote = await Zotero.Items.getAsync(loose.noteID);
        knowledgeBase.api.openEditor({window:true,zettelId: unsourced.id});
        let keyEditor;
        for (let n=0; n<100; n++) {
          keyEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === unsourced.id);
          if (keyEditor?.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        const keyInput = keyEditor.document.getElementById("knowledge-base-editor-key");
        keyEditor.document.getElementById("knowledge-base-editor-key").focus();
        keyInput.focus();
        if (!keyEditor.document.getElementById('knowledge-base-note-type') || keyInput.hidden) throw new Error('Note metadata controls are missing');
        keyInput.value = "HostProject"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false))) throw new Error("Thinking key save failed");
        const htmlBeforeKeyConflict = looseNote.getNote();
        keyInput.value = rows[0].id; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        for(let n=0;n<80 && keyInput.getAttribute('aria-invalid')!=='true';n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(keyInput.getAttribute('aria-invalid')!=='true' || keyEditor.document.getElementById('knowledge-base-key-feedback').hidden) throw new Error('Occupied ID has no inline feedback: ' + JSON.stringify({value:keyInput.value, wanted:rows[0].id, id:unsourced.id, invalid:keyInput.getAttribute('aria-invalid'), backend:await knowledgeBase.api.checkNoteKey(rows[0].id,unsourced.id)}));
        if(await keyEditor.save(false)) throw new Error('An occupied ID was saved');
        keyInput.blur();
        await keyEditor.refreshRelations();
        if(keyInput.value!==rows[0].id) throw new Error('Refreshing relationships replaced the pending ID');
        if((await knowledgeBase.api.getZettel(unsourced.id)).reference!=='HostProject' || looseNote.getNote()!==htmlBeforeKeyConflict) throw new Error('ID conflict changed the saved note');
        if(metadataShots) {
          const image=await keyEditor.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');
          const canvas=keyEditor.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
          canvas.width=image.width; canvas.height=image.height; canvas.getContext('2d').drawImage(image,0,0); image.close();
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(metadataShots,'id-conflict.png'),new Uint8Array(await blob.arrayBuffer()));
        }
        keyEditor.document.getElementById('knowledge-base-key-resolve').click();
        let resolvedKey;
        for(let n=0;n<100;n++) {
          resolvedKey=(await knowledgeBase.api.getZettel(unsourced.id)).reference;
          if(/^\\d{14}$/.test(resolvedKey) && keyEditor.document.getElementById('knowledge-base-key-feedback').hidden) break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        if(!/^\\d{14}$/.test(resolvedKey) || (await knowledgeBase.api.resolveCardLink('knowledge-base://card/HostProject'))?.targetId!==unsourced.id) throw new Error('Available ID did not resolve the conflict with retained identity');
        keyEditor.document.getElementById("knowledge-base-editor-key").focus();
        keyInput.value = "HostProjectRevised"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false))) throw new Error("Thinking key rename failed");
        const keyed = await knowledgeBase.api.getZettel(unsourced.id);
        if (keyed.source_note !== 0 || keyed.reference !== "HostProjectRevised" || keyed.custom_key !== "HostProjectRevised" || (await knowledgeBase.api.resolveCardLink("knowledge-base://card/HostProject")).targetId !== unsourced.id || keyEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Thinking key changed identity or broke old links");
        keyInput.value = "HostZettel"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false)) || (await knowledgeBase.api.getZettel(unsourced.id)).reference !== "HostZettel" || (await knowledgeBase.api.resolveCardLink("knowledge-base://card/HostProjectRevised"))?.targetId !== unsourced.id) throw new Error("Zettel ID editing lost the note or its previous references");
        keyInput.value = "HostProjectRevised"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false)) || (await knowledgeBase.api.getZettel(unsourced.id)).source_note !== 0) throw new Error("Converting back to Thinking failed");
        keyEditor.document.getElementById("knowledge-base-parent-edit").click();
        const parentSearch = keyEditor.document.getElementById("knowledge-base-parent-search");
        parentSearch.value = rows[0].title; parentSearch.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        let parentChoice;
        for (let n=0; n<50; n++) {
          parentChoice = [...keyEditor.document.querySelectorAll("#knowledge-base-parent-results .relation-link")].find(button => button.textContent.includes(rows[0].title));
          if (parentChoice) break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (!parentChoice) throw new Error("Parent reference picker did not find a note");
        parentChoice.click(); if (!(await keyEditor.save(false)) || (await knowledgeBase.api.getFamily(unsourced.id)).parent?.id !== rows[0].id) throw new Error("Parent picker did not save its note");
        keyEditor.document.getElementById("knowledge-base-parent-edit").click();
        for(let n=0; n<50 && !keyEditor.document.querySelector("#knowledge-base-parent-results .metadata-clear"); n++) await new Promise(resolve=>setTimeout(resolve,50));
        keyEditor.document.querySelector("#knowledge-base-parent-results .metadata-clear").click();
        if (!(await keyEditor.save(false)) || (await knowledgeBase.api.getFamily(unsourced.id)).parent) throw new Error("No parent did not detach the note");
        keyEditor.close();
        await new Promise(resolve => setTimeout(resolve, 100));
        knowledgeBase.api.openEditor({zettelId: unsourced.id});
        const main = Zotero.getMainWindow();
        let workbench, inline;
        for (let n=0; n<150; n++) {
          workbench = main.document.querySelector(".knowledge-base-workbench")?.contentWindow;
          inline = workbench?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
          if (inline?.knowledgeBaseCardId === unsourced.id && inline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (inline?.knowledgeBaseCardId !== unsourced.id || inline.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Workbench did not embed the existing native editor");
        knowledgeBase.api.openManager({selectId: unsourced.id});
        entryButton.dispatchEvent(new mainWindow.Event("command"));
        if (main.document.querySelectorAll(".knowledge-base-workbench").length !== 1) throw new Error("Workbench created duplicate tabs");
        const listRows=[...workbench.document.querySelectorAll('.zettel-row')];
        const rowHeight=workbench.eval('ROW_HEIGHT');
        for(let index=0;index<listRows.length;index++) {
          const bounds=listRows[index].getBoundingClientRect();
          if(Math.abs(bounds.height-rowHeight)>1 || (index && Math.abs(bounds.top-listRows[index-1].getBoundingClientRect().top-rowHeight)>1)) throw new Error('List row spacing disagrees with virtual scrolling geometry');
          for(const part of listRows[index].querySelectorAll('.title,.card-snippet,.zid')) if(part.getBoundingClientRect().bottom>bounds.bottom+1) throw new Error('List preview metadata overflowed its row');
        }
        if (main.Zotero_Tabs.getState().some(tab => tab.type === "knowledgebase")) throw new Error("Workbench leaked an unsupported document into Zotero session state");
        const brokenRef='note-1-MISSING1';
        const brokenSource=await knowledgeBase.api.saveZettel({title:'A referring note with an unavailable link',body:'[['+brokenRef+']]'});
        for(let n=0;n<100 && !workbench.document.querySelector('#knowledge-base-unresolved-list details[data-ref="'+brokenRef+'"]');n++) await new Promise(resolve=>setTimeout(resolve,25));
        const issues=workbench.document.getElementById('knowledge-base-unresolved');
        if(issues.parentElement.id!=='knowledge-base-root' || issues.open || issues.hidden) throw new Error('Unavailable links are not a collapsed workbench panel');
        const cardsBeforeIssue=(await knowledgeBase.api.listZettels()).length;
        workbench.knowledgeBaseShowUnresolved(brokenRef);
        let issueSourceButton;
        for(let n=0;n<100;n++) {
          issueSourceButton=workbench.document.querySelector('#knowledge-base-unresolved-list details[data-ref="'+brokenRef+'"] .relation-link');
          if(issueSourceButton)break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        if(!issues.open || !issueSourceButton?.textContent.includes('A referring note') || (await knowledgeBase.api.listZettels()).length!==cardsBeforeIssue || inline.knowledgeBaseCardId!==unsourced.id) throw new Error('Unavailable link diagnostics created a replacement or lost the referring note');
        if(metadataShots) {
          const image=await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');
          const canvas=main.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(metadataShots,'unavailable-links.png'),new Uint8Array(await blob.arrayBuffer()));
        }
        await knowledgeBase.api.saveZettel({id:brokenSource,title:'A referring note with an unavailable link',body:'Link removed'});
        for(let n=0;n<100 && workbench.document.querySelector('#knowledge-base-unresolved-list details[data-ref="'+brokenRef+'"]');n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(workbench.document.querySelector('#knowledge-base-unresolved-list details[data-ref="'+brokenRef+'"]')) throw new Error('Corrected link diagnostics did not refresh');
        await eraseFixtureCard(brokenSource);
        issues.open=false;
        workbench.newZettel("Workbench typing fixture");
        for (let n=0; n<150; n++) {
          inline = workbench.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (!inline.knowledgeBaseCardId && inline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (inline.knowledgeBaseCardId === unsourced.id || knowledgeBase.api.projectNativeNote(inline.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.getNote()).title !== "Workbench typing fixture") throw new Error("New Note kept the old document: " + JSON.stringify({url:inline.location.href, args:inline.eval("args"), id:inline.knowledgeBaseCardId}));
        const emptyConnections = inline.document.getElementById("knowledge-base-editor-relations");
        const emptyButtons = [...emptyConnections.querySelectorAll("nav button")];
        if (!emptyConnections.hidden || emptyButtons.length !== 3 || emptyButtons.some(button => !button.hidden || !button.disabled || !button.textContent.endsWith("0"))) throw new Error("Empty connections clutter the writing surface");
        if (inline.document.getElementById("knowledge-base-editor-toolbar").hidden || inline.document.getElementById("knowledge-base-parent-display").parentElement.hidden) throw new Error("Direct source or parent controls are missing");
        await inline.setEditorMode("source");
        const inlineBody = inline.document.getElementById("knowledge-base-editor-body");
        inlineBody.value = "# Workbench typing fixture\\n\\nTyped in the workbench.";
        inlineBody.dispatchEvent(new inline.Event("input", {bubbles:true}));
        if (!(await inline.save(false))) throw new Error("Workbench direct edit did not save");
        const inlineID = inline.knowledgeBaseCardId;
        if (inlineID === unsourced.id) throw new Error("New Note reused an existing ID");
        if ((await knowledgeBase.api.getZettel(inlineID)).body !== "Typed in the workbench.") throw new Error("Workbench saved the wrong content");
        {
        const parentPicker = inline.document.getElementById("knowledge-base-parent-picker");
        const parentSearch = inline.document.getElementById("knowledge-base-parent-search");
        const parentChange = inline.document.getElementById("knowledge-base-parent-edit");
        parentChange.click();
        await inline.refreshRelations();
        if (parentPicker.closest("[hidden]") || parentSearch.getBoundingClientRect().width < 100 || inline.document.activeElement !== parentSearch) throw new Error("Change Parent did not reveal and focus the picker for an unparented note");
        parentSearch.value = unsourced.id;
        parentSearch.dispatchEvent(new inline.Event("input", {bubbles:true}));
        let parentChoice;
        for (let n=0; n<100; n++) {
          parentChoice = parentPicker.querySelector(".relation-link");
          if (parentChoice) break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        if (!parentChoice || parentChoice.getBoundingClientRect().height < 1) throw new Error("Parent search did not show its matching note");
        parentChoice.click();
        if (!(await inline.save(false)) || (await knowledgeBase.api.getFamily(inlineID)).parent?.id !== unsourced.id || !parentPicker.hidden) throw new Error("Choosing a parent did not save the hierarchy");
        {
          const copyButton = workbench.document.getElementById("knowledge-base-btn-copy-zettels");
          const copyStatus = workbench.document.getElementById("knowledge-base-copy-status");
          if (copyButton.getBoundingClientRect().width < 20 || !workbench.getComputedStyle(copyButton).listStyleImage.includes("copy.svg") || !copyButton.getAttribute("aria-label")) throw new Error("Copy Zettel list has no visible native toolbar action");
          copyButton.dispatchEvent(new workbench.Event("command"));
          for (let n=0;n<200 && copyStatus.hidden;n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (copyStatus.hidden || copyButton.hasAttribute("disabled")) throw new Error("Copy Zettel list did not finish");
          const copiedText = Zotero.Utilities.Internal.getClipboard("text/plain");
          const copiedRows = copiedText.split("\\n").map(line=>JSON.parse(line.slice(2)));
          const copiedChild = copiedRows.find(row=>row.id===inlineID);
          const expectedZettels = (await knowledgeBase.api.listZettels()).length;
          if (copiedRows.length!==expectedZettels || copiedRows.some(row=>Object.keys(row).join(',')!=="id,title,parent") || copiedChild?.parent?.id!==(await knowledgeBase.api.getZettel(unsourced.id)).reference || copiedChild?.title!=="Workbench typing fixture" || !copiedRows.some(row=>row.parent===null)) throw new Error("Copied Zettel list lost titles, parent identities or roots, or followed the current filter: "+copiedText);
          let cancellationChecks=0;
          if (await knowledgeBase.api.copyZettelList(()=>++cancellationChecks===2) !== null || Zotero.Utilities.Internal.getClipboard("text/plain") !== copiedText) throw new Error("A cancelled Zettel copy replaced the clipboard");
        }
        parentChange.click();
        for (let n=0; n<100 && parentPicker.querySelector(".metadata-clear")?.closest("[hidden]"); n++) await new Promise(resolve=>setTimeout(resolve,25));
        parentPicker.querySelector(".metadata-clear").click();
        if (!(await inline.save(false)) || (await knowledgeBase.api.getFamily(inlineID)).parent || !parentPicker.parentElement.hidden || (await knowledgeBase.api.getZettel(inlineID)).body !== "Typed in the workbench.") throw new Error("No parent did not detach the note while preserving its content");
        parentChange.click();
        parentSearch.dispatchEvent(new inline.KeyboardEvent("keydown", {key:"Escape",bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,250));
        if (!parentPicker.hidden || !parentPicker.parentElement.hidden || parentChange.getAttribute("aria-expanded") !== "false" || (await knowledgeBase.api.getFamily(inlineID)).parent) throw new Error("Cancelling Change Parent left an empty row or changed the hierarchy");
        }
        const connectionChildID = await knowledgeBase.api.saveZettel({title:"A child note with a full title that remains readable across the available editor width", body:"[[" + inlineID + "]]", parentId:inlineID});
        const childNav = inline.document.getElementById("knowledge-base-editor-children-label");
        const backlinkNav = inline.document.getElementById("knowledge-base-editor-backlinks-label");
        for (let n=0; n<100 && (childNav.disabled || backlinkNav.disabled); n++) await new Promise(resolve=>setTimeout(resolve,50));
        if (childNav.disabled || backlinkNav.disabled || !childNav.textContent.endsWith("1") || !backlinkNav.textContent.endsWith("1")) throw new Error("Children and backlinks did not update in the workbench");
        childNav.click();
        const childList = inline.document.getElementById("knowledge-base-editor-family");
        if (childList.hidden || !inline.document.getElementById("knowledge-base-editor-backlinks").hidden || childNav.getAttribute("aria-expanded") !== "true") throw new Error("Connection navigation did not select one list");
        backlinkNav.click();
        if (!childList.hidden || inline.document.getElementById("knowledge-base-editor-backlinks").hidden) throw new Error("Connection categories stacked their lists");
        if (inline.document.getElementById("knowledge-base-editor-more")) throw new Error("Editor retains duplicate navigation actions");
        if (metadataShots) {
          const image = await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,"white");
          const canvas = main.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
          canvas.width=image.width;canvas.height=image.height;canvas.getContext("2d").drawImage(image,0,0);image.close();
          const blob = await new Promise(resolve=>canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(metadataShots,"connections.png"),new Uint8Array(await blob.arrayBuffer()));
        }
        childNav.click();
        childList.querySelector("button").click();
        for (let n=0; n<150; n++) {
          const childEditor = workbench.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (childEditor.knowledgeBaseCardId === connectionChildID && childEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        if (workbench.document.getElementById("knowledge-base-workbench-editor").contentWindow.knowledgeBaseCardId !== connectionChildID) throw new Error("Clicking a child did not navigate within the Tab");
        const navigationFrame = workbench.document.getElementById("knowledge-base-workbench-editor");
        const childBeforeNavigation = navigationFrame.contentWindow;
        await childBeforeNavigation.setEditorMode("source");
        const navigationBody = childBeforeNavigation.document.getElementById("knowledge-base-editor-body");
        navigationBody.value += "\\n\\nLast edit before rapid navigation.";
        navigationBody.dispatchEvent(new childBeforeNavigation.Event("input", {bubbles:true}));
        const originalGetZettel = knowledgeBase.api.getZettel;
        const untouchedHTML = looseNote.getNote();
        let releaseEditorLoad, editorLoadHeld = false;
        const editorLoadGate = new Promise(resolve => { releaseEditorLoad = resolve; });
        knowledgeBase.api.getZettel = async (id) => {
          if (id === unsourced.id && !editorLoadHeld) {
            editorLoadHeld = true;
            await editorLoadGate;
          }
          return originalGetZettel(id);
        };
        try {
          const loadingNavigation = knowledgeBase.api.mountEditor(navigationFrame, {zettelId:unsourced.id});
          for (let n=0; n<150 && !editorLoadHeld; n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (!editorLoadHeld) throw new Error("Could not delay workbench editor initialization");
          const queuedReplacement = knowledgeBase.api.mountEditor(navigationFrame, {zettelId:connectionChildID});
          const latestNavigation = knowledgeBase.api.mountEditor(navigationFrame, {zettelId:unsourced.id});
          await new Promise(resolve=>setTimeout(resolve,50));
          if (looseNote.getNote() !== untouchedHTML) throw new Error("Navigation saved an incompletely loaded note");
          releaseEditorLoad();
          const navigations = await Promise.all([loadingNavigation,queuedReplacement,latestNavigation]);
          if (JSON.stringify(navigations) !== "[false,false,true]") throw new Error("Rapid workbench navigation did not select only the latest request: " + JSON.stringify(navigations));
          if (navigationFrame.contentWindow.knowledgeBaseCardId !== unsourced.id || navigationFrame.contentWindow.document.getElementById("knowledge-base-editor-root").dataset.mode !== "visual") throw new Error("Rapid navigation returned before the final editor was ready");
          if (looseNote.getNote() !== untouchedHTML || !(await originalGetZettel(connectionChildID)).body.includes("Last edit before rapid navigation.")) throw new Error("Rapid navigation lost edits or overwrote the next note");
          if (!workbench.document.getElementById("knowledge-base-error").hidden) throw new Error("Rapid navigation displayed an error stack");
        } finally {
          releaseEditorLoad();
          knowledgeBase.api.getZettel = originalGetZettel;
        }
        workbench.ZoteroKnowledgeBase_selectZettel(unsourced.id);
        for (let n=0; n<150; n++) {
          inline = workbench.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (inline.knowledgeBaseCardId === unsourced.id && inline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (inline.knowledgeBaseCardId !== unsourced.id) throw new Error("Workbench navigation did not switch the inline note");
        if(workbench.document.getElementById("knowledge-base-open-window")) throw new Error('Workbench has a duplicate window-opening control');
        knowledgeBase.api.setWorkbenchMode("window");
        knowledgeBase.api.openManager({selectId:unsourced.id});
        entryButton.dispatchEvent(new mainWindow.Event("command"));
        let independent, separateManager, separateEditor;
        async function waitSeparate(cardID, draftID) {
          const wantedMode = knowledgeBase.api.getNoteEditorMode();
          for (let n=0; n<150; n++) {
            independent = [...Services.wm.getEnumerator("knowledge-base:workbench")][0];
            separateManager = independent?.document.getElementById("knowledge-base-window-browser")?.contentWindow;
            separateEditor = separateManager?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
            if (!separateManager?.document.getElementById("knowledge-base-workbench-editor")?.hidden && separateEditor?.document.getElementById("knowledge-base-editor-root")?.dataset.mode === wantedMode && (cardID ? separateEditor.knowledgeBaseCardId === cardID : separateEditor.knowledgeBaseDraftId === draftID)) {await separateEditor.knowledgeBaseReady();return;}
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          throw new Error("Independent workbench did not load the requested native editor: " + JSON.stringify({count:[...Services.wm.getEnumerator("knowledge-base:workbench")].length,windowURL:independent?.location.href,windowReady:independent?.document.readyState,managerURL:separateManager?.location.href,managerReady:separateManager?.document.readyState,editorURL:separateEditor?.location.href,cardID:separateEditor?.knowledgeBaseCardId,draftID:separateEditor?.knowledgeBaseDraftId,wantedCard:cardID,wantedDraft:draftID,tabStatus:inline.document.getElementById("knowledge-base-editor-status").textContent}));
        }
        await waitSeparate(unsourced.id);
        if (separateManager.document.getElementById("knowledge-base-open-window") || separateEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Independent workbench lost the native note or exposed a redundant window entry");
        mainWindow.document.getElementById("knowledge-base-menu-open-manager").dispatchEvent(new mainWindow.Event("command"));
        await waitSeparate(unsourced.id);
        knowledgeBase.api.setWorkbenchMode("tab");
        const independentBounds = independent.document.getElementById("knowledge-base-window-browser").getBoundingClientRect();
        if (independentBounds.width < 800 || independentBounds.height < 500 || separateEditor.document.getElementById("knowledge-base-rich-frame").getBoundingClientRect().height < 300) throw new Error("Independent workbench or native editor did not fill its window: " + JSON.stringify({window:independentBounds.toJSON(),editor:separateEditor.document.getElementById("knowledge-base-rich-frame").getBoundingClientRect().toJSON(),managerHeight:separateManager.innerHeight,editorHeight:separateEditor.innerHeight}));
        checkNativeEndSpace(separateEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow);
        knowledgeBase.api.openWorkbenchWindow({selectId:connectionChildID});
        knowledgeBase.api.openWorkbenchWindow({selectId:unsourced.id});
        await waitSeparate(unsourced.id);
        if ([...Services.wm.getEnumerator("knowledge-base:workbench")].length !== 1) throw new Error("Repeated independent workbench requests opened duplicate windows");
        await separateEditor.openNoteLink("knowledge-base://card/"+connectionChildID);
        await waitSeparate(connectionChildID);
        if (inline.knowledgeBaseCardId !== unsourced.id) throw new Error("Independent note links navigated the library tab instead of their own workbench");
        separateManager.document.querySelector('.zettel-row[data-id="'+unsourced.id+'"]').click();
        await waitSeparate(unsourced.id);
        await separateEditor.setEditorMode("source");
        const separateBody = separateEditor.document.getElementById("knowledge-base-editor-body");
        separateBody.value += "\\n\\nSaved from independent workbench.";
        separateBody.dispatchEvent(new separateEditor.Event("input",{bubbles:true}));
        if (!(await separateEditor.save(false)) || !looseNote.getNote().includes("Saved from independent workbench.")) throw new Error("Independent workbench did not save to the original native note");
        for (let n=0; n<100 && !inline.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow.document.body.textContent.includes("Saved from independent workbench."); n++) await new Promise(resolve=>setTimeout(resolve,25));
        if (!inline.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow.document.body.textContent.includes("Saved from independent workbench.")) throw new Error("Independent workbench save did not refresh the tab editor");
        for (let n=0; n<100 && inline.eval("dirty"); n++) await new Promise(resolve=>setTimeout(resolve,25));
        if (inline.eval("dirty")) throw new Error("Native refresh retained a redundant tab draft: " + JSON.stringify({snapshot:inline.eval("snapshot()"),card:await knowledgeBase.api.getZettel(unsourced.id),parent:(await knowledgeBase.api.getFamily(unsourced.id)).parent,expectedHTML:inline.eval("expectedNoteHTML"),status:inline.document.getElementById("knowledge-base-editor-status").textContent}));
        separateManager.newZettel("Independent closing draft");
        for (let n=0; n<150; n++) {
          separateEditor = separateManager.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (!separateEditor.knowledgeBaseCardId && separateEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        if (separateEditor.knowledgeBaseCardId || knowledgeBase.api.projectNativeNote(separateEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.getNote()).title !== "Independent closing draft") throw new Error("Independent new-note action opened or retained another editor");
        await separateEditor.setEditorMode("source");
        const pendingSeparate = separateEditor.document.getElementById("knowledge-base-editor-body");
        pendingSeparate.value = "# Independent closing draft\\n\\nKept when closing the independent window.";
        pendingSeparate.dispatchEvent(new separateEditor.Event("input",{bubbles:true}));
        const separateDraftID = separateEditor.knowledgeBaseDraftId;
        independent.close();
        for (let n=0; n<100 && !(await knowledgeBase.api.getEditorDraft(separateDraftID))?.body.includes("Kept when closing"); n++) await new Promise(resolve=>setTimeout(resolve,25));
        if (!(await knowledgeBase.api.getEditorDraft(separateDraftID))?.body.includes("Kept when closing")) throw new Error("Independent close lost the unsaved draft");
        knowledgeBase.api.openWorkbenchWindow({editor:{draftId:separateDraftID}});
        await waitSeparate(null,separateDraftID);
        if (!separateEditor.document.getElementById("knowledge-base-editor-body").value.includes("Kept when closing")) throw new Error("Reopening independent workbench lost the recovery draft");
        independent.close();
        await new Promise(resolve=>setTimeout(resolve,100));
        await knowledgeBase.api.discardEditorDraft(separateDraftID);
        const sortMenu = workbench.document.getElementById('knowledge-base-sort');
        if (sortMenu.options.length !== 8 || sortMenu.value !== 'updated-desc') throw new Error('Native note sorting is missing its default or choices');
        sortMenu.value = 'id-asc';
        sortMenu.dispatchEvent(new workbench.Event('change', {bubbles:true}));
        for (let n=0; n<100 && workbench.document.getElementById('knowledge-base-list').getAttribute('aria-busy')!=='false'; n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(knowledgeBase.api.getNoteSort() !== 'id-asc') throw new Error('ID sort did not persist');
        sortMenu.value = 'created-desc';
        sortMenu.dispatchEvent(new workbench.Event('change', {bubbles:true}));
        for (let n=0; n<100 && workbench.document.getElementById('knowledge-base-list').getAttribute('aria-busy')!=='false'; n++) await new Promise(resolve=>setTimeout(resolve,25));
        if (knowledgeBase.api.getNoteSort() !== 'created-desc' || !workbench.document.querySelector('.zettel-row.active')) throw new Error('Changing note sort lost the selection or preference');
        if (metadataShots) {
          const image = await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = main.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d").drawImage(image,0,0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(metadataShots,"workbench.png"), new Uint8Array(await blob.arrayBuffer()));
        }
        main.Zotero_Tabs.close(main.Zotero_Tabs.selectedID);
        for (let n=0; n<100 && main.document.querySelector(".knowledge-base-workbench"); n++) await new Promise(resolve => setTimeout(resolve,25));
        if (main.document.querySelector(".knowledge-base-workbench")) throw new Error("Workbench did not close its embedded views");
        await eraseFixtureCard(connectionChildID);
        await eraseFixtureCard(inlineID);
        const taggedCard = await knowledgeBase.api.getZettel(unsourced.id);
        looseNote.addTag("Machine learning"); looseNote.addTag("中文 标签"); await looseNote.saveTx();
        await knowledgeBase.api.saveEditorCard({id: taggedCard.id, noteID:looseNote.id, title:"A long child note title about understanding relationships between ideas and navigating a knowledge base without squeezing text into a narrow sidebar", body:"#tag-a #tag-b #中文 \`#ignored\`", sourceMode:true, expectedNoteHTML:looseNote.getNote(), expectedUpdatedAt:taggedCard.updated_at, parentId:null});
        await Zotero.Tags.setColor(item.libraryID, "Machine learning", "#3478f6", 0);
        const taggedGraphNode = (await knowledgeBase.api.getGraph()).nodes.find(node => node.id === unsourced.id);
        if (looseNote.hasTag("tag-a") || looseNote.hasTag("tag-b") || looseNote.hasTag("中文") || !looseNote.hasTag("Machine learning") || !looseNote.hasTag("中文 标签") || looseNote.hasTag("ignored") || taggedGraphNode.tags.length !== 2 || !taggedGraphNode.tags.includes("Machine learning") || !taggedGraphNode.tags.includes("中文 标签") || taggedGraphNode.color !== "#3478f6") throw new Error("Native multiword tags or Zotero graph colors did not persist independently of text: " + JSON.stringify({tags:looseNote.getTags(), graph:taggedGraphNode}));
        await knowledgeBase.api.openEditor({window:true, zettelId:unsourced.id});
        let nativeTagEditor;
        for (let n=0; n<100; n++) {
          nativeTagEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === unsourced.id);
          if (nativeTagEditor?.document.querySelectorAll("#knowledge-base-note-tags .note-tag").length === 2) break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (!nativeTagEditor || ![...nativeTagEditor.document.querySelectorAll("#knowledge-base-note-tags .note-tag")].some(label => label.textContent === "Machine learning")) throw new Error("Editor did not render native multiword tags");
        looseNote.removeTag("Machine learning"); looseNote.removeTag("中文 标签"); looseNote.addTag("Revised tag with spaces"); await looseNote.saveTx();
        for (let n=0; n<100 && nativeTagEditor.document.querySelector("#knowledge-base-note-tags .note-tag")?.textContent !== "Revised tag with spaces"; n++) await new Promise(resolve => setTimeout(resolve,50));
        if (nativeTagEditor.document.querySelectorAll("#knowledge-base-note-tags .note-tag").length !== 1 || nativeTagEditor.document.querySelector("#knowledge-base-note-tags .note-tag").textContent !== "Revised tag with spaces" || (await knowledgeBase.api.getGraph()).nodes.find(node => node.id === unsourced.id).tags.join() !== "Revised tag with spaces") throw new Error("Native tag edits did not refresh editor and graph");
        looseNote.removeTag("Revised tag with spaces"); await looseNote.saveTx();
        for (let n=0; n<100 && !nativeTagEditor.document.getElementById("knowledge-base-note-tags").hidden; n++) await new Promise(resolve => setTimeout(resolve,50));
        if (!nativeTagEditor.document.getElementById("knowledge-base-note-tags").hidden || (await knowledgeBase.api.getGraph()).nodes.find(node => node.id === unsourced.id).color !== undefined || looseNote.getTags().length) throw new Error("Removing native tags did not clear the views");
        const personalParent = await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID, Zotero.Prefs.get("extensions.zotero.knowledge-base.notes.parent." + item.libraryID, true));
        if (personalParent.getTags().length || Zotero.Tags.getColors(item.libraryID).has("Personal Knowledge")) throw new Error("Personal parent was automatically tagged");
        personalParent.addTag("User marker"); await personalParent.saveTx();
        const inheritedLabels=()=>[...nativeTagEditor.document.querySelectorAll("#knowledge-base-note-tags .note-tag")].map(label=>label.textContent);
        for(let n=0;n<100 && !inheritedLabels().includes("User marker");n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(!inheritedLabels().includes("User marker") || !(await knowledgeBase.api.getGraph()).nodes.find(node=>node.id===unsourced.id).tags.includes("User marker") || looseNote.getTags().length) throw new Error('Parent item tags did not inherit live without modifying native note tags');
        personalParent.removeTag("User marker");await personalParent.saveTx();
        for(let n=0;n<100 && inheritedLabels().length;n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(inheritedLabels().length || (await knowledgeBase.api.getNoteTags(looseNote.id,unsourced.id)).length) throw new Error('Removed parent tags remained on a child');
        personalParent.addTag("User marker");await personalParent.saveTx();
        migratedNote.addTag("Outline topic");await migratedNote.saveTx();
        async function setTagParent(parentId) {
          const card=await knowledgeBase.api.getZettel(unsourced.id);
          await knowledgeBase.api.saveEditorCard({id:card.id,title:card.title,body:card.body,sourceNote:!!card.source_note,customKey:card.custom_key,itemKey:card.item_key,libraryID:card.library_id,noteID:looseNote.id,expectedNoteHTML:looseNote.getNote(),expectedUpdatedAt:card.updated_at,parentId});
        }
        await setTagParent(rows[0].id);
        for(let n=0;n<100 && !inheritedLabels().includes("Outline topic");n++) await new Promise(resolve=>setTimeout(resolve,25));
        const priorGroups=knowledgeBase.api.getGraphGroups();
        knowledgeBase.api.setGraphGroups([{tag:"Outline topic",color:"#ff5500"},{tag:"User marker",color:"#00aa66"},...priorGroups]);
        const groupedCard=(await knowledgeBase.api.getGraph()).nodes.find(node=>node.id===unsourced.id);
        if(!inheritedLabels().includes("Outline topic") || !groupedCard.tags.includes("Outline topic") || groupedCard.group!=="Outline topic" || groupedCard.color!=="#ff5500" || looseNote.getTags().length) throw new Error('Card ancestor tags or first-matching graph groups failed');
        for(let n=0;n<100 && !graph.document.getElementById("graph-groups-legend").textContent.includes("Outline topic");n++) await new Promise(resolve=>setTimeout(resolve,25));
        const groupedSVG=[...graph.document.querySelectorAll(".graph-node")].find(node=>node.dataset.nodeId===unsourced.id);
        if(!groupedSVG || groupedSVG.style.getPropertyValue("--node-color")!=="#ff5500" || !graph.document.getElementById("graph-groups-legend").textContent.includes("Outline topic")) throw new Error('Live graph colors or group legend did not refresh');
        knowledgeBase.api.setGraphGroups([{tag:"User marker",color:"#00aa66"},{tag:"Outline topic",color:"#ff5500"},...priorGroups]);
        if((await knowledgeBase.api.getGraph()).nodes.find(node=>node.id===unsourced.id).color!=="#00aa66") throw new Error('Reordered graph groups did not change matching priority');
        await setTagParent(null);
        for(let n=0;n<100 && inheritedLabels().includes("Outline topic");n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(inheritedLabels().includes("Outline topic") || (await knowledgeBase.api.getNoteTags(looseNote.id,unsourced.id)).includes("Outline topic")) throw new Error('Moving a card left its old inherited tags');
        migratedNote.removeTag("Outline topic");await migratedNote.saveTx();
        knowledgeBase.api.setGraphGroups(priorGroups);
        nativeTagEditor.close();
        await Zotero.Tags.setColor(item.libraryID, "Personal Knowledge", "#805ad5", 0);
        if (!personalParent || looseNote.parentItemID !== personalParent.id || looseNote.getCollections().length) throw new Error("Unsourced note was not attached to the personal parent");
        const updatePlacement = async (source) => {
          const current = await knowledgeBase.api.getZettel(unsourced.id);
          await knowledgeBase.api.saveEditorCard({ id: current.id, noteID: looseNote.id, title: current.title, body: current.body, sourceMode: false, expectedUpdatedAt: current.updated_at, parentId: rows[0].id, itemKey: source?.key || null, libraryID: source?.libraryID || null });
        };
        await updatePlacement(item);
        if (looseNote.parentItemID !== item.id || item.getCollections().length) throw new Error("Changing source moved the source item into the note collection");
        await updatePlacement(null);
        if (looseNote.parentItemID !== personalParent.id || looseNote.getCollections().length) throw new Error("Clearing source did not return the same note to its personal parent");
        const standaloneSource = new Zotero.Item("note");
        standaloneSource.libraryID = item.libraryID;
        standaloneSource.setNote("<p>Standalone source note</p>");
        await standaloneSource.saveTx({skipSelect:true});
        await updatePlacement(standaloneSource);
        if (looseNote.parentItemID !== personalParent.id || looseNote.getCollections().length) throw new Error("Standalone note source was used as an invalid parent");
        standaloneSource.parentItemID = item.id; await standaloneSource.saveTx();
        await updatePlacement(standaloneSource);
        if (looseNote.parentItemID !== item.id) throw new Error("An attached source note did not use its regular parent");
        await updatePlacement(null);
        standaloneSource.parentItemID = false; await standaloneSource.saveTx();
        personalParent.setField("title", "Renamed personal notes"); await personalParent.saveTx();
        await updatePlacement(item);
        personalParent.deleted = true; await personalParent.saveTx();
        await updatePlacement(null);
        if (personalParent.deleted || looseNote.parentItemID !== personalParent.id || (await knowledgeBase.api.getZettel(unsourced.id)).item_key) throw new Error("Clearing a source did not restore the same personal parent");
        await knowledgeBase.api.releaseNativeNote(looseNote.id);
        const again = await knowledgeBase.api.acquireNativeNote({ id: unsourced.id, title: unsourced.title, body: unsourced.body });
        if (Zotero.Tags.getColors(item.libraryID).get("Personal Knowledge")?.color !== "#805ad5") throw new Error("Reopening replaced the user's personal marker color");
        if (again.noteID !== looseNote.id || looseNote.parentItemID !== personalParent.id || personalParent.getField("title") !== "Renamed personal notes" || Zotero.Collections.getByLibrary(item.libraryID).some(entry => entry.name === "Knowledge Base")) throw new Error("Reopening duplicated the note or renamed personal parent");
        await knowledgeBase.api.releaseNativeNote(looseNote.id);

        for (let n = 0; n < 100 && !migratedNote.getAttachments().length; n++) await new Promise(resolve => setTimeout(resolve, 100));
        const migratedImage = Zotero.Items.get(migratedNote.getAttachments()[0]);
        if (!migratedImage || !(await migratedImage.fileExists())) throw new Error("Legacy image was not imported into Zotero note attachments");
        if (migratedNote.getAttachments().length !== 1) throw new Error("Two native editors imported duplicate migration images");
        if (editor.document.getElementById("knowledge-base-src-clear") || editor.document.getElementById("knowledge-base-src-anno")) throw new Error("Obsolete source actions remain in the editor");
        await switchMode("source");
        body.value = "A saved idea with [[" + (await knowledgeBase.api.listZettels()).find(card => card.id !== rows[0].id).id + "]] and $E = mc^2$. [@Host2026] [My note](zotero://select/library/items/" + note.key + ").\\n\\n$$\\nx^2+y^2\\n$$\\n\\n## From reading to an idea\\n\\n- Keep the source close to the idea.\\n- Connect it to a related card.\\n\\n> One clear thought per card makes it easier to revisit.\\n\\n| Connection | Purpose |\\n| --- | --- |\\n| Parent | Outline |\\n| Card link | Related idea |";
        const complexCitation = { citationItems: [{ uris: [Zotero.URI.getItemURI(item)], itemData: Zotero.Utilities.Item.itemToCSLJSON(item), locator: "23", label: "page" }], properties: {} };
        const embeddedImage = editor.document.createElementNS("http://www.w3.org/1999/xhtml", "img");
        embeddedImage.setAttribute("data-attachment-key", migratedImage.key);
        embeddedImage.setAttribute("alt", "Migration image");
        const complexSpan = editor.document.createElementNS("http://www.w3.org/1999/xhtml", "span");
        complexSpan.className = "citation";
        complexSpan.setAttribute("data-citation", encodeURIComponent(JSON.stringify(complexCitation)));
        complexSpan.textContent = "Smith 2026, p. 23";
        body.value += "\\n\\n" + embeddedImage.outerHTML + "\\n\\n" + complexSpan.outerHTML;
        body.dispatchEvent(new editor.Event("input", { bubbles: true }));
        for (let n = 0; n < 80 && (!(await knowledgeBase.api.getZettel(rows[0].id)).body.includes("From reading to an idea") || (await knowledgeBase.api.listEditorDrafts()).length); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await knowledgeBase.api.getZettel(rows[0].id)).body.includes("From reading to an idea")) throw new Error("Editor autosave did not persist");
        if ((await knowledgeBase.api.listEditorDrafts()).length) throw new Error("Committed draft was not removed");
        if (editor.document.getElementById("knowledge-base-editor-save") || !editor.document.getElementById("knowledge-base-editor-apply-draft").hidden) throw new Error("Normal editing still exposes a manual Save control");
        if (editor.closed) throw new Error("Autosave unexpectedly closed the editor");
        await switchMode("visual");
        const noteElement = editor.document.getElementById("knowledge-base-rich-frame");
        const instance = noteElement.getCurrentInstance();
        const frameWindow = instance._iframeWindow;
        const frameDocument = frameWindow.document;
        const richSurface = frameDocument.querySelector(".ProseMirror");
        if (noteElement.localName !== "note-editor" || !richSurface || !instance._item.isNote()) throw new Error("Editor is not bound to a native Zotero note");
        const nativeNote = instance._item;
        const nativeHTML = nativeNote.getNote();
        if (!nativeHTML.includes('class="math"') || !nativeHTML.includes('data-citation=')) throw new Error("Markdown did not migrate to native math and citations");
        const childID = (await knowledgeBase.api.listZettels()).find(card => card.id !== rows[0].id).id;
        const childReference = (await knowledgeBase.api.getZettel(childID)).reference;
        const cardLink = [...richSurface.querySelectorAll("a[title]")].find(link=>link.getAttribute("title")==="[[" + childReference + "]]");
        if (!cardLink || cardLink.textContent !== (await knowledgeBase.api.getNoteLink(childID)).label || (await knowledgeBase.api.resolveCardLink(cardLink.href))?.targetId !== childID) throw new Error("Native card links lost their stable target or current key");
        if (richSurface.querySelector("a[href$='" + note.key + "']")?.textContent !== "My note") throw new Error("Note labels were rewritten");
        const citation = richSurface.querySelector(".citation");
        if (!citation?.textContent.includes("Smith") || !citation.textContent.includes("2026")) throw new Error("Native author-year citation missing");
        const click = (target) => {
          const bounds = target.getBoundingClientRect();
          for (const type of ["mousedown", "mouseup", "click"]) target.dispatchEvent(new frameWindow.MouseEvent(type, { bubbles: true, cancelable: true, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2, ctrlKey: true, metaKey: true }));
        };
        const linkMessages=[];
        frameWindow.addEventListener("message", event=>{if(event.data?.message)linkMessages.push({action:event.data.message.action,url:event.data.message.url,id:event.data.instanceID,source:event.source===frameWindow});},true);
        cardLink.scrollIntoView({block:"center"});
        await new Promise(resolve=>setTimeout(resolve,50));
        click(cardLink);
        let linkEditor;
        for (let n = 0; n < 120; n++) {
          const linkWorkbench = Zotero.getMainWindow().document.querySelector(".knowledge-base-workbench")?.contentWindow;
          linkEditor = linkWorkbench?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
          if (linkEditor?.knowledgeBaseCardId === childID && linkEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (linkEditor?.knowledgeBaseCardId !== childID) throw new Error("Native card hyperlink did not navigate into the workbench: " + JSON.stringify({href:cardLink.href,connected:cardLink.isConnected,currentInstance:noteElement.getCurrentInstance().instanceID,expectedInstance:instance.instanceID,mode:knowledgeBase.api.getWorkbenchMode(),editor:linkEditor?.knowledgeBaseCardId,selected:Zotero.getMainWindow().ZoteroPane.getSelectedItems().map(item=>item.id), messages:linkMessages}));
        Zotero.getMainWindow().Zotero_Tabs.close(Zotero.getMainWindow().Zotero_Tabs.selectedID);
        const math = richSurface.querySelector("math-inline .math-render");
        const mathBounds = math.getBoundingClientRect();
        for (const type of ["mousedown", "mouseup", "click"]) math.dispatchEvent(new frameWindow.MouseEvent(type, { bubbles: true, cancelable: true, clientX: mathBounds.x + mathBounds.width / 2, clientY: mathBounds.y + mathBounds.height / 2 }));
        await new Promise(resolve => setTimeout(resolve, 100));
        const mathSource = richSurface.querySelector("math-inline .math-src .ProseMirror");
        if (!mathSource || frameWindow.getComputedStyle(mathSource.parentElement).display === "none") throw new Error("Native math did not expand in place");
        const mathRange = frameDocument.createRange(); mathRange.selectNodeContents(mathSource); mathRange.collapse(false);
        const mathSelection = frameWindow.getSelection(); mathSelection.removeAllRanges(); mathSelection.addRange(mathRange); mathSource.focus();
        if (!frameDocument.execCommand("insertText", false, " + 1")) throw new Error("Native math input failed");
        for (let n = 0; n < 80 && !nativeNote.getNote().includes("mc^2 + 1"); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!nativeNote.getNote().includes("mc^2 + 1")) throw new Error("Native formula edit did not save Markdown math");
        mathSource.dispatchEvent(new frameWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        richSurface.focus();
        const range = frameDocument.createRange();
        const lastParagraph = [...richSurface.querySelectorAll(":scope > p")].pop();
        range.selectNodeContents(lastParagraph); range.collapse(false);
        const selection = frameWindow.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!frameDocument.execCommand("insertText", false, " Native autosave probe")) throw new Error("Native editing input failed");
        for (let n = 0; n < 100 && !nativeNote.getNote().includes("Native autosave probe"); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!nativeNote.getNote().includes("Native autosave probe")) throw new Error("Zotero's editor did not save the real note");
        for (let n = 0; n < 100 && !(await knowledgeBase.api.getZettel(rows[0].id)).body.includes("Native autosave probe"); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await knowledgeBase.api.getZettel(rows[0].id)).body.includes("Native autosave probe")) throw new Error("Native note changes did not refresh the card cache");
        await switchMode("source");
        if (!body.value.includes("[@Host2026]") || !body.value.includes("[My note](zotero://")) throw new Error("Source projection lost references");
        if (editor.document.getElementById("knowledge-base-editor-title") || !body.querySelector("iframe")?.contentDocument.querySelector(".cm-editor")) throw new Error("Markdown still exposes a separate title or plain textarea");
        const sourceDoc = body.querySelector("iframe").contentDocument;
        const cmContent = sourceDoc.querySelector(".cm-content");
        if (cmContent.namespaceURI !== "http://www.w3.org/1999/xhtml") throw new Error("Markdown content is not HTML: " + cmContent.namespaceURI);
        const typingBefore = body.value;
        const typingAt = typingBefore.indexOf("Native autosave probe");
        editor.focus(); body.focus(); body.setSelectionRange(typingAt, typingAt);
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!sourceDoc.execCommand("insertText", false, "Cursor probe ")) throw new Error("Markdown typing failed");
        await new Promise(resolve => setTimeout(resolve, 100));
        if (body.value !== typingBefore.slice(0, typingAt) + "Cursor probe " + typingBefore.slice(typingAt)) throw new Error("Markdown typed at the wrong cursor: " + JSON.stringify({at: typingAt, value: body.value, selection: body.selectionStart, editable: cmContent.isContentEditable, active: editor.document.activeElement?.outerHTML?.slice(0,300), dom: cmContent.innerHTML.slice(0,250), anchor: editor.getSelection()?.anchorNode?.parentElement?.outerHTML?.slice(0,200)}));
        const saveStarted = Date.now();
        const replaceBefore = body.value;
        body.setSelectionRange(typingAt, typingAt + "Cursor probe ".length);
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!sourceDoc.execCommand("insertText", false, "中文编辑 ")) throw new Error("Markdown replacement failed");
        await new Promise(resolve => setTimeout(resolve, 50));
        if (body.value !== replaceBefore.slice(0, typingAt) + "中文编辑 " + replaceBefore.slice(typingAt + "Cursor probe ".length)) throw new Error("Markdown replaced text at the wrong position");
        for (let n = 0; n < 30 && !nativeNote.getNote().includes("中文编辑 Native autosave probe"); n++) await new Promise(resolve => setTimeout(resolve, 50));
        const markdownSaveMs = Date.now() - saveStarted;
        if (!nativeNote.getNote().includes("中文编辑 Native autosave probe") || markdownSaveMs > 1600) throw new Error("Markdown autosave was not prompt: " + markdownSaveMs + " ms");
        const citationChip = sourceDoc.querySelector(".knowledge-base-md-node-citation");
        if (!citationChip || citationChip.textContent.includes("data-citation")) throw new Error("Native citation is not displayed as a compact chip");
        const changeButton = editor.document.getElementById("knowledge-base-src-pick");
        if (editor.document.getElementById("knowledge-base-editor-more") || editor.document.querySelectorAll(".metadata-change").length !== 1) throw new Error("Editor retains redundant action controls");
        const changeBounds = changeButton.getBoundingClientRect();
        if (!changeButton.getAttribute("aria-label") || changeBounds.width < 24 || changeBounds.height < 10 || changeBounds.right > editor.innerWidth) throw new Error("Source Change button is not visibly laid out: " + JSON.stringify({text:changeButton.textContent, bounds:changeBounds.toJSON(), style:editor.getComputedStyle(changeButton).cssText, display:editor.getComputedStyle(changeButton).display}));
        const chipShots = ${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        if (chipShots) {
          await IOUtils.makeDirectory(chipShots, {ignoreExisting: true});
          const image = await editor.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = editor.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
          await IOUtils.write(PathUtils.join(chipShots, "markdown-editor.png"), new Uint8Array(await blob.arrayBuffer()));
        }
        const protectedSource = knowledgeBase.api.getMarkdownSource(nativeNote.getNote());
        if (!body.value.includes("data-attachment-key=") || !protectedSource.fragments.some(fragment => fragment.includes(migratedImage.key)) || !protectedSource.fragments.some(fragment => fragment.includes("locator%22%3A%2223"))) throw new Error("Source projection lost protected image/citation metadata");
        await switchMode("visual");
        await switchMode("source");
                body.value += "\\n\\nProtected fragment round trip";
        body.dispatchEvent(new editor.Event("input", {bubbles: true}));
        if (!(await editor.save(false))) throw new Error("Markdown fragment save failed");
        const fragmentCheck = nativeNote.getNote();
        if (!fragmentCheck.includes(migratedImage.key) || !fragmentCheck.includes("locator%22%3A%2223") || !fragmentCheck.includes("Protected fragment round trip")) throw new Error("Markdown save lost native images or citation locators");
        const sourceBeforeConflict = body.value;
        body.value = body.value.replace("Protected fragment round trip", "Unsaved Markdown conflict");
        body.dispatchEvent(new editor.Event("input", {bubbles: true}));
        nativeNote.setNote(nativeNote.getNote().replace("Protected fragment round trip", "Better Notes external change"));
        await nativeNote.saveTx();
        if (await editor.save(false)) throw new Error("Markdown editor overwrote an external edit");
        if (!nativeNote.getNote().includes("Better Notes external change") || nativeNote.getNote().includes("Unsaved Markdown conflict") || !editor.document.getElementById("knowledge-base-editor-status").textContent.includes(knowledgeBase.api.loc("editor-save-conflict"))) throw new Error("Markdown conflict was not visible or retained");
        if (!noteElement.getCurrentInstance()._disableSaving) throw new Error("Hidden native editor can still write during Markdown editing");
        nativeNote.setNote(fragmentCheck); await nativeNote.saveTx();
        body.value = sourceBeforeConflict;
        if (!(await editor.save(false))) throw new Error("Conflict did not resolve after restoring the original baseline");
        await switchMode("visual");
        function dragPanel(win, splitterID, name, percent, end = "pointerup") {
          const handle = win.document.getElementById(splitterID);
          const rect = handle.parentElement.getBoundingClientRect();
          const x = name === "graph" ? rect.right - rect.width * percent / 100 : rect.left + rect.width * percent / 100;
          let error;
          const onError = event => { error = event.error || event.message; };
          win.addEventListener("error", onError);
          try {
            handle.dispatchEvent(new win.PointerEvent("pointerdown", {button:0, bubbles:true}));
            const shield = win.document.querySelector('.panel-drag-shield');
            if (!shield || win.getComputedStyle(shield).position !== 'fixed' || shield.getBoundingClientRect().width < win.innerWidth - 2) throw new Error('Panel dragging does not cover the native editor');
            shield.dispatchEvent(new win.PointerEvent("pointermove", {clientX:x, bubbles:true}));
            if(end === 'blur') win.dispatchEvent(new win.Event(end));
            else shield.dispatchEvent(new win.Event(end, {bubbles:true}));
          } finally { win.removeEventListener("error", onError); }
          if (error) throw new Error("Panel drag raised a host error: " + error);
          if (win.document.documentElement.classList.contains("resizing-panels")) throw new Error("Panel resizing state was not cleared");
          if (win.document.querySelector('.panel-drag-shield')) throw new Error('Panel drag shield was not released');
          const expected = Math.round(Math.max(18, Math.min(55, percent)));
          const persisted = Zotero.Prefs.get("extensions.zotero.knowledge-base.panels." + name, true);
          if (!Number.isInteger(persisted) || persisted !== expected) throw new Error("Panel drag did not save an integer width: " + persisted);
        }
        if (Zotero.Prefs.get("extensions.zotero.knowledge-base.panels.manager", true) !== undefined || Zotero.Prefs.get("extensions.zotero.knowledge-base.panels.graph", true) !== undefined) throw new Error("Panel regression must start without saved widths");
        dragPanel(manager, "knowledge-base-splitter", "manager", 31.4159);
        dragPanel(graph, "graph-splitter", "graph", 27.1828, "pointercancel");
        dragPanel(manager, "knowledge-base-splitter", "manager", 100);
        dragPanel(manager, "knowledge-base-splitter", "manager", 0);
        dragPanel(manager, "knowledge-base-splitter", "manager", 31.4159, "blur");
        const listHandle = manager.document.getElementById("knowledge-base-splitter");
        const originalWidth = manager.document.getElementById("knowledge-base-list-pane").getBoundingClientRect().width;
        listHandle.dispatchEvent(new manager.KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
        if (!(manager.document.getElementById("knowledge-base-list-pane").getBoundingClientRect().width > originalWidth) || knowledgeBase.api.getPanelWidth("manager") !== 33) throw new Error("List panel did not resize and persist");
        const transformBeforeResize = graph.document.querySelector("#graph-svg > g")?.getAttribute("transform");
        graph.document.getElementById("graph-splitter").dispatchEvent(new graph.KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
        if (knowledgeBase.api.getPanelWidth("graph") !== 29 || transformBeforeResize !== graph.document.querySelector("#graph-svg > g")?.getAttribute("transform")) throw new Error("Graph resizing changed its viewport or failed to persist");
        const editorRelations = editor.document.getElementById("knowledge-base-editor-relations");
        const compactConnections = editorRelations.getBoundingClientRect().width >= 200 && editor.getComputedStyle(editor.document.getElementById("knowledge-base-editor-content")).flexDirection === "column" && editorRelations.querySelectorAll("nav button").length === 3 && !editorRelations.querySelector("details") && !editorRelations.contains(editor.document.getElementById("knowledge-base-parent-display"));
        const sourceDisplay = editor.document.getElementById("knowledge-base-src-display");
        const sourceReference = sourceDisplay.textContent;
        if (!sourceReference.includes("Smith") || !sourceReference.includes("2026") || !sourceDisplay.querySelector("i") || !sourceReference.includes("Journal of Test Studies") || editor.document.getElementById("knowledge-base-parent-root")) throw new Error("Source/Parent metadata is not a concise reference");
        const systemDark = editor.matchMedia("(prefers-color-scheme: dark)").matches;
        const nativeFrame = noteElement.getCurrentInstance()._iframeWindow;
        let noteLinkTool;
        for (let n = 0; n < 50; n++) {
          noteLinkTool = nativeFrame.document.querySelector(".knowledge-base-note-link");
          if (noteLinkTool) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const modeTool = nativeFrame.document.querySelector(".knowledge-base-markdown-toggle");
        if (!noteLinkTool || noteLinkTool.getBoundingClientRect().width < 28 || noteLinkTool.getBoundingClientRect().left - modeTool.getBoundingClientRect().right < 6) throw new Error("Note-link toolbar entry disappeared or has crowded hit areas after returning to rich text");
        checkNativeEndSpace(nativeFrame);
        const nativeStyleScoped = !!nativeFrame.document.getElementById("knowledge-base-note-appearance") && !nativeFrame.getComputedStyle(nativeFrame.document.querySelector('.primary-editor')).fontFamily.includes('Avenir Next');
        if (!nativeStyleScoped) throw new Error("Knowledge Base typography is missing from its own editor frame");
        const screenshotDirectory = ${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        async function snapshot(name, win) {
          const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(screenshotDirectory, name + ".png"), new Uint8Array(await blob.arrayBuffer()));
        }
        if (editor.document.getElementById('knowledge-base-note-kind') || editor.document.getElementById('knowledge-base-note-kind-text')) throw new Error('Unified notes still show a type');
        editor.openCardPicker();
        for (let n=0; n<100 && !editor.document.querySelector("#knowledge-base-link-results .note-reference-text"); n++) await new Promise(resolve=>setTimeout(resolve,20));
        const pickerReference = editor.document.querySelector("#knowledge-base-link-results .note-reference-text");
        if (!pickerReference) throw new Error("Insert Note references are missing");
        const checkReferences = win => {
          for (const text of win.document.querySelectorAll(".note-reference-text")) {
            const title = text.querySelector(".relation-title");
            if (!title || !text.getBoundingClientRect().height) continue;
            if (text.querySelector(".relation-id") || text.textContent !== title.textContent) throw new Error("A note reference contains an inline identifier: " + text.textContent);
          }
        };
        if (screenshotDirectory) await snapshot("insert-note-picker", editor);
        checkReferences(editor); checkReferences(manager); checkReferences(graph);
        editor.document.getElementById("knowledge-base-link-drop").hidden = true;
        if (screenshotDirectory) {
          await IOUtils.makeDirectory(screenshotDirectory, { ignoreExisting: true });
          await snapshot("manager", manager);
          await snapshot("graph", graph);
          await snapshot("native-editor", editor);
          editorRelations.open = false;
          await snapshot("native-editor-writing", editor);
          editorRelations.open = true;

        }
        const priorSources = knowledgeBase.api.getGraphOptions().sources;
        knowledgeBase.api.setGraphOption("sources", true);
        const realGetGraph = knowledgeBase.api.getGraph;
        const originalGraphData = await realGetGraph();
        let graphFrames;
        Zotero.debug("Knowledge Base host stage: blank native note");
        const windowsBeforeNew=new Set([...Services.wm.getEnumerator("knowledge-base:editor")]);
        const newNoteStarted=Date.now();
        knowledgeBase.api.openEditor({window:true,sourceItem:{key:item.key,libraryID:item.libraryID}});
        let quickNote;
        for(let n=0;n<100;n++) {
          quickNote=[...Services.wm.getEnumerator("knowledge-base:editor")].find(win=>!windowsBeforeNew.has(win));
          if(quickNote?.document.getElementById("knowledge-base-editor-root")?.dataset.mode==="visual") break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        if(!quickNote || quickNote.document.getElementById("knowledge-base-editor-title") || quickNote.document.getElementById("knowledge-base-editor-body").querySelector("iframe")) throw new Error("New Note still uses a separate title or eagerly allocates Markdown");
        const quickInstance=quickNote.document.getElementById("knowledge-base-rich-frame").getCurrentInstance();
        if(!quickInstance?._item.isNote() || quickInstance._item.parentItemID!==item.id || quickInstance._iframeWindow.document.querySelector(".primary-editor h1")) throw new Error("New Note is not a blank native Zotero note under its source");
        const newNoteOpenMs=Date.now()-newNoteStarted;
        if(screenshotDirectory) await snapshot("new-native-note",quickNote);
        quickNote.close();
        for(let n=0;n<100 && !quickNote.closed;n++) await new Promise(resolve=>setTimeout(resolve,20));
        if(!quickNote.closed) throw new Error("Blank native note did not close cleanly");
        Zotero.debug("Knowledge Base host stage: graph scopes and animation");
        const topics = ["视觉语言模型", "图像分割", "表示学习", "多模态检索", "生成模型", "研究方法"];
        const network = {nodes:[], edges:[]};
        for (let topic = 0; topic < topics.length; topic++) {
          const sourceID = "network-source-" + topic;
          network.nodes.push({id:sourceID, title:"Source · " + topics[topic], kind:"source", snippet:"Researcher 2026", citation:"Researcher 2026"});
          for (let i = 0; i < 30; i++) {
            const id = "network-" + topic + "-" + i;
            network.nodes.push({id, title:(i === 0 ? "Survey · " : "") + topics[topic] + "：研究问题、证据与思考 " + i, kind:"card", group:topics[topic], tags:[topics[topic]], color:["#2469c9","#268572","#bd4781","#8c61c9","#c88428","#368b9c"][topic], snippet:"# " + topics[topic] + "\\n\\nA connected research note."});
            network.edges.push({source:id, target:sourceID, kind:"source", ref:sourceID, context:""});
            if (i) network.edges.push({source:"network-" + topic + "-0", target:id, kind:i < 3 ? "parent" : "link", ref:id, context:""});
          }
          if (topic) network.edges.push({source:"network-0-0", target:"network-" + topic + "-0", kind:"link", ref:"", context:""});
        }
        network.nodes.push({id:"network-isolated",title:"Isolated note",kind:"card",snippet:""},{id:"network-self",title:"Self reference only",kind:"card",snippet:""});
        network.edges.push({source:"network-self",target:"network-self",kind:"link",ref:"",context:""});
        const isolationControl = graph.document.getElementById("graph-hide-isolated");
        async function waitGraphCount(count) {
          for(let n=0;n<100 && graph.document.querySelectorAll(".graph-node").length!==count;n++) await new Promise(resolve=>setTimeout(resolve,25));
          if(graph.document.querySelectorAll(".graph-node").length!==count || graph.document.getElementById("graph-error").textContent) throw new Error("Isolated-node filtering failed: " + graph.document.querySelectorAll(".graph-node").length + "/" + count + " " + graph.document.getElementById("graph-error").textContent);
        }
        async function snapshotGraph(name) {
          if(!screenshotDirectory) return;
          for(let n=0;n<150 && graph.document.getElementById("graph-svg").dataset.layoutState!=="settled";n++) await new Promise(resolve=>setTimeout(resolve,25));
          graph.document.getElementById("graph-fit").click();
          await new Promise(resolve=>graph.requestAnimationFrame(()=>graph.requestAnimationFrame(resolve)));
          await snapshot(name,graph);
        }
        async function redrawGraph(data) {
          knowledgeBase.api.setGraphOption("sources",true);
          knowledgeBase.api.setGraphOption("hideIsolated",false);
          graph.document.getElementById("graph-global").click();
          knowledgeBase.api.getGraph = async () => data;
          graph.document.getElementById("graph-refresh").click();
          for (let n = 0; n < 100 && graph.document.querySelectorAll(".graph-node").length !== data.nodes.length; n++) await new Promise(resolve => setTimeout(resolve, 25));
          if (graph.document.querySelectorAll(".graph-node").length !== data.nodes.length || graph.document.getElementById("graph-error").textContent) throw new Error("Host network rendering failed: " + graph.document.querySelectorAll(".graph-node").length + "/" + data.nodes.length + " " + graph.document.getElementById("graph-error").textContent + " " + JSON.stringify({options:knowledgeBase.api.getGraphOptions(),scope:graph.document.getElementById("graph-svg").dataset.scope}));
          await new Promise(resolve=>setTimeout(resolve,400));
          graph.document.getElementById("graph-fit").click();
        }
        try {
          graph.document.getElementById("graph-global").click();
          await redrawGraph(network);
          if (graph.getComputedStyle(graph.document.getElementById("graph-canvas")).backgroundImage !== "none") throw new Error("Graph still has a distracting background grid");
          const circles = [...graph.document.querySelectorAll(".graph-node-dot")].map(circle => Number(circle.getAttribute("r")));
          if (!(Math.max(...circles) > Math.min(...circles))) throw new Error("Network hubs do not have larger nodes");
          if([...graph.document.querySelectorAll('.graph-node-dot')].some(circle=>Number(circle.getAttribute('r'))*circle.getScreenCTM().a<3.4)) throw new Error('Zoomed-out graph nodes became too small to see');
          if ([...graph.document.querySelectorAll(".graph-node")].some(node => /NaN|Infinity/.test(node.getAttribute("transform")))) throw new Error("Network coordinates are invalid");
          if (screenshotDirectory) await snapshot("graph-network", graph);
          const search = graph.document.getElementById("graph-search");
          search.value = "Survey"; search.dispatchEvent(new graph.Event("input"));
          if (graph.document.querySelectorAll(".graph-node.highlighted").length !== 6) throw new Error("Graph search does not highlight all matching notes");
          search.value = ""; search.dispatchEvent(new graph.Event("input"));
          knowledgeBase.api.setGraphLabelLength(12); await new Promise(resolve=>setTimeout(resolve,100));
          const lengthNode=[...graph.document.querySelectorAll(".graph-node")].find(node=>node.getAttribute("aria-label").startsWith("Survey"));
          const fullLengthTitle=lengthNode.getAttribute("aria-label");
          const resizedLabel=graph.document.querySelector('[data-node-id="'+lengthNode.dataset.nodeId+'"] text');
          if(resizedLabel.textContent!==Array.from(fullLengthTitle).slice(0,12).join('')+'…') throw new Error('Open graph did not apply its title length live');
          knowledgeBase.api.setGraphLabelLength(18); await new Promise(resolve=>setTimeout(resolve,100));

          const baseNodeStyles=new Map([...graph.document.querySelectorAll(".graph-node")].map(node=>[node,{opacity:graph.getComputedStyle(node).opacity,fill:graph.getComputedStyle(node.querySelector('.graph-node-dot')).fill}]));
          const baseEdgeStyles=new Map([...graph.document.querySelectorAll(".graph-edge")].map(line=>[line,{opacity:graph.getComputedStyle(line).opacity,width:parseFloat(graph.getComputedStyle(line).strokeWidth),stroke:graph.getComputedStyle(line).stroke}]));
          let node = [...graph.document.querySelectorAll(".graph-node")].find(node => node.getAttribute("aria-label").startsWith("Survey"));
          node.dispatchEvent(new graph.PointerEvent("pointerenter"));
          const titleLimit=knowledgeBase.api.getGraphLabelLength();
          const fullTitle=node.getAttribute("aria-label");
          if(node.querySelector("text").textContent!==Array.from(fullTitle).slice(0,titleLimit).join('')+'…' || !node.querySelector('title').textContent.startsWith(fullTitle) || !graph.document.querySelector(".graph-edge.highlighted")) throw new Error("Hover lost its compact title, full tooltip or connected links");
          node.dispatchEvent(new graph.MouseEvent("click",{bubbles:true}));
          if(graph.document.querySelector('.dimmed')) throw new Error('Selection faded unrelated graph nodes or links');
          for(const [other,style] of baseNodeStyles) if(graph.getComputedStyle(other).opacity!==style.opacity || graph.getComputedStyle(other.querySelector('.graph-node-dot')).fill!==style.fill) throw new Error('Selection changed the brightness or tag color of graph nodes');
          for(const [line,style] of baseEdgeStyles) {
            const current=graph.getComputedStyle(line);
            if(line.classList.contains('highlighted')) {if(parseFloat(current.strokeWidth)<=style.width || parseFloat(current.opacity)<Number(style.opacity)) throw new Error('Connected graph links were not strengthened');}
            else if(current.opacity!==style.opacity || current.stroke!==style.stroke) throw new Error('Selection faded unrelated graph links');
          }
          if (screenshotDirectory) await snapshot("graph-network-hover", graph);
          node.dispatchEvent(new graph.PointerEvent("pointerleave"));
          const before = node.getAttribute("transform");
          const screen = node.getScreenCTM();
          // Synthetic pointers are not active native pointers, so capture is a stub for this gesture.
          const capture = node.setPointerCapture;
          node.setPointerCapture = () => {};
          node.dispatchEvent(new graph.PointerEvent("pointerdown", {button:0, bubbles:true}));
          graph.document.getElementById("graph-svg").dispatchEvent(new graph.PointerEvent("pointermove", {clientX:screen.e + 60, clientY:screen.f + 40, bubbles:true}));
          graph.document.getElementById("graph-svg").dispatchEvent(new graph.PointerEvent("pointerup", {bubbles:true}));
          node.setPointerCapture = capture;
          if (node.getAttribute("transform") === before) throw new Error("Node drag did not update its position");
          graph.dispatchEvent(new graph.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
          if (graph.document.querySelector(".graph-node.selected,.graph-node.dimmed")) throw new Error("Escape did not clear graph selection");
          const scene = graph.document.querySelector("#graph-svg > g");
          const viewportBeforeIsolation = scene.getAttribute("transform");
          isolationControl.checked = true;
          isolationControl.dispatchEvent(new graph.Event("command",{bubbles:true}));
          await waitGraphCount(network.nodes.length-2);
          if(!knowledgeBase.api.getGraphOptions().hideIsolated || graph.document.querySelector('[data-node-id="network-isolated"],[data-node-id="network-self"]')) throw new Error("The native filter did not hide isolated and self-reference-only notes");
          if(graph.document.querySelector("#graph-svg > g").getAttribute("transform")!==viewportBeforeIsolation) throw new Error("Filtering isolated nodes reset graph pan or zoom");
          if(screenshotDirectory) await snapshot("graph-connected-only",graph);
          knowledgeBase.api.setGraphOption("sources",false);
          knowledgeBase.api.setGraphOption("references",false);
          await waitGraphCount(18);
          knowledgeBase.api.setGraphOption("outline",false);
          await waitGraphCount(0);
          if(graph.document.getElementById("graph-empty").hidden) throw new Error("The isolated-node filter lost the empty graph message");
          knowledgeBase.api.setGraphOption("outline",true);
          knowledgeBase.api.setGraphOption("references",true);
          knowledgeBase.api.setGraphOption("sources",true);
          isolationControl.checked = false;
          isolationControl.dispatchEvent(new graph.Event("command",{bubbles:true}));
          await waitGraphCount(network.nodes.length);
          if(network.nodes.length!==188 || network.edges.length!==360) throw new Error("Graph filtering modified the source data");
          manager.document.getElementById("knowledge-base-btn-graph").click();
          await waitGraphCount(network.nodes.length);
          if(graph.document.getElementById("graph-svg").dataset.scope!=="global" || graph.document.getElementById("graph-depth-control")) throw new Error("Manager global entry did not restore global scope");
          knowledgeBase.api.openGraph({centerId:"network-0-1"});
          await waitGraphCount(3);
          if([...Services.wm.getEnumerator("knowledge-base:graph")].length!==1 || graph.document.getElementById("graph-svg").dataset.centerId!=="network-0-1") throw new Error("Local entry did not reuse the graph window with a new center");
          function setHop(value) { knowledgeBase.api.setGraphLocalDepth(value); }
          setHop(2); await waitGraphCount(36);
          await snapshotGraph("graph-local-two-hops");
          knowledgeBase.api.setGraphOption("hideIsolated",true); await waitGraphCount(36);
          setHop(1); await waitGraphCount(3);
          knowledgeBase.api.setGraphOption("sources",false); await waitGraphCount(2);
          knowledgeBase.api.setGraphOption("outline",false); await waitGraphCount(1);
          knowledgeBase.api.setGraphOption("sources",true);
          knowledgeBase.api.setGraphOption("outline",true);
          knowledgeBase.api.setGraphOption("hideIsolated",false);
          knowledgeBase.api.openGraph({centerId:"network-source-0"});
          await waitGraphCount(31);
          await snapshotGraph("graph-local-paper");
          graph.document.getElementById("graph-global").click();
          await waitGraphCount(network.nodes.length);
          if(!graph.document.querySelector('[data-node-id="network-source-0"].selected') || graph.document.querySelector('.dimmed')) throw new Error("Global scope did not retain the selected paper highlight");
          graph.document.querySelector('[data-node-id="network-1-1"]').dispatchEvent(new graph.MouseEvent("click",{bubbles:true}));
          graph.document.getElementById("graph-local").click(); await waitGraphCount(3);
          if(graph.document.getElementById("graph-svg").dataset.centerId!=="network-1-1") throw new Error("Local action did not center the selected note");
          graph.document.getElementById("graph-global").click(); await waitGraphCount(network.nodes.length);
          const large={nodes:[],edges:[]};
          Zotero.debug('Knowledge Base host stage: large graph');
          graph.focus();
          for(let i=0;i<1200;i++) {
            large.nodes.push({id:"large-"+i,title:"Research note with a long title "+i,kind:"card",snippet:"",group:topics[i%6],color:["#2469c9","#268572","#bd4781","#8c61c9","#c88428","#368b9c"][i%6],tags:[topics[i%6]]});
            if(i) large.edges.push({source:"large-"+i,target:"large-"+(i-1),kind:"link",ref:"",context:""});
            if(i>6) large.edges.push({source:"large-"+i,target:"large-"+(i-6),kind:"parent",ref:"",context:""});
          }
          await redrawGraph(large);
          Zotero.Utilities.Internal.activate(graph); graph.focus();
          await new Promise(resolve=>setTimeout(resolve,100));
          const intervals=[]; let lastFrame=graph.performance.now();
          await new Promise(resolve=>{
            function frame(now) {
              intervals.push(now-lastFrame);lastFrame=now;
              if(intervals.length>=24) resolve(); else graph.requestAnimationFrame(frame);
            }
            graph.requestAnimationFrame(frame);
          });
          if(Math.max(...intervals)>250 || graph.document.getElementById("graph-error").textContent) throw new Error("Large graph blocked display frames: "+JSON.stringify(intervals));
          const svg=graph.document.getElementById("graph-svg");
          if(!["canvas","webgl2"].includes(svg.dataset.renderer) || graph.document.getElementById("graph-paint").hidden) throw new Error("Large graph did not use a batched renderer");
          for(let i=0;i<400 && svg.dataset.layoutState!=="settled";i++) await new Promise(resolve=>setTimeout(resolve,25));
          if(svg.dataset.layoutState!=="settled") throw new Error("Large graph did not finish its background layout");
          Zotero.debug('Knowledge Base host stage: graph style switching');
          graph.focus();
          svg.querySelector('[data-node-id="large-0"]').dispatchEvent(new graph.MouseEvent('click',{bubbles:true}));
          const beforeThemeTransform=svg.querySelector('g').getAttribute('transform');
          const themeContext=graph.document.getElementById('graph-paint').getContext('2d');
          for(const value of ['bear','minimal']) {
            Zotero.debug('Knowledge Base host stage: graph style '+value);
            graph.ZoteroPluginUI.select(value);
            for(let n=0;n<200 && (themeContext.font.includes('Avenir Next') || graph.document.documentElement.hasAttribute('data-plugin-bear')!==(value==='bear') || svg.dataset.layoutState!=='settled');n++)await new Promise(resolve=>setTimeout(resolve,25));
            if(themeContext.font.includes('Avenir Next') || graph.document.documentElement.hasAttribute('data-plugin-bear')!==(value==='bear') || svg.querySelector('g').getAttribute('transform')!==beforeThemeTransform || svg.dataset.layoutState!=='settled')throw new Error('Graph theme did not refresh its renderer or changed its viewport: '+JSON.stringify({value,font:themeContext.font,transform:svg.querySelector('g').getAttribute('transform'),before:beforeThemeTransform,state:svg.dataset.layoutState}));
            auditUI(graph);
          }
          await new Promise(resolve=>graph.requestAnimationFrame(resolve));
          Zotero.debug('Knowledge Base host stage: graph styles applied');
          const idleIntervals=[];let idleFrame=graph.performance.now();
          await new Promise(resolve=>{
            function frame(now) {
              idleIntervals.push(now-idleFrame);idleFrame=now;
              if(idleIntervals.length>=12) resolve();else graph.requestAnimationFrame(frame);
            }
            graph.requestAnimationFrame(frame);
          });
          const paint=graph.document.getElementById("graph-paint"), bounds=svg.getBoundingClientRect();
          const target=[...svg.querySelectorAll(".graph-node")].find(node=>{const m=node.getScreenCTM();return m.e>bounds.left+30 && m.f>bounds.top+30 && m.e<bounds.right-30 && m.f<bounds.bottom-30;});
          if(!target) throw new Error("Large graph has no visible node");
          const screenTarget=target.getScreenCTM();
          svg.dispatchEvent(new graph.MouseEvent("click",{clientX:screenTarget.e,clientY:screenTarget.f,bubbles:true}));
          if(!graph.document.querySelector(".graph-node.selected") || graph.document.getElementById("graph-selection").hidden) throw new Error("Graph hit testing did not select a node: "+JSON.stringify({state:svg.dataset.layoutState,backend:svg.dataset.renderer,id:target.dataset.nodeId,point:{x:screenTarget.e,y:screenTarget.f},bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}}));
          const canvasCapture=svg.setPointerCapture;svg.setPointerCapture=()=>{};
          svg.dispatchEvent(new graph.PointerEvent("pointerdown",{button:0,clientX:screenTarget.e,clientY:screenTarget.f,bubbles:true}));
          svg.dispatchEvent(new graph.PointerEvent("pointermove",{clientX:screenTarget.e+40,clientY:screenTarget.f+20,bubbles:true}));
          svg.dispatchEvent(new graph.PointerEvent("pointerup",{bubbles:true}));svg.setPointerCapture=canvasCapture;
          const bitmap=paint.getContext("2d").getImageData(0,0,paint.width,paint.height).data;
          const gpuCanvas=graph.document.getElementById("graph-gpu");
          let gpuRenderer;
          if(svg.dataset.renderer==="webgl2") {
            const gl=gpuCanvas.getContext("webgl2");
            async function checkGPUPixels() {
              graph.dispatchEvent(new graph.Event("resize"));
              await new Promise((resolve,reject)=>graph.requestAnimationFrame(()=>{
                const pixels=new Uint8Array(gpuCanvas.width*gpuCanvas.height*4);
                gl.readPixels(0,0,gpuCanvas.width,gpuCanvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
                if(gl.getError()!==gl.NO_ERROR || !pixels.some((value,i)=>i%4===3&&value)) reject(new Error("GPU graph did not paint valid pixels"));
                else resolve();
              }));
            }
            await checkGPUPixels();
            const info=gl.getExtension("WEBGL_debug_renderer_info");
            gpuRenderer=gl.getParameter(info?info.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
            const context=gl.getExtension("WEBGL_lose_context");
            if(context) {
              context.loseContext();
              for(let i=0;i<80&&svg.dataset.renderer!=="canvas";i++) await new Promise(resolve=>setTimeout(resolve,25));
              if(svg.dataset.renderer!=="canvas" || !gpuCanvas.hidden) throw new Error("GPU context loss did not fall back to Canvas");
              const fallbackPixels=paint.getContext("2d").getImageData(0,0,paint.width,paint.height).data;
              if(!fallbackPixels.some((value,i)=>i%4===3&&value)) throw new Error("GPU fallback lost graph pixels");
              context.restoreContext();
              for(let i=0;i<80&&svg.dataset.renderer!=="webgl2";i++) await new Promise(resolve=>setTimeout(resolve,25));
              if(svg.dataset.renderer!=="webgl2" || gpuCanvas.hidden) throw new Error("Restored GPU context did not resume rendering");
              await checkGPUPixels();
            }
          } else if(!bitmap.some((value,i)=>i%4===3 && value)) throw new Error("Canvas graph did not paint pixels");
          graph.dispatchEvent(new graph.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
          if(graph.document.querySelector(".graph-node.selected")) throw new Error("Canvas Escape did not clear selection");
          const beforePan=svg.querySelector(":scope > g").getAttribute("transform");
          if(Zotero.isMac) {
            for(let i=0;i<20;i++) svg.dispatchEvent(new graph.WheelEvent("wheel",{deltaX:2,deltaY:3,bubbles:true,cancelable:true}));
            await new Promise(resolve=>graph.requestAnimationFrame(()=>graph.requestAnimationFrame(resolve)));
            if(svg.querySelector(":scope > g").getAttribute("transform")===beforePan) throw new Error("Large graph pan did not respond");
          }
          await snapshotGraph("graph-large");
          graphFrames={nodes:large.nodes.length,links:large.edges.length,backend:svg.dataset.renderer,gpuRenderer,mean:intervals.reduce((a,b)=>a+b)/intervals.length,max:Math.max(...intervals),idleMean:idleIntervals.reduce((a,b)=>a+b)/idleIntervals.length};
          await redrawGraph(network);

        } finally {
          knowledgeBase.api.setGraphOption("hideIsolated",false);
          knowledgeBase.api.setGraphOption("outline",true);
          knowledgeBase.api.setGraphOption("references",true);
          knowledgeBase.api.setGraphOption("sources",true);
          await redrawGraph(originalGraphData);
          knowledgeBase.api.getGraph = realGetGraph;
          knowledgeBase.api.setGraphOption("sources", priorSources);
          graph.ZoteroKnowledgeBase_showGraph(rows[0].id);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await switchMode("source");
        Zotero.debug("Knowledge Base host stage: native close confirmations");
        const nativeDialogs = [];
        const choices = ["cancel", "accept", "extra1"];
        let dialogFailure;
        const observer = { observe(win, topic) {
          if (topic !== "domwindowopened") return;
          win.addEventListener("load", () => {
            if (win.document.documentURI !== "chrome://global/content/commonDialog.xhtml") return;
            setTimeout(async () => {
              try {
                const dialog = win.document.getElementById("commonDialog");
                const choice = choices.shift();
                if (!choice || !dialog.getButton("accept").label || !dialog.getButton("extra1").label) throw new Error("Native close confirmation is incomplete");
                if (screenshotDirectory && choice === "cancel") await snapshot("close-confirmation", win);
                dialog.getButton(choice).click();
                nativeDialogs.push(choice);
              } catch (error) { dialogFailure = String(error); win.close(); }
            }, 150);
          }, { once: true });
        } };
        Services.ww.registerNotification(observer);
        async function closeShortcut(win) {
          const previousDialogs = nativeDialogs.length;
          win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true, cancelable: true }));
          for (let n = 0; n < 160 && nativeDialogs.length === previousDialogs && !dialogFailure; n++) await new Promise(resolve => setTimeout(resolve, 50));
          if (dialogFailure) throw new Error(dialogFailure);
          if (nativeDialogs.length === previousDialogs) throw new Error("Command-W did not show a native close confirmation");
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        try {
          body.value += "\\n\\nSave on close";
          body.dispatchEvent(new editor.Event("input", { bubbles: true }));
          let closeBody = body.value;
          await closeShortcut(editor);
          if (editor.closed || body.value !== closeBody || nativeDialogs[0] !== "cancel") throw new Error("Cancel did not keep the unsaved editor open");
          body.value += " — confirmed save";
          body.dispatchEvent(new editor.Event("input", { bubbles: true }));
          closeBody = body.value;
          await closeShortcut(editor);
          for (let n = 0; n < 80 && !editor.closed; n++) await new Promise(resolve => setTimeout(resolve, 50));
          if (!editor.closed || knowledgeBase.api.getMarkdownSource(nativeNote.getNote()).body !== closeBody || nativeDialogs[1] !== "accept") throw new Error("Command-W did not save and close");
          const acquired = await knowledgeBase.api.acquireNativeNote({ id: rows[0].id, title: "", body: "" });
          const beforeExternal = await knowledgeBase.api.getZettel(rows[0].id);
          await knowledgeBase.api.saveEditorDraft({ id: rows[0].id, title: "Conflict", body: "Pending source", draftId: "native-conflict", draftRevision: 1 });
          const externalHTML = await knowledgeBase.api.nativeNoteHTML("Edited in Zotero", beforeExternal.body + "\\n\\nExternal note edit");
          nativeNote.setNote(externalHTML); await nativeNote.saveTx();
          try {
            await knowledgeBase.api.saveEditorCard({ id: rows[0].id, noteID: nativeNote.id, title: "Conflict", body: "Pending source", sourceMode: true, expectedNoteHTML: acquired.html, expectedUpdatedAt: beforeExternal.updated_at, draftId: "native-conflict", draftRevision: 1 });
            throw new Error("Concurrent native edit was overwritten");
          } catch (error) { if (!String(error).includes("CARD_CONFLICT")) throw error; }
          if (!(await knowledgeBase.api.getEditorDraft("native-conflict")) || !nativeNote.getNote().includes("External note edit") || nativeNote.getNote().includes("Pending source")) throw new Error("Conflict failed to preserve both note and draft");
          await knowledgeBase.api.discardEditorDraft("native-conflict");
          await knowledgeBase.api.releaseNativeNote(nativeNote.id);
          for (let n = 0; n < 80 && (await knowledgeBase.api.getZettel(rows[0].id)).title !== "Edited in Zotero"; n++) await new Promise(resolve => setTimeout(resolve, 50));
          const externalCard = await knowledgeBase.api.getZettel(rows[0].id);
          if (externalCard.title !== "Edited in Zotero" || externalCard.item_key !== item.key || (await knowledgeBase.api.getFamily(rows[0].id)).children.length !== 1) throw new Error("Native editing did not preserve card sources and hierarchy");
          const caseSource = new Zotero.Item("book");
          caseSource.libraryID = item.libraryID;
          caseSource.setField("title", "Corner case source");
          await caseSource.saveTx({skipSelect: true});
          const caseNative = await knowledgeBase.api.duplicateNativeNote(nativeNote.id, "Corner case", externalCard.body, nativeNote.getNote());
          const caseNote = await Zotero.Items.getAsync(caseNative.noteID);
          caseNote.parentItemID = caseSource.id; await caseNote.saveTx({skipSelect: true});
          const caseID = await seedMappedNote({noteID: caseNote.id, sourceNote:true, itemKey: caseSource.key, libraryID: caseSource.libraryID});
          const caseCached = await knowledgeBase.api.getZettel(caseID);
          caseSource.deleted = true; await caseSource.saveTx();
          await knowledgeBase.api.auditNativeNotes();
          if ((await knowledgeBase.api.searchZettelSummaries('', {availability:'active',cardIDs:[caseID]})).items.length || (await knowledgeBase.api.searchZettelSummaries('', {availability:'trash',cardIDs:[caseID]})).items[0]?.id !== caseID || (await knowledgeBase.api.getGraph()).nodes.some(node=>node.id===caseID)) throw new Error('Deleted note leaked into the active list or graph, or lost its deleted entry');
          const sourceHealth = await knowledgeBase.api.getNoteHealth(caseID);
          if (sourceHealth.source !== "trashed" || sourceHealth.note !== "trashed" || (await knowledgeBase.api.getZettel(caseID)).item_key !== caseSource.key || caseNote.parentItemID !== caseSource.id) throw new Error("Trashed source detached its note or lost its association");
          let unavailableRejected = false;
          try { await knowledgeBase.api.acquireNativeNote({id: caseID, title: "", body: ""}); } catch(error) { unavailableRejected = String(error).includes("NOTE_UNAVAILABLE"); }
          if (!unavailableRejected) throw new Error("Opening a trashed note created a replacement");
          await knowledgeBase.api.restoreNote(caseID);
          if ((await knowledgeBase.api.searchZettelSummaries('', {availability:'active',cardIDs:[caseID]})).items[0]?.id !== caseID) throw new Error('Restoring the original did not refresh its availability');
          if (caseNote.deleted || caseSource.deleted || (await knowledgeBase.api.getNoteHealth(caseID)).note !== "available" || caseNote.parentItemID !== caseSource.id) throw new Error("Restore did not retain the note identity and parent");
          knowledgeBase.api.openEditor({window:true,zettelId: caseID});
          let trashedEditor;
          for (let n = 0; n < 100; n++) {
            trashedEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === caseID);
            if (trashedEditor?.document.getElementById("knowledge-base-rich-frame")?.getCurrentInstance()) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          caseNote.deleted = true; await caseNote.saveTx();
          for (let n = 0; n < 100 && (!trashedEditor.document.getElementById("knowledge-base-editor-apply-draft").hidden || trashedEditor.document.getElementById("knowledge-base-editor-preview").hidden); n++) await new Promise(resolve => setTimeout(resolve, 50));
          if (!trashedEditor.document.getElementById("knowledge-base-editor-apply-draft").hidden || trashedEditor.document.getElementById("knowledge-base-editor-preview").hidden) throw new Error("Deleting an open note left its editor writable");
          if (!trashedEditor.document.getElementById("knowledge-base-editor-restore").hidden) throw new Error("A trashed note still offers restoration inside Knowledge Base");
          if ((await knowledgeBase.api.getNoteHealth(caseID)).note !== "trashed" || (await knowledgeBase.api.getZettel(caseID)).body !== caseCached.body) throw new Error("Deleting a native note lost its cached content");
          knowledgeBase.api.openManager({selectId:caseID});
          const trashMain = Zotero.getMainWindow();
          let trashWorkbench;
          for (let n=0; n<150; n++) {
            trashWorkbench = trashMain.document.querySelector('.knowledge-base-workbench')?.contentWindow;
            const cached = trashWorkbench?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
            if (cached?.knowledgeBaseCardId === caseID && !cached.document.getElementById('knowledge-base-editor-preview')?.hidden) break;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          const trashNavigation = trashWorkbench.document.getElementById('knowledge-base-workbench-editor');
          if (!(await knowledgeBase.api.mountEditor(trashNavigation,{zettelId:rows[0].id})) || !(await knowledgeBase.api.mountEditor(trashNavigation,{zettelId:caseID}))) throw new Error('A note in Trash blocked workbench navigation');
          if (trashWorkbench.document.getElementById('knowledge-base-tag')) throw new Error('Knowledge Base still exposes tag filtering');
          for (let n=0; n<100 && trashWorkbench.document.querySelector('.zettel-row[data-id="'+caseID+'"]'); n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (trashWorkbench.document.querySelector('.zettel-row[data-id="'+caseID+'"]')) throw new Error('A trashed note remains visible in Knowledge Base');
          const beforeExternalRestore = caseNote.getNote();
          // Restore through Zotero only: no Knowledge Base restore or explicit audit call.
          caseNote.deleted = false; await caseNote.saveTx();
          for (let n=0; n<150; n++) {
            if (!trashedEditor.document.getElementById('knowledge-base-rich-frame').hidden && !trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').hidden && trashedEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id === caseNote.id && trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id === caseNote.id && (await knowledgeBase.api.searchZettelSummaries('',{availability:'active',cardIDs:[caseID]})).items.length) break;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          if (trashedEditor.document.getElementById('knowledge-base-rich-frame').hidden || trashedEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id !== caseNote.id || trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').hidden || trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id !== caseNote.id || !(await knowledgeBase.api.searchZettelSummaries('',{availability:'active',cardIDs:[caseID]})).items.length || caseNote.getNote() !== beforeExternalRestore) throw new Error('Native Trash restore did not reconnect open editors to the unchanged original: ' + JSON.stringify({separateID:trashedEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id,separateHidden:trashedEditor.document.getElementById('knowledge-base-rich-frame').hidden,inlineID:trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id,inlineHidden:trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').hidden,expectedID:caseNote.id,active:(await knowledgeBase.api.searchZettelSummaries('',{availability:'active',cardIDs:[caseID]})).items.length,htmlChanged:caseNote.getNote()!==beforeExternalRestore,status:trashedEditor.document.getElementById('knowledge-base-editor-status').textContent,dirty:trashedEditor.eval('dirty'),recovery:trashedEditor.eval('recoveryPending'),unavailable:trashedEditor.eval('noteUnavailable')}));
          const retained = await knowledgeBase.api.acquireNativeNote({id:caseID,title:caseCached.title,body:caseCached.body});
          if (retained.noteID !== caseNote.id || (await knowledgeBase.api.getZettel(caseID)).item_key !== caseSource.key) throw new Error('Native restore changed card identity, note identity or source');
          await knowledgeBase.api.releaseNativeNote(caseNote.id);
          // Reopening an existing workbench also reconciles changes without notifier events.
          caseNote.deleted = true; await caseNote.saveTx({skipNotifier:true});
          knowledgeBase.api.openManager({selectId:caseID});
          for (let n=0; n<100 && !(await knowledgeBase.api.searchZettelSummaries('',{availability:'trash',cardIDs:[caseID]})).items.length; n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (!(await knowledgeBase.api.searchZettelSummaries('',{availability:'trash',cardIDs:[caseID]})).items.length) throw new Error('Reusing the workbench skipped the Trash audit');
          await Zotero.Items.erase(caseNote.id);
          for (let n=0; n<150 && ((await knowledgeBase.api.getZettel(caseID)) || !trashedEditor.document.getElementById('knowledge-base-editor-restore').hidden); n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (await knowledgeBase.api.getZettel(caseID) || (await knowledgeBase.api.searchZettelSummaries('',{availability:'trash',cardIDs:[caseID]})).items.length) throw new Error('Permanent Zotero deletion left a cached recovery card');
          if (!trashedEditor.document.getElementById('knowledge-base-editor-save-copy').hidden || !trashedEditor.document.getElementById('knowledge-base-editor-restore').hidden) throw new Error('An erased original still offers cached-copy recovery');
          if (!(await knowledgeBase.api.mountEditor(trashNavigation,{zettelId:rows[0].id}))) throw new Error('Permanent deletion blocked navigation to a surviving note');
          trashedEditor.close();
          trashMain.Zotero_Tabs.close(trashMain.Zotero_Tabs.selectedID);
          await Zotero.Items.erase(caseSource.id);
          closeBody = externalCard.body;
          const copy = await knowledgeBase.api.duplicateNativeNote(nativeNote.id, "Copied note", closeBody);
          const copyNote = await Zotero.Items.getAsync(copy.noteID);
          const copyImage = Zotero.Items.get(copyNote.getAttachments()[0]);
          if (!copyImage || copyImage.key === migratedImage.key || !(await copyImage.fileExists())) throw new Error("Copy did not create independent native image attachments");
          const copiedCard = await knowledgeBase.api.saveEditorCard({ noteID: copyNote.id, title: "Copied note", body: closeBody, sourceMode: false });
          await knowledgeBase.api.releaseNativeNote(copyNote.id);
          knowledgeBase.api.setWorkbenchMode('tab');
          knowledgeBase.api.openManager({selectId:copiedCard.id});
          let deleteWorkbench, deleteEditor;
          for(let n=0;n<150;n++) {
            deleteWorkbench = Zotero.getMainWindow().document.querySelector('.knowledge-base-workbench')?.contentWindow;
            deleteEditor = deleteWorkbench?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
            if(deleteEditor?.knowledgeBaseCardId===copiedCard.id && deleteEditor.document.getElementById('knowledge-base-rich-frame')?.getCurrentInstance()) break;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          if(deleteEditor?.knowledgeBaseCardId!==copiedCard.id) throw new Error('Delete shortcut fixture did not load');
          await deleteEditor.knowledgeBaseReady();
          if(!(await deleteEditor.save(false))) throw new Error('Delete shortcut fixture did not settle');
          await deleteEditor.setEditorMode('source');
          const pendingBody = deleteEditor.document.getElementById('knowledge-base-editor-body');
          pendingBody.value += "\\n\\nLast edit before moving to Trash.";
          pendingBody.dispatchEvent(new deleteEditor.Event('input', {bubbles:true}));
          const confirmDelete = deleteWorkbench.confirm;
          deleteWorkbench.confirm = () => true;
          try {
            const noteList = deleteWorkbench.document.getElementById('knowledge-base-list');
            noteList.focus();
            noteList.dispatchEvent(new deleteWorkbench.KeyboardEvent('keydown', {key:'Backspace',metaKey:Zotero.isMac,ctrlKey:!Zotero.isMac,bubbles:true,cancelable:true}));
            for(let n=0;n<200;n++) {
              const selected = deleteWorkbench.document.querySelector('.zettel-row.active');
              if(copyNote.deleted && selected && selected.dataset.id!==copiedCard.id && !deleteWorkbench.document.querySelector('.zettel-row[data-id="'+copiedCard.id+'"]')) break;
              await new Promise(resolve=>setTimeout(resolve,25));
            }
          } finally { deleteWorkbench.confirm = confirmDelete; }
          const deleteState = {saved:copyNote.getNote().includes('Last edit before moving to Trash.'),trashed:copyNote.deleted,selected:deleteWorkbench.document.querySelector('.zettel-row.active')?.dataset.id,visible:!!deleteWorkbench.document.querySelector('.zettel-row[data-id="'+copiedCard.id+'"]'),error:deleteWorkbench.document.getElementById('knowledge-base-error').textContent};
          if(!deleteState.saved || !deleteState.trashed || !deleteState.selected || deleteState.selected===copiedCard.id || deleteState.visible) throw new Error('Command-Delete did not finish: '+JSON.stringify(deleteState));
          Zotero.getMainWindow().Zotero_Tabs.close(Zotero.getMainWindow().Zotero_Tabs.selectedID);

          if (!copyNote.deleted || nativeNote.deleted || !(await migratedImage.fileExists())) throw new Error("Card deletion did not trash only its own note");
          if (!(await knowledgeBase.api.getZettel(copiedCard.id)) || (await knowledgeBase.api.searchZettelSummaries('', {availability:'active',cardIDs:[copiedCard.id]})).items.length) throw new Error('Knowledge Base deletion lost the recoverable card or left it visible');
          copyNote.deleted = false; await copyNote.saveTx();
          for (let n=0; n<100 && !(await knowledgeBase.api.searchZettelSummaries('', {availability:'active',cardIDs:[copiedCard.id]})).items.length; n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (!(await knowledgeBase.api.searchZettelSummaries('', {availability:'active',cardIDs:[copiedCard.id]})).items.length) throw new Error('Restoring a Knowledge Base-deleted note did not reconnect the same card');
          await Zotero.Items.erase(copyNote.id);
          nativeNote.deleted = true; await nativeNote.saveTx();
          try { await knowledgeBase.api.acquireNativeNote({ id: rows[0].id, title: "", body: "" }); throw new Error("Missing note was silently replaced"); }
          catch (error) { if (!String(error).includes("NOTE_UNAVAILABLE")) throw error; }
          nativeNote.deleted = false; await nativeNote.saveTx();
          knowledgeBase.api.openEditor({window:true, zettelId: rows[0].id });
          let draftEditor;
          for (let n = 0; n < 80; n++) {
            draftEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => !win.closed);
            if (draftEditor?.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          await draftEditor.setEditorMode("source");
          for (let n = 0; n < 80 && draftEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "source"; n++) await new Promise(resolve => setTimeout(resolve, 50));
          const draftBody = draftEditor.document.getElementById("knowledge-base-editor-body");
          draftBody.value = "Keep this close draft";
          draftBody.dispatchEvent(new draftEditor.Event("input", { bubbles: true }));
          await closeShortcut(draftEditor);
          for (let n = 0; n < 80 && !draftEditor.closed; n++) await new Promise(resolve => setTimeout(resolve, 50));
          const kept = (await knowledgeBase.api.listEditorDrafts()).find(draft => draft.body === "Keep this close draft");
          if (!draftEditor.closed || !kept || (await knowledgeBase.api.getZettel(rows[0].id)).body !== closeBody || nativeDialogs[2] !== "extra1") throw new Error("Command-W did not preserve an uncommitted draft");
          await knowledgeBase.api.discardEditorDraft(kept.draftId);
        } finally { Services.ww.unregisterNotification(observer); }
        if (choices.length) throw new Error("Native close choices were not all tested");
        const saved = await knowledgeBase.api.getZettel(rows[0].id);
        Zotero.debug("Knowledge Base host stage: recovery and shutdown");
        await knowledgeBase.api.saveEditorDraft({ id: saved.id, title: saved.title, body: "Recovered draft body", itemKey: saved.item_key, libraryID: saved.library_id, expectedUpdatedAt: saved.updated_at, draftId: "host-recovery", draftRevision: 1 });
        knowledgeBase.api.openEditor({window:true, draftId: "host-recovery" });
        let recovered;
        for (let n = 0; n < 80; n++) {
          recovered = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseDraftId === "host-recovery");
          if (recovered?.document.getElementById("knowledge-base-editor-body")?.value === "Recovered draft body" && recovered.eval("loaded")) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (recovered?.document.getElementById("knowledge-base-editor-body")?.value !== "Recovered draft body" || !recovered.eval("loaded")) throw new Error("Draft recovery failed");
        recovered.document.getElementById("knowledge-base-editor-apply-draft").dispatchEvent(new recovered.Event("command", { bubbles: true }));
        for (let n = 0; n < 80 && (await knowledgeBase.api.getZettel(saved.id)).body !== "Recovered draft body"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if ((await knowledgeBase.api.getZettel(saved.id)).body !== "Recovered draft body") throw new Error("Recovered draft did not save");
        await recovered.setEditorMode("source");
        for (let n = 0; n < 80 && recovered.document.getElementById("knowledge-base-editor-body").hidden; n++) await new Promise(resolve => setTimeout(resolve, 100));
        const pendingBody = recovered.document.getElementById("knowledge-base-editor-body");
        // Simulate previously unfiled linked notes so startup must organize them.
        nativeNote.parentItemID = false; await nativeNote.saveTx();
        looseNote.parentItemID = false; await looseNote.saveTx();
        thinking.deleted = false; await thinking.saveTx();
        note.deleted = false; await note.saveTx();
        await knowledgeBase.api.auditNativeNotes();
        const persistedThinkingID = await seedMappedNote({noteID: thinking.id, initialTags:["Thinking Note"]});
        const persistedLiteratureID = await seedMappedNote({noteID: note.id, sourceNote:true, itemKey: item.key, libraryID: item.libraryID});
        const restartTrashNote = new Zotero.Item('note');
        restartTrashNote.libraryID = nativeNote.libraryID;
        const restartTrashHTML = '<div data-schema-version="9"><h1>Trash across restart</h1><p>Original native content <span class="math">$x^2$</span> <a href="knowledge-base://card/' + rows[0].id + '">Linked card</a></p></div>';
        restartTrashNote.setNote(restartTrashHTML); await restartTrashNote.saveTx({skipSelect:true});
        const restartTrashID = await seedMappedNote({noteID:restartTrashNote.id,initialTags:["Zettel"]});
        await knowledgeBase.api.deleteZettel(restartTrashID);
        if (!restartTrashNote.deleted) throw new Error("Knowledge Base deletion did not trash a previously linked Zotero note");
        await knowledgeBase.api.auditNativeNotes();
        if (!(await knowledgeBase.api.getZettel(restartTrashID)) || (await knowledgeBase.api.searchZettelSummaries('',{availability:'active',cardIDs:[restartTrashID]})).items.length) throw new Error('Trash fixture lost its mapped card before restart');
        if (thinking.getNote() !== originalThinking || thinking.parentItemID !== item.id) throw new Error("Opening changed the original project before restart");
        const mainDoc = Zotero.getMainWindow().document;
        await Zotero.getActiveZoteroPane().selectItem(item.id);
        await new Promise(resolve => setTimeout(resolve, 500));
        const sidebar = mainDoc.getElementById("zotero-item-pane");
        const nativeView = mainDoc.getElementById("zotero-view-item");
        const cardSection = [...mainDoc.querySelectorAll("item-pane-custom-section")].find(el => el.dataset.pane?.includes("knowledge-base"));
        if (!cardSection) throw new Error("Native card sidebar section is missing");
        cardSection.querySelector("collapsible-section").open = true;
        const sectionBody = cardSection.querySelector('[data-type="body"]');
        {
        for(let n=0;n<100 && !sectionBody.querySelector('.knowledge-base-source-note');n++)await new Promise(resolve=>setTimeout(resolve,25));
        const sourceRow=sectionBody.querySelector('.knowledge-base-source-note');
        const itemNotes=await knowledgeBase.api.listByItem(item.key);
        const ideaNotes=itemNotes.filter(note=>!note.source_note);
        if(!sourceRow || sectionBody.querySelectorAll('.knowledge-base-source-note').length!==1 || sectionBody.querySelectorAll('li').length!==ideaNotes.length || sectionBody.querySelector('.knowledge-base-section-footer') || sectionBody.querySelector('.knowledge-base-mini-btn'))throw new Error('Sidebar does not separate the unique source note from its Zettels');
        const sidebarShots=${JSON.stringify(process.env.KNOWLEDGE_BASE_HOST_SCREENSHOTS || "")};
        for(const width of [280,400]) {
          sidebar.setAttribute('width',String(width));await new Promise(resolve=>setTimeout(resolve,150));
          const sourceStyle=mainDoc.defaultView.getComputedStyle(sourceRow);
          if(sourceStyle.backgroundColor!=='rgba(0, 0, 0, 0)' || sourceStyle.borderTopWidth!=='0px' || sourceStyle.boxShadow!=='none')throw new Error('Source note still has a boxed button style');
          if(sectionBody.querySelector('.knowledge-base-add-note').textContent!=='+' || sectionBody.querySelector('.knowledge-base-add-note').getBoundingClientRect().width<20)throw new Error('Sidebar add action is not visible');
          for(const button of sectionBody.querySelectorAll('button'))if(!button.getAttribute('aria-label') && !button.textContent.trim())throw new Error('Sidebar button lacks a name');
          if(sidebarShots) {
            await IOUtils.makeDirectory(sidebarShots,{ignoreExisting:true});
            cardSection.scrollIntoView({block:'center'});await new Promise(resolve=>setTimeout(resolve,100));
            const image=await mainDoc.defaultView.browsingContext.currentWindowGlobal.drawSnapshot(cardSection.getBoundingClientRect(),1,'white');
            const canvas=mainDoc.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
            const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(sidebarShots,'item-sidebar-'+width+'.png'),new Uint8Array(await blob.arrayBuffer()));
          }
        }
        }
        sectionBody.innerHTML = '<ul class="knowledge-base-section-list"><li>' + "A long card title with many words ".repeat(60) + '</li></ul>';
        for (const width of [280, 400]) {
          sidebar.setAttribute("width", String(width));
          await new Promise(resolve => setTimeout(resolve, 100));
          const bounds = nativeView.getBoundingClientRect();
          if (bounds.width > sidebar.getBoundingClientRect().width || nativeView.scrollWidth > nativeView.clientWidth + 1)
            throw new Error("Long card titles stretch Zotero's native info and abstract pane");
        }
        knowledgeBase.api.openWorkbenchWindow({selectId:rows[0].id});
        knowledgeBase.api.setWorkbenchMode("window");
        knowledgeBase.api.setGraphOption("hideIsolated",true);
        await waitSeparate(rows[0].id);
        await separateEditor.setEditorMode("source");
        const quittingWorkbenchBody = separateEditor.document.getElementById("knowledge-base-editor-body");
        quittingWorkbenchBody.value += "\\n\\nIndependent pending quit edit.";
        quittingWorkbenchBody.dispatchEvent(new separateEditor.Event("input",{bubbles:true}));
        const quittingWorkbenchDraftID = separateEditor.knowledgeBaseDraftId;
        pendingBody.value = "Last keystroke before quitting";
        pendingBody.dispatchEvent(new recovered.Event("input", { bubbles: true }));
        await recovered.knowledgeBaseFlushDraft();
        // Model a process interruption between the native commit and the Knowledge Base commit.
        // All writes below belong to this disposable profile.
        const journalCard = await knowledgeBase.api.getZettel(unsourced.id);
        const intendedHTML = await knowledgeBase.api.nativeNoteHTML(journalCard.title, "Interrupted host save");
        const journalInput = { id: journalCard.id, title: journalCard.title, body: "Interrupted host save", sourceNote: !!journalCard.source_note, customKey: journalCard.custom_key, itemKey: journalCard.item_key, libraryID: journalCard.library_id, parentId: (await knowledgeBase.api.getFamily(journalCard.id)).parent?.id || null, noteID: looseNote.id, expectedNoteHTML: looseNote.getNote(), expectedUpdatedAt: journalCard.updated_at, sourceMode: true, sourceDocument: knowledgeBase.api.getMarkdownDocument(intendedHTML), draftId: "host-interrupted-save", draftRevision: 1 };
        const journalOperation = { id: looseNote.libraryID + ":" + looseNote.key, noteKey: looseNote.key, libraryID: looseNote.libraryID, expectedHTML: looseNote.getNote(), intendedHTML, expectedVersion: journalCard.updated_at, input: journalInput };
        const panelWidths = { manager: knowledgeBase.api.getPanelWidth("manager"), graph: knowledgeBase.api.getPanelWidth("graph") };
        const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
        const journalConnection = await Sqlite.openConnection({path: PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base.sqlite")});
        try {
          await journalConnection.executeTransaction(async () => {
            await journalConnection.execute("INSERT INTO note_save_operations(id, card_id, data, created_at) VALUES (?, ?, ?, ?)", [journalOperation.id, journalCard.id, JSON.stringify(journalOperation), Date.now()]);
            await journalConnection.execute("INSERT INTO editor_drafts(id, body, data, revision, updated_at) VALUES (?, ?, ?, 1, ?)", [journalInput.draftId, journalInput.body, JSON.stringify(journalInput), Date.now()]);
          });
          knowledgeBase.hooks.onAppShutdown();
          looseNote.setNote(intendedHTML); await looseNote.saveTx();
          const journalRows = await journalConnection.execute("SELECT body FROM zettels WHERE id = ?", [journalCard.id]);
          if (journalRows[0].getResultByName("body") === "Interrupted host save") throw new Error("Interrupted-save fixture committed metadata prematurely");
        } finally { await journalConnection.close(); }
        await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ cards: 5, editorSnapshotTiming, graphFrames, newNoteOpenMs, quittingWorkbenchDraftID, restartTrashID, restartTrashKey: restartTrashNote.key, restartTrashHTML, keyedThinkingID: unsourced.id, panelWidths, nativeMarkdownKey: nativeMarkdownNote.key, unmanagedKey: unmanaged.key, thinkingID: persistedThinkingID, literatureID: persistedLiteratureID, thinkingKey: thinking.key, thinkingHTML: originalThinking, cardID: rows[0].id, noteKey: nativeNote.key, looseNoteKey: looseNote.key, personalParentKey: personalParent.key, markdownSaveMs, legacyImage: imageURL.slice("knowledge-base-asset:".length), iconsVisible, identitiesVisible, mathVisible, sourcesHidden, graphControlsVisible, nativeStyleScoped, compactConnections, nativeDialogs, systemDark, quitting: Date.now() }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        } catch (error) {
          await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error), stack: error.stack }));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
        }
      }, 1500);
    } catch (error) {
      await IOUtils.writeUTF8(restarting ? ${JSON.stringify(restartMarker)} : ${JSON.stringify(marker)}, JSON.stringify({ error: String(error), stack: error.stack }));
      Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
    }
  }
  setTimeout(run, 250);
}
`,
);
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]) +
    `
const hostTestStartup = startup;
startup = async function (...args) {
  try { await hostTestStartup(...args); }
  catch (error) {
    await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({error:String(error),stack:error.stack}));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  }
};
`,
);
new Script(strFromU8(files["bootstrap.js"]), {
  filename: "host-test-bootstrap.js",
});
await writeFile(
  join(profile, "extensions/knowledge-base@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  binary,
  ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
  {
    stdio: ["ignore", log.fd, log.fd],
    env: {
      ...process.env,
      TMPDIR: hostTemp,
      DEEPSEEK_API_KEY: "",
      OPENCODE_API_KEY: "",
    },
  },
);
const exited = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) =>
    resolve({ code, signal, time: Date.now() }),
  );
});
let timeout;
let passed = false;
try {
  const result = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new Error("Zotero host suite did not finish within 180 seconds"),
          ),
        180000,
      );
    }),
  ]);
  const state = JSON.parse(await readFile(marker, "utf8"));
  if (state.error || result.code !== 0)
    throw new Error(JSON.stringify({ state, result }));
  if (!connectionsOnly) {
    if (
      state.error ||
      result.code !== 0 ||
      state.cards !== 5 ||
      !state.iconsVisible ||
      !state.identitiesVisible ||
      !state.mathVisible ||
      !state.sourcesHidden ||
      !state.graphControlsVisible ||
      !state.nativeStyleScoped ||
      !state.compactConnections ||
      state.nativeDialogs?.join(",") !== "cancel,accept,extra1"
    )
      throw new Error(JSON.stringify({ state, result }));
    const db = new DatabaseSync(join(data, "knowledge-base.sqlite"), {
      readOnly: true,
    });
    try {
      if (
        db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        db.prepare("SELECT count(*) AS n FROM zettels").get().n !== 5
      )
        throw new Error("Saved database failed verification");
      const migration = db
        .prepare("SELECT original_body FROM card_notes WHERE card_id = ?")
        .get(state.cardID);
      if (!migration?.original_body.includes("![Migration image]"))
        throw new Error("Original Markdown migration backup was not preserved");
      if (
        !db
          .prepare("SELECT body FROM editor_drafts WHERE body = ?")
          .get("Last keystroke before quitting")
      )
        throw new Error("The last pending edit was not preserved on quit");
      if (
        db.prepare("SELECT COUNT(*) AS n FROM note_save_operations").get().n !==
        1
      )
        throw new Error("Interrupted-save journal did not survive shutdown");
    } finally {
      db.close();
    }
  }
  clearTimeout(timeout);
  const restarted = spawn(
    binary,
    ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
    {
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...process.env,
        TMPDIR: hostTemp,
        DEEPSEEK_API_KEY: "",
        OPENCODE_API_KEY: "",
      },
    },
  );
  let restartTimeout;
  try {
    const secondExit = new Promise((resolve, reject) => {
      restarted.once("error", reject);
      restarted.once("exit", (code) => resolve(code));
    });
    const code = await Promise.race([
      secondExit,
      new Promise((_, reject) => {
        restartTimeout = setTimeout(
          () =>
            reject(new Error("Zotero restart did not exit within 30 seconds")),
          30000,
        );
      }),
    ]);
    const restored = JSON.parse(await readFile(restartMarker, "utf8"));
    if (
      restored.error ||
      code !== 0 ||
      (connectionsOnly
        ? !restored.connectionsOnly
        : restored.cards !== 5 ||
          restored.hiddenCards !== 4 ||
          restored.noteKey !== state.noteKey)
    )
      throw new Error("Restart validation failed: " + JSON.stringify(restored));
  } finally {
    clearTimeout(restartTimeout);
    if (restarted.exitCode === null) restarted.kill("SIGKILL");
  }
  if (settingsOnly)
    console.log(
      "PASS Real Zotero minimal Settings, per-type templates, shared tag placeholder, vector progress, note counts and restart.",
    );
  else if (retiredOnly)
    console.log(
      "PASS Real Zotero retired AI and lexical suggestions remain unavailable; manual links, source notes, hierarchy, templates, credentials and legacy settings survive native/Markdown navigation and restart.",
    );
  else if (graphViewsOnly)
    console.log(
      "PASS Real Zotero note-type graphs, fresh relationship layouts, compact controls, clean relationship titles, local scope and restart.",
    );
  else if (viewsOnly)
    console.log(
      "PASS Real Zotero four category icons and separate Trash, own tags, live edits, search, pointer targets, stable layout, Minimal/Bear widths and default All after restart.",
    );
  else if (metadataOnly)
    console.log(
      "PASS Real Zotero compact metadata: click-to-copy, editable IDs, cancel, conflicts, retained references, aligned long text, source navigation and concise Source references; native/Markdown and restart.",
    );
  else if (workbenchOnly)
    console.log(
      "PASS Real Zotero native/Markdown autosave without Save buttons; pending edits across note changes; explicit draft application; close shortcuts and save/cancel/draft dialogs, conflicts, editor-mode persistence and restart.",
    );
  else if (readingViewOnly)
    console.log(
      "PASS Real Zotero shared note editor in sidebar, tab and window; live takeover setting, compact metadata, responsive toolbars, figure capture, saved edits, cleanup failure recovery and restart.",
    );
  else if (mathOnly)
    console.log(
      "PASS Real Zotero heading math, native cards, Markdown, saves, cleanup and restart.",
    );
  else if (textToolsOnly)
    console.log(
      "PASS Real Zotero text tools: native/Markdown math rendering, selected formatting, protected code and links, idempotence, one-step undo/redo, find and replace, ordinary notes, autosave and restart.",
    );
  else if (readerToolbarOnly)
    console.log(
      "PASS Real Zotero PDF toolbar opens existing Literature Notes, falls back without creation and retains targets after restart; native icon and labels, Knowledge Base tab reuse, existing-reader update on disable/re-enable, new readers, close cleanup and restart.",
    );
  else if (contextOnly)
    console.log(
      "PASS Real Zotero native note context menus preserve the current document, target copy and tag actions correctly, support Trash restoration and confirmed permanent deletion, keyboard access and restart persistence.",
    );
  else if (trashOnly)
    console.log(
      "PASS Real Zotero Knowledge Base Trash: recoverable unopened notes, original restoration, retained IDs and links, scoped permanent deletion, confirmed emptying across search filters, cancellation, source and unrelated Trash preservation, unified icons, narrow layout and restart persistence.",
    );
  else if (noteTypesOnly)
    console.log(
      "PASS Real Zotero restores schema 12/13 classifications as independent note types, preserves existing native notes and tags, changes types with Entity as the default in native/Markdown editors without default tags, filters Entity, and retains content, sources, aliases, links and hierarchy after restart.",
    );
  else if (appearanceOnly)
    console.log(
      "PASS Real Zotero Minimal/Bear live switching, native Settings typography and complete control labels at narrow and wide widths; unified notes, editable tags, full long IDs, retained style, IDs and tag removals after restart.",
    );
  else if (toolbarOnly)
    console.log(
      "PASS Real Zotero Markdown More menus remain visible and accept pointer clicks in Knowledge Base and ordinary notes at narrow and wide widths; source interaction, original frame layers and saved note content survive close, mode switches and restart.",
    );
  else if (templatesOnly)
    console.log(
      "PASS Real Zotero named user templates without presets; create, rename, switch, autosave and confirmed deletion; blank default, independent template content, native/Markdown editing, existing-note preservation and restart persistence.",
    );
  else if (relationsOnly)
    console.log(
      "PASS Real Zotero relation layout at wide, medium and narrow widths; wrapped titles and long IDs remain within their row and retain independent click targets.",
    );
  else if (linksOnly)
    console.log(
      "PASS Real Zotero native and Markdown bracket completion, ID filtering, keyboard insertion, copied-reference paste, native undo/redo, mode round trips, saved backlinks, restart and shutdown.",
    );
  else {
    console.log(
      `PASS Native Markdown on ordinary Zotero notes, in-place autosave, conflict detection, native close dialogs and restart drafts; untagged personal parent with retained user tags and colors; Native Zotero note editor (${state.systemDark ? "dark" : "light"} host); native note autosave, Markdown math migration and citation metadata; unified notes, unique source notes, retained native-note fixtures without copying, retained ownership and placement across restart; stable card references, persisted author-year and key labels, inline wiki insertion with native undo/redo and retained cursor, title-independent reference maintenance; native Command-W save/cancel/draft choices; native/Markdown editing with real cursor insertion/replacement and autosave (${state.markdownSaveMs} ms), protected images, citations and external-edit conflicts; editable note IDs, plain timestamp initialization and refreshed Markdown references with retained aliases, retained source associations, scoped Knowledge Base typography, concise Source references and live metadata updates; a Zotero Tab workbench with native in-place editing, independent new Note IDs, navigation and session cleanup; compact connection navigation with empty categories hidden, unavailable links opening their referring notes without replacements, consistent virtual row spacing, native Tab child navigation, direct Source labels, top-toolbar note actions, proportionate image previews, native toolbar Markdown icon toggle, force graph with connection-sized hubs, hover neighborhoods, compact title labels with full tooltips and live Settings, separate global/local entries with configured hop neighborhoods, selected global highlights and paper centers, display-rate interpolation and a responsive 1200-node graph, all-match search, node dragging and Escape clearing; fractional panel drags, cancellation, bounds and persisted widths across restart, and graph-local relationship controls, a persistent native isolated-node filter with relationship-aware filtering, empty states and unchanged graph data; persistent list sorting and Command-Delete with pending edits, neighbor selection and native Trash restoration in open editors and after restart, stable note/card mappings, permanent-deletion cleanup without cached copies, automatic source/personal-parent placement, compact connections and recovery drafts; native multiword tag rendering and updates, live native-parent and card-ancestor tag inheritance without note writes, configurable tag/color groups with priority and legend, group settings retained across restart, title-first relationship labels, hashtags retained as ordinary text; native sidebar text containment; real Zotero quit (${result.time - state.quitting} ms); saved database and linked notes survive restart.`,
    );
    console.log(
      "Graph display intervals (ms): " +
        JSON.stringify(state.graphFrames) +
        "; blank native Note opened in " +
        state.newNoteOpenMs +
        " ms",
    );
    console.log(
      "Native editor snapshot timing (ms): " +
        JSON.stringify(state.editorSnapshotTiming),
    );
  }
  if (state.readingMetrics) {
    console.log(JSON.stringify(state.readingMetrics, null, 2));
    const report = process.env.KNOWLEDGE_BASE_READING_BENCHMARK_OUTPUT;
    if (report) {
      await mkdir(dirname(resolve(report)), { recursive: true });
      await writeFile(
        resolve(report),
        JSON.stringify(state.readingMetrics, null, 2) + "\n",
      );
    }
  }
  passed = true;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited.catch(() => {});
    clearTimeout(killTimer);
  }
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error(`Test profile and logs retained at ${root}`);
}
