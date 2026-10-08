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
import { join, resolve } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const binary =
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero";
await access(binary);
const xpi = resolve(process.argv[2] || "dist/zotero-knowledge-base.xpi");
const files = unzipSync(await readFile(xpi));
const root = await mkdtemp(join(tmpdir(), "knowledge-base-quit-"));
const profile = join(root, "profile");
const data = join(root, "data");
const marker = join(root, "result.json");
const restartMarker = join(root, "restart.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
const prefs = {
  "intl.locale.requested": process.env.KB_HOST_LOCALE || "en-US",
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
if (process.env.KB_HOST_COLOR_SCHEME) {
  prefs["ui.systemUsesDarkTheme"] =
    process.env.KB_HOST_COLOR_SCHEME === "dark" ? 1 : 0;
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
  bootstrap.replace(trigger, trigger + "\n  runQuitTest();") +
    `
function runQuitTest() {
  const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  async function run() {
    try {
      const kb = Zotero.ZoteroKnowledgeBase;
      // Fixture for previously linked notes; never included in production code.
      async function seedMappedNote(input) {
        const native = await Zotero.Items.getAsync(input.noteID);
        const id = "fixture-" + native.libraryID + "-" + native.key;
        const projection = kb.api.projectNativeNote(native.getNote());
        await kb.api.saveZettel({id, kind: input.kind, ...projection, itemKey: input.itemKey, libraryID: input.libraryID});
        const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
        const connection = await Sqlite.openConnection({path: PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base.sqlite")});
        try {
          await connection.execute("INSERT OR IGNORE INTO card_notes (card_id, note_key, library_id, original_body, external) VALUES (?, ?, ?, ?, 1)", [id, native.key, native.libraryID, projection.body]);
        } finally { await connection.close(); }
        return id;
      }
      if ("registerExistingNote" in kb.api) throw new Error("One-off library adoption API leaked into the plugin");
      if (!Zotero.getMainWindow()?.document.getElementById("knowledge-base-menu-open-manager")) {
        setTimeout(run, 250);
        return;
      }
      if (await IOUtils.exists(${JSON.stringify(marker)})) {
        const first = JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
        if(kb.api.getWorkbenchMode()!=="window") throw new Error('Restart lost the workbench opening preference');
        if(kb.api.getGraphLabelLength()!==18) throw new Error("Restart lost the graph title length");
        if(!kb.api.getGraphOptions().hideIsolated) throw new Error('Restart lost the isolated-node filter preference');
        if(!kb.api.getTagInheritance() || JSON.stringify(kb.api.getGraphGroups())!==JSON.stringify([{tag:"#Ideas",color:"#aa22cc"}])) throw new Error('Restart lost tag inheritance or graph group settings');
        kb.api.setWorkbenchMode("tab");
        const cards = await kb.api.listZettels();
        const card = cards.find(row => row.id === first.cardID);
        if (cards.length !== 5 || card?.body !== "Recovered draft body" || (await kb.api.getFamily(card.id)).children.length !== 1) throw new Error("Restart lost saved card content or hierarchy");
        const restartTrashNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.restartTrashKey);
        if (!restartTrashNote?.isInTrash() || !(await kb.api.getZettel(first.restartTrashID)) || !(await kb.api.searchZettelSummaries('',{availability:'deleted',cardIDs:[first.restartTrashID]})).items.length) throw new Error('Restart lost the mapping for a note still in Zotero Trash');
        restartTrashNote.deleted = false; await restartTrashNote.saveTx();
        for (let n=0; n<100 && !(await kb.api.searchZettelSummaries('',{availability:'active',cardIDs:[first.restartTrashID]})).items.length; n++) await new Promise(resolve=>setTimeout(resolve,25));
        const rebound = await kb.api.acquireNativeNote({id:first.restartTrashID,title:'Trash across restart',body:''});
        if (rebound.noteID !== restartTrashNote.id || restartTrashNote.key !== first.restartTrashKey || restartTrashNote.getNote() !== first.restartTrashHTML || !(await kb.api.searchZettelSummaries('',{availability:'active',cardIDs:[first.restartTrashID]})).items.length || !(await kb.api.getOutgoing(first.restartTrashID)).some(link=>link.targetId===first.cardID)) throw new Error('Native restore after restart lost identity, content or card links');
        await kb.api.releaseNativeNote(rebound.noteID);
        const keyedThinking = await kb.api.getZettel(first.keyedThinkingID);
        if (keyedThinking?.kind !== "thinking" || keyedThinking.custom_key !== "HostProjectRevised" || keyedThinking.reference !== "HostProjectRevised" || (await kb.api.resolveCardLink("knowledge-base://card/HostProject")).targetId !== first.keyedThinkingID) throw new Error("Restart lost Thinking keys or old links");
        if (keyedThinking.body !== "Interrupted host save" || (await kb.api.listEditorDrafts()).some(draft => draft.draftId === "host-interrupted-save")) throw new Error("Restart did not reconcile the interrupted cross-database save");
        const organizedNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.noteKey);
        const organizedLoose = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.looseNoteKey);
        const organizedParent = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.personalParentKey);
        await Zotero.Items.loadDataTypes([organizedLoose], ["collections"]);
        if (!organizedNote.parentItemID || organizedLoose.parentItemID !== organizedParent.id || organizedLoose.getCollections().length) throw new Error("Startup did not organize existing linked notes");
        if (organizedParent.hasTag("Personal Knowledge") || !organizedParent.hasTag("User marker") || Zotero.Tags.getColors(organizedParent.libraryID).get("Personal Knowledge")?.color !== "#805ad5") throw new Error("Restart added an automatic tag or changed user tags/colors");
        const unmanaged = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.unmanagedKey);
        if (!unmanaged || unmanaged.getNote() !== "<p>Unmanaged library note</p>" || unmanaged.parentItemID !== organizedNote.parentItemID || cards.some(row => row.title === "Unmanaged library note")) throw new Error("Startup imported or moved an unmanaged library note");
        const projectCard = await kb.api.getZettel(first.thinkingID);
        const readingCard = await kb.api.getZettel(first.literatureID);
        const projectNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.thinkingKey);
        if (projectCard?.kind !== "thinking" || projectCard.item_key || readingCard?.kind !== "literature" || projectNote.parentItemID !== organizedNote.parentItemID || projectNote.getNote() !== first.thinkingHTML) throw new Error("Restart changed an linked note's type, content or placement");
        const linked = await kb.api.acquireNativeNote({ id: card.id, title: card.title, body: card.body });
        const restoredNote = await Zotero.Items.getAsync(linked.noteID);
        if (!restoredNote.parentItemID || restoredNote.key !== first.noteKey || !restoredNote.getNote().includes("Recovered draft body")) throw new Error("Restart duplicated or lost the linked note");
        await kb.api.releaseNativeNote(linked.noteID);
        if (!(await kb.api.listEditorDrafts()).some(draft => draft.body === "Last keystroke before quitting")) throw new Error("Restart lost the recovery draft");
        if (!(await kb.api.getEditorDraft(first.quittingWorkbenchDraftID))?.body.includes("Independent pending quit edit.")) throw new Error("Restart lost the independent workbench's final unsaved edit");
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
        kb.api.openManager({ window:true, selectId: card.id });
        kb.api.openGraph({ centerId: card.id });
        for (const [name, paneID] of [["manager", "knowledge-base-list-pane"], ["graph", "graph-inspector"]]) {
          let pane;
          for (let n = 0; n < 100 && !pane?.style.flexBasis; n++) {
            const win = [...Services.wm.getEnumerator("knowledge-base:" + name)][0];
            pane = win?.document.getElementById(paneID);
            if (!pane?.style.flexBasis) await new Promise(resolve => setTimeout(resolve, 25));
          }
          if (kb.api.getPanelWidth(name) !== first.panelWidths[name] || pane?.style.flexBasis !== first.panelWidths[name] + "%") throw new Error("Restart did not restore the " + name + " panel width");
        }
        const restartedGraph = [...Services.wm.getEnumerator("knowledge-base:graph")][0];
        if(!restartedGraph.document.getElementById("graph-hide-isolated").checked) throw new Error('Restart did not restore the native isolated-node checkbox');
        kb.api.setGraphOption("hideIsolated", false);
        await IOUtils.writeUTF8(${JSON.stringify(restartMarker)}, JSON.stringify({ cards: cards.length, noteKey: restoredNote.key }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        return;
      }
      if ((await kb.api.listZettels()).length) throw new Error("Fresh install contains preloaded user cards");
      const mainWindow=Zotero.getMainWindow();
      const entryButton=mainWindow.document.getElementById("knowledge-base-toolbar-button");
      if(entryButton?.parentElement.id!=="zotero-items-toolbar" || entryButton.getBoundingClientRect().width<20 || !mainWindow.getComputedStyle(entryButton).listStyleImage.includes("icon-20.svg") || mainWindow.document.getElementById("knowledge-base-menu-open-workbench-window")) throw new Error('Knowledge Base did not have one menu entry and its native library toolbar icon');
      async function openMarkdownToolbar(frameWindow) {
        let entry;
        for (let n = 0; n < 80 && !entry; n++) {
          entry = frameWindow.document.querySelector(".knowledge-base-markdown-toggle");
          if (!entry) await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (!entry || entry.getAttribute("aria-label") !== kb.api.loc("editor-format-markdown")) throw new Error("Markdown switch is missing from the native toolbar");
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
      if (!(await kb.api.searchItems("Linked Zotero note")).some(match => match.key === note.key)) throw new Error("Zotero note search failed");
      if (!(await kb.api.searchItems("Host2026")).some(match => match.key === item.key)) throw new Error("Citation key search failed");
      if ((await kb.api.searchItems("NoSuchCitation2026")).length) throw new Error("Source search returned unrelated items");
      await kb.api.openLink("zotero://select/library/items/" + note.key);
      if (Zotero.getMainWindow().ZoteroPane.getSelectedItems()[0]?.key !== note.key) throw new Error("Note hyperlink did not select its Zotero note");
      const unmanaged = new Zotero.Item("note");
      unmanaged.libraryID = item.libraryID;
      unmanaged.parentItemID = item.id;
      unmanaged.setNote("<p>Unmanaged library note</p>");
      await unmanaged.saveTx({skipSelect: true});

      // The extension also edits an ordinary native note without creating a KB card.
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
      const nativeReadingFrame = nativeMD.nativeInstance._iframeWindow;
      const nativeReadingButton = nativeReadingFrame.document.querySelector('.knowledge-base-reading-toggle');
      const nativeToolbar = nativeReadingFrame.document.querySelector('.toolbar');
      const nativeSourceState = {value:nativeMD.source.value,start:nativeMD.source.selectionStart,end:nativeMD.source.selectionEnd,scroll:nativeMD.source.scrollTop};
      const beforeReadingNote = nativeMarkdownNote.getNote();
      nativeReadingButton.click();
      for(let n=0;n<100 && nativeReadingButton.getAttribute('aria-pressed')!=='true';n++) await new Promise(resolve=>setTimeout(resolve,25));
      const nativeReadingPanel=nativeReadingFrame.document.querySelector('.knowledge-base-reading-view');
      if(nativeReadingPanel.hidden || !nativeReadingPanel.querySelector('.katex-display') || nativeReadingPanel.querySelector('[contenteditable]') || nativeReadingFrame.document.querySelector('.toolbar')!==nativeToolbar || !nativeMD.source.hidden || nativeMarkdownNote.getNote()!==beforeReadingNote) throw new Error('Native Markdown reading changed its toolbar, document or formula rendering');
      nativeReadingButton.click();
      if(nativeMD.source.hidden || JSON.stringify({value:nativeMD.source.value,start:nativeMD.source.selectionStart,end:nativeMD.source.selectionEnd,scroll:nativeMD.source.scrollTop})!==JSON.stringify(nativeSourceState)) throw new Error('Native Reading lost Markdown selection or scroll');
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
      if (!nativeMD.source.value.includes('Updated in another editor') || !nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-markdown').hidden || (await kb.api.getEditorDraft('native-document:' + nativeMarkdownNote.libraryID + ':' + nativeMarkdownNote.key))) throw new Error('Clean native Markdown did not follow a save from another editor: ' + JSON.stringify({sameInstance: otherNativeInstance === nativeMD.nativeInstance, html: nativeMarkdownNote.getNote(), source: nativeMD.source.value, bar: nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-markdown').outerHTML, draft: await kb.api.getEditorDraft('native-document:' + nativeMarkdownNote.libraryID + ':' + nativeMarkdownNote.key)}));
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
      if (!nativeMarkdownNote.getNote().includes('<strong>in place</strong>') || nativeMarkdownNote.parentItemID !== item.id || !nativeMarkdownNote.hasTag('Native Markdown test') || (nativeMarkdownNote.getNote().match(/<h1/g) || []).length !== 1 || (await kb.api.listZettels()).length) throw new Error("Native Markdown changed identity/placement or silently imported a note");
      for (let n = 0; n < 100 && nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent !== kb.api.loc('editor-saved'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      await new Promise(resolve => setTimeout(resolve,600));
      const ownSaveStatus = nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent;
      if (nativeMD.source.value !== unformattedNativeSource) throw new Error('Saving automatically formatted native Markdown source');
      const normalizedNativeHTML = nativeMarkdownNote.getNote().replace(/data-schema-version="[^"]+"/, 'data-schema-version="9" data-kb-host-normalization="true"');
      nativeMarkdownNote.setNote(normalizedNativeHTML);
      await nativeMarkdownNote.saveTx();
      await new Promise(resolve => setTimeout(resolve,200));
      if (nativeMD.source.value !== unformattedNativeSource) throw new Error('Equivalent HTML normalization reformatted the author source');
      if(nativeMD.source.selectionStart !== nativeCursor || nativeMD.source.selectionEnd !== nativeCursor || Math.abs(nativeMD.source.scrollTop-nativeScroll)>5 || ownSaveStatus !== kb.api.loc('editor-saved') || nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent === kb.api.loc('native-markdown-conflict')) throw new Error('Own native Markdown save reset cursor/viewport or reported a conflict: ' + JSON.stringify({cursor:nativeMD.source.selectionStart,expected:nativeCursor,scroll:nativeMD.source.scrollTop,expectedScroll:nativeScroll,status:ownSaveStatus}));
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
      for (let n = 0; n < 100 && nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent !== kb.api.loc('editor-saved'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      nativeMarkdownNote.setNote(nativeMarkdownNote.getNote().replace('Remote independent paragraph', 'in place'));
      await nativeMarkdownNote.saveTx();
      nativeMD.source.value = nativeMD.source.value.replace('in place', 'Conflicting native draft');
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.Event('input'));
      nativeMarkdownNote.setNote(nativeMarkdownNote.getNote().replace('in place', 'External edit preserved'));
      await nativeMarkdownNote.saveTx();
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.KeyboardEvent('keydown', {key:'s', metaKey:true, bubbles:true, cancelable:true}));
      const nativeStatus = nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status');
      for (let n = 0; n < 100 && !nativeStatus.textContent.includes(kb.api.loc('native-markdown-conflict')); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMarkdownNote.getNote().includes('External edit preserved') || nativeMarkdownNote.getNote().includes('Conflicting native draft') || nativeStatus.textContent !== kb.api.loc('native-markdown-conflict')) throw new Error("Native Markdown overwrote an external change: " + JSON.stringify({html: nativeMarkdownNote.getNote(), status:nativeStatus.outerHTML, alive:nativeMD.source.isConnected, draft:await kb.api.getEditorDraft("native-document:" + nativeMarkdownNote.libraryID + ":" + nativeMarkdownNote.key)}));
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
      if (!nativeMD.source.value.includes('Conflicting native draft') || (await kb.api.listEditorDrafts()).some(draft => draft.nativeDocument)) throw new Error("Native Markdown draft did not restore separately from card recovery");
      // Keep this conflicting native draft open until quit, then verify recovery after restart.
      const thinking = new Zotero.Item("note");
      thinking.libraryID = item.libraryID;
      thinking.parentItemID = item.id;
      thinking.setNote('<div data-schema-version="9"><h1>Existing project</h1><p>[[]] Original thinking</p></div>');
      thinking.setTags([{tag: "#Ideas"}]);
      await thinking.saveTx({skipSelect: true});
      const originalThinking = thinking.getNote();
      const thinkingID = await seedMappedNote({noteID: thinking.id, kind: "thinking"});
      const sameThinkingID = await seedMappedNote({noteID: thinking.id, kind: "thinking"});
      if (thinkingID !== sameThinkingID || thinking.getNote() !== originalThinking || thinking.parentItemID !== item.id || thinking.getTags()[0]?.tag !== "#Ideas") throw new Error("Registering an existing note copied or changed it");
      const acquiredThinking = await kb.api.acquireNativeNote({id: thinkingID, title: "", body: ""});
      if (acquiredThinking.noteID !== thinking.id || thinking.parentItemID !== item.id) throw new Error("Existing project note identity or placement changed on open");
      await kb.api.releaseNativeNote(thinking.id);
      const literatureID = await seedMappedNote({noteID: note.id, kind: "literature", itemKey: item.key, libraryID: item.libraryID});
      let duplicateLiteratureRejected = false;
      try { await seedMappedNote({noteID: thinking.id, kind: "literature", itemKey: item.key, libraryID: item.libraryID}); } catch (error) { duplicateLiteratureRejected = String(error).includes("LITERATURE_EXISTS"); }
      if (!duplicateLiteratureRejected || (await kb.api.getZettel(thinkingID)).kind !== "thinking") throw new Error("Duplicate Literature Note was not rejected atomically");
      await kb.api.saveZettel({id: thinkingID, kind: "thinking", title: "Existing project", body: "[Reading](zotero://note/u/" + note.key + "/)"});
      if ((await kb.api.getOutgoing(thinkingID))[0]?.targetId !== literatureID) throw new Error("Native note links did not enter the graph");
      await Promise.all([kb.api.openLiteratureNote(item.key, item.libraryID), kb.api.openLiteratureNote(item.key, item.libraryID)]);
      const literatureMain = Zotero.getMainWindow();
      let literatureInline;
      for (let n = 0; n < 150; n++) {
        const manager = literatureMain.document.querySelector(".knowledge-base-workbench")?.contentWindow;
        literatureInline = manager?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
        if (literatureInline?.knowledgeBaseCardId === literatureID && literatureInline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (literatureInline?.knowledgeBaseCardId !== literatureID || literatureInline.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== note.id || literatureMain.document.querySelectorAll(".knowledge-base-workbench").length !== 1) throw new Error("Literature requests did not reuse the native note in one Tab");
      literatureMain.Zotero_Tabs.close(literatureMain.Zotero_Tabs.selectedID);
      for (let n = 0; n < 100 && literatureMain.document.querySelector(".knowledge-base-workbench"); n++) await new Promise(resolve => setTimeout(resolve, 25));
      await kb.api.openEditor({window:true, zettelId:literatureID});
      let literatureEditors = [];
      for (let n = 0; n < 100; n++) {
        literatureEditors = [...Services.wm.getEnumerator("knowledge-base:editor")];
        if (literatureEditors.length) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (literatureEditors.length !== 1 || (await kb.api.listZettels("", false, "literature")).length !== 1) throw new Error("Repeated literature requests opened duplicate notes or windows: " + literatureEditors.length + "/" + (await kb.api.listZettels("", false, "literature")).length);
      const literatureEditor = literatureEditors[0];
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (literatureEditor.document.getElementById("knowledge-base-note-kind").value !== "literature" || !literatureEditor.document.getElementById("knowledge-base-note-kind").disabled || literatureEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== note.id) throw new Error("Literature UI did not reuse the linked native note");
      const literatureReference = literatureEditor.document.getElementById("knowledge-base-editor-reference");
      if (literatureReference.textContent !== "@Host2026" || (await kb.api.getZettel(literatureID)).reference !== "@Host2026") throw new Error("Literature Note reference is missing");
      literatureReference.click();
      if (Zotero.Utilities.Internal.getClipboard("text/plain") !== "[[@Host2026]]") throw new Error("Reference copy did not write a usable wiki link: " + JSON.stringify({plain: Zotero.Utilities.Internal.getClipboard("text/plain"), unicode: Zotero.Utilities.Internal.getClipboard("text/unicode")}));
      if ((await kb.api.resolveCardLink("knowledge-base://card/%40Host2026"))?.targetId !== literatureID) throw new Error("Literature citation-key navigation failed");
      const noteLink = "[[@Host2026]]";
      const noteLinkHTML = await kb.api.nativeNoteHTML("", noteLink);
      if (!kb.api.getMarkdownSource(noteLinkHTML).body.includes(noteLink) || (await kb.api.getDraftLinks(noteLink + " [@Host2026]")).length !== 1) throw new Error("Native Markdown roundtrip confused note links with item citations");
      await kb.api.saveZettel({id: thinkingID, kind: "thinking", title: "Existing project", body: noteLink});
      if ((await kb.api.getOutgoing(thinkingID))[0]?.targetId !== literatureID || !(await kb.api.getBacklinks(literatureID)).some(link => link.sourceId === thinkingID)) throw new Error("Literature reference was not indexed into backlinks");
      await openMarkdownToolbar(literatureEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow);
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "source"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      const literatureBody = literatureEditor.document.getElementById("knowledge-base-editor-body");
      const concurrentLiterature = await Zotero.Notes.open(note.id, null, {openInWindow: true});
      concurrentLiterature._postMessage({action: 'insertHTML', html: '<p>Shared session update</p>'});
      for (let n = 0; n < 100 && (!note.getNote().includes('Shared session update') || !literatureBody.value.includes('Shared session update')); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!note.getNote().includes('Shared session update') || !literatureBody.value.includes('Shared session update') || literatureEditor.document.getElementById('knowledge-base-editor-status').textContent === kb.api.loc('editor-save-conflict')) throw new Error('Knowledge Base Markdown did not follow its shared native note session');
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
      if (!(await literatureEditor.save(false)) || note.parentItemID !== item.id || note.id !== beforeSourceReselect.id || note.key !== beforeSourceReselect.key || note.getNote() !== beforeSourceReselect.html) throw new Error("Reselecting the same source did not move the existing note intact");
      if (literatureEditor.document.getElementById("knowledge-base-metadata") || literatureEditor.document.getElementById("knowledge-base-kind") || literatureEditor.document.getElementById("knowledge-base-editor-mode")) throw new Error("Editor still exposes metadata, a type selector or Browse mode");
      if (literatureEditor.document.getElementById("knowledge-base-editor-status").textContent.includes(literatureID)) throw new Error("Editor exposes its internal note ID");
      item.setField("extra", "Citation Key: HostRenamed2026");
      if (Zotero.ItemFields.getID("citationKey")) item.setField("citationKey", "HostRenamed2026");
      await item.saveTx();
      for (let n = 0; n < 100 && literatureReference.textContent !== "@HostRenamed2026"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (literatureReference.textContent !== "@HostRenamed2026" || (await kb.api.resolveCardLink("knowledge-base://card/%40Host2026"))?.targetId !== literatureID) throw new Error("Citation-key change lost the stable note reference or left its display stale");
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
      const nativeStyles = await kb.api.getSourceStyles();
      for (const styleName of ["apa", "ieee", "chicago-author-date"]) {
        const styleID = "http://www.zotero.org/styles/" + styleName;
        if (!nativeStyles.some(style => style.id === styleID)) throw new Error("Installed CSL style missing: " + styleName);
        kb.api.setSourceStyle(styleID);
        const formatted = await kb.api.getSourceBibliography(item.key, item.libraryID);
        if (!formatted.includes("Smith") || !formatted.includes("2026") || !formatted.includes("<i>Journal of Test Studies</i>") || formatted.includes("Z3988") || formatted.includes("style=")) throw new Error("Native CSL rendering lost bibliography semantics: " + formatted);
        if (styleName === "ieee") {
          for (let n=0; n<100 && !parentDisplay.textContent.includes("[1]"); n++) await new Promise(resolve => setTimeout(resolve, 25));
          if (!parentDisplay.textContent.includes("[1]") || !parentDisplay.querySelector(".csl-left-margin")) throw new Error("Open editor did not refresh when CSL style changed");
        }
      }
      kb.api.setSourceStyle("http://www.zotero.org/styles/apa");
      if (!Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === "knowledge-base-preferences") || note.getNote() !== originalLiteratureHTML) throw new Error("Source Settings are missing or rendering rewrote the note");
      const preferences = Zotero.Utilities.Internal.openPreferences("knowledge-base-preferences");
      let styleMenu;
      for (let n=0; n<100; n++) {
        styleMenu = preferences.document.getElementById("knowledge-base-source-style");
        if (styleMenu?.value === "http://www.zotero.org/styles/apa" && preferences.document.querySelectorAll("#knowledge-base-source-styles menuitem").length) break;
        await new Promise(resolve => setTimeout(resolve,50));
      }
      if (!styleMenu || styleMenu.value !== "http://www.zotero.org/styles/apa") throw new Error("Native Settings style control did not initialize");
      const modeMenu=preferences.document.getElementById("knowledge-base-workbench-mode");
      if(modeMenu?.value!=="tab" || modeMenu.getAttribute("native")!=="true" || !modeMenu.querySelector('menuitem[value="window"]').label) throw new Error('Native Settings workbench mode did not initialize');
      modeMenu.value="window";modeMenu.dispatchEvent(new preferences.Event("command",{bubbles:true}));
      if(kb.api.getWorkbenchMode()!=="window") throw new Error('Native Settings did not persist separate-window mode');
      modeMenu.value="tab";modeMenu.dispatchEvent(new preferences.Event("command",{bubbles:true}));
      styleMenu.value = "http://www.zotero.org/styles/ieee";
      styleMenu.dispatchEvent(new preferences.Event("command", {bubbles:true}));
      if (kb.api.getSourceStyle() !== "http://www.zotero.org/styles/ieee") throw new Error("Native Settings did not persist the style");
      styleMenu.value = "http://www.zotero.org/styles/apa";
      styleMenu.dispatchEvent(new preferences.Event("command", {bubbles:true}));
      const labelLengthControl=preferences.document.getElementById("knowledge-base-graph-label-length");
      if(labelLengthControl?.value !== "20" || labelLengthControl.getBoundingClientRect().width < 30) throw new Error('Graph title length setting is missing or invisible');
      labelLengthControl.value="18";labelLengthControl.dispatchEvent(new preferences.Event("change",{bubbles:true}));
      if(kb.api.getGraphLabelLength()!==18) throw new Error('Graph title length did not autosave');
      labelLengthControl.value="0";labelLengthControl.dispatchEvent(new preferences.Event("change",{bubbles:true}));
      if(labelLengthControl.value!=="18" || kb.api.getGraphLabelLength()!==18) throw new Error('Invalid graph title length was accepted');
      const metadataShots = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
      const inheritanceControl=preferences.document.getElementById("knowledge-base-inherit-tags");
      if(!inheritanceControl?.checked) throw new Error('Native Settings did not enable tag inheritance by default');
      if(!(inheritanceControl.querySelector(".checkbox-check")?.getBoundingClientRect().width>=12)) throw new Error('Native inheritance checkbox is not visibly rendered');
      inheritanceControl.checked=false;inheritanceControl.dispatchEvent(new preferences.Event("command",{bubbles:true}));
      if(kb.api.getTagInheritance()) throw new Error('Native Settings did not save tag inheritance');
      inheritanceControl.checked=true;inheritanceControl.dispatchEvent(new preferences.Event("command",{bubbles:true}));
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
      if(kb.api.getGraphGroups()[0].color!=="#2288aa") throw new Error('Native Settings did not reorder graph-group priority');
      preferences.document.querySelector(".graph-group-row .graph-group-remove").dispatchEvent(new preferences.Event("command",{bubbles:true}));
      if(JSON.stringify(kb.api.getGraphGroups())!==JSON.stringify([{tag:"#Ideas",color:"#aa22cc"}]) || preferences.document.querySelectorAll(".graph-group-row").length!==1) throw new Error('Native Settings did not save graph tag/color rules');
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
      // Explicitly detach this fixture to cover a surviving note with a trashed source.
      note.parentItemID = false; await note.saveTx({skipSelect:true});
      item.deleted = true; await item.saveTx();
      const standaloneHealth = await kb.api.getNoteHealth(literatureID);
      if (standaloneHealth.source !== "trashed" || standaloneHealth.note !== "available") throw new Error("A standalone Literature Note was treated as deleted with its source");
      if (!(await literatureEditor.save(false)) || (await kb.api.getZettel(literatureID)).item_key !== item.key || note.parentItemID) throw new Error("Unavailable source prevented saving or moved a standalone Literature Note");
      await kb.api.restoreNote(literatureID);
      await literatureEditor.save(false);
      literatureEditor.close();
      for (let n = 0; n < 100 && !literatureEditor.closed; n++) await new Promise(resolve => setTimeout(resolve, 25));
      await kb.api.deleteZettel(literatureID);
      await kb.api.deleteZettel(thinkingID);
      if (thinking.deleted || note.deleted || thinking.getNote() !== originalThinking) throw new Error("Removing registered notes trashed or rewrote original notes");
      const migrationCanvas=Zotero.getMainWindow().document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
      migrationCanvas.width=240;migrationCanvas.height=90;
      const migrationContext=migrationCanvas.getContext("2d");
      migrationContext.fillStyle="#eaf1ff";migrationContext.fillRect(0,0,240,90);
      migrationContext.fillStyle="#3478f6";migrationContext.fillRect(16,16,48,58);migrationContext.fillRect(80,36,48,38);migrationContext.fillRect(144,26,80,48);
      const png=migrationCanvas.toDataURL("image/png").split(",")[1];
      const imageURL = await kb.api.importImage([...atob(png)].map(char => char.charCodeAt(0)), "image/png", "host-migration");
      await kb.api.saveZettel({ title: "Shutdown test", body: "Inline $E = mc^2$.\\n\\n![Migration image](" + imageURL + ")", itemKey: item.key, libraryID: item.libraryID });
      const rows = await kb.api.listZettels();
      await kb.api.saveZettel({ title: "Child card", body: "[[" + rows[0].id + "]]", parentId: rows[0].id });
      kb.api.openManager({ window:true, selectId: rows[0].id });
      kb.api.openEditor({window:true, zettelId: rows[0].id });
      kb.api.openGraph({ centerId: rows[0].id });
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
        const buttons = [...manager.document.querySelectorAll(".kb-native-tool"), ...graph.document.querySelectorAll(".kb-native-tool")];
        const iconsVisible = buttons.filter(button => !button.hidden).every(button => {
          const icon = button.querySelector(".toolbarbutton-icon");
          const text = button.querySelector(".toolbarbutton-text");
          const largeIcon = ["knowledge-base-btn-edit", "knowledge-base-btn-delete", "knowledge-base-btn-local-graph", "knowledge-base-btn-graph"].includes(button.id);
          const size = largeIcon ? 20 : 16;
          return icon?.getBoundingClientRect().width === size && icon.getBoundingClientRect().height === size
            && text && button.ownerGlobal.getComputedStyle(text).display === "none"
            && button.getBoundingClientRect().width === (largeIcon ? 32 : 28);
        });
        const actions = [...manager.document.querySelectorAll(".card-actions toolbarbutton")];
        if (actions.length !== 3 || actions.some(button => !button.closest("#knowledge-base-toolbar")) || manager.document.querySelector("#knowledge-base-detail .card-actions")) throw new Error("Note actions are not confined to the top toolbar");
        const toolbar = manager.document.getElementById("knowledge-base-toolbar");
        if (toolbar.getBoundingClientRect().height > 55) throw new Error("Default-width toolbar wraps note actions onto another row");
        const sourceBox = manager.document.getElementById("knowledge-base-detail-source");
        if (sourceBox.querySelector(".source-item-label")?.textContent !== kb.api.loc("manager-source-item") || !sourceBox.querySelector(".csl-entry")) throw new Error("Source is not identified as a Zotero item");
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
        const imageShots = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
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
          const id = button.querySelector(".relation-id");
          return id && button.getAttribute("title").includes(id.textContent) && button.querySelector(".relation-title").getBoundingClientRect().width > 0;
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
        const controls = [...graph.document.querySelectorAll("#graph-outline,#graph-references,#graph-sources,#graph-hide-isolated")];
        const graphControlsVisible = controls.length === 4 && !graph.document.getElementById("graph-hide-isolated").checked && controls.every(control => control.label && control.getBoundingClientRect().width > 0);
        const sourceWasVisible = !!graph.document.querySelector(".graph-node.source");
        const sourceControl = controls.find(control => control.id === "graph-sources");
        sourceControl.checked = false;
        sourceControl.dispatchEvent(new graph.Event("command", { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 150));
        const sourcesHidden = sourceWasVisible && !graph.document.querySelector(".graph-node.source,.graph-edge.source") && Zotero.Prefs.get("extensions.zotero.knowledge-base.graph.sources", true) === false;
        const editor = [...Services.wm.getEnumerator("knowledge-base:editor")][0];
        const body = editor.document.getElementById("knowledge-base-editor-body");
        const rootElement = editor.document.getElementById("knowledge-base-editor-root");
        for (let n = 0; n < 80 && rootElement.dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (rootElement.dataset.mode !== "visual") throw new Error("The editor did not start in visual mode");
        if (editor.document.getElementById("knowledge-base-editor-mode")) throw new Error("Browse mode is still exposed");
        async function switchMode(mode) {
          if (rootElement.dataset.mode !== mode) {
            await openMarkdownToolbar(editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow);
          }
          for (let n = 0; n < 80 && rootElement.dataset.mode !== mode; n++) await new Promise(resolve => setTimeout(resolve, 100));
          const nativeElement = editor.document.getElementById("knowledge-base-rich-frame");
          const nativeFrame = nativeElement.getCurrentInstance()._iframeWindow;
          const toggle = nativeFrame.document.querySelector(".toolbar .start .knowledge-base-markdown-toggle");
          const sourceMode = mode === "source";
          if (rootElement.dataset.mode !== mode || body.hidden === sourceMode || nativeElement.hidden || !editor.document.getElementById("knowledge-base-editor-preview").hidden || toggle?.getAttribute("aria-pressed") !== String(sourceMode)) throw new Error("Editor did not retain its toolbar and single body: " + mode);
          if (sourceMode && (!nativeElement.getCurrentInstance()._disableSaving || nativeFrame.getComputedStyle(nativeFrame.document.querySelector(".primary-editor")).visibility !== "hidden")) throw new Error("The hidden rich-text writer remained active");
        }
        const migratedNote = editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item;
        const readingElement = editor.document.getElementById("knowledge-base-rich-frame");
        const readingFrame = readingElement.getCurrentInstance()._iframeWindow;
        const stableToolbar = readingFrame.document.querySelector('.toolbar');
        const stableMiddle = stableToolbar.querySelector('.middle');
        const stableToolbarRect = stableToolbar.getBoundingClientRect();
        const readingToggle = readingFrame.document.querySelector('.knowledge-base-reading-toggle');
        const readingModel = readingFrame.wrappedJSObject.getDataSync(true);
        if(readingModel) await readingElement.getCurrentInstance()._save(JSON.parse(JSON.stringify(readingModel)));
        const readingOriginalHTML = migratedNote.getNote();
        readingToggle.click();
        for(let n=0;n<100 && rootElement.dataset.mode!=="reading";n++) await new Promise(resolve=>setTimeout(resolve,25));
        const nativeReadingPanel=readingFrame.document.querySelector('.knowledge-base-reading-view');
        if(rootElement.dataset.mode!=="reading" || nativeReadingPanel.hidden || nativeReadingPanel.querySelector('[contenteditable]') || readingFrame.document.querySelector('.toolbar')!==stableToolbar || stableToolbar.querySelector('.middle')!==stableMiddle || Math.abs(stableToolbar.getBoundingClientRect().height-stableToolbarRect.height)>1 || migratedNote.getNote()!==readingOriginalHTML) throw new Error('Knowledge Base native Reading changed its toolbar or document: '+JSON.stringify({mode:rootElement.dataset.mode,panelHidden:nativeReadingPanel.hidden,editable:!!nativeReadingPanel.querySelector('[contenteditable]'),toolbarSame:readingFrame.document.querySelector('.toolbar')===stableToolbar,middleSame:stableToolbar.querySelector('.middle')===stableMiddle,heightBefore:stableToolbarRect.height,heightAfter:stableToolbar.getBoundingClientRect().height,storageSame:migratedNote.getNote()===readingOriginalHTML,before:readingOriginalHTML,after:migratedNote.getNote()}));
        readingToggle.click();
        for(let n=0;n<100 && rootElement.dataset.mode!=="visual";n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(rootElement.dataset.mode!=="visual") throw new Error('Reading did not restore native editing');
        await switchMode("source");
        const readingBody=editor.document.getElementById("knowledge-base-editor-body");
        readingBody.setSelectionRange(5,9);
        const sourceReadingState={value:readingBody.value,start:readingBody.selectionStart,end:readingBody.selectionEnd,scroll:readingBody.scrollTop};
        const sourceReadingHTML=migratedNote.getNote();
        readingToggle.click();
        for(let n=0;n<100 && rootElement.dataset.mode!=="reading";n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(rootElement.dataset.mode!=="reading" || !readingBody.hidden || !nativeReadingPanel.querySelector('.katex') || !nativeReadingPanel.querySelector('img') || migratedNote.getNote()!==sourceReadingHTML || !readingElement.getCurrentInstance()._disableSaving) throw new Error('Knowledge Base Markdown Reading changed storage or lost formulas/images: '+JSON.stringify({mode:rootElement.dataset.mode,sourceHidden:readingBody.hidden,math:!!nativeReadingPanel.querySelector('.katex'),image:!!nativeReadingPanel.querySelector('img'),storageSame:migratedNote.getNote()===sourceReadingHTML,writerDisabled:readingElement.getCurrentInstance()._disableSaving,body:readingBody.value,preview:nativeReadingPanel.innerHTML.slice(0,1200)}));
        const readingImage=nativeReadingPanel.querySelector('img');
        for(let n=0;n<100 && (!readingImage.complete || !readingImage.naturalWidth);n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(!readingImage.complete || readingImage.naturalWidth!==240 || readingImage.naturalHeight!==90) throw new Error('Reading image did not actually load: '+JSON.stringify({src:readingImage.getAttribute('src')?.slice(0,100),complete:readingImage.complete,width:readingImage.naturalWidth,height:readingImage.naturalHeight}));
        const readingImageBounds=readingImage.getBoundingClientRect();
        if(Math.abs(readingImageBounds.width/readingImageBounds.height-readingImage.naturalWidth/readingImage.naturalHeight)>.03 || readingImageBounds.width>nativeReadingPanel.getBoundingClientRect().width) throw new Error('Reading image is distorted or wider than its viewport: '+JSON.stringify(readingImageBounds.toJSON()));
        const readingShots = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
        if(readingShots) {
          await IOUtils.makeDirectory(readingShots,{ignoreExisting:true});
          const image=await editor.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,'white');
          const canvas=editor.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
          await IOUtils.write(PathUtils.join(readingShots,'reading-view.png'),new Uint8Array(await blob.arrayBuffer()));image.close();
        }
        readingToggle.click();
        for(let n=0;n<100 && rootElement.dataset.mode!=="source";n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(rootElement.dataset.mode!=="source" || JSON.stringify({value:readingBody.value,start:readingBody.selectionStart,end:readingBody.selectionEnd,scroll:readingBody.scrollTop})!==JSON.stringify(sourceReadingState)) throw new Error('Knowledge Base Reading lost source text, selection or scroll');
        await switchMode("visual");
        if (migratedNote.parentItemID !== item.id) throw new Error("Sourced note was not filed under its source");
        if (Zotero.getActiveZoteroPane().getSelectedItems().some(selected => selected.id === migratedNote.id)) throw new Error("Native note creation changed the library selection");
        editor.document.getElementById("knowledge-base-src-pick").click();
        editor.document.getElementById("knowledge-base-src-none").click();
        let personal;
        for (let n = 0; n < 160; n++) {
          personal = await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID, Zotero.Prefs.get("extensions.zotero.knowledge-base.notes.parent." + item.libraryID, true));
          if (!(await kb.api.getZettel(rows[0].id)).item_key && personal && migratedNote.parentItemID === personal.id && !migratedNote.getCollections().length && editor.document.getElementById("knowledge-base-editor-status").textContent === kb.api.loc("editor-saved")) break;
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
        for (let n = 0; n < 160 && ((await kb.api.getZettel(rows[0].id)).item_key !== item.key || migratedNote.parentItemID !== item.id || editor.document.getElementById("knowledge-base-editor-status").textContent !== kb.api.loc("editor-saved")); n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (migratedNote.parentItemID !== item.id || item.getCollections().length) throw new Error("The source picker did not reparent the existing note cleanly");

        const unsourced = (await kb.api.listZettels()).find(card => card.id !== rows[0].id);
        await kb.api.saveEditorCard({id: unsourced.id, title:unsourced.title, body:unsourced.body, kind:"thinking"});
        const loose = await kb.api.acquireNativeNote({ id: unsourced.id, title: unsourced.title, body: unsourced.body });
        const looseNote = await Zotero.Items.getAsync(loose.noteID);
        kb.api.openEditor({window:true,zettelId: unsourced.id});
        let keyEditor;
        for (let n=0; n<100; n++) {
          keyEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === unsourced.id);
          if (keyEditor?.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        const typePicker = keyEditor.document.getElementById("knowledge-base-note-kind");
        const keyInput = keyEditor.document.getElementById("knowledge-base-editor-key");
        if (!typePicker.hidden || !typePicker.disabled || keyInput.hidden || keyEditor.document.getElementById("knowledge-base-note-kind-text").textContent !== kb.api.loc("note-kind-thinking")) throw new Error("Saved Thinking type is not static text");
        keyInput.value = "HostProject"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false))) throw new Error("Thinking key save failed");
        keyInput.value = "HostProjectRevised"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false))) throw new Error("Thinking key rename failed");
        const keyed = await kb.api.getZettel(unsourced.id);
        if (keyed.kind !== "thinking" || keyed.reference !== "HostProjectRevised" || keyed.custom_key !== "HostProjectRevised" || (await kb.api.resolveCardLink("knowledge-base://card/HostProject")).targetId !== unsourced.id || keyEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Thinking key changed identity or broke old links");
        keyEditor.document.getElementById("knowledge-base-kind-convert").click();
        if (!(await keyEditor.save(false)) || (await kb.api.getZettel(unsourced.id)).kind !== "zettel" || !keyInput.hidden || (await kb.api.resolveCardLink("knowledge-base://card/HostProjectRevised")).targetId !== unsourced.id || keyEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Converting to Zettel broke identity or old keys");
        keyEditor.document.getElementById("knowledge-base-kind-convert").click();
        keyInput.value = "HostProjectRevised"; keyInput.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        if (!(await keyEditor.save(false)) || (await kb.api.getZettel(unsourced.id)).kind !== "thinking") throw new Error("Converting back to Thinking failed");
        keyEditor.document.getElementById("knowledge-base-parent-change").click();
        const parentSearch = keyEditor.document.getElementById("knowledge-base-parent-search");
        parentSearch.value = rows[0].title; parentSearch.dispatchEvent(new keyEditor.Event("input", {bubbles:true}));
        let parentChoice;
        for (let n=0; n<50; n++) {
          parentChoice = [...keyEditor.document.querySelectorAll("#knowledge-base-parent-results .relation-link")].find(button => button.textContent.includes(rows[0].title));
          if (parentChoice) break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (!parentChoice) throw new Error("Parent reference picker did not find a note");
        parentChoice.click(); if (!(await keyEditor.save(false)) || (await kb.api.getFamily(unsourced.id)).parent?.id !== rows[0].id) throw new Error("Parent picker did not save its note");
        keyEditor.document.getElementById("knowledge-base-parent-change").click();
        for(let n=0; n<50 && !keyEditor.document.querySelector("#knowledge-base-parent-results .metadata-clear"); n++) await new Promise(resolve=>setTimeout(resolve,50));
        keyEditor.document.querySelector("#knowledge-base-parent-results .metadata-clear").click();
        if (!(await keyEditor.save(false)) || (await kb.api.getFamily(unsourced.id)).parent) throw new Error("No parent did not detach the note");
        keyEditor.close();
        await new Promise(resolve => setTimeout(resolve, 100));
        kb.api.openEditor({zettelId: unsourced.id});
        const main = Zotero.getMainWindow();
        let workbench, inline;
        for (let n=0; n<150; n++) {
          workbench = main.document.querySelector(".knowledge-base-workbench")?.contentWindow;
          inline = workbench?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
          if (inline?.knowledgeBaseCardId === unsourced.id && inline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (inline?.knowledgeBaseCardId !== unsourced.id || inline.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Workbench did not embed the existing native editor");
        kb.api.openManager({selectId: unsourced.id});
        entryButton.dispatchEvent(new mainWindow.Event("command"));
        if (main.document.querySelectorAll(".knowledge-base-workbench").length !== 1) throw new Error("Workbench created duplicate tabs");
        if (main.Zotero_Tabs.getState().some(tab => tab.type === "knowledgebase")) throw new Error("Workbench leaked an unsupported document into Zotero session state");
        workbench.newZettel("Workbench typing fixture");
        for (let n=0; n<150; n++) {
          inline = workbench.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (!inline.knowledgeBaseCardId && inline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (inline.knowledgeBaseCardId === unsourced.id || inline.document.getElementById("knowledge-base-editor-title").value !== "Workbench typing fixture") throw new Error("New Note kept the old document: " + JSON.stringify({url:inline.location.href, args:inline.eval("args"), id:inline.knowledgeBaseCardId}));
        const emptyConnections = inline.document.getElementById("knowledge-base-editor-relations");
        const emptyButtons = [...emptyConnections.querySelectorAll("nav button")];
        if (emptyConnections.hidden || emptyButtons.length !== 3 || emptyButtons.some(button => !button.disabled || !button.textContent.endsWith("0"))) throw new Error("Zero-count connections disappeared from the workbench");
        const emptyBounds = emptyConnections.getBoundingClientRect();
        if (emptyBounds.height < 20 || emptyBounds.top < 0 || emptyBounds.bottom > inline.innerHeight) throw new Error("Connection navigation is outside the workbench viewport");
        await inline.setEditorMode("source");
        const inlineBody = inline.document.getElementById("knowledge-base-editor-body");
        inlineBody.value = "# Workbench typing fixture\\n\\nTyped in the workbench.";
        inlineBody.dispatchEvent(new inline.Event("input", {bubbles:true}));
        if (!(await inline.save(false))) throw new Error("Workbench direct edit did not save");
        const inlineID = inline.knowledgeBaseCardId;
        if (inlineID === unsourced.id) throw new Error("New Note reused an existing ID");
        if ((await kb.api.getZettel(inlineID)).body !== "Typed in the workbench.") throw new Error("Workbench saved the wrong content");
        const connectionChildID = await kb.api.saveZettel({title:"A child note with a full title that remains readable across the available editor width", body:"[[" + inlineID + "]]", parentId:inlineID});
        const childNav = inline.document.getElementById("knowledge-base-editor-children-label");
        const backlinkNav = inline.document.getElementById("knowledge-base-editor-backlinks-label");
        for (let n=0; n<100 && (childNav.disabled || backlinkNav.disabled); n++) await new Promise(resolve=>setTimeout(resolve,50));
        if (childNav.disabled || backlinkNav.disabled || !childNav.textContent.endsWith("1") || !backlinkNav.textContent.endsWith("1")) throw new Error("Children and backlinks did not update in the workbench");
        childNav.click();
        const childList = inline.document.getElementById("knowledge-base-editor-family");
        if (childList.hidden || !inline.document.getElementById("knowledge-base-editor-backlinks").hidden || childNav.getAttribute("aria-expanded") !== "true") throw new Error("Connection navigation did not select one list");
        backlinkNav.click();
        if (!childList.hidden || inline.document.getElementById("knowledge-base-editor-backlinks").hidden) throw new Error("Connection categories stacked their lists");
        const inlineMore = inline.document.getElementById("knowledge-base-editor-more");
        inlineMore.open = true;
        const moreRows = [...inlineMore.querySelectorAll(".editor-more-menu > button:not([hidden])")];
        for (const button of moreRows) {
          const bounds = button.getBoundingClientRect();
          if (bounds.width < 180 || bounds.height < 24 || bounds.height > 40 || inline.getComputedStyle(button).whiteSpace !== "nowrap") throw new Error("More menu has a squeezed or wrapped row: " + button.id + ": " + JSON.stringify({width:bounds.width,height:bounds.height}));
        }
        if (metadataShots) {
          const image = await main.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,"white");
          const canvas = main.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
          canvas.width=image.width;canvas.height=image.height;canvas.getContext("2d").drawImage(image,0,0);image.close();
          const blob = await new Promise(resolve=>canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(metadataShots,"connections-menu.png"),new Uint8Array(await blob.arrayBuffer()));
        }
        inlineMore.open = false;
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
        const originalGetZettel = kb.api.getZettel;
        const untouchedHTML = looseNote.getNote();
        let releaseEditorLoad, editorLoadHeld = false;
        const editorLoadGate = new Promise(resolve => { releaseEditorLoad = resolve; });
        kb.api.getZettel = async (id) => {
          if (id === unsourced.id && !editorLoadHeld) {
            editorLoadHeld = true;
            await editorLoadGate;
          }
          return originalGetZettel(id);
        };
        try {
          const loadingNavigation = kb.api.mountEditor(navigationFrame, {zettelId:unsourced.id});
          for (let n=0; n<150 && !editorLoadHeld; n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (!editorLoadHeld) throw new Error("Could not delay workbench editor initialization");
          const queuedReplacement = kb.api.mountEditor(navigationFrame, {zettelId:connectionChildID});
          const latestNavigation = kb.api.mountEditor(navigationFrame, {zettelId:unsourced.id});
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
          kb.api.getZettel = originalGetZettel;
        }
        workbench.ZoteroKnowledgeBase_selectZettel(unsourced.id);
        for (let n=0; n<150; n++) {
          inline = workbench.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (inline.knowledgeBaseCardId === unsourced.id && inline.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (inline.knowledgeBaseCardId !== unsourced.id) throw new Error("Workbench navigation did not switch the inline note");
        if(workbench.document.getElementById("knowledge-base-open-window")) throw new Error('Workbench has a duplicate window-opening control');
        kb.api.setWorkbenchMode("window");
        kb.api.openManager({selectId:unsourced.id});
        entryButton.dispatchEvent(new mainWindow.Event("command"));
        let independent, separateManager, separateEditor;
        async function waitSeparate(cardID, draftID) {
          for (let n=0; n<150; n++) {
            independent = [...Services.wm.getEnumerator("knowledge-base:workbench")][0];
            separateManager = independent?.document.getElementById("knowledge-base-window-browser")?.contentWindow;
            separateEditor = separateManager?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
            if (!separateManager?.document.getElementById("knowledge-base-workbench-editor")?.hidden && separateEditor?.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual" && (cardID ? separateEditor.knowledgeBaseCardId === cardID : separateEditor.knowledgeBaseDraftId === draftID)) return;
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          throw new Error("Independent workbench did not load the requested native editor: " + JSON.stringify({count:[...Services.wm.getEnumerator("knowledge-base:workbench")].length,windowURL:independent?.location.href,windowReady:independent?.document.readyState,managerURL:separateManager?.location.href,managerReady:separateManager?.document.readyState,editorURL:separateEditor?.location.href,cardID:separateEditor?.knowledgeBaseCardId,draftID:separateEditor?.knowledgeBaseDraftId,wantedCard:cardID,wantedDraft:draftID,tabStatus:inline.document.getElementById("knowledge-base-editor-status").textContent}));
        }
        await waitSeparate(unsourced.id);
        if (separateManager.document.getElementById("knowledge-base-open-window") || separateEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== looseNote.id) throw new Error("Independent workbench lost the native note or exposed a redundant window entry");
        mainWindow.document.getElementById("knowledge-base-menu-open-manager").dispatchEvent(new mainWindow.Event("command"));
        await waitSeparate(unsourced.id);
        kb.api.setWorkbenchMode("tab");
        const independentBounds = independent.document.getElementById("knowledge-base-window-browser").getBoundingClientRect();
        if (independentBounds.width < 800 || independentBounds.height < 500 || separateEditor.document.getElementById("knowledge-base-rich-frame").getBoundingClientRect().height < 300) throw new Error("Independent workbench or native editor did not fill its window: " + JSON.stringify({window:independentBounds.toJSON(),editor:separateEditor.document.getElementById("knowledge-base-rich-frame").getBoundingClientRect().toJSON(),managerHeight:separateManager.innerHeight,editorHeight:separateEditor.innerHeight}));
        checkNativeEndSpace(separateEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._iframeWindow);
        kb.api.openWorkbenchWindow({selectId:connectionChildID});
        kb.api.openWorkbenchWindow({selectId:unsourced.id});
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
        if (inline.eval("dirty")) throw new Error("Native refresh retained a redundant tab draft: " + JSON.stringify({snapshot:inline.eval("snapshot()"),card:await kb.api.getZettel(unsourced.id),parent:(await kb.api.getFamily(unsourced.id)).parent,expectedHTML:inline.eval("expectedNoteHTML"),status:inline.document.getElementById("knowledge-base-editor-status").textContent}));
        separateManager.newZettel("Independent closing draft");
        for (let n=0; n<150; n++) {
          separateEditor = separateManager.document.getElementById("knowledge-base-workbench-editor").contentWindow;
          if (!separateEditor.knowledgeBaseCardId && separateEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        if (separateEditor.knowledgeBaseCardId || separateEditor.document.getElementById("knowledge-base-editor-title").value !== "Independent closing draft") throw new Error("Independent new-note action opened or retained another editor");
        await separateEditor.setEditorMode("source");
        const pendingSeparate = separateEditor.document.getElementById("knowledge-base-editor-body");
        pendingSeparate.value = "# Independent closing draft\\n\\nKept when closing the independent window.";
        pendingSeparate.dispatchEvent(new separateEditor.Event("input",{bubbles:true}));
        const separateDraftID = separateEditor.knowledgeBaseDraftId;
        independent.close();
        for (let n=0; n<100 && !(await kb.api.getEditorDraft(separateDraftID))?.body.includes("Kept when closing"); n++) await new Promise(resolve=>setTimeout(resolve,25));
        if (!(await kb.api.getEditorDraft(separateDraftID))?.body.includes("Kept when closing")) throw new Error("Independent close lost the unsaved draft");
        kb.api.openWorkbenchWindow({editor:{draftId:separateDraftID}});
        await waitSeparate(null,separateDraftID);
        if (!separateEditor.document.getElementById("knowledge-base-editor-body").value.includes("Kept when closing")) throw new Error("Reopening independent workbench lost the recovery draft");
        independent.close();
        await new Promise(resolve=>setTimeout(resolve,100));
        await kb.api.discardEditorDraft(separateDraftID);
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
        await kb.api.deleteZettel(connectionChildID);
        await kb.api.deleteZettel(inlineID);
        const taggedCard = await kb.api.getZettel(unsourced.id);
        looseNote.addTag("Machine learning"); looseNote.addTag("中文 标签"); await looseNote.saveTx();
        await kb.api.saveEditorCard({id: taggedCard.id, noteID:looseNote.id, title:"A long child note title about understanding relationships between ideas and navigating a knowledge base without squeezing text into a narrow sidebar", body:"#tag-a #tag-b #中文 \`#ignored\`", sourceMode:true, expectedNoteHTML:looseNote.getNote(), expectedUpdatedAt:taggedCard.updated_at, parentId:null});
        await Zotero.Tags.setColor(item.libraryID, "Machine learning", "#3478f6", 0);
        const taggedGraphNode = (await kb.api.getGraph()).nodes.find(node => node.id === unsourced.id);
        if (looseNote.hasTag("tag-a") || looseNote.hasTag("tag-b") || looseNote.hasTag("中文") || !looseNote.hasTag("Machine learning") || !looseNote.hasTag("中文 标签") || looseNote.hasTag("ignored") || taggedGraphNode.tags.length !== 2 || !taggedGraphNode.tags.includes("Machine learning") || !taggedGraphNode.tags.includes("中文 标签") || taggedGraphNode.color !== "#3478f6") throw new Error("Native multiword tags or Zotero graph colors did not persist independently of text: " + JSON.stringify({tags:looseNote.getTags(), graph:taggedGraphNode}));
        await kb.api.openEditor({window:true, zettelId:unsourced.id});
        let nativeTagEditor;
        for (let n=0; n<100; n++) {
          nativeTagEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === unsourced.id);
          if (nativeTagEditor?.document.querySelectorAll("#knowledge-base-note-tags .note-tag").length === 2) break;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        if (!nativeTagEditor || ![...nativeTagEditor.document.querySelectorAll("#knowledge-base-note-tags .note-tag")].some(label => label.textContent === "Machine learning")) throw new Error("Editor did not render native multiword tags");
        looseNote.removeTag("Machine learning"); looseNote.removeTag("中文 标签"); looseNote.addTag("Revised tag with spaces"); await looseNote.saveTx();
        for (let n=0; n<100 && nativeTagEditor.document.querySelector("#knowledge-base-note-tags .note-tag")?.textContent !== "Revised tag with spaces"; n++) await new Promise(resolve => setTimeout(resolve,50));
        if (nativeTagEditor.document.querySelectorAll("#knowledge-base-note-tags .note-tag").length !== 1 || nativeTagEditor.document.querySelector("#knowledge-base-note-tags .note-tag").textContent !== "Revised tag with spaces" || (await kb.api.getGraph()).nodes.find(node => node.id === unsourced.id).tags.join() !== "Revised tag with spaces") throw new Error("Native tag edits did not refresh editor and graph");
        looseNote.removeTag("Revised tag with spaces"); await looseNote.saveTx();
        for (let n=0; n<100 && !nativeTagEditor.document.getElementById("knowledge-base-note-tags").hidden; n++) await new Promise(resolve => setTimeout(resolve,50));
        if (!nativeTagEditor.document.getElementById("knowledge-base-note-tags").hidden || (await kb.api.getGraph()).nodes.find(node => node.id === unsourced.id).color !== undefined || looseNote.getTags().length) throw new Error("Removing native tags did not clear the views");
        const personalParent = await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID, Zotero.Prefs.get("extensions.zotero.knowledge-base.notes.parent." + item.libraryID, true));
        if (personalParent.getTags().length || Zotero.Tags.getColors(item.libraryID).has("Personal Knowledge")) throw new Error("Personal parent was automatically tagged");
        personalParent.addTag("User marker"); await personalParent.saveTx();
        const inheritedLabels=()=>[...nativeTagEditor.document.querySelectorAll("#knowledge-base-note-tags .note-tag")].map(label=>label.textContent);
        for(let n=0;n<100 && !inheritedLabels().includes("User marker");n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(!inheritedLabels().includes("User marker") || !(await kb.api.getGraph()).nodes.find(node=>node.id===unsourced.id).tags.includes("User marker") || looseNote.getTags().length) throw new Error('Parent item tags did not inherit live without modifying native note tags');
        personalParent.removeTag("User marker");await personalParent.saveTx();
        for(let n=0;n<100 && inheritedLabels().length;n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(inheritedLabels().length || (await kb.api.getNoteTags(looseNote.id,unsourced.id)).length) throw new Error('Removed parent tags remained on a child');
        personalParent.addTag("User marker");await personalParent.saveTx();
        migratedNote.addTag("Outline topic");await migratedNote.saveTx();
        async function setTagParent(parentId) {
          const card=await kb.api.getZettel(unsourced.id);
          await kb.api.saveEditorCard({id:card.id,title:card.title,body:card.body,kind:card.kind,customKey:card.custom_key,itemKey:card.item_key,libraryID:card.library_id,noteID:looseNote.id,expectedNoteHTML:looseNote.getNote(),expectedUpdatedAt:card.updated_at,parentId});
        }
        await setTagParent(rows[0].id);
        for(let n=0;n<100 && !inheritedLabels().includes("Outline topic");n++) await new Promise(resolve=>setTimeout(resolve,25));
        const priorGroups=kb.api.getGraphGroups();
        kb.api.setGraphGroups([{tag:"Outline topic",color:"#ff5500"},{tag:"User marker",color:"#00aa66"},...priorGroups]);
        const groupedCard=(await kb.api.getGraph()).nodes.find(node=>node.id===unsourced.id);
        if(!inheritedLabels().includes("Outline topic") || !groupedCard.tags.includes("Outline topic") || groupedCard.group!=="Outline topic" || groupedCard.color!=="#ff5500" || looseNote.getTags().length) throw new Error('Card ancestor tags or first-matching graph groups failed');
        for(let n=0;n<100 && !graph.document.getElementById("graph-groups-legend").textContent.includes("Outline topic");n++) await new Promise(resolve=>setTimeout(resolve,25));
        const groupedSVG=[...graph.document.querySelectorAll(".graph-node")].find(node=>node.dataset.nodeId===unsourced.id);
        if(!groupedSVG || groupedSVG.style.getPropertyValue("--node-color")!=="#ff5500" || !graph.document.getElementById("graph-groups-legend").textContent.includes("Outline topic")) throw new Error('Live graph colors or group legend did not refresh');
        kb.api.setGraphGroups([{tag:"User marker",color:"#00aa66"},{tag:"Outline topic",color:"#ff5500"},...priorGroups]);
        if((await kb.api.getGraph()).nodes.find(node=>node.id===unsourced.id).color!=="#00aa66") throw new Error('Reordered graph groups did not change matching priority');
        kb.api.setTagInheritance(false);
        for(let n=0;n<100 && inheritedLabels().length;n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(inheritedLabels().length || (await kb.api.getGraph()).nodes.find(node=>node.id===unsourced.id).group) throw new Error('Disabling inheritance did not remove inherited tags and groups');
        kb.api.setTagInheritance(true);
        await setTagParent(null);
        for(let n=0;n<100 && inheritedLabels().includes("Outline topic");n++) await new Promise(resolve=>setTimeout(resolve,25));
        if(inheritedLabels().includes("Outline topic") || (await kb.api.getNoteTags(looseNote.id,unsourced.id)).includes("Outline topic")) throw new Error('Moving a card left its old inherited tags');
        migratedNote.removeTag("Outline topic");await migratedNote.saveTx();
        kb.api.setGraphGroups(priorGroups);
        nativeTagEditor.close();
        await Zotero.Tags.setColor(item.libraryID, "Personal Knowledge", "#805ad5", 0);
        if (!personalParent || looseNote.parentItemID !== personalParent.id || looseNote.getCollections().length) throw new Error("Unsourced note was not attached to the personal parent");
        const updatePlacement = async (source) => {
          const current = await kb.api.getZettel(unsourced.id);
          await kb.api.saveEditorCard({ id: current.id, noteID: looseNote.id, title: current.title, body: current.body, sourceMode: false, expectedUpdatedAt: current.updated_at, parentId: rows[0].id, itemKey: source?.key || null, libraryID: source?.libraryID || null });
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
        if (personalParent.deleted || looseNote.parentItemID !== personalParent.id || (await kb.api.getZettel(unsourced.id)).item_key) throw new Error("Clearing a source did not restore the same personal parent");
        await kb.api.releaseNativeNote(looseNote.id);
        const again = await kb.api.acquireNativeNote({ id: unsourced.id, title: unsourced.title, body: unsourced.body });
        if (Zotero.Tags.getColors(item.libraryID).get("Personal Knowledge")?.color !== "#805ad5") throw new Error("Reopening replaced the user's personal marker color");
        if (again.noteID !== looseNote.id || looseNote.parentItemID !== personalParent.id || personalParent.getField("title") !== "Renamed personal notes" || Zotero.Collections.getByLibrary(item.libraryID).some(entry => entry.name === "Knowledge Base")) throw new Error("Reopening duplicated the note or renamed personal parent");
        await kb.api.releaseNativeNote(looseNote.id);

        for (let n = 0; n < 100 && !migratedNote.getAttachments().length; n++) await new Promise(resolve => setTimeout(resolve, 100));
        const migratedImage = Zotero.Items.get(migratedNote.getAttachments()[0]);
        if (!migratedImage || !(await migratedImage.fileExists())) throw new Error("Legacy image was not imported into Zotero note attachments");
        if (migratedNote.getAttachments().length !== 1) throw new Error("Two native editors imported duplicate migration images");
        if (editor.document.getElementById("knowledge-base-src-clear") || editor.document.getElementById("knowledge-base-src-anno")) throw new Error("Obsolete source actions remain in the editor");
        await switchMode("source");
        body.value = "A saved idea with [[" + (await kb.api.listZettels()).find(card => card.id !== rows[0].id).id + "]] and $E = mc^2$. [@Host2026] [My note](zotero://select/library/items/" + note.key + ").\\n\\n$$\\nx^2+y^2\\n$$\\n\\n## From reading to an idea\\n\\n- Keep the source close to the idea.\\n- Connect it to a related card.\\n\\n> One clear thought per card makes it easier to revisit.\\n\\n| Connection | Purpose |\\n| --- | --- |\\n| Parent | Outline |\\n| Card link | Related idea |";
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
        for (let n = 0; n < 80 && (!(await kb.api.getZettel(rows[0].id)).body.includes("From reading to an idea") || (await kb.api.listEditorDrafts()).length); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await kb.api.getZettel(rows[0].id)).body.includes("From reading to an idea")) throw new Error("Editor autosave did not persist");
        if ((await kb.api.listEditorDrafts()).length) throw new Error("Committed draft was not removed");
        const saveButton = editor.document.getElementById("knowledge-base-editor-save");
        if (!saveButton.label || saveButton.getBoundingClientRect().height < 16) throw new Error("Native Save control is not visible");
        saveButton.dispatchEvent(new editor.Event("command", { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 150));
        if (editor.closed) throw new Error("Save unexpectedly closed the editor");
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
        const cardLink = richSurface.querySelector("a[href^='knowledge-base://card/']");
        if (!cardLink?.textContent.startsWith("[[")) throw new Error("Card IDs were rewritten");
        if (richSurface.querySelector("a[href$='" + note.key + "']")?.textContent !== "My note") throw new Error("Note labels were rewritten");
        const citation = richSurface.querySelector(".citation");
        if (!citation?.textContent.includes("Smith") || !citation.textContent.includes("2026")) throw new Error("Native author-year citation missing");
        const click = (target) => {
          const bounds = target.getBoundingClientRect();
          for (const type of ["mousedown", "mouseup", "click"]) target.dispatchEvent(new frameWindow.MouseEvent(type, { bubbles: true, cancelable: true, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2, ctrlKey: true, metaKey: true }));
        };
        click(cardLink);
        const childID = (await kb.api.listZettels()).find(card => card.id !== rows[0].id).id;
        let linkEditor;
        for (let n = 0; n < 120; n++) {
          const linkWorkbench = Zotero.getMainWindow().document.querySelector(".knowledge-base-workbench")?.contentWindow;
          linkEditor = linkWorkbench?.document.getElementById("knowledge-base-workbench-editor")?.contentWindow;
          if (linkEditor?.knowledgeBaseCardId === childID && linkEditor.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (linkEditor?.knowledgeBaseCardId !== childID) throw new Error("Native card hyperlink did not navigate into the workbench");
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
        for (let n = 0; n < 100 && !(await kb.api.getZettel(rows[0].id)).body.includes("Native autosave probe"); n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await kb.api.getZettel(rows[0].id)).body.includes("Native autosave probe")) throw new Error("Native note changes did not refresh the card cache");
        await switchMode("source");
        if (!body.value.includes("[@Host2026]") || !body.value.includes("[My note](zotero://")) throw new Error("Source projection lost references");
        if (!editor.document.getElementById("knowledge-base-editor-title").hidden || !body.querySelector("iframe")?.contentDocument.querySelector(".cm-editor")) throw new Error("Markdown still exposes a separate title or plain textarea");
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
        const more = editor.document.getElementById("knowledge-base-editor-more");
        if (more.open || editor.document.querySelectorAll(".metadata-change").length) throw new Error("Secondary actions are not collapsed into More");
        more.open = true;
        const changeBounds = changeButton.getBoundingClientRect();
        if (!changeButton.getAttribute("aria-label") || changeBounds.width < 24 || changeBounds.height < 10 || changeBounds.right > editor.innerWidth) throw new Error("Source Change button is not visibly laid out: " + JSON.stringify({text:changeButton.textContent, bounds:changeBounds.toJSON(), style:editor.getComputedStyle(changeButton).cssText, display:editor.getComputedStyle(changeButton).display}));
        more.open = false;
        const chipShots = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
        if (chipShots) {
          await IOUtils.makeDirectory(chipShots, {ignoreExisting: true});
          const image = await editor.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = editor.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
          await IOUtils.write(PathUtils.join(chipShots, "markdown-editor.png"), new Uint8Array(await blob.arrayBuffer()));
        }
        const protectedSource = kb.api.getMarkdownSource(nativeNote.getNote());
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
        if (!nativeNote.getNote().includes("Better Notes external change") || nativeNote.getNote().includes("Unsaved Markdown conflict") || !editor.document.getElementById("knowledge-base-editor-status").textContent.includes(kb.api.loc("editor-save-conflict"))) throw new Error("Markdown conflict was not visible or retained");
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
            win.dispatchEvent(new win.PointerEvent("pointermove", {clientX:x}));
            win.dispatchEvent(new win.Event(end));
          } finally { win.removeEventListener("error", onError); }
          if (error) throw new Error("Panel drag raised a host error: " + error);
          if (win.document.documentElement.classList.contains("resizing-panels")) throw new Error("Panel resizing state was not cleared");
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
        if (!(manager.document.getElementById("knowledge-base-list-pane").getBoundingClientRect().width > originalWidth) || kb.api.getPanelWidth("manager") !== 33) throw new Error("List panel did not resize and persist");
        const transformBeforeResize = graph.document.querySelector("#graph-svg > g")?.getAttribute("transform");
        graph.document.getElementById("graph-splitter").dispatchEvent(new graph.KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
        if (kb.api.getPanelWidth("graph") !== 29 || transformBeforeResize !== graph.document.querySelector("#graph-svg > g")?.getAttribute("transform")) throw new Error("Graph resizing changed its viewport or failed to persist");
        const editorRelations = editor.document.getElementById("knowledge-base-editor-relations");
        const compactConnections = editorRelations.getBoundingClientRect().width >= 200 && editor.getComputedStyle(editor.document.getElementById("knowledge-base-editor-content")).flexDirection === "column" && editorRelations.querySelectorAll("nav button").length === 3 && !editorRelations.querySelector("details") && !editorRelations.contains(editor.document.getElementById("knowledge-base-parent-display"));
        const sourceReference = editor.document.getElementById("knowledge-base-src-display").textContent;
        if (!sourceReference.includes("Smith") || !sourceReference.includes("2026") || !sourceReference.includes("Journal of Test Studies") || editor.document.getElementById("knowledge-base-parent-root")) throw new Error("Source/Parent metadata is not a concise reference");
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
        const nativeStyleUntouched = !nativeFrame.document.querySelector("style[data-knowledge-base]");
        if (!nativeStyleUntouched) throw new Error("Plugin overrides the native note editor style");
        const screenshotDirectory = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
        async function snapshot(name, win) {
          const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(screenshotDirectory, name + ".png"), new Uint8Array(await blob.arrayBuffer()));
        }
        if (!editor.document.getElementById("knowledge-base-note-kind").hidden || editor.document.getElementById("knowledge-base-note-kind-text").textContent !== kb.api.loc("note-kind-zettel")) throw new Error("Saved Zettel still shows a dropdown");
        editor.openCardPicker();
        for (let n=0; n<100 && !editor.document.querySelector("#knowledge-base-link-results .note-reference-text"); n++) await new Promise(resolve=>setTimeout(resolve,20));
        const pickerReference = editor.document.querySelector("#knowledge-base-link-results .note-reference-text");
        if (!pickerReference) throw new Error("Insert Note references are missing");
        const checkReferences = win => {
          for (const text of win.document.querySelectorAll(".note-reference-text")) {
            const key = text.querySelector(".relation-id");
            const title = text.querySelector(".relation-title");
            if (!key || key.hidden || !title || !text.getBoundingClientRect().height) continue;
            if (win.getComputedStyle(key).display !== "inline" || win.getComputedStyle(title).display !== "inline" || text.textContent!==title.textContent+" ("+key.textContent+")" || text.firstElementChild!==title) throw new Error("A note reference does not show title (key): " + text.textContent);
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
        const priorSources = kb.api.getGraphOptions().sources;
        kb.api.setGraphOption("sources", true);
        const realGetGraph = kb.api.getGraph;
        const originalGraphData = await realGetGraph();
        const topics = ["视觉语言模型", "图像分割", "表示学习", "多模态检索", "生成模型", "研究方法"];
        const network = {nodes:[], edges:[]};
        for (let topic = 0; topic < topics.length; topic++) {
          const sourceID = "network-source-" + topic;
          network.nodes.push({id:sourceID, title:"Source · " + topics[topic], kind:"source", snippet:"Researcher 2026", citation:"Researcher 2026"});
          for (let i = 0; i < 30; i++) {
            const id = "network-" + topic + "-" + i;
            network.nodes.push({id, title:(i === 0 ? "Survey · " : "") + topics[topic] + "：研究问题、证据与思考 " + i, kind:"card", group:topics[topic], tags:[topics[topic]], color:["#2469c9","#268572","#bd4781","#8c61c9","#c88428","#368b9c"][topic], noteKind:i === 0 ? "thinking" : i === 1 ? "literature" : "zettel", snippet:"# " + topics[topic] + "\\n\\nA connected research note."});
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
        async function redrawGraph(data) {
          kb.api.getGraph = async () => data;
          graph.document.getElementById("graph-refresh").click();
          for (let n = 0; n < 100 && graph.document.querySelectorAll(".graph-node").length !== data.nodes.length; n++) await new Promise(resolve => setTimeout(resolve, 25));
          if (graph.document.querySelectorAll(".graph-node").length !== data.nodes.length || graph.document.getElementById("graph-error").textContent) throw new Error("Host network rendering failed: " + graph.document.querySelectorAll(".graph-node").length + "/" + data.nodes.length + " " + graph.document.getElementById("graph-error").textContent);
          await new Promise(resolve=>setTimeout(resolve,400));
          graph.document.getElementById("graph-fit").click();
        }
        try {
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
          kb.api.setGraphLabelLength(12); await new Promise(resolve=>setTimeout(resolve,100));
          const lengthNode=[...graph.document.querySelectorAll(".graph-node")].find(node=>node.getAttribute("aria-label").startsWith("Survey"));
          const fullLengthTitle=lengthNode.getAttribute("aria-label");
          const resizedLabel=graph.document.querySelector('[data-node-id="'+lengthNode.dataset.nodeId+'"] text');
          if(resizedLabel.textContent!==Array.from(fullLengthTitle).slice(0,12).join('')+'…') throw new Error('Open graph did not apply its title length live');
          kb.api.setGraphLabelLength(18); await new Promise(resolve=>setTimeout(resolve,100));

          const baseNodeStyles=new Map([...graph.document.querySelectorAll(".graph-node")].map(node=>[node,{opacity:graph.getComputedStyle(node).opacity,fill:graph.getComputedStyle(node.querySelector('.graph-node-dot')).fill}]));
          const baseEdgeStyles=new Map([...graph.document.querySelectorAll(".graph-edge")].map(line=>[line,{opacity:graph.getComputedStyle(line).opacity,width:parseFloat(graph.getComputedStyle(line).strokeWidth),stroke:graph.getComputedStyle(line).stroke}]));
          let node = [...graph.document.querySelectorAll(".graph-node")].find(node => node.getAttribute("aria-label").startsWith("Survey"));
          node.dispatchEvent(new graph.PointerEvent("pointerenter"));
          const titleLimit=kb.api.getGraphLabelLength();
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
          if(!kb.api.getGraphOptions().hideIsolated || graph.document.querySelector('[data-node-id="network-isolated"],[data-node-id="network-self"]')) throw new Error("The native filter did not hide isolated and self-reference-only notes");
          if(graph.document.querySelector("#graph-svg > g").getAttribute("transform")!==viewportBeforeIsolation) throw new Error("Filtering isolated nodes reset graph pan or zoom");
          if(screenshotDirectory) await snapshot("graph-connected-only",graph);
          kb.api.setGraphOption("sources",false);
          kb.api.setGraphOption("references",false);
          await waitGraphCount(18);
          kb.api.setGraphOption("outline",false);
          await waitGraphCount(0);
          if(graph.document.getElementById("graph-empty").hidden) throw new Error("The isolated-node filter lost the empty graph message");
          kb.api.setGraphOption("outline",true);
          kb.api.setGraphOption("references",true);
          kb.api.setGraphOption("sources",true);
          isolationControl.checked = false;
          isolationControl.dispatchEvent(new graph.Event("command",{bubbles:true}));
          await waitGraphCount(network.nodes.length);
          if(network.nodes.length!==188 || network.edges.length!==360) throw new Error("Graph filtering modified the source data");
        } finally {
          kb.api.setGraphOption("hideIsolated",false);
          kb.api.setGraphOption("outline",true);
          kb.api.setGraphOption("references",true);
          kb.api.setGraphOption("sources",true);
          await redrawGraph(originalGraphData);
          kb.api.getGraph = realGetGraph;
          kb.api.setGraphOption("sources", priorSources);
          graph.ZoteroKnowledgeBase_showGraph(rows[0].id);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await switchMode("source");
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
          if (!editor.closed || kb.api.getMarkdownSource(nativeNote.getNote()).body !== closeBody || nativeDialogs[1] !== "accept") throw new Error("Command-W did not save and close");
          const acquired = await kb.api.acquireNativeNote({ id: rows[0].id, title: "", body: "" });
          const beforeExternal = await kb.api.getZettel(rows[0].id);
          await kb.api.saveEditorDraft({ id: rows[0].id, title: "Conflict", body: "Pending source", draftId: "native-conflict", draftRevision: 1 });
          const externalHTML = await kb.api.nativeNoteHTML("Edited in Zotero", beforeExternal.body + "\\n\\nExternal note edit");
          nativeNote.setNote(externalHTML); await nativeNote.saveTx();
          try {
            await kb.api.saveEditorCard({ id: rows[0].id, noteID: nativeNote.id, title: "Conflict", body: "Pending source", sourceMode: true, expectedNoteHTML: acquired.html, expectedUpdatedAt: beforeExternal.updated_at, draftId: "native-conflict", draftRevision: 1 });
            throw new Error("Concurrent native edit was overwritten");
          } catch (error) { if (!String(error).includes("CARD_CONFLICT")) throw error; }
          if (!(await kb.api.getEditorDraft("native-conflict")) || !nativeNote.getNote().includes("External note edit") || nativeNote.getNote().includes("Pending source")) throw new Error("Conflict failed to preserve both note and draft");
          await kb.api.discardEditorDraft("native-conflict");
          await kb.api.releaseNativeNote(nativeNote.id);
          for (let n = 0; n < 80 && (await kb.api.getZettel(rows[0].id)).title !== "Edited in Zotero"; n++) await new Promise(resolve => setTimeout(resolve, 50));
          const externalCard = await kb.api.getZettel(rows[0].id);
          if (externalCard.title !== "Edited in Zotero" || externalCard.item_key !== item.key || (await kb.api.getFamily(rows[0].id)).children.length !== 1) throw new Error("Native editing did not preserve card sources and hierarchy");
          const caseSource = new Zotero.Item("book");
          caseSource.libraryID = item.libraryID;
          caseSource.setField("title", "Corner case source");
          await caseSource.saveTx({skipSelect: true});
          const caseNative = await kb.api.duplicateNativeNote(nativeNote.id, "Corner case", externalCard.body, nativeNote.getNote());
          const caseNote = await Zotero.Items.getAsync(caseNative.noteID);
          caseNote.parentItemID = caseSource.id; await caseNote.saveTx({skipSelect: true});
          const caseID = await seedMappedNote({noteID: caseNote.id, kind: "literature", itemKey: caseSource.key, libraryID: caseSource.libraryID});
          const caseCached = await kb.api.getZettel(caseID);
          caseSource.deleted = true; await caseSource.saveTx();
          await kb.api.auditNativeNotes();
          if ((await kb.api.searchZettelSummaries('', {availability:'active',cardIDs:[caseID]})).items.length || (await kb.api.searchZettelSummaries('', {availability:'deleted',cardIDs:[caseID]})).items[0]?.id !== caseID || (await kb.api.getGraph()).nodes.some(node=>node.id===caseID)) throw new Error('Deleted note leaked into the active list or graph, or lost its deleted entry');
          const sourceHealth = await kb.api.getNoteHealth(caseID);
          if (sourceHealth.source !== "trashed" || sourceHealth.note !== "trashed" || (await kb.api.getZettel(caseID)).item_key !== caseSource.key || caseNote.parentItemID !== caseSource.id) throw new Error("Trashed source detached its note or lost its association");
          let unavailableRejected = false;
          try { await kb.api.acquireNativeNote({id: caseID, title: "", body: ""}); } catch(error) { unavailableRejected = String(error).includes("NOTE_UNAVAILABLE"); }
          if (!unavailableRejected) throw new Error("Opening a trashed note created a replacement");
          await kb.api.restoreNote(caseID);
          if ((await kb.api.searchZettelSummaries('', {availability:'active',cardIDs:[caseID]})).items[0]?.id !== caseID) throw new Error('Restoring the original did not refresh its availability');
          if (caseNote.deleted || caseSource.deleted || (await kb.api.getNoteHealth(caseID)).note !== "available" || caseNote.parentItemID !== caseSource.id) throw new Error("Restore did not retain the note identity and parent");
          kb.api.openEditor({window:true,zettelId: caseID});
          let trashedEditor;
          for (let n = 0; n < 100; n++) {
            trashedEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === caseID);
            if (trashedEditor?.document.getElementById("knowledge-base-rich-frame")?.getCurrentInstance()) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          caseNote.deleted = true; await caseNote.saveTx();
          for (let n = 0; n < 100 && (!trashedEditor.document.getElementById("knowledge-base-editor-save").disabled || trashedEditor.document.getElementById("knowledge-base-editor-preview").hidden); n++) await new Promise(resolve => setTimeout(resolve, 50));
          if (!trashedEditor.document.getElementById("knowledge-base-editor-save").disabled || trashedEditor.document.getElementById("knowledge-base-editor-preview").hidden) throw new Error("Deleting an open note left its editor writable");
          if ((await kb.api.getNoteHealth(caseID)).note !== "trashed" || (await kb.api.getZettel(caseID)).body !== caseCached.body) throw new Error("Deleting a native note lost its cached content");
          kb.api.openManager({selectId:caseID});
          const trashMain = Zotero.getMainWindow();
          let trashWorkbench;
          for (let n=0; n<150; n++) {
            trashWorkbench = trashMain.document.querySelector('.knowledge-base-workbench')?.contentWindow;
            const cached = trashWorkbench?.document.getElementById('knowledge-base-workbench-editor')?.contentWindow;
            if (cached?.knowledgeBaseCardId === caseID && !cached.document.getElementById('knowledge-base-editor-preview')?.hidden) break;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          const trashNavigation = trashWorkbench.document.getElementById('knowledge-base-workbench-editor');
          if (!(await kb.api.mountEditor(trashNavigation,{zettelId:rows[0].id})) || !(await kb.api.mountEditor(trashNavigation,{zettelId:caseID}))) throw new Error('A note in Trash blocked workbench navigation');
          const trashFilter = trashWorkbench.document.getElementById('knowledge-base-kind');
          trashFilter.value = 'deleted';
          trashFilter.dispatchEvent(new trashWorkbench.Event('change',{bubbles:true}));
          for (let n=0; n<100 && !trashWorkbench.document.querySelector('.zettel-row[data-id="'+caseID+'"]'); n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (!trashWorkbench.document.querySelector('.zettel-row[data-id="'+caseID+'"]') || trashFilter.querySelector('[value="deleted"]').textContent !== kb.api.loc('manager-deleted-notes')) throw new Error('Trash filter lost the original card or localization');
          const beforeExternalRestore = caseNote.getNote();
          // Restore through Zotero only: no KB restore or explicit audit call.
          caseNote.deleted = false; await caseNote.saveTx();
          for (let n=0; n<150; n++) {
            if (trashedEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id === caseNote.id && trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id === caseNote.id && (await kb.api.searchZettelSummaries('',{availability:'active',cardIDs:[caseID]})).items.length) break;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          if (trashedEditor.document.getElementById('knowledge-base-rich-frame').hidden || trashedEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id !== caseNote.id || trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').hidden || trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id !== caseNote.id || !(await kb.api.searchZettelSummaries('',{availability:'active',cardIDs:[caseID]})).items.length || caseNote.getNote() !== beforeExternalRestore) throw new Error('Native Trash restore did not reconnect open editors to the unchanged original: ' + JSON.stringify({separateID:trashedEditor.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id,separateHidden:trashedEditor.document.getElementById('knowledge-base-rich-frame').hidden,inlineID:trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').getCurrentInstance()?._item.id,inlineHidden:trashNavigation.contentWindow.document.getElementById('knowledge-base-rich-frame').hidden,expectedID:caseNote.id,active:(await kb.api.searchZettelSummaries('',{availability:'active',cardIDs:[caseID]})).items.length,htmlChanged:caseNote.getNote()!==beforeExternalRestore,status:trashedEditor.document.getElementById('knowledge-base-editor-status').textContent,dirty:trashedEditor.eval('dirty'),recovery:trashedEditor.eval('recoveryPending'),unavailable:trashedEditor.eval('noteUnavailable')}));
          const retained = await kb.api.acquireNativeNote({id:caseID,title:caseCached.title,body:caseCached.body});
          if (retained.noteID !== caseNote.id || (await kb.api.getZettel(caseID)).item_key !== caseSource.key) throw new Error('Native restore changed card identity, note identity or source');
          await kb.api.releaseNativeNote(caseNote.id);
          // Reopening an existing workbench also reconciles changes without notifier events.
          caseNote.deleted = true; await caseNote.saveTx({skipNotifier:true});
          kb.api.openManager({selectId:caseID});
          for (let n=0; n<100 && !(await kb.api.searchZettelSummaries('',{availability:'deleted',cardIDs:[caseID]})).items.length; n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (!(await kb.api.searchZettelSummaries('',{availability:'deleted',cardIDs:[caseID]})).items.length) throw new Error('Reusing the workbench skipped the Trash audit');
          await Zotero.Items.erase(caseNote.id);
          for (let n=0; n<150 && ((await kb.api.getZettel(caseID)) || !trashedEditor.document.getElementById('knowledge-base-editor-restore').hidden); n++) await new Promise(resolve=>setTimeout(resolve,25));
          if (await kb.api.getZettel(caseID) || (await kb.api.searchZettelSummaries('',{availability:'deleted',cardIDs:[caseID]})).items.length) throw new Error('Permanent Zotero deletion left a cached recovery card');
          if (!trashedEditor.document.getElementById('knowledge-base-editor-save-copy').hidden || !trashedEditor.document.getElementById('knowledge-base-editor-restore').hidden) throw new Error('An erased original still offers cached-copy recovery');
          if (!(await kb.api.mountEditor(trashNavigation,{zettelId:rows[0].id}))) throw new Error('Permanent deletion blocked navigation to a surviving note');
          trashedEditor.close();
          trashMain.Zotero_Tabs.close(trashMain.Zotero_Tabs.selectedID);
          await Zotero.Items.erase(caseSource.id);
          closeBody = externalCard.body;
          const copy = await kb.api.duplicateNativeNote(nativeNote.id, "Copied note", closeBody);
          const copyNote = await Zotero.Items.getAsync(copy.noteID);
          const copyImage = Zotero.Items.get(copyNote.getAttachments()[0]);
          if (!copyImage || copyImage.key === migratedImage.key || !(await copyImage.fileExists())) throw new Error("Copy did not create independent native image attachments");
          const copiedCard = await kb.api.saveEditorCard({ noteID: copyNote.id, title: "Copied note", body: closeBody, sourceMode: false });
          await kb.api.releaseNativeNote(copyNote.id);
          await kb.api.deleteZettel(copiedCard.id);
          if (!copyNote.deleted || nativeNote.deleted || !(await migratedImage.fileExists())) throw new Error("Card deletion did not trash only its own note");
          nativeNote.deleted = true; await nativeNote.saveTx();
          try { await kb.api.acquireNativeNote({ id: rows[0].id, title: "", body: "" }); throw new Error("Missing note was silently replaced"); }
          catch (error) { if (!String(error).includes("NOTE_UNAVAILABLE")) throw error; }
          nativeNote.deleted = false; await nativeNote.saveTx();
          kb.api.openEditor({window:true, zettelId: rows[0].id });
          let draftEditor;
          for (let n = 0; n < 80; n++) {
            draftEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => !win.closed);
            if (draftEditor?.document.getElementById("knowledge-base-editor-root")?.dataset.mode === "visual") break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          const draftBody = draftEditor.document.getElementById("knowledge-base-editor-body");
          await draftEditor.setEditorMode("source");
          for (let n = 0; n < 80 && draftEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "source"; n++) await new Promise(resolve => setTimeout(resolve, 50));
          draftBody.value = "Keep this close draft";
          draftBody.dispatchEvent(new draftEditor.Event("input", { bubbles: true }));
          await closeShortcut(draftEditor);
          for (let n = 0; n < 80 && !draftEditor.closed; n++) await new Promise(resolve => setTimeout(resolve, 50));
          const kept = (await kb.api.listEditorDrafts()).find(draft => draft.body === "Keep this close draft");
          if (!draftEditor.closed || !kept || (await kb.api.getZettel(rows[0].id)).body !== closeBody || nativeDialogs[2] !== "extra1") throw new Error("Command-W did not preserve an uncommitted draft");
          await kb.api.discardEditorDraft(kept.draftId);
        } finally { Services.ww.unregisterNotification(observer); }
        if (choices.length) throw new Error("Native close choices were not all tested");
        const saved = await kb.api.getZettel(rows[0].id);
        await kb.api.saveEditorDraft({ id: saved.id, title: saved.title, body: "Recovered draft body", itemKey: saved.item_key, libraryID: saved.library_id, expectedUpdatedAt: saved.updated_at, draftId: "host-recovery", draftRevision: 1 });
        kb.api.openEditor({window:true, draftId: "host-recovery" });
        let recovered;
        for (let n = 0; n < 80; n++) {
          recovered = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseDraftId === "host-recovery");
          if (recovered?.document.getElementById("knowledge-base-editor-body")?.value === "Recovered draft body") break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (recovered?.document.getElementById("knowledge-base-editor-body")?.value !== "Recovered draft body") throw new Error("Draft recovery failed");
        recovered.document.getElementById("knowledge-base-editor-save").dispatchEvent(new recovered.Event("command", { bubbles: true }));
        for (let n = 0; n < 80 && (await kb.api.getZettel(saved.id)).body !== "Recovered draft body"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if ((await kb.api.getZettel(saved.id)).body !== "Recovered draft body") throw new Error("Recovered draft did not save");
        await recovered.setEditorMode("source");
        for (let n = 0; n < 80 && recovered.document.getElementById("knowledge-base-editor-body").hidden; n++) await new Promise(resolve => setTimeout(resolve, 100));
        const pendingBody = recovered.document.getElementById("knowledge-base-editor-body");
        // Simulate previously unfiled linked notes so startup must organize them.
        nativeNote.parentItemID = false; await nativeNote.saveTx();
        looseNote.parentItemID = false; await looseNote.saveTx();
        const persistedThinkingID = await seedMappedNote({noteID: thinking.id, kind: "thinking"});
        const persistedLiteratureID = await seedMappedNote({noteID: note.id, kind: "literature", itemKey: item.key, libraryID: item.libraryID});
        const restartTrashNote = new Zotero.Item('note');
        restartTrashNote.libraryID = nativeNote.libraryID;
        const restartTrashHTML = '<div data-schema-version="9"><h1>Trash across restart</h1><p>Original native content <span class="math">$x^2$</span> <a href="knowledge-base://card/' + rows[0].id + '">Linked card</a></p></div>';
        restartTrashNote.setNote(restartTrashHTML); await restartTrashNote.saveTx({skipSelect:true});
        const restartTrashID = await seedMappedNote({noteID:restartTrashNote.id,kind:'zettel'});
        restartTrashNote.deleted = true; await restartTrashNote.saveTx();
        await kb.api.auditNativeNotes();
        if (!(await kb.api.getZettel(restartTrashID)) || (await kb.api.searchZettelSummaries('',{availability:'active',cardIDs:[restartTrashID]})).items.length) throw new Error('Trash fixture lost its mapped card before restart');
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
        sectionBody.classList.add("knowledge-base-section");
        sectionBody.innerHTML = '<ul class="knowledge-base-section-list"><li>' + "A long card title with many words ".repeat(60) + '</li></ul>';
        for (const width of [280, 400]) {
          sidebar.setAttribute("width", String(width));
          await new Promise(resolve => setTimeout(resolve, 100));
          const bounds = nativeView.getBoundingClientRect();
          if (bounds.width > sidebar.getBoundingClientRect().width || nativeView.scrollWidth > nativeView.clientWidth + 1)
            throw new Error("Long card titles stretch Zotero's native info and abstract pane");
        }
        kb.api.openWorkbenchWindow({selectId:rows[0].id});
        kb.api.setWorkbenchMode("window");
        kb.api.setGraphOption("hideIsolated",true);
        await waitSeparate(rows[0].id);
        await separateEditor.setEditorMode("source");
        const quittingWorkbenchBody = separateEditor.document.getElementById("knowledge-base-editor-body");
        quittingWorkbenchBody.value += "\\n\\nIndependent pending quit edit.";
        quittingWorkbenchBody.dispatchEvent(new separateEditor.Event("input",{bubbles:true}));
        const quittingWorkbenchDraftID = separateEditor.knowledgeBaseDraftId;
        pendingBody.value = "Last keystroke before quitting";
        pendingBody.dispatchEvent(new recovered.Event("input", { bubbles: true }));
        await recovered.knowledgeBaseFlushDraft();
        // Model a process interruption between the native commit and the KB commit.
        // All writes below belong to this disposable profile.
        const journalCard = await kb.api.getZettel(unsourced.id);
        const intendedHTML = await kb.api.nativeNoteHTML(journalCard.title, "Interrupted host save");
        const journalInput = { id: journalCard.id, title: journalCard.title, body: "Interrupted host save", kind: journalCard.kind, customKey: journalCard.custom_key, itemKey: journalCard.item_key, libraryID: journalCard.library_id, parentId: (await kb.api.getFamily(journalCard.id)).parent?.id || null, noteID: looseNote.id, expectedNoteHTML: looseNote.getNote(), expectedUpdatedAt: journalCard.updated_at, sourceMode: true, sourceDocument: kb.api.getMarkdownDocument(intendedHTML), draftId: "host-interrupted-save", draftRevision: 1 };
        const journalOperation = { id: looseNote.libraryID + ":" + looseNote.key, noteKey: looseNote.key, libraryID: looseNote.libraryID, expectedHTML: looseNote.getNote(), intendedHTML, expectedVersion: journalCard.updated_at, input: journalInput };
        const panelWidths = { manager: kb.api.getPanelWidth("manager"), graph: kb.api.getPanelWidth("graph") };
        const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
        const journalConnection = await Sqlite.openConnection({path: PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base.sqlite")});
        try {
          await journalConnection.executeTransaction(async () => {
            await journalConnection.execute("INSERT INTO note_save_operations(id, card_id, data, created_at) VALUES (?, ?, ?, ?)", [journalOperation.id, journalCard.id, JSON.stringify(journalOperation), Date.now()]);
            await journalConnection.execute("INSERT INTO editor_drafts(id, body, data, revision, updated_at) VALUES (?, ?, ?, 1, ?)", [journalInput.draftId, journalInput.body, JSON.stringify(journalInput), Date.now()]);
          });
          kb.hooks.onAppShutdown();
          looseNote.setNote(intendedHTML); await looseNote.saveTx();
          const journalRows = await journalConnection.execute("SELECT body FROM zettels WHERE id = ?", [journalCard.id]);
          if (journalRows[0].getResultByName("body") === "Interrupted host save") throw new Error("Interrupted-save fixture committed metadata prematurely");
        } finally { await journalConnection.close(); }
        await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ cards: 5, quittingWorkbenchDraftID, restartTrashID, restartTrashKey: restartTrashNote.key, restartTrashHTML, keyedThinkingID: unsourced.id, panelWidths, nativeMarkdownKey: nativeMarkdownNote.key, unmanagedKey: unmanaged.key, thinkingID: persistedThinkingID, literatureID: persistedLiteratureID, thinkingKey: thinking.key, thinkingHTML: originalThinking, cardID: rows[0].id, noteKey: nativeNote.key, looseNoteKey: looseNote.key, personalParentKey: personalParent.key, markdownSaveMs, legacyImage: imageURL.slice("knowledge-base-asset:".length), iconsVisible, identitiesVisible, mathVisible, sourcesHidden, graphControlsVisible, nativeStyleUntouched, compactConnections, nativeDialogs, systemDark, quitting: Date.now() }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        } catch (error) {
          await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error), stack: error.stack }));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
        }
      }, 1500);
    } catch (error) {
      await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error), stack: error.stack }));
      Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
    }
  }
  setTimeout(run, 250);
}
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
  { stdio: ["ignore", log.fd, log.fd] },
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
        () => reject(new Error("Zotero did not exit within 90 seconds")),
        90000,
      );
    }),
  ]);
  const state = JSON.parse(await readFile(marker, "utf8"));
  if (
    state.error ||
    result.code !== 0 ||
    state.cards !== 5 ||
    !state.iconsVisible ||
    !state.identitiesVisible ||
    !state.mathVisible ||
    !state.sourcesHidden ||
    !state.graphControlsVisible ||
    !state.nativeStyleUntouched ||
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
      db.prepare("SELECT COUNT(*) AS n FROM note_save_operations").get().n !== 1
    )
      throw new Error("Interrupted-save journal did not survive shutdown");
  } finally {
    db.close();
  }
  clearTimeout(timeout);
  const restarted = spawn(
    binary,
    ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
    { stdio: ["ignore", log.fd, log.fd] },
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
      code !== 0 ||
      restored.cards !== 5 ||
      restored.noteKey !== state.noteKey
    )
      throw new Error("Restart validation failed");
  } finally {
    clearTimeout(restartTimeout);
    if (restarted.exitCode === null) restarted.kill("SIGKILL");
  }
  console.log(
    `PASS Native Markdown on ordinary Zotero notes, in-place autosave, conflict detection, native close dialogs and restart drafts; untagged personal parent with retained user tags and colors; Native Zotero note editor (${state.systemDark ? "dark" : "light"} host); native note autosave, Markdown math migration and citation metadata; three note types, unique Literature Notes, retained native-note fixtures without copying, retained ownership and placement across restart; stable card references, author-year citations and note links; native Command-W save/cancel/draft choices; native/Markdown editing with real cursor insertion/replacement and autosave (${state.markdownSaveMs} ms), protected images, citations and external-edit conflicts; editable Thinking keys with retained aliases, restricted Literature type, original native style, native Settings CSL selection and real-time bibliography updates; a Zotero Tab workbench with native in-place editing, independent new Note IDs, navigation and session cleanup; single-row connection navigation with visible zero counts, native Tab child navigation, uniform More menu rows, Source labels, top-toolbar note actions, proportionate image previews, native toolbar Markdown icon toggle, force graph with connection-sized hubs, hover neighborhoods, compact title labels with full tooltips and live Settings, body-only Reading views that preserve drafts and toolbars, all-match search, node dragging and Escape clearing; fractional panel drags, cancellation, bounds and persisted widths across restart, and graph-local relationship controls, a persistent native isolated-node filter with relationship-aware filtering, empty states and unchanged graph data; native Trash restoration in open editors and after restart, stable note/card mappings, permanent-deletion cleanup without cached copies, automatic source/personal-parent placement, compact connections and recovery drafts; native multiword tag rendering and updates, live native-parent and card-ancestor tag inheritance without note writes, configurable tag/color groups with priority and legend, group settings retained across restart, title-first relationship labels, hashtags retained as ordinary text; native sidebar text containment; real Zotero quit (${result.time - state.quitting} ms); saved database and linked notes survive restart.`,
  );
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
