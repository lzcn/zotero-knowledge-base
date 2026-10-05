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
        const cards = await kb.api.listZettels();
        const card = cards.find(row => row.id === first.cardID);
        if (cards.length !== 4 || card?.body !== "Recovered draft body" || (await kb.api.getFamily(card.id)).children.length !== 1) throw new Error("Restart lost saved card content or hierarchy");
        const keyedThinking = await kb.api.getZettel(first.keyedThinkingID);
        if (keyedThinking?.kind !== "thinking" || keyedThinking.custom_key !== "HostProjectRevised" || keyedThinking.reference !== "HostProjectRevised" || (await kb.api.resolveCardLink("knowledge-base://card/HostProject")).targetId !== first.keyedThinkingID) throw new Error("Restart lost Thinking keys or old links");
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
        if (!(await IOUtils.exists(PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base", "assets", first.legacyImage)))) throw new Error("Migration cleanup removed the original backup image");
        const nativeMarkdownNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.nativeMarkdownKey);
        if (!nativeMarkdownNote.getNote().includes('External edit preserved') || nativeMarkdownNote.getNote().includes('Conflicting native draft')) throw new Error("Quit overwrote a conflicting native note");
        const resumedInstance = await Zotero.Notes.open(nativeMarkdownNote.id, null, {openInWindow:true});
        const resumedWin = resumedInstance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
        for (let n = 0; n < 100 && !resumedWin.document.querySelector('.knowledge-base-native-markdown'); n++) await new Promise(resolve => setTimeout(resolve, 50));
        await openMarkdownToolbar(resumedInstance._iframeWindow);
        const resumedSource = resumedWin.document.querySelector('.knowledge-base-native-source');
        for (let n = 0; n < 100 && resumedSource.hidden; n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (!resumedSource.value.includes('Conflicting native draft')) throw new Error("Restart lost native Markdown recovery draft");
        kb.api.openManager({ selectId: card.id });
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
        await IOUtils.writeUTF8(${JSON.stringify(restartMarker)}, JSON.stringify({ cards: cards.length, noteKey: restoredNote.key }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        return;
      }
      if ((await kb.api.listZettels()).length) throw new Error("Fresh install contains preloaded user cards");
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
      nativeMarkdownNote.setNote('<div data-schema-version="9"><h1>Native Markdown</h1><p style="color: rgb(34,34,34); background-color: white">Ordinary <strong>text</strong></p><pre class="math">$$e=mc^2$$</pre></div>');
      await nativeMarkdownNote.saveTx({skipSelect: true});
      async function openNativeMarkdown() {
        const nativeInstance = await Zotero.Notes.open(nativeMarkdownNote.id, null, {openInWindow: true});
        const nativeWindow = nativeInstance._iframeWindow.browsingContext.embedderElement.ownerDocument.defaultView;
        for (let n = 0; n < 100 && !nativeWindow.document.querySelector('.knowledge-base-native-markdown'); n++) await new Promise(resolve => setTimeout(resolve, 50));
        const source = nativeWindow.document.querySelector('.knowledge-base-native-source');
        if (!source) throw new Error("Native note Markdown switch was not attached");
        if (!nativeWindow.document.querySelector('.knowledge-base-native-markdown').hidden) throw new Error('Markdown adds a redundant toolbar in native mode');
        await openMarkdownToolbar(nativeInstance._iframeWindow);
        const toggle = nativeInstance._iframeWindow.document.querySelector('.knowledge-base-markdown-toggle');
        for (let n = 0; n < 100 && source.hidden; n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (source.hidden || !nativeInstance._disableSaving || nativeInstance._iframeWindow.browsingContext.embedderElement.hidden || toggle.getAttribute("aria-pressed") !== "true") throw new Error("Native Markdown did not disable the hidden host writer");
        return {nativeInstance, nativeWindow, source, toggle};
      }
      let nativeMD = await openNativeMarkdown();
      if (!nativeMD.source.value.startsWith('# Native Markdown') || !nativeMD.source.value.includes('Ordinary **text**') || !nativeMD.source.value.includes('e=mc^2') || nativeMD.source.value.includes('style=')) throw new Error("Native Markdown remains opaque for ordinary content");
      const beforeNativeSwitch = nativeMarkdownNote.getNote();
      nativeMD.toggle.click();
      for (let n = 0; n < 100 && !nativeMD.source.hidden; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMD.source.hidden || nativeMarkdownNote.getNote() !== beforeNativeSwitch) throw new Error("Unchanged native Markdown switch rewrote the note: " + JSON.stringify({hidden:nativeMD.source.hidden, before:beforeNativeSwitch, after:nativeMarkdownNote.getNote(), status:nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent}));
      nativeMD.toggle.click();
      for (let n = 0; n < 100 && nativeMD.source.hidden; n++) await new Promise(resolve => setTimeout(resolve, 50));
      nativeMD.source.value += "\\n\\nNative Markdown saved **in place**";
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.Event('input'));
      for (let n = 0; n < 100 && !nativeMarkdownNote.getNote().includes('in place'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMarkdownNote.getNote().includes('<strong>in place</strong>') || nativeMarkdownNote.parentItemID !== item.id || !nativeMarkdownNote.hasTag('Native Markdown test') || (nativeMarkdownNote.getNote().match(/<h1/g) || []).length !== 1 || (await kb.api.listZettels()).length) throw new Error("Native Markdown changed identity/placement or silently imported a note");
      for (let n = 0; n < 100 && nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status').textContent !== kb.api.loc('editor-saved'); n++) await new Promise(resolve => setTimeout(resolve, 50));
      nativeMarkdownNote.setNote(nativeMarkdownNote.getNote().replace('in place', 'External edit preserved'));
      await nativeMarkdownNote.saveTx();
      nativeMD.source.value += "\\n\\nConflicting native draft";
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.Event('input'));
      nativeMD.source.dispatchEvent(new nativeMD.nativeWindow.KeyboardEvent('keydown', {key:'s', metaKey:true, bubbles:true, cancelable:true}));
      const nativeStatus = nativeMD.nativeWindow.document.querySelector('.knowledge-base-native-status');
      for (let n = 0; n < 100 && !nativeStatus.textContent.includes(kb.api.loc('native-markdown-conflict')); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!nativeMarkdownNote.getNote().includes('External edit preserved') || nativeMarkdownNote.getNote().includes('Conflicting native draft') || nativeStatus.textContent !== kb.api.loc('native-markdown-conflict')) throw new Error("Native Markdown overwrote an external change: " + JSON.stringify({html: nativeMarkdownNote.getNote(), status:nativeStatus.outerHTML, alive:nativeMD.source.isConnected, draft:await kb.api.getEditorDraft("native-document:" + nativeMarkdownNote.libraryID + ":" + nativeMarkdownNote.key)}));
      let nativeCloseAsked = 0;
      const nativeChoices = ['cancel', 'extra1'];
      const nativeCloseObserver = {observe(win, topic) {
        if (topic !== 'domwindowopened') return;
        win.addEventListener('load', () => {
          if (win.document.documentURI !== 'chrome://global/content/commonDialog.xhtml') return;
          setTimeout(() => {
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
        if (nativeMD.nativeWindow.closed || nativeCloseAsked !== 1) throw new Error("Native Markdown Command-W cancellation failed");
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
      const metadataShots = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
      if (metadataShots) {
        await IOUtils.makeDirectory(metadataShots, {ignoreExisting: true});
        const image = await literatureEditor.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = literatureEditor.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        await IOUtils.write(PathUtils.join(metadataShots, "literature-editor.png"), new Uint8Array(await blob.arrayBuffer()));
      }
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
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
      const imageURL = await kb.api.importImage([...atob(png)].map(char => char.charCodeAt(0)), "image/png", "host-migration");
      await kb.api.saveZettel({ title: "Shutdown test", body: "Inline $E = mc^2$.\\n\\n![Migration image](" + imageURL + ")", itemKey: item.key, libraryID: item.libraryID });
      const rows = await kb.api.listZettels();
      await kb.api.saveZettel({ title: "Child card", body: "[[" + rows[0].id + "]]", parentId: rows[0].id });
      kb.api.openManager({ selectId: rows[0].id });
      kb.api.openEditor({ zettelId: rows[0].id });
      kb.api.openGraph({ centerId: rows[0].id });
      setTimeout(async () => {
        try {
        const manager = [...Services.wm.getEnumerator("knowledge-base:manager")][0];
        const graph = [...Services.wm.getEnumerator("knowledge-base:graph")][0];
        const buttons = [...manager.document.querySelectorAll(".kb-native-tool"), ...graph.document.querySelectorAll(".kb-native-tool")];
        const iconsVisible = buttons.every(button => {
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
        if (sourceBox.querySelector(".source-item-label")?.textContent !== kb.api.loc("manager-source-item") || !sourceBox.querySelector(".source-item-icon")) throw new Error("Source is not identified as a Zotero item");
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
        preview.append(probe); await probe.decode();
        const imageBounds = probe.getBoundingClientRect();
        if (imageBounds.width >= 800 || imageBounds.width > preview.clientWidth || Math.abs(imageBounds.height * 4 - imageBounds.width) > 1) throw new Error("Wide preview image stretched instead of shrinking proportionally");
        probe.width = 120; probe.height = 400;
        const smallBounds = probe.getBoundingClientRect();
        if (Math.abs(smallBounds.width - 120) > 1 || Math.abs(smallBounds.height - 30) > 1) throw new Error("Stored image height distorted a small preview image");
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
        const controls = [...graph.document.querySelectorAll("#graph-outline,#graph-references,#graph-sources")];
        const graphControlsVisible = controls.length === 3 && controls.every(control => control.label && control.getBoundingClientRect().width > 0);
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
        kb.api.openEditor({zettelId: unsourced.id});
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
        const taggedCard = await kb.api.getZettel(unsourced.id);
        looseNote.addTag("Manual tag"); await looseNote.saveTx();
        await kb.api.saveEditorCard({id: taggedCard.id, noteID:looseNote.id, title:"A long child note title about understanding relationships between ideas and navigating a knowledge base without squeezing text into a narrow sidebar", body:"#tag-a #tag-b #中文 \`#ignored\`", sourceMode:true, expectedNoteHTML:looseNote.getNote(), expectedUpdatedAt:taggedCard.updated_at, parentId:null});
        await Zotero.Tags.setColor(item.libraryID, "tag-a", "#3478f6", 0);
        const taggedGraphNode = (await kb.api.getGraph()).nodes.find(node => node.id === unsourced.id);
        if (!looseNote.hasTag("tag-a") || !looseNote.hasTag("tag-b") || !looseNote.hasTag("中文") || !looseNote.hasTag("Manual tag") || looseNote.hasTag("ignored") || taggedGraphNode.tags.slice(0,3).join(",") !== "tag-a,tag-b,中文" || !taggedGraphNode.tags.includes("Manual tag") || taggedGraphNode.color !== "#3478f6") throw new Error("Inline tags or Zotero graph colors did not persist");
        const personalParent = await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID, Zotero.Prefs.get("extensions.zotero.knowledge-base.notes.parent." + item.libraryID, true));
        if (personalParent.getTags().length || Zotero.Tags.getColors(item.libraryID).has("Personal Knowledge")) throw new Error("Personal parent was automatically tagged");
        personalParent.addTag("User marker"); await personalParent.saveTx();
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
        for (let n = 0; n < 80 && manager.document.querySelector("#knowledge-base-list .active")?.dataset.id !== childID; n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (manager.document.querySelector("#knowledge-base-list .active")?.dataset.id !== childID) throw new Error("Native card hyperlink did not navigate");
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
        const changeBounds = changeButton.getBoundingClientRect();
        if (!changeButton.querySelector("svg") || !changeButton.getAttribute("aria-label") || changeBounds.width < 24 || changeBounds.height < 10 || changeBounds.right > editor.innerWidth) throw new Error("Source Change button is not visibly laid out: " + JSON.stringify({text:changeButton.textContent, bounds:changeBounds.toJSON(), style:editor.getComputedStyle(changeButton).cssText, display:editor.getComputedStyle(changeButton).display}));
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
        nativeNote.setNote(nativeNote.getNote().replace("Protected fragment round trip", "Better Notes external change"));
        await nativeNote.saveTx();
        body.value += "\\n\\nUnsaved Markdown conflict";
        body.dispatchEvent(new editor.Event("input", {bubbles: true}));
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
        if (editorRelations.open || editorRelations.contains(editor.document.getElementById("knowledge-base-parent-display"))) throw new Error("Connections are expanded by default or duplicate Parent");
        editorRelations.open = true;
        const compactConnections = editorRelations.getBoundingClientRect().width >= 200 && editor.getComputedStyle(editor.document.getElementById("knowledge-base-editor-content")).flexDirection === "column" && editor.getComputedStyle(editorRelations.querySelector(".editor-connections")).flexDirection === "column" && !editorRelations.querySelector("section");
        const sourceReference = editor.document.getElementById("knowledge-base-src-display").textContent;
        if (!sourceReference.includes("Smith 2026") || !sourceReference.includes("Journal of Test Studies") || sourceReference.includes("10.1000/host-test") || editor.document.getElementById("knowledge-base-parent-root")) throw new Error("Source/Parent metadata is not a concise reference");
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
            const range=win.document.createRange(); range.selectNodeContents(title);
            const firstLine=range.getClientRects()[0];
            if (win.getComputedStyle(key).display !== "inline" || win.getComputedStyle(title).display !== "inline" || (text.getBoundingClientRect().width > 350 && firstLine && Math.abs(key.getBoundingClientRect().top-firstLine.top)>4)) throw new Error("A note reference still splits key and title: " + JSON.stringify({url:win.location.href, text:text.textContent, keyDisplay:win.getComputedStyle(key).display, titleDisplay:win.getComputedStyle(title).display, keyTop:key.getBoundingClientRect().top, titleTop:firstLine?.top, width:text.getBoundingClientRect().width}));
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
          for (let i = 0; i < 10; i++) {
            const id = "network-" + topic + "-" + i;
            network.nodes.push({id, title:(i === 0 ? "Survey · " : "") + topics[topic] + "：研究问题、证据与思考 " + i, kind:"card", noteKind:i === 0 ? "thinking" : i === 1 ? "literature" : "zettel", snippet:"# " + topics[topic] + "\\n\\nA connected research note."});
            network.edges.push({source:id, target:sourceID, kind:"source", ref:sourceID, context:""});
            if (i) network.edges.push({source:"network-" + topic + "-0", target:id, kind:i < 3 ? "parent" : "link", ref:id, context:""});
          }
          if (topic) network.edges.push({source:"network-0-0", target:"network-" + topic + "-0", kind:"link", ref:"", context:""});
        }
        async function redrawGraph(data) {
          kb.api.getGraph = async () => data;
          graph.document.getElementById("graph-refresh").click();
          for (let n = 0; n < 100 && graph.document.querySelectorAll(".graph-node").length !== data.nodes.length; n++) await new Promise(resolve => setTimeout(resolve, 25));
          if (graph.document.querySelectorAll(".graph-node").length !== data.nodes.length || graph.document.getElementById("graph-error").textContent) throw new Error("Host network rendering failed: " + graph.document.querySelectorAll(".graph-node").length + "/" + data.nodes.length + " " + graph.document.getElementById("graph-error").textContent);
          graph.document.getElementById("graph-fit").click();
        }
        try {
          await redrawGraph(network);
          if (graph.getComputedStyle(graph.document.getElementById("graph-canvas")).backgroundImage !== "none") throw new Error("Graph still has a distracting background grid");
          const circles = [...graph.document.querySelectorAll(".graph-node circle")].map(circle => Number(circle.getAttribute("r")));
          if (!(Math.max(...circles) > Math.min(...circles))) throw new Error("Network hubs do not have larger nodes");
          if ([...graph.document.querySelectorAll(".graph-node")].some(node => /NaN|Infinity/.test(node.getAttribute("transform")))) throw new Error("Network coordinates are invalid");
          if (screenshotDirectory) await snapshot("graph-network", graph);
          const search = graph.document.getElementById("graph-search");
          search.value = "Survey"; search.dispatchEvent(new graph.Event("input"));
          if (graph.document.querySelectorAll(".graph-node.highlighted").length !== 6) throw new Error("Graph search does not highlight all matching notes");
          search.value = ""; search.dispatchEvent(new graph.Event("input"));
          const node = [...graph.document.querySelectorAll(".graph-node")].find(node => node.getAttribute("aria-label").startsWith("Survey"));
          node.dispatchEvent(new graph.PointerEvent("pointerenter"));
          if (node.querySelector("text").textContent !== node.getAttribute("aria-label") || !graph.document.querySelector(".graph-edge.highlighted")) throw new Error("Hover did not reveal the full title and its connections");
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
        } finally {
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
          const sourceHealth = await kb.api.getNoteHealth(caseID);
          if (sourceHealth.source !== "trashed" || sourceHealth.note !== "trashed" || (await kb.api.getZettel(caseID)).item_key !== caseSource.key || caseNote.parentItemID !== caseSource.id) throw new Error("Trashed source detached its note or lost its association");
          let unavailableRejected = false;
          try { await kb.api.acquireNativeNote({id: caseID, title: "", body: ""}); } catch(error) { unavailableRejected = String(error).includes("NOTE_UNAVAILABLE"); }
          if (!unavailableRejected) throw new Error("Opening a trashed note created a replacement");
          await kb.api.restoreNote(caseID);
          if (caseNote.deleted || caseSource.deleted || (await kb.api.getNoteHealth(caseID)).note !== "available" || caseNote.parentItemID !== caseSource.id) throw new Error("Restore did not retain the note identity and parent");
          kb.api.openEditor({zettelId: caseID});
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
          trashedEditor.document.getElementById("knowledge-base-editor-restore").dispatchEvent(new trashedEditor.Event("command", {bubbles: true}));
          for (let n = 0; n < 100 && (trashedEditor.document.getElementById("knowledge-base-rich-frame").hidden || !trashedEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()); n++) await new Promise(resolve => setTimeout(resolve, 50));
          if (trashedEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()?._item.id !== caseNote.id) throw new Error("Restoring an open note changed its identity or failed to reopen editing");
          trashedEditor.close();
          await kb.api.releaseNativeNote(caseNote.id);
          await Zotero.Items.erase(caseNote.id);
          if ((await kb.api.getNoteHealth(caseID)).note !== "missing" || !(await kb.api.getZettel(caseID))) throw new Error("Permanent deletion removed the Knowledge Base cache");
          kb.api.openEditor({zettelId: caseID});
          let missingEditor;
          for (let n = 0; n < 100; n++) {
            missingEditor = [...Services.wm.getEnumerator("knowledge-base:editor")].find(win => win.knowledgeBaseCardId === caseID);
            if (missingEditor && !missingEditor.document.getElementById("knowledge-base-editor-preview")?.hidden && missingEditor.document.getElementById("knowledge-base-editor-save")?.disabled) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (!missingEditor || missingEditor.document.getElementById("knowledge-base-editor-preview").hidden || missingEditor.document.getElementById("knowledge-base-editor-save-copy").hidden) throw new Error("Missing note recovery UI is unavailable");
          missingEditor.document.getElementById("knowledge-base-editor-save-copy").dispatchEvent(new missingEditor.Event("command", {bubbles: true}));
          for (let n = 0; n < 100 && !missingEditor.closed; n++) await new Promise(resolve => setTimeout(resolve, 50));
          const recovered = (await kb.api.listZettels()).find(card => card.id !== caseID && card.title === caseCached.title && card.kind === "zettel" && card.item_key === caseSource.key);
          if (!recovered || recovered.body !== caseCached.body || !(await kb.api.getZettel(caseID))) throw new Error("Saving cached content failed to preserve both records: " + JSON.stringify({ cached: caseCached, recovered, current: await kb.api.listZettels() }));
          for (const win of Services.wm.getEnumerator("knowledge-base:editor")) if (win.knowledgeBaseCardId === recovered.id) win.close();
          await kb.api.deleteZettel(recovered.id);
          await kb.api.deleteZettel(caseID);
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
          kb.api.openEditor({ zettelId: rows[0].id });
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
        kb.api.openEditor({ draftId: "host-recovery" });
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
        pendingBody.value = "Last keystroke before quitting";
        pendingBody.dispatchEvent(new recovered.Event("input", { bubbles: true }));
        await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ cards: 4, keyedThinkingID: unsourced.id, panelWidths: { manager: kb.api.getPanelWidth("manager"), graph: kb.api.getPanelWidth("graph") }, nativeMarkdownKey: nativeMarkdownNote.key, unmanagedKey: unmanaged.key, thinkingID: persistedThinkingID, literatureID: persistedLiteratureID, thinkingKey: thinking.key, thinkingHTML: originalThinking, cardID: rows[0].id, noteKey: nativeNote.key, looseNoteKey: looseNote.key, personalParentKey: personalParent.key, markdownSaveMs, legacyImage: imageURL.slice("knowledge-base-asset:".length), iconsVisible, identitiesVisible, mathVisible, sourcesHidden, graphControlsVisible, nativeStyleUntouched, compactConnections, nativeDialogs, systemDark, quitting: Date.now() }));
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
    state.cards !== 4 ||
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
      db.prepare("SELECT count(*) AS n FROM zettels").get().n !== 4
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
      restored.cards !== 4 ||
      restored.noteKey !== state.noteKey
    )
      throw new Error("Restart validation failed");
  } finally {
    clearTimeout(restartTimeout);
    if (restarted.exitCode === null) restarted.kill("SIGKILL");
  }
  console.log(
    `PASS Native Markdown on ordinary Zotero notes, in-place autosave, conflict detection, native close dialogs and restart drafts; untagged personal parent with retained user tags and colors; Native Zotero note editor (${state.systemDark ? "dark" : "light"} host); native note autosave, Markdown math migration and citation metadata; three note types, unique Literature Notes, retained native-note fixtures without copying, retained ownership and placement across restart; stable card references, author-year citations and note links; native Command-W save/cancel/draft choices; native/Markdown editing with real cursor insertion/replacement and autosave (${state.markdownSaveMs} ms), protected images, citations and external-edit conflicts; editable Thinking keys with retained aliases, restricted Literature type, original native style, Source/Parent reference rows and pencil pickers, vertical connections, Source item markers, top-toolbar note actions, proportionate image previews, native toolbar Markdown icon toggle, force graph with connection-sized hubs, hover neighborhoods, full-title labels, all-match search, node dragging and Escape clearing; fractional panel drags, cancellation, bounds and persisted widths across restart, and graph-local relationship controls; deleted-note recovery without replacement, automatic source/personal-parent placement, compact connections and recovery drafts; native sidebar text containment; real Zotero quit (${result.time - state.quitting} ms); saved database and linked notes survive restart.`,
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
