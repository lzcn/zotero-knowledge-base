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
      if (!Zotero.getMainWindow()?.document.getElementById("knowledge-base-menu-open-manager")) {
        setTimeout(run, 250);
        return;
      }
      if (await IOUtils.exists(${JSON.stringify(marker)})) {
        const first = JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)}));
        const cards = await kb.api.listZettels();
        const card = cards.find(row => row.id === first.cardID);
        if (cards.length !== 4 || card?.body !== "Recovered draft body" || (await kb.api.getFamily(card.id)).children.length !== 1) throw new Error("Restart lost saved card content or hierarchy");
        const organizedNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.noteKey);
        const organizedLoose = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.looseNoteKey);
        const organizedCollection = await Zotero.Collections.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.collectionKey);
        await Zotero.Items.loadDataTypes([organizedLoose], ["collections"]);
        if (!organizedNote.parentItemID || organizedLoose.parentItemID || !organizedLoose.inCollection(organizedCollection.id)) throw new Error("Startup did not organize existing linked notes");
        const projectCard = await kb.api.getZettel(first.thinkingID);
        const readingCard = await kb.api.getZettel(first.literatureID);
        const projectNote = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, first.thinkingKey);
        if (projectCard?.kind !== "thinking" || projectCard.item_key || readingCard?.kind !== "literature" || projectNote.parentItemID !== organizedNote.parentItemID || projectNote.getNote() !== first.thinkingHTML) throw new Error("Restart changed an adopted note's type, content or placement");
        const linked = await kb.api.acquireNativeNote({ id: card.id, title: card.title, body: card.body });
        const restoredNote = await Zotero.Items.getAsync(linked.noteID);
        if (!restoredNote.parentItemID || restoredNote.key !== first.noteKey || !restoredNote.getNote().includes("Recovered draft body")) throw new Error("Restart duplicated or lost the linked note");
        await kb.api.releaseNativeNote(linked.noteID);
        if (!(await kb.api.listEditorDrafts()).some(draft => draft.body === "Last keystroke before quitting")) throw new Error("Restart lost the recovery draft");
        if (!(await IOUtils.exists(PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base", "assets", first.legacyImage)))) throw new Error("Migration cleanup removed the original backup image");
        await IOUtils.writeUTF8(${JSON.stringify(restartMarker)}, JSON.stringify({ cards: cards.length, noteKey: restoredNote.key }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        return;
      }
      const item = new Zotero.Item("book");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Isolated test source");
      item.setField("date", "2026");
      item.setCreators([{ firstName: "A", lastName: "Smith", creatorType: "author" }]);
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
      const thinking = new Zotero.Item("note");
      thinking.libraryID = item.libraryID;
      thinking.parentItemID = item.id;
      thinking.setNote('<div data-schema-version="9"><h1>Existing project</h1><p>[[]] Original thinking</p></div>');
      thinking.setTags([{tag: "#Ideas"}]);
      await thinking.saveTx({skipSelect: true});
      const originalThinking = thinking.getNote();
      const thinkingID = await kb.api.registerExistingNote({noteID: thinking.id, kind: "thinking"});
      const sameThinkingID = await kb.api.registerExistingNote({noteID: thinking.id, kind: "thinking"});
      if (thinkingID !== sameThinkingID || thinking.getNote() !== originalThinking || thinking.parentItemID !== item.id || thinking.getTags()[0]?.tag !== "#Ideas") throw new Error("Registering an existing note copied or changed it");
      const acquiredThinking = await kb.api.acquireNativeNote({id: thinkingID, title: "", body: ""});
      if (acquiredThinking.noteID !== thinking.id || thinking.parentItemID !== item.id) throw new Error("Existing project note identity or placement changed on open");
      await kb.api.releaseNativeNote(thinking.id);
      const literatureID = await kb.api.registerExistingNote({noteID: note.id, kind: "literature", itemKey: item.key, libraryID: item.libraryID});
      let duplicateLiteratureRejected = false;
      try { await kb.api.registerExistingNote({noteID: thinking.id, kind: "literature", itemKey: item.key, libraryID: item.libraryID}); } catch (error) { duplicateLiteratureRejected = String(error).includes("LITERATURE_EXISTS"); }
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
      if (literatureEditor.document.getElementById("knowledge-base-kind").value !== "literature" || literatureEditor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item.id !== note.id) throw new Error("Literature UI did not reuse the adopted native note");
      literatureEditor.document.getElementById("knowledge-base-editor-format").dispatchEvent(new literatureEditor.Event("command", {bubbles: true}));
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "source"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      const literatureBody = literatureEditor.document.getElementById("knowledge-base-editor-body");
      literatureBody.value += "\\n\\nLiterature synthesis";
      literatureBody.dispatchEvent(new literatureEditor.Event("input", {bubbles: true}));
      if (!(await literatureEditor.save(false)) || (note.getNote().match(/Linked Zotero note/g) || []).length !== 1) throw new Error("Markdown editing duplicated an existing note's title paragraph");
      literatureEditor.document.getElementById("knowledge-base-editor-format").dispatchEvent(new literatureEditor.Event("command", {bubbles: true}));
      for (let n = 0; n < 100 && literatureEditor.document.getElementById("knowledge-base-editor-root").dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 50));
      const metadataBox = literatureEditor.document.getElementById("knowledge-base-metadata");
      if (metadataBox.hidden || !metadataBox.textContent.includes("Host2026")) throw new Error("Literature Note metadata is missing");
      item.setField("publisher", "Live metadata publisher");
      await item.saveTx();
      for (let n = 0; n < 100 && !metadataBox.textContent.includes("Live metadata publisher"); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!metadataBox.textContent.includes("Live metadata publisher") || note.getNote().includes("Live metadata publisher")) throw new Error("Metadata did not align live without rewriting the note body");
      const metadataShots = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
      if (metadataShots) {
        metadataBox.open = true;
        await IOUtils.makeDirectory(metadataShots, {ignoreExisting: true});
        const image = await literatureEditor.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = literatureEditor.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        await IOUtils.write(PathUtils.join(metadataShots, "literature-metadata.png"), new Uint8Array(await blob.arrayBuffer()));
      }
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
        const modeMenu = editor.document.getElementById("knowledge-base-editor-mode");
        const rootElement = editor.document.getElementById("knowledge-base-editor-root");
        for (let n = 0; n < 80 && rootElement.dataset.mode !== "visual"; n++) await new Promise(resolve => setTimeout(resolve, 100));
        if (rootElement.dataset.mode !== "visual") throw new Error("The editor did not start in visual mode");
        if (modeMenu.localName !== "button" || modeMenu.querySelectorAll("menuitem").length || !modeMenu.label) throw new Error("Native browse/edit toggle is missing");
        async function switchMode(mode) {
          if (mode === "source" || (rootElement.dataset.mode === "source" && mode === "visual")) {
            if (rootElement.dataset.mode !== mode) editor.document.getElementById("knowledge-base-editor-format").dispatchEvent(new editor.Event("command", {bubbles: true}));
          } else if (rootElement.dataset.mode === "source") await editor.setEditorMode(mode);
          else if (rootElement.dataset.mode !== mode) modeMenu.dispatchEvent(new editor.Event("command", { bubbles: true }));
          for (let n = 0; n < 80 && rootElement.dataset.mode !== mode; n++) await new Promise(resolve => setTimeout(resolve, 100));
          const surfaces = [body, editor.document.getElementById("knowledge-base-editor-preview"), editor.document.getElementById("knowledge-base-rich-frame")];
          if (rootElement.dataset.mode !== mode || surfaces.filter(surface => !surface.hidden).length !== 1) throw new Error("Editor mode is not a single surface: " + mode);
        }
        const migratedNote = editor.document.getElementById("knowledge-base-rich-frame").getCurrentInstance()._item;
        if (migratedNote.parentItemID !== item.id) throw new Error("Sourced note was not filed under its source");
        if (Zotero.getActiveZoteroPane().getSelectedItems().some(selected => selected.id === migratedNote.id)) throw new Error("Native note creation changed the library selection");
        editor.document.getElementById("knowledge-base-src-clear").dispatchEvent(new editor.Event("command", { bubbles: true }));
        let defaultCollection;
        for (let n = 0; n < 160; n++) {
          defaultCollection = Zotero.Collections.getByLibrary(item.libraryID).find(entry => entry.name === "Knowledge Base");
          if (!(await kb.api.getZettel(rows[0].id)).item_key && !migratedNote.parentItemID && defaultCollection && migratedNote.inCollection(defaultCollection.id) && editor.document.getElementById("knowledge-base-editor-status").textContent === kb.api.loc("editor-saved")) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (migratedNote.parentItemID || !defaultCollection || !migratedNote.inCollection(defaultCollection.id)) throw new Error("The clear-source control did not organize the note");
        editor.document.getElementById("knowledge-base-src-pick").dispatchEvent(new editor.Event("command", { bubbles: true }));
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
        if (migratedNote.parentItemID !== item.id || item.inCollection(defaultCollection.id)) throw new Error("The source picker did not reparent the existing note cleanly");

        const unsourced = (await kb.api.listZettels()).find(card => card.id !== rows[0].id);
        const loose = await kb.api.acquireNativeNote({ id: unsourced.id, title: unsourced.title, body: unsourced.body });
        const looseNote = await Zotero.Items.getAsync(loose.noteID);
        const collection = Zotero.Collections.getByLibrary(item.libraryID).find(entry => entry.name === "Knowledge Base");
        if (!collection || looseNote.parentItemID || !looseNote.inCollection(collection.id)) throw new Error("Unsourced note was not filed into Knowledge Base");
        const updatePlacement = async (source) => {
          const current = await kb.api.getZettel(unsourced.id);
          await kb.api.saveEditorCard({ id: current.id, noteID: looseNote.id, title: current.title, body: current.body, sourceMode: false, expectedUpdatedAt: current.updated_at, parentId: rows[0].id, itemKey: source?.key || null, libraryID: source?.libraryID || null });
        };
        await updatePlacement(item);
        if (looseNote.parentItemID !== item.id || item.inCollection(collection.id)) throw new Error("Changing source moved the source item into the note collection");
        await updatePlacement(null);
        if (looseNote.parentItemID || !looseNote.inCollection(collection.id)) throw new Error("Clearing source did not return the same note to its collection");
        await updatePlacement(note);
        if (looseNote.parentItemID || !looseNote.inCollection(collection.id)) throw new Error("Standalone note source was used as an invalid parent");
        note.parentItemID = item.id; await note.saveTx();
        await updatePlacement(note);
        if (looseNote.parentItemID !== item.id) throw new Error("An attached source note did not use its regular parent");
        await updatePlacement(null);
        note.parentItemID = false; await note.saveTx();
        collection.name = "Renamed idea notes"; await collection.saveTx();
        await kb.api.releaseNativeNote(looseNote.id);
        const again = await kb.api.acquireNativeNote({ id: unsourced.id, title: unsourced.title, body: unsourced.body });
        if (again.noteID !== looseNote.id || !looseNote.inCollection(collection.id) || Zotero.Collections.getByLibrary(item.libraryID).some(entry => entry.name === "Knowledge Base")) throw new Error("Reopening duplicated the note or renamed collection");
        await kb.api.releaseNativeNote(looseNote.id);

        for (let n = 0; n < 100 && !migratedNote.getAttachments().length; n++) await new Promise(resolve => setTimeout(resolve, 100));
        const migratedImage = Zotero.Items.get(migratedNote.getAttachments()[0]);
        if (!migratedImage || !(await migratedImage.fileExists())) throw new Error("Legacy image was not imported into Zotero note attachments");
        if (migratedNote.getAttachments().length !== 1) throw new Error("Two native editors imported duplicate migration images");
        const clearIcon = editor.document.querySelector("#knowledge-base-src-clear .toolbarbutton-icon");
        if (clearIcon?.getBoundingClientRect().width !== 16 || clearIcon.getBoundingClientRect().height !== 16) throw new Error("Native remove-source icon is missing");
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
        for (let n = 0; n < 80 && !(await kb.api.getZettel(rows[0].id)).body.includes("From reading to an idea"); n++) await new Promise(resolve => setTimeout(resolve, 100));
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
        for (let n = 0; n < 80 && !manager.document.getElementById("knowledge-base-detail-id").textContent.endsWith(childID); n++) await new Promise(resolve => setTimeout(resolve, 50));
        if (!manager.document.getElementById("knowledge-base-detail-id").textContent.endsWith(childID)) throw new Error("Native card hyperlink did not navigate");
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
        await switchMode("reading");
        if (noteElement.mode !== "view" || !noteElement.getCurrentInstance()._readOnly) throw new Error("Native reading view is editable");
        await switchMode("source");
        if (!body.value.includes("[@Host2026]") || !body.value.includes("[My note](zotero://")) throw new Error("Source projection lost references");
        const protectedSource = kb.api.getMarkdownSource(nativeNote.getNote());
        if (!body.value.includes("knowledge-base://fragment/") || !protectedSource.fragments.some(fragment => fragment.includes(migratedImage.key)) || !protectedSource.fragments.some(fragment => fragment.includes("locator%22%3A%2223"))) throw new Error("Source projection lost protected image/citation metadata");
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
        if (!noteElement.getCurrentInstance()._readOnly) throw new Error("Hidden native editor can still write during Markdown editing");
        nativeNote.setNote(fragmentCheck); await nativeNote.saveTx();
        body.value = sourceBeforeConflict;
        if (!(await editor.save(false))) throw new Error("Conflict did not resolve after restoring the original baseline");
        await switchMode("visual");
        const listHandle = manager.document.getElementById("knowledge-base-splitter");
        const originalWidth = manager.document.getElementById("knowledge-base-list-pane").getBoundingClientRect().width;
        listHandle.dispatchEvent(new manager.KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
        if (!(manager.document.getElementById("knowledge-base-list-pane").getBoundingClientRect().width > originalWidth) || kb.api.getPanelWidth("manager") !== 30) throw new Error("List panel did not resize and persist");
        const transformBeforeResize = graph.document.querySelector("#graph-svg > g")?.getAttribute("transform");
        graph.document.getElementById("graph-splitter").dispatchEvent(new graph.KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
        if (kb.api.getPanelWidth("graph") !== 28 || transformBeforeResize !== graph.document.querySelector("#graph-svg > g")?.getAttribute("transform")) throw new Error("Graph resizing changed its viewport or failed to persist");
        const editorRelations = editor.document.getElementById("knowledge-base-editor-relations");
        editorRelations.open = true;
        const compactConnections = editorRelations.getBoundingClientRect().height <= 141;
        const systemDark = editor.matchMedia("(prefers-color-scheme: dark)").matches;
        const nativeFrame = noteElement.getCurrentInstance()._iframeWindow;
        const whiteSurfaces = nativeFrame.getComputedStyle(nativeFrame.document.body).backgroundColor === "rgb(255, 255, 255)";
        const rgb = nativeFrame.getComputedStyle(nativeFrame.document.querySelector(".primary-editor")).color.match(/[0-9.]+/g).slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        const readableText = 1.05 / (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05) >= 4.5;
        const screenshotDirectory = ${JSON.stringify(process.env.KB_HOST_SCREENSHOTS || "")};
        async function snapshot(name, win) {
          const image = await win.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
          const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          await IOUtils.write(PathUtils.join(screenshotDirectory, name + ".png"), new Uint8Array(await blob.arrayBuffer()));
        }
        if (screenshotDirectory) {
          await IOUtils.makeDirectory(screenshotDirectory, { ignoreExisting: true });
          await snapshot("manager", manager);
          await snapshot("graph", graph);
          await snapshot("native-editor", editor);
          await switchMode("reading"); await snapshot("reading", editor);

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
          const caseID = await kb.api.registerExistingNote({noteID: caseNote.id, kind: "literature", itemKey: caseSource.key, libraryID: caseSource.libraryID});
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
          if (!recovered || recovered.body !== caseCached.body || !(await kb.api.getZettel(caseID))) throw new Error("Saving cached content failed to preserve both records");
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
        looseNote.removeFromCollection(collection.id); await looseNote.saveTx();
        const persistedThinkingID = await kb.api.registerExistingNote({noteID: thinking.id, kind: "thinking"});
        const persistedLiteratureID = await kb.api.registerExistingNote({noteID: note.id, kind: "literature", itemKey: item.key, libraryID: item.libraryID});
        if (thinking.getNote() !== originalThinking || thinking.parentItemID !== item.id) throw new Error("Adoption changed the original project before restart");
        pendingBody.value = "Last keystroke before quitting";
        pendingBody.dispatchEvent(new recovered.Event("input", { bubbles: true }));
        await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ cards: 4, thinkingID: persistedThinkingID, literatureID: persistedLiteratureID, thinkingKey: thinking.key, thinkingHTML: originalThinking, cardID: rows[0].id, noteKey: nativeNote.key, looseNoteKey: looseNote.key, collectionKey: collection.key, legacyImage: imageURL.slice("knowledge-base-asset:".length), iconsVisible, identitiesVisible, mathVisible, sourcesHidden, graphControlsVisible, whiteSurfaces, readableText, compactConnections, nativeDialogs, systemDark, quitting: Date.now() }));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        } catch (error) {
          await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error), stack: error.stack }));
          Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
        }
      }, 1500);
    } catch (error) {
      await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ error: String(error) }));
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
    !state.whiteSurfaces ||
    !state.readableText ||
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
    `PASS Native Zotero note editor (${state.systemDark ? "dark" : "light"} host); native note autosave, Markdown math migration and citation metadata; three note types, unique Literature Notes, existing-note registration without copying, retained ownership and placement across restart; stable card references, author-year citations and note links; native Command-W save/cancel/draft choices; native/Markdown editing with protected images, citations and external-edit conflicts; live source metadata, resizable panels and graph-local relationship controls; deleted-note recovery without replacement, automatic source/collection placement, compact connections and recovery drafts; real Zotero quit (${result.time - state.quitting} ms); saved database and linked notes survive restart.`,
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
