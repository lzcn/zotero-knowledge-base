// Test the packaged plugin against an isolated Zotero profile and database.
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
import { join } from "node:path";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import process from "node:process";
import { URL } from "node:url";
import { Script } from "node:vm";
import { setTimeout, clearTimeout } from "node:timers";

const root = await mkdtemp(join(tmpdir(), "similar-works-host-"));
const profile = join(root, "profile");
const dataDirectory = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(dataDirectory);
const prefs = {
  "intl.locale.requested": process.env.SW_HOST_LOCALE || "en-US",
  "extensions.zotero.dataDir": dataDirectory,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.zotero.automaticScraperUpdates": false,
  "extensions.zotero.similar-works.backgroundStartupDelayMs": process.env
    .KNOWLEDGE_BASE_STARTUP_PROBE
    ? 60000
    : 0,
  "extensions.zotero.similar-works.tagNameStyle": "sentence",
  "extensions.zotero.similar-works.maxRecommendations": 15,
  "app.update.auto": false,
  "extensions.update.enabled": false,
};
if (process.env.SW_HOST_COLOR_SCHEME) {
  prefs["ui.systemUsesDarkTheme"] =
    process.env.SW_HOST_COLOR_SCHEME === "dark" ? 1 : 0;
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
const files = unzipSync(
  await readFile(new URL("../dist/zotero-knowledge-base.xpi", import.meta.url)),
);
files["content/library/scripts/runtime.js"] = strToU8(
  strFromU8(files["content/library/scripts/runtime.js"]).replace(
    "let stopped = false;",
    "Zotero.KnowledgeBaseTestLibraryScope = scope;\n  let stopped = false;",
  ),
);
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]) +
    `
var SWOriginalStartup = startup;
startup = async function(data) {
  await Zotero.initializationPromise;
  let runtimeDownloads = 0;
  const hasRuntimeCache = ${Boolean(process.env.SW_HOST_RUNTIME_DIR)};
  const request = Zotero.HTTP.request;
  const runtimeURL = "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-osx-universal2-1.22.0.tgz";
  Zotero.HTTP.request = function(method, url, options) {
    if (url === runtimeURL) runtimeDownloads++;
    return request.call(this, method, url, options);
  };
  if (${JSON.stringify(process.env.SW_HOST_NATIVE_MODEL_DIR || "")}) {
    const source = ${JSON.stringify(process.env.SW_HOST_NATIVE_MODEL_DIR || "")};
    const target = PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base", "models", "minilm-l6-v2");
    await IOUtils.makeDirectory(target, { createAncestors:true, ignoreExisting:true });
    for (const name of ["model.onnx", "tokenizer.json", "tokenizer_config.json", "config.json", "special_tokens_map.json", "coreml-cache"]) {
      if (await IOUtils.exists(PathUtils.join(source, name)))
        await IOUtils.copy(PathUtils.join(source, name), PathUtils.join(target, name), {recursive:true});
    }
  }
  if (${JSON.stringify(process.env.SW_HOST_RUNTIME_DIR || "")}) {
    const source = ${JSON.stringify(process.env.SW_HOST_RUNTIME_DIR || "")};
    const target = PathUtils.join(Zotero.DataDirectory.dir, "knowledge-base", "runtime", "onnx");
    await IOUtils.makeDirectory(target, {createAncestors:true, ignoreExisting:true});
    for (const name of ["inference", "libonnxruntime.1.22.0.dylib"])
      await IOUtils.copy(PathUtils.join(source,name), PathUtils.join(target,name));
  }
  await SWOriginalStartup(data);
  const SWScope = Zotero.KnowledgeBaseTestLibraryScope;
  const SWReady = Zotero.ZoteroKnowledgeBase.api.getLibraryState() === "ready";
  setTimeout(async () => {
    const result = {};
    try {
      if (${Boolean(process.env.KNOWLEDGE_BASE_STARTUP_PROBE)}) {
        const indexer = SWScope.SWIndexer;
        if (!indexer._startupPending || indexer.corpus._ready || SWScope.SWSemantic._native) throw new Error("Startup eagerly loaded retrieval resources: "+JSON.stringify({pending:indexer._startupPending,opened:!!indexer.corpus._ready,native:!!SWScope.SWSemantic._native}));
        const doc = Zotero.getMainWindow().document;
        const source = new Zotero.Item("journalArticle"); source.setField("title", "Lazy startup fixture"); await source.saveTx();
        const id = await Zotero.ZoteroKnowledgeBase.api.saveZettel({title:"Immediate note", body:"Notes stay available while retrieval waits.", itemKey:source.key, libraryID:source.libraryID});
        await Zotero.getActiveZoteroPane().selectItem(source.id);
        let section;
        for (let n=0;n<200;n++) {
          section = [...doc.querySelectorAll("item-pane-custom-section")].find(el=>el.dataset.pane?.includes("knowledge-base-zettel-section"));
          if(section?.querySelector(".knowledge-base-section-list li")) break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        if (!section?.querySelector(".knowledge-base-section-list li")) throw new Error("Notes did not appear before retrieval");
        const panel=section.querySelector(".knowledge-base-similar-body");
        if(!panel.hidden || indexer.corpus._ready || SWScope.SWSemantic._native)throw new Error("Automatic sidebar rendering bypassed lazy startup");
        const started=Date.now();
        section.querySelector('button[data-view="similar"]').click();
        for(let n=0;n<100 && (indexer._startupPending || !indexer.corpus._ready);n++)await new Promise(resolve=>setTimeout(resolve,10));
        if(indexer._startupPending || !indexer.corpus._ready)throw new Error("Explicit activation did not prioritize retrieval");
        result.foregroundWakeMs=Date.now()-started;
        if(result.foregroundWakeMs>1000)throw new Error("Explicit retrieval waited for the startup timer");
        await Zotero.ZoteroKnowledgeBase.hooks.onShutdown();
        if(indexer._startupTimer || indexer._startupIdleCancel || indexer.corpus._db)throw new Error("Shutdown leaked scheduled work or storage");
        if(await Zotero.Items.getByLibraryAndKeyAsync(source.libraryID,source.key)===false || !id)throw new Error("Startup probe lost native data");
        result.ok=true;
        await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify(result));
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        return;
      }
      if (!SWReady || !SWScope.SWSection._registered) throw new Error("Sidebar did not register");
      await SWScope.SWIndexer.corpus.ready;
      if (SWScope.SWLLM || SWScope.SWCodex) throw new Error("Generative AI runtime was loaded");
      await SWScope.SWSemantic.start(SWScope.SWIndexer.corpus);
      const registered = SWScope.SWSection._registered;
      await Zotero.ZoteroKnowledgeBase.hooks.onStartup();
      if (SWScope.SWSection._registered !== registered) throw new Error("Duplicate registration");
      const doc = Zotero.getMainWindow().document;
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
          if(!native && text && !control.matches('.sw-row')) {
            const line=parseFloat(view.getComputedStyle(control).lineHeight);
            if(Number.isFinite(line) && control.clientHeight+2<line)throw new Error('Control is shorter than its text: '+control.id+': '+text);
          }
        }
      };
      const checkSharedStyle = (view, surface) => {
        const root = view.document.documentElement;
        const originalAttribute = root.hasAttribute('data-plugin-bear');
        const originalPreference = Zotero.Prefs.get('extensions.zotero.plugin-ui.bear', true);
        try {
          for (const bear of [true, false]) {
            Zotero.Prefs.set('extensions.zotero.plugin-ui.bear', bear, true);
            root.toggleAttribute('data-plugin-bear', bear);
            const style = view.getComputedStyle(surface);
            const dark = view.matchMedia('(prefers-color-scheme: dark)').matches;
            const accent = bear ? (dark ? '#d58e97' : '#aa5962') : (dark ? '#9dbdf0' : '#3768ad');
            if (style.getPropertyValue('--ui-accent').trim() !== accent || style.fontFamily.includes('Avenir Next')) throw new Error('Task controls do not follow the shared palette and system typography');
          }
        } finally {
          root.toggleAttribute('data-plugin-bear', originalAttribute);
          if (originalPreference === undefined) Zotero.Prefs.clear('extensions.zotero.plugin-ui.bear', true);
          else Zotero.Prefs.set('extensions.zotero.plugin-ui.bear', originalPreference, true);
        }
      };
      const capture = async (name, window) => {
        if (name.startsWith('sidebar')) {
          const pane = [...window.document.querySelectorAll('item-pane-custom-section')].find(el => el.dataset.pane?.includes('knowledge-base-zettel-section'));
          if (pane) {
            pane.querySelector('collapsible-section').open = true;
            await pane.closest('item-details').scrollToPane(SWScope.SWSection._registered, 'instant');
            await new Promise(resolve => setTimeout(resolve,100));
          }
        }
        for(const root of window.document.querySelectorAll('.plugin-preferences, #tag-manager, .sw-list'))auditUI(window,root);
        const folder = ${JSON.stringify(process.env.SW_HOST_SCREENSHOTS || "")};
        if (!folder) return;
        await IOUtils.makeDirectory(folder, {ignoreExisting:true});
        const image = await window.browsingContext.currentWindowGlobal.drawSnapshot(undefined,1,"white");
        const canvas = window.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
        canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);image.close();
        const blob=await new Promise(resolve=>canvas.toBlob(resolve));
        await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));
      };
      if (doc.querySelectorAll("#similar-works-style").length !== 1) throw new Error("Duplicate stylesheet");
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Deep Learning: " + "A long source title with several words ".repeat(6));
      item.setField("abstractNote", "An abstract that must wrap inside the native sidebar. ".repeat(30));
      await item.saveTx({skipSelect: true});
      await Zotero.getActiveZoteroPane().selectItem(item.id);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const sidebar = doc.getElementById("zotero-item-pane");
      const view = doc.getElementById("zotero-view-item");
      const section = [...doc.querySelectorAll("item-pane-custom-section")].find(el => el.dataset.pane?.includes("knowledge-base-zettel-section"));
      if (!section) throw new Error("Native sidebar section is missing");
      section.querySelector("collapsible-section").open = true;
      if (section.querySelectorAll('[role="tab"]').length !== 3 || section.querySelector('.knowledge-base-similar-body').hidden !== true) throw new Error("Sidebar did not default to Notes with three views");
      await capture('sidebar-notes',doc.defaultView);
      section.querySelector('button[data-view="similar"]').click();
      const ownSections=[...sidebar.querySelectorAll("item-pane-custom-section")].filter(el=>el.dataset.pane?.includes("knowledge-base-zettel-section") || el.dataset.pane?.includes("similar-works-similar"));
      if(ownSections.length!==1)throw new Error("Knowledge Base has duplicate sidebar entries: "+JSON.stringify(ownSections.map(el=>el.dataset.pane)));
      SWScope.SWSection.ensureSkeleton(section.querySelector(".knowledge-base-similar-body"));
      const list = section.querySelector(".sw-list");
      const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      row.className = "sw-row";
      row.innerHTML = '<span class="sw-rank">1</span><div class="sw-main"><div class="sw-title">'
        + "A-long-title-without-spaces".repeat(30) + '</div><div class="sw-meta">'
        + "A long author name ".repeat(60) + '</div></div><div class="sw-side"><span class="sw-num">99%</span></div>';
      list.replaceChildren(row);
      for (const width of [280, 400]) {
        sidebar.setAttribute("width", String(width));
        await new Promise(resolve => setTimeout(resolve, 100));
        const bounds = view.getBoundingClientRect();
        if (bounds.width > sidebar.getBoundingClientRect().width || view.scrollWidth > view.clientWidth + 1 || row.getBoundingClientRect().right > bounds.right)
          throw new Error("Long recommendation text stretches Zotero's native info and abstract pane");
      }
      list.replaceChildren();
      const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      doc.documentElement.appendChild(body);
      SWScope.SWSection.ensureSkeleton(body);
      await doc.l10n.translateFragment(body);
      if (!body.querySelector("progress").getAttribute("aria-label")) throw new Error("Missing localized progress label");
      body.remove();
      const testTagWindows = [];
      const waitFor = async (predicate, step, attempts = 100) => {
        for (let n = 0; n < attempts; n++) {
          const value = await predicate();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error("Tag UI did not finish loading: " + step + " " + JSON.stringify(testTagWindows.filter(win=>!win.closed).map(win=>({mode:win.document.getElementById("mode")?.value,target:win.document.getElementById("target")?.value,preview:win.document.getElementById("preview")?.textContent,checked:[...win.document.querySelectorAll("#tags input")].filter(input=>input.checked).map(input=>input.value)}))));
      };
      const tagAPI = SWScope.SWTags;
      const tagMenu = doc.getElementById("similar-works-organize-tags");
      if (!tagMenu) throw new Error("Missing tag menu");
      await doc.l10n.translateElements([tagMenu]);
      if (tagMenu.label !== ${JSON.stringify(process.env.SW_HOST_LOCALE === "zh-CN" ? "标签管理" : "Tag Manager")}) throw new Error("Unexpected tag menu label: " + tagMenu.label);
      if (!tagMenu.classList.contains("menuitem-iconic")) throw new Error("Tag menu icon slot missing");
      const tagIcon = new doc.defaultView.Image();
      await new Promise((resolve, reject) => {
        tagIcon.onload = resolve;
        tagIcon.onerror = () => reject(new Error("Tag menu icon failed to load"));
        tagIcon.src = tagMenu.getAttribute("image");
      });
      if (tagIcon.naturalWidth !== 16 || tagIcon.naturalHeight !== 16) throw new Error("Unexpected tag icon dimensions");
      const peers = [];
      for (const name of ["Deep Learning", "deep-learning"]) {
        const peer = new Zotero.Item("journalArticle");
        peer.libraryID = item.libraryID;
        peer.setField("title", "Deep Learning for representation learning");
        peer.addTag(name, name === "deep-learning" ? 1 : 0);
        peer.addTag("Unrelated neighbor topic");
        await peer.saveTx({skipSelect:true});
        peers.push(peer);
      }
      const taggedNote = new Zotero.Item("note");
      taggedNote.parentItemID = item.id;
      taggedNote.setNote("<p>A note to retain during tag merge</p>");
      taggedNote.addTag("deep-learning");
      await taggedNote.saveTx({skipSelect:true});
      const noteBeforeMerge = taggedNote.getNote();
      section.querySelector('button[data-view="tags"]').click();
      await waitFor(() => section.querySelector(".knowledge-base-manage-tags"), "current item tags");
      if (section.querySelector(".sw-tags")) throw new Error("Suggestions remain in the sidebar");
      item.addTag("Deep Learning");
      await item.saveTx({skipSelect:true});
      await waitFor(() => section.querySelector(".knowledge-base-item-tags li")?.textContent === "Deep Learning", "tag change refresh");
      section.querySelector(".knowledge-base-manage-tags").click();
      await waitFor(() => [...tagAPI._dialogs].some(win => !win.closed), "sidebar Tag Manager");
      for (const win of tagAPI._dialogs) win.close();
      await capture("sidebar-tags",doc.defaultView);
      section.querySelector('button[data-view="similar"]').click();
      await Zotero.DB.executeTransaction(async () => {
        await Zotero.Tags.setColor(item.libraryID, "Deep Learning", "#336699", 0);
        await Zotero.Tags.setColor(item.libraryID, "deep-learning", "#993333", 1);
      });
      if ((await tagAPI.catalog(item.libraryID,true)).some(name=>tagAPI.words(name).join(" ").toLowerCase() === "deep learning")) throw new Error("Colored tags appeared in management");
      for (const [sources,destination] of [[["deep-learning"],"Topic"],[["Graph Neural Networks"],"Deep Learning"]]) {
        try {
          await tagAPI.merge(item.libraryID,sources,destination);
          throw new Error("Colored tag could be changed or used as a destination");
        } catch (error) { if (error.message !== "similar-works-tags-protected") throw error; }
      }
      if (!peers[1].hasTag("deep-learning") || Zotero.Tags.getColor(item.libraryID,"Deep Learning").color !== "#336699") throw new Error("Protected tag data changed");
      Zotero.Prefs.set("extensions.zotero.similar-works.excludeColoredTags",false,true);
      for (let index = 0; index < 125; index++) {
        peers[0].addTag("Fixture Tag " + index);
        peers[1].addTag("Fixture Tag " + index);
      }
      await peers[0].saveTx({skipSelect:true});
      await peers[1].saveTx({skipSelect:true});
      const checkActionControl = (win, value) => {
        const control=win.document.getElementById('mode');
        const rect=control.getBoundingClientRect();
        const footer=control.closest('footer').getBoundingClientRect();
        if(control.localName!=='menulist' || control.getAttribute('native')!=='true' || control.value!==value || !control.selectedItem?.getAttribute('label'))throw new Error('The native action picker lost its selection or localized label');
        if(rect.width<140 || rect.height<22 || rect.right>footer.right+1 || rect.bottom>footer.bottom+1)throw new Error('Tag action picker is clipped: '+JSON.stringify({rect:rect.toJSON(),footer:footer.toJSON()}));
        const arrow=control.shadowRoot?.querySelector('dropmarker') || control.querySelector('dropmarker');
        if(arrow && arrow.getBoundingClientRect().right>rect.right+1)throw new Error('Tag action arrow extends outside its control');
      };
      const chooseAction=async(win,value)=>{
        const control=win.document.getElementById('mode');
        const popup=control.querySelector('menupopup');
        win.focus();control.scrollIntoView({block:"nearest"});control.focus();
        await new Promise(resolve => setTimeout(resolve,100));
        control.open=true;
        await waitFor(()=>popup.state==='open','open action picker');
        popup.activateItem(popup.querySelector('[value="'+value+'"]'));
        await waitFor(()=>control.value===value && popup.state==='closed','select native action');
        checkActionControl(win,value);
      };
      const managedTagCount = (await tagAPI.catalog(item.libraryID, true)).length;
      const tagDialog = tagAPI.open(doc.defaultView, item.libraryID);
      await waitFor(() => tagDialog.document?.querySelectorAll('#tags input').length === managedTagCount, 'load all tag dialog rows');
      await tagDialog.document.l10n.ready;
      testTagWindows.push(tagDialog);
      const td = tagDialog.document;
      await waitFor(() => tagDialog.getComputedStyle(td.getElementById('sort-name')).backgroundColor==='rgba(0, 0, 0, 0)', 'flat sortable headings');
      if (td.querySelector('.tag').getBoundingClientRect().height<30 || td.getElementById('sort-name').getBoundingClientRect().height<28) throw new Error('Tag rows or sorting labels are cramped');
      checkActionControl(tagDialog,'merge');
      await capture('tag-manager',tagDialog);
      checkSharedStyle(tagDialog, td.getElementById('tag-manager'));
      for (const name of ["Deep Learning", "deep-learning"]) {
        const input = [...td.querySelectorAll('#tags input')].find(input => input.value === name);
        if (input?.closest('tr').querySelector('.tag-count')?.textContent.trim() !== "2") throw new Error("Tag usage count did not include native note/manual/automatic membership: " + name);
      }
      td.getElementById('sort-count').click();
      await waitFor(() => td.querySelectorAll('#tags input').length === managedTagCount, 'sort count rows');
      const sortedCounts = [...td.querySelectorAll('.tag-count')].map(cell => Number(cell.textContent.replaceAll(',', '')));
      if (sortedCounts.some((count, i) => i && count > sortedCounts[i-1])) throw new Error("Count sorting failed");
      td.getElementById('sort-name').click();
      await waitFor(() => td.querySelectorAll('#tags input').length === managedTagCount, 'sort name rows');
      if (td.getElementById('duplicates').checked) throw new Error("Tag Manager did not default to all tags");
      td.getElementById('search').value = "deep";
      td.getElementById('refresh').click();
      await waitFor(() => td.querySelectorAll('#tags input').length === 2 && [...td.querySelectorAll('#tags input')].every(input => ["Deep Learning", "deep-learning"].includes(input.value)), 'load manual merge candidates');
      if (td.getElementById('ai-open') || td.getElementById('ai')) throw new Error("AI action remains visible");
      const firstTag = td.querySelector('#tags input');
      firstTag.click();
      await waitFor(() => !td.getElementById('clear-selection').disabled, 'enable clear selection');
      await capture('tag-manager-selected',tagDialog);
      if (!td.getElementById('merge').disabled) throw new Error("Merge accepted a single tag");
      const selectedName = firstTag.value;
      td.getElementById('sort-name').click();
      await waitFor(() => td.querySelectorAll('#tags input').length === 2, 'reverse name sort');
      if (![...td.querySelectorAll('#tags input')].some(input => input.value === selectedName && input.checked)) throw new Error("Sorting lost selection");
      td.getElementById('search').value = "no-matching-tag";
      td.getElementById('search').dispatchEvent(new tagDialog.Event('input', {bubbles:true}));
      await waitFor(() => !td.querySelectorAll('#tags input').length, 'filter selected tag out');
      await td.l10n.translateElements([td.getElementById('selection-count')]);
      const selectionArgs = JSON.parse(td.getElementById('selection-count').getAttribute('data-l10n-args'));
      if (selectionArgs.hidden !== 1 || selectionArgs.selected !== 1 || selectionArgs.visible !== 0) throw new Error("Hidden selection count is incorrect");
      td.getElementById('clear-selection').click();
      await waitFor(() => td.getElementById('clear-selection').disabled && td.getElementById('merge').disabled, 'clear filtered selections');
      td.getElementById('search').value = "deep";
      td.getElementById('search').dispatchEvent(new tagDialog.Event('input', {bubbles:true}));
      await waitFor(() => td.querySelectorAll('#tags input').length === 2, 'restore manual candidates');
      await chooseAction(tagDialog,"merge");
      await waitFor(() => td.querySelectorAll('#tags input').length >= 2, 'render merge action');
      for (const checkbox of td.querySelectorAll('#tags input')) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new tagDialog.Event("change", {bubbles:true}));
      }
      await waitFor(() => !td.getElementById('merge').disabled, 'preview merge');
      td.getElementById('target').value = "Deep Learning";
      if (!(await tagAPI.preview(item.libraryID, ["Deep Learning", "deep-learning"]) === 4)) throw new Error("Merge preview did not count all distinct items");
      const rowsBeforeMerge = [...td.querySelectorAll('#tags input')];
      td.getElementById('merge').click();
      if (rowsBeforeMerge.some((row, index) => row !== td.querySelectorAll('#tags input')[index] || !row.disabled) || !td.getElementById('clear-selection').disabled) throw new Error('Starting a tag operation rebuilt the list or left selection unlocked');
      await waitFor(() => peers[1].hasTag("Deep Learning") && !peers[1].hasTag("deep-learning"), "apply merge");
      await waitFor(() => !td.getElementById('refresh').disabled, 'merge result');
      await waitFor(() => td.querySelector('.tag-count')?.textContent.trim() === "4", 'refresh merged usage count');
      if (tagDialog.closed || !taggedNote.hasTag("Deep Learning") || taggedNote.getNote() !== noteBeforeMerge || Zotero.Tags.getColor(item.libraryID, "Deep Learning").color !== "#336699") throw new Error("Merge changed note content, target color or closed results");
      Zotero.Prefs.set("extensions.zotero.similar-works.excludeColoredTags",true,true);
      peers[1].addTag("Representation learning");
      peers[1].addTag("representation-learning");
      await peers[1].saveTx({skipSelect:true});
      td.getElementById('duplicates').checked = true;
      td.getElementById('search').value = "";
      td.getElementById('refresh').click();
      await waitFor(() => [...td.querySelectorAll('#tags input')].some(input => input.value === "representation-learning"), 'name variant candidates');
      const duplicateNames = [...td.querySelectorAll('#tags input')].map(input => input.value);
      if (!duplicateNames.includes("Representation learning") || duplicateNames.includes("Deep Learning") || !peers[1].hasTag("representation-learning")) throw new Error("Duplicate filtering changed tags or included protected names");
      peers[1].removeTag("Representation learning");
      peers[1].removeTag("representation-learning");
      await peers[1].saveTx({skipSelect:true});
      td.getElementById('duplicates').checked = false;
      peers[0].addTag("Graph Neural Networks");
      await peers[0].saveTx({skipSelect:true});
      const topic = new Zotero.Item("journalArticle");
      topic.libraryID = item.libraryID;
      topic.setField("title", "Graph Neural Networks for molecule prediction");
      topic.setField("abstractNote", "Graph Neural Networks improve molecule prediction. We evaluate molecule prediction.");
      await topic.saveTx({skipSelect:true});
      const suggestions = await tagAPI.suggest(topic, []);
      if (!suggestions.some(tag => tag.name === "Graph Neural Networks")) throw new Error("Existing supported tag is missing");

      const diffusionPaper = new Zotero.Item("journalArticle");
      diffusionPaper.libraryID = item.libraryID;
      diffusionPaper.setField("title", "Unsupervised diffusion solver for combinatorial optimization via combinatorial adjoint matching");
      diffusionPaper.setField("abstractNote", "We train discrete diffusion models for combinatorial optimization without labelled solutions. Combinatorial adjoint matching propagates optimization signals along trajectories of continuous-time Markov chains.");
      await diffusionPaper.saveTx({skipSelect:true});
      const diffusionNeighbor = new Zotero.Item("journalArticle");
      diffusionNeighbor.libraryID = item.libraryID;
      diffusionNeighbor.setField("title", "Diffusion models for image synthesis and personalized marketing");
      diffusionNeighbor.setField("abstractNote", "Discrete diffusion models also support combinatorial optimization through Markov chains.");
      const unsupportedTopics = ["#Image Synthesis", "#Personalized Marketing", "#Recommender Systems Systems", "#Stable Diffusion", "#Denoising Diffusion Probabilistic Models", "#Constraint Satisfaction", "#Probabilistic Reasoning"];
      for (const name of ["#Optimization", "#Combinatorial Optimization", "#Diffusion Model", "#Continuous-Time Markov Chains", ...unsupportedTopics]) diffusionNeighbor.addTag(name);
      await diffusionNeighbor.saveTx({skipSelect:true});
      await SWScope.SWIndexer.ensureNow(diffusionNeighbor);
      const fulltextAttachment = new Zotero.Item("attachment");
      fulltextAttachment.libraryID = item.libraryID;
      fulltextAttachment.parentItemID = diffusionPaper.id;
      fulltextAttachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
      fulltextAttachment.attachmentContentType = "application/pdf";
      fulltextAttachment.attachmentPath = "storage:paper.pdf";
      fulltextAttachment.setField("title", "Cached full text fixture");
      await fulltextAttachment.saveTx({skipSelect:true});
      const textPath = Zotero.Fulltext.getItemCacheFile(fulltextAttachment).path;
      await IOUtils.makeDirectory(PathUtils.parent(textPath), {ignoreExisting:true});
      await IOUtils.writeUTF8(textPath,
        "Stochastic control describes the optimization of discrete trajectories.\\n" +
        "We connect stochastic control with unsupervised combinatorial optimization.\\n" +
        "The stochastic control objective guides the diffusion solver.\\n" +
        "References\\nPersonalized marketing. Personalized marketing. Personalized marketing.");
      await SWScope.SWIndexer.ensureNow(diffusionPaper);
      await Zotero.getActiveZoteroPane().selectItem(diffusionPaper.id);
      const liveTagBody = section.querySelector('.knowledge-base-similar-body');
      section.querySelector('button[data-view="similar"]').click();
      const diffusionProps = {body:liveTagBody,item:diffusionPaper,tabType:"library"};
      await SWScope.SWSection.renderBody(diffusionProps,true);
      if (liveTagBody.querySelector('.sw-tags') || /Preparing recommendations/.test(liveTagBody.textContent)) throw new Error("Sidebar still shows suggestions or preparation prose");
      doc.defaultView.resizeTo(1100,800);
      section.querySelector('collapsible-section').open=true;
      await section.closest('item-details').scrollToPane(SWScope.SWSection._registered,"instant");
      await capture('sidebar',doc.defaultView);
      const pageMatches = [];
      for (let i=0; i<40; i++) {
        const paper = new Zotero.Item("journalArticle");
        paper.libraryID = item.libraryID;
        paper.setField("title", "Combinatorial optimization with discrete solvers " + i);
        await paper.saveTx({skipSelect:true});
        pageMatches.push({key:SWScope.SWIndexer.docKey(paper),score:0.8,weak:true});
      }
      const initialCount = Zotero.Prefs.get("similar-works.maxRecommendations");
      Zotero.Prefs.set("similar-works.maxRecommendations",20);
      pageMatches.push({key:"1/WEAKTAIL",score:0.01,weak:true});
      const pageToken = liveTagBody._swToken;
      liveTagBody._swMethod="text";
      await SWScope.SWSection._presentMatches(diffusionProps,pageMatches,SWScope.SWIndexer.docKey(diffusionPaper),pageToken);
      if (liveTagBody.querySelectorAll('.sw-row').length!==20) throw new Error("Initial batch did not respect display setting");
      liveTagBody.querySelector('.sw-more').scrollIntoView({block:"end"});
      await waitFor(()=>liveTagBody.querySelectorAll('.sw-row').length===40,"load relevant results on scroll");
      if (liveTagBody.querySelector('.sw-more')) throw new Error("Weak tail was retained to fill results");
      result.adaptiveResults=liveTagBody.querySelectorAll('.sw-row').length;
      Zotero.Prefs.set("similar-works.maxRecommendations",initialCount);
      await Zotero.getActiveZoteroPane().selectItem(item.id);
      peers[0].addTag("odd   tag");
      await peers[0].saveTx({skipSelect:true});
      td.getElementById('duplicates').checked = false;
      td.getElementById('search').value = "odd";
      td.getElementById('refresh').click();
      await waitFor(() => td.querySelector('#tags input')?.value === "odd   tag", 'load normalization candidate');
      await chooseAction(tagDialog,"rename");
      await waitFor(() => td.querySelector('#tags input')?.value === "odd   tag", "render single rename");
      const normalize = td.querySelector('#tags input');
      normalize.checked = true;
      normalize.dispatchEvent(new tagDialog.Event("change", {bubbles:true}));
      await waitFor(() => !td.getElementById('merge').disabled, 'preview normalization');
      if (td.getElementById('target').value !== "Odd tag") throw new Error("Normalization did not suggest a clean name");
      td.getElementById('target').value = "Fixture Tag 0";
      td.getElementById('target').dispatchEvent(new tagDialog.Event("input",{bubbles:true}));
      if (td.getElementById('collision').hidden) throw new Error("Rename collision was not shown");
      td.getElementById('target').value = "Odd tag";
      td.getElementById('target').dispatchEvent(new tagDialog.Event("input",{bubbles:true}));
      if (!td.getElementById('collision').hidden) throw new Error("Stale rename collision");
      td.getElementById('merge').click();
      await waitFor(() => peers[0].hasTag("Odd tag") && !peers[0].hasTag("odd   tag"), 'apply normalization');
      await waitFor(() => !td.getElementById('refresh').disabled, 'normalization result');
      if (tagDialog.closed || taggedNote.getNote() !== noteBeforeMerge) throw new Error("Normalization changed unrelated note content");
      tagDialog.close();

      const settings = Zotero.Utilities.Internal.openPreferences("knowledge-base-preferences");
      await waitFor(() => settings.document.getElementById("knowledge-base-source-style")?.value && settings.document.getElementById("similar-works-limit"), "Unified settings did not load");
      const panes = Zotero.PreferencePanes.pluginPanes.filter(pane => pane.pluginID === "knowledge-base@lzcn");
      if (panes.length !== 1 || settings.document.querySelector(".settings-pages") || settings.document.getElementById("knowledge-base-data-path")) throw new Error("Settings still have extra navigation or implementation details");
      const menu = settings.document.getElementById("knowledge-base-ui-style");
      if (menu.getBoundingClientRect().width < 280) throw new Error("Native appearance menu was forcibly shortened");
      const matchingLabel = settings.document.getElementById("similar-works-vectors");
      for (let n = 0; n < 100 && !matchingLabel?.textContent.trim(); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!matchingLabel?.textContent.trim() || settings.document.getElementById("similar-works-model") || settings.document.getElementById("similar-works-build")) throw new Error("Settings did not show simple preparation status without model internals");
      if (settings.document.documentElement.textContent.includes("minilm-l6") || settings.document.documentElement.textContent.includes("Xenova/")) throw new Error("Model identity leaked into Settings");
      const sharedAPI = Zotero.ZoteroKnowledgeBase.api;
      const originalStatus = sharedAPI.getLibraryStatus;
      const snapshot = originalStatus();
      sharedAPI.getLibraryStatus = () => ({...snapshot, state:"indexing", indexedItems:3, totalItems:10, queuedItems:7, indexProgress:{phase:"ready",done:3,total:10}, vectorTotal:10, semantic:{state:"indexing",indexedItems:2,queuedItems:8,error:null}});
      for (let n = 0; n < 50 && settings.document.getElementById("similar-works-vector-progress").value !== 2; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (settings.document.getElementById("similar-works-index-progress").value !== 3 || settings.document.getElementById("similar-works-vector-progress").value !== 2 || settings.document.getElementById("similar-works-vector-progress").hidden) throw new Error("Settings progress did not refresh with indexing state");
      if (${JSON.stringify(process.env.SW_HOST_SCREENSHOT || "")}) {
        const image = await settings.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = settings.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await IOUtils.write(${JSON.stringify(process.env.SW_HOST_SCREENSHOT || "")}, new Uint8Array(await blob.arrayBuffer()));
      }
      await capture('settings',settings);
      const limit = await waitFor(() => settings.document.getElementById("similar-works-limit"), "Similar Items controls did not load");
      if (settings.getComputedStyle(limit).fontFamily.includes('Avenir Next')) throw new Error('Settings inherited the Bear font');
      if([...settings.document.styleSheets].some(sheet=>sheet.href?.includes('similar-works/content/ui.css')))throw new Error('Settings loaded the operational theme stylesheet');
      if (settings.document.getElementById('similar-works-ui-style')) throw new Error('Settings expose an appearance picker');
      sharedAPI.getLibraryStatus = originalStatus;
      limit.value = "15";
      limit.dispatchEvent(new settings.Event("change", { bubbles: true }));
      if (Number(Zotero.Prefs.get(limit.getAttribute("preference"), true)) !== 15) throw new Error("Settings selection was not saved");
      limit.value = "20";
      limit.dispatchEvent(new settings.Event("change", { bubbles: true }));
      await capture('settings-similar',settings);
      const style = await waitFor(() => settings.document.getElementById("similar-works-tag-style"), "Tag Manager controls did not load");
      const hashtag = settings.document.getElementById("similar-works-tag-hashtag");
      if (!style || style.querySelectorAll("menuitem").length !== 2 || settings.document.getElementById("similar-works-tag-case") || settings.document.getElementById("similar-works-tag-hyphens")) throw new Error("Naming options were not simplified");
      for(const value of ["title","sentence"]) {
        style.value=value;style.dispatchEvent(new settings.Event("command",{bubbles:true}));
        if (Zotero.Prefs.get(style.getAttribute("preference"),true)!==value) throw new Error("Case preset did not auto-save");
      }
      if(tagAPI.formatName("gan yolo co-attention PyTorch")!=="GAN YOLO co-attention PyTorch") throw new Error("Scientific dictionary did not load");
      hashtag.checked=true;hashtag.dispatchEvent(new settings.Event("command",{bubbles:true}));
      if(tagAPI.formatName("deep learning")!=="#Deep learning") throw new Error("Hashtag setting did not save");
      const excludedTags = settings.document.getElementById("similar-works-excluded-tags");
      const excludeColored = settings.document.getElementById("similar-works-exclude-colored-tags");
      if (!excludedTags || !excludeColored.checked || !excludeColored.label) throw new Error("Tag protection controls did not load");
      excludedTags.value = ["Graph Neural Networks", "Special Status"].join(String.fromCharCode(10));
      excludedTags.dispatchEvent(new settings.Event("input", {bubbles:true}));
      excludedTags.dispatchEvent(new settings.Event("change", {bubbles:true}));
      await waitFor(() => Zotero.Prefs.get(excludedTags.getAttribute("preference"),true) === excludedTags.value, 'save excluded tags');
      if ((await tagAPI.catalog(item.libraryID,true)).includes("Graph Neural Networks")) throw new Error("Manual exclusion did not hide a tag");
      try { await tagAPI.merge(item.libraryID,["Odd tag"],"#SpecialStatus"); throw new Error("Excluded destination accepted"); }
      catch (error) { if (error.message !== "similar-works-tags-protected") throw error; }
      await capture("settings-tags",settings);
      await waitFor(() => settings.document.getElementById("knowledge-base-source-style")?.value, "Note System controls did not load");
      await capture("settings-notes",settings);
      settings.close();
      peers[0].addTag("format HTTP parser");
      peers[1].addTag("#format_HTTP_parser");
      await peers[0].saveTx({skipSelect:true});
      await peers[1].saveTx({skipSelect:true});
      const formatDialog = tagAPI.open(doc.defaultView,item.libraryID);
      await waitFor(() => ["format HTTP parser","#format_HTTP_parser"].every(name => [...(formatDialog.document?.querySelectorAll('#tags input') || [])].some(input => input.value === name)), 'load naming variants');
      const fd = formatDialog.document;
      await chooseAction(formatDialog,"format");
      await waitFor(() => ["format HTTP parser","#format_HTTP_parser"].every(name => [...fd.querySelectorAll('#tags input')].some(input => input.value === name)), 'render format rows');
      for (const checkbox of [...fd.querySelectorAll('#tags input')].filter(input=>["format HTTP parser","#format_HTTP_parser"].includes(input.value))) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new formatDialog.Event("change", {bubbles:true}));
      }
      await waitFor(() => !fd.getElementById('merge').disabled, 'preview configured format');
      if (!fd.getElementById('target').hidden) throw new Error("Bulk format unexpectedly asks for a shared name");
      fd.getElementById('merge').click();
      await waitFor(() => peers.every(peer=>peer.hasTag("#Format HTTP parser")), 'apply configured format');
      await waitFor(() => !fd.getElementById('refresh').disabled, 'configured format result');
      if (peers[0].hasTag("format HTTP parser") || peers[1].hasTag("#format_HTTP_parser") || taggedNote.getNote() !== noteBeforeMerge) throw new Error("Naming merge did not preserve unrelated data");
      formatDialog.close();
      for (let index = 0; index < 230; index++) peers[0].addTag("BulkTag"+index);
      await peers[0].saveTx({skipSelect:true});
      const bulkDialog = tagAPI.open(doc.defaultView,item.libraryID);
      await waitFor(() => bulkDialog.document?.querySelectorAll('#tags input').length > 230, 'display all tags without a cutoff');
      const bd = bulkDialog.document;
      if (bd.documentElement.namespaceURI !== "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" || bd.getElementById("merge").namespaceURI !== bd.documentElement.namespaceURI) throw new Error("Tag Manager is not using native window and buttons");
      if (bd.querySelector('#tags input').getBoundingClientRect().width > 20) throw new Error("Tag checkbox has stretched beyond native control size");
      if (Zotero.isMac) {
        bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"w",metaKey:true,isComposing:true,cancelable:true}));
        bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"w",ctrlKey:true,cancelable:true}));
        if (bulkDialog.closed) throw new Error("IME or Control-W closed Tag Manager");
        bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"f",metaKey:true,cancelable:true}));
        if (bd.activeElement !== bd.getElementById("search")) throw new Error("Command-F did not focus tag search");
      }
      if (bd.getElementById("mode").value !== "merge") throw new Error("Wrong default tag action");
      await chooseAction(bulkDialog,"format");
      if ([...bd.querySelectorAll('#tags input')].some(input=>['Deep Learning','Graph Neural Networks'].includes(input.value))) throw new Error('Protected tags were visible');
      bd.getElementById('search').value = "BulkTag";
      bd.getElementById('search').dispatchEvent(new bulkDialog.Event("input",{bubbles:true}));
      await waitFor(() => bd.querySelectorAll('#tags input').length === 230, 'filter bulk tags');
      let inputs = [...bd.querySelectorAll('#tags input')];
      inputs[1].click();
      inputs[5].dispatchEvent(new bulkDialog.MouseEvent("click",{bubbles:true,shiftKey:true}));
      await waitFor(() => [...bd.querySelectorAll('#tags input')].filter(input=>input.checked).length === 5, 'shift range selection');
      bd.getElementById('select-all').click();
      await waitFor(() => [...bd.querySelectorAll('#tags input')].every(input=>input.checked), 'select all filtered tags');
      await waitFor(() => !bd.getElementById('merge').disabled, 'preview bulk formatting');
      if (bd.getElementById('mode').value !== "format") throw new Error("Wrong format action");
      if (${JSON.stringify(process.env.SW_TAGS_HOST_SCREENSHOT || "")}) {
        const image = await bulkDialog.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = bd.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await IOUtils.write(${JSON.stringify(process.env.SW_TAGS_HOST_SCREENSHOT || "")}, new Uint8Array(await blob.arrayBuffer()));
      }
      bd.getElementById('merge').click();
      await waitFor(() => !bd.getElementById('refresh').disabled, 'finish bulk formatting', 500);
      if (!peers[0].hasTag("#BulkTag0") || !peers[0].hasTag("#BulkTag229") || peers[0].getTags().filter(tag=>tag.tag.startsWith("#BulkTag")).length !== 230) throw new Error("Bulk formatting lost distinct tags");
      if (!peers[0].hasTag("Deep Learning") || taggedNote.getNote() !== noteBeforeMerge) throw new Error("Bulk formatting changed protected or unrelated data");
      bd.getElementById("search").value = "#BulkTag";
      bd.getElementById("search").dispatchEvent(new bulkDialog.Event("input",{bubbles:true}));
      await waitFor(() => bd.querySelectorAll("#tags input").length === 230, "render formatted tags for deletion");
      await chooseAction(bulkDialog,"delete");
      await waitFor(() => bd.querySelectorAll("#tags input").length === 230, "render deletion action");
      const deletionInputs = [...bd.querySelectorAll("#tags input")];
      const removedNames = deletionInputs.slice(0,2).map(input=>input.value);
      deletionInputs[0].click(); deletionInputs[1].click();
      await waitFor(() => !bd.getElementById("merge").disabled && bd.getElementById("target").hidden, "preview delete selection");
      bd.getElementById("merge").click();
      await waitFor(() => !bd.getElementById("refresh").disabled, "finish delete");
      if (removedNames.some(name=>peers[0].hasTag(name)) || peers[0].getTags().filter(tag=>tag.tag.startsWith("#BulkTag")).length !== 228) throw new Error("Bulk deletion did not preserve unselected tags");
      if (!peers[0].hasTag("Deep Learning") || taggedNote.getNote() !== noteBeforeMerge || peers[0].deleted) throw new Error("Deletion changed protected tags or items");
      const deletedText=await bd.l10n.formatValue('similar-works-tags-deleted',{count:2});
      await waitFor(()=>!bd.getElementById('mode').disabled && bd.getElementById('preview').textContent===deletedText,'restore action picker after deletion');
      for(const width of [680,440]) {
        bulkDialog.resizeTo(width,560);await new Promise(resolve=>setTimeout(resolve,100));
        checkActionControl(bulkDialog,'delete');
        await capture(width===680?'tag-manager-after-delete':'tag-manager-narrow-delete',bulkDialog);
      }
      bd.getElementById('tag-manager').style.fontSize='18px';
      checkActionControl(bulkDialog,'delete');
      await capture('tag-manager-large-text',bulkDialog);
      bd.getElementById('tag-manager').style.fontSize='';
      await chooseAction(bulkDialog,'merge');
      await waitFor(()=>!bd.getElementById('target').hidden,'reuse action picker after deletion');
      bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"w",metaKey:!!Zotero.isMac,ctrlKey:!Zotero.isMac,cancelable:true}));
      await waitFor(() => bulkDialog.closed, "Command-W close tag dialog");
      const corpus = SWScope.SWIndexer.corpus;
      if (!corpus._db) throw new Error("Index did not open");
      SWScope.SWSection.injectWindow(doc.defaultView);
      const graphBody = doc.createElementNS("http://www.w3.org/1999/xhtml","div");
      doc.documentElement.appendChild(graphBody);
      SWScope.SWSection.ensureSkeleton(graphBody);
      if (SWScope.SWGraph || doc.getElementById("similar-works-graph-menu") || graphBody.querySelector(".sw-graph-open")) throw new Error("Unfinished graph entry is visible");
      if (!graphBody.querySelector(".sw-list") || !doc.getElementById("similar-works-organize-tags")) throw new Error("Disabling Graph removed existing features");
      graphBody.remove();

      const semantic = SWScope.SWSemantic;
      const storedVector = new Float32Array(384); storedVector[0] = 1;
      corpus.docs.set("1/HOST-VECTOR", {hash: "host-vector", weak: false});
      await corpus._db.execute("INSERT OR REPLACE INTO embeddings (key, sourceHash, model, vector, updatedAt) VALUES (?, ?, ?, ?, ?)",
        ["1/HOST-VECTOR", "host-vector", semantic.version, semantic.encode(storedVector), Date.now()]);
      semantic.vectors.delete("1/HOST-VECTOR");
      await semantic._load(corpus);
      if (semantic.vectors.get("1/HOST-VECTOR")?.vector[0] !== 1) {
        const vectorRows = await corpus._db.execute("SELECT vector FROM embeddings WHERE key = ?", ["1/HOST-VECTOR"]);
        const bytes = vectorRows[0].getResultByName("vector");
        throw new Error("Persisted native semantic vector failed to reload: " + JSON.stringify({array:Array.isArray(bytes),length:bytes.length,byteLength:bytes.byteLength,constructor:bytes.constructor?.name}));
      }

      if (${JSON.stringify(process.env.SW_HOST_NATIVE_MODEL_DIR || "")}) {
        semantic._enabled = true;
        await semantic._init();
        const nativeProcess = semantic._native;
        if (!nativeProcess) throw new Error("Native inference did not launch");
        const encoded = await semantic._encode(["Spectral hashing for similarity search."]);
        if (encoded.vectors.length !== 1 || encoded.vectors[0].length !== 384)
          throw new Error("Native host inference returned invalid vector");
        item.setField("title", "Deep Learning for molecular representation and molecule prediction");
        item.setField("abstractNote", "Graph neural networks learn molecular representations for molecule prediction.");
        await item.saveTx({skipSelect:true});
        const queryKey = SWScope.SWIndexer.docKey(item);
        for (const paper of [item, ...peers]) {
          await SWScope.SWIndexer.ensureNow(paper);
          await semantic._build(SWScope.SWIndexer.docKey(paper));
        }
        const hybrid = await semantic.recommend(queryKey, 10, key => key.startsWith(item.libraryID + "/"));
        if (!hybrid?.matches.some(match=>match.key===SWScope.SWIndexer.docKey(peers[0]))) throw new Error("Hybrid retrieval did not return indexed peers");
        await semantic._build(SWScope.SWIndexer.docKey(diffusionPaper));
        const semanticTags = await SWScope.SWTags.suggest(diffusionPaper,[{item:diffusionNeighbor,score:0.8}]);
        if (semanticTags.some(tag=>unsupportedTopics.includes(tag.name)) || !semanticTags.some(tag=>tag.isNew)) throw new Error("Native MiniLM tag ranking lost topic evidence");
        await semantic.saveRecommendations(queryKey, true, hybrid.matches, hybrid.snapshot);
        if (!semantic.recommendationsFresh(semantic.getRecommendations(queryKey,true),queryKey)) throw new Error("Hybrid host cache is stale immediately after retrieval");
        const hybridBody = doc.createElementNS("http://www.w3.org/1999/xhtml","div");
        doc.documentElement.appendChild(hybridBody);
        await SWScope.SWSection.renderBody({body:hybridBody,item,tabType:"library"},true);
        if (!hybridBody.querySelector(".sw-row") || [...hybridBody.querySelectorAll(".sw-num")].some(el=>el.textContent.includes("%"))) throw new Error("Hybrid sidebar missing or exposes RRF as a similarity percentage");
        hybridBody.remove();
        result.nativeBackend = semantic.status.backend;
        semantic.pause();
        const exit = await nativeProcess.wait();
        if (semantic._native || !exit) throw new Error("Native inference leaked on pause");
        if (runtimeDownloads !== (hasRuntimeCache ? 0 : 1)) throw new Error("Runtime cache was not reused as expected: " + runtimeDownloads);

        // A valid cache must work with network access disabled.
        Zotero.HTTP.request = function() { throw new Error("Unexpected download with valid caches"); };
        semantic._enabled = true;
        await semantic._init();
        const cached = await semantic._encode(["Spectral hashing for similarity search."]);
        const cosine = (a,b) => a.reduce((sum,n,i)=>sum+n*b[i],0);
        if (cosine(encoded.vectors[0],cached.vectors[0]) < 0.99999) throw new Error("Cached runtime changed embeddings");
        semantic.pause();
        await semantic._nativeExit;
        Zotero.HTTP.request = function(method, url, options) {
          if (url === runtimeURL) runtimeDownloads++;
          return request.call(this, method, url, options);
        };

        // Repair a damaged runtime without invalidating the model or vector cache.
        const runtimeDir = PathUtils.join(Zotero.DataDirectory.dir,"knowledge-base","runtime","onnx");
        await IOUtils.writeUTF8(PathUtils.join(runtimeDir,"libonnxruntime.1.22.0.dylib"),"damaged");
        semantic._enabled = true;
        await semantic._init();
        if (runtimeDownloads !== (hasRuntimeCache ? 1 : 2)) throw new Error("Damaged runtime was not downloaded again");
        const repaired = await semantic._encode(["Spectral hashing for similarity search."]);
        if (cosine(encoded.vectors[0],repaired.vectors[0]) < 0.99999) throw new Error("Repaired runtime changed embeddings");
        for (const paper of [item,...peers]) {
          const key = SWScope.SWIndexer.docKey(paper);
          semantic.forget(key);
          await semantic._build(key);
        }
        const again = await semantic.recommend(queryKey,10,key=>key.startsWith(item.libraryID+"/"));
        if (JSON.stringify(hybrid.matches.map(m=>m.key)) !== JSON.stringify(again?.matches.map(m=>m.key))) throw new Error("Runtime repair changed recommendation ranks");
        if ((await IOUtils.getChildren(runtimeDir)).some(path=>PathUtils.filename(path).startsWith("download"))) throw new Error("Runtime setup left temporary archives");
        result.runtimeDownload = hasRuntimeCache ? "copied runtime, offline reuse and corruption recovery passed" : "fresh, offline reuse and corruption recovery passed";
        result.runtimeMinimumCosine = Math.min(cosine(encoded.vectors[0],cached.vectors[0]),cosine(encoded.vectors[0],repaired.vectors[0]));
        result.runtimeRanking = "unchanged";
        semantic.pause();
        await semantic._nativeExit;
      }

      // Pause background work before checking foreground priority.
      semantic.pause();
      await semantic._running;
      const originalBuild = semantic._build;
      let selectedBuilt = false;
      semantic.corpus.docs.set("1/HOST-PRIORITY", {hash: "priority"});
      semantic._enabled = true;
      semantic._build = async key => {
        selectedBuilt = key === "1/HOST-PRIORITY";
        semantic.pause();
      };
      const selectedAt = Date.now();
      try {
        semantic.enqueue("1/HOST-PRIORITY", true);
        await semantic._running;
        if (!selectedBuilt || Date.now() - selectedAt >= 1000)
          throw new Error("Selected note waited for background indexing delay");
      } finally { semantic._build = originalBuild; }

      await Zotero.getActiveZoteroPane().selectItem(item.id);
      await new Promise(resolve => setTimeout(resolve, 300));
      const navigationBody = section.querySelector('[data-type="body"]');
      const sectionAPI = SWScope.SWSection;
      await sectionAPI._presentMatches(
        {body:navigationBody, item, tabType:"library"},
        [{key:SWScope.SWIndexer.docKey(peers[0]), score:0.9, lexicalScore:0.9, semanticScore:0, weak:true}],
        SWScope.SWIndexer.docKey(item), navigationBody._swToken
      );
      const matchEvidence = navigationBody.querySelector('.sw-evidence');
      if (!matchEvidence.hidden || doc.defaultView.getComputedStyle(matchEvidence).display !== 'none') throw new Error('Match evidence is visible by default');
      matchEvidence.hidden = false;
      matchEvidence.open = true;
      try {
        await waitFor(() => matchEvidence.querySelectorAll('blockquote').length === 2, 'show both recommendation passages');
      } catch (error) {
        throw new Error(error.message + JSON.stringify({connected:matchEvidence.isConnected,html:matchEvidence.innerHTML,direct:await SWScope.SWEvidence.compareItems(item,peers[0])}));
      }
      section.querySelector('collapsible-section').open = true;
      await section.closest('item-details').scrollToPane(sectionAPI._registered, 'instant');
      await new Promise(resolve => setTimeout(resolve, 100));
      await sectionAPI._presentMatches(
        {body:navigationBody, item, tabType:"library"},
        [{key:SWScope.SWIndexer.docKey(peers[0]), score:0.9, lexicalScore:0.9, semanticScore:0, weak:true}],
        SWScope.SWIndexer.docKey(item), navigationBody._swToken
      );
      const visibleEvidence = navigationBody.querySelector('.sw-evidence');
      visibleEvidence.hidden = false;
      visibleEvidence.open = true;
      await waitFor(() => visibleEvidence.querySelectorAll('blockquote').length === 2, 'render visible evidence');
      const evidenceRow = visibleEvidence.previousElementSibling;
      if (evidenceRow.querySelector('.sw-title').getBoundingClientRect().bottom > evidenceRow.getBoundingClientRect().bottom) throw new Error('Wrapped title overflows its recommendation button');
      visibleEvidence.hidden = true;
      await capture('evidence-hidden',doc.defaultView);
      result.matchEvidence = true;
      await sectionAPI._presentMatches(
        {body:navigationBody, item, tabType:"library"},
        [{key:SWScope.SWIndexer.docKey(peers[0]), score:0.9, lexicalScore:0.9, semanticScore:0, weak:true}],
        SWScope.SWIndexer.docKey(item), navigationBody._swToken
      );
      navigationBody.querySelector(".sw-row").click();
      await waitFor(() => Zotero.getActiveZoteroPane().getSelectedItems()[0]?.id === peers[0].id
        && !navigationBody.querySelector(".sw-source").hidden, "recommendation navigation");
      await new Promise(resolve => setTimeout(resolve, 300));
      const sourceCard = navigationBody.querySelector(".sw-source");
      await doc.l10n.translateFragment(sourceCard);
      if (sourceCard.querySelector(".sw-title").textContent !== item.getField("title")) throw new Error("Wrong navigation source");
      if (doc.defaultView.getComputedStyle(sourceCard).borderRadius!=='0px') throw new Error('Source navigation still uses a rounded card');
      await capture('sidebar',doc.defaultView);
      checkSharedStyle(doc.defaultView, navigationBody.querySelector('.sw-list'));
      checkSharedStyle(doc.defaultView, sourceCard);
      if (!sourceCard.querySelector(".sw-source-label").textContent) throw new Error("Missing source localization");
      if (!section.querySelector("collapsible-section").open) throw new Error("Similar Items collapsed after navigation");
      const details = section.closest("item-details");
      if (!details.isPaneVisible(section.dataset.pane)) throw new Error("Similar Items is not visible after navigation");
      const sourceStyle = doc.defaultView.getComputedStyle(sourceCard);
      if (parseFloat(sourceStyle.borderInlineStartWidth) < 2 || sourceCard.getBoundingClientRect().height < 30) throw new Error("Source card styling failed");
      sourceCard.click();
      await waitFor(() => Zotero.getActiveZoteroPane().getSelectedItems()[0]?.id === item.id
        && sourceCard.querySelector(".sw-title")?.textContent === peers[0].getField("title"), "return to source");
      await Zotero.getActiveZoteroPane().selectItem(peers[1].id);
      await waitFor(() => sourceCard.hidden, "clear navigation source");
      await Zotero.getActiveZoteroPane().selectItem(item.id);
      result.navigation = "passed";
      const openManager = tagAPI.open(doc.defaultView,item.libraryID);
      await waitFor(() => openManager.document?.querySelectorAll('#tags input').length > 200, 'manager before shutdown');
      if (!tagAPI._dialogs.has(openManager)) throw new Error("Live manager window was not tracked");
      let shutdownNative = null;
      if (${JSON.stringify(process.env.SW_HOST_NATIVE_MODEL_DIR || "")}) {
        semantic._enabled = true;
        await semantic._init();
        shutdownNative = semantic._native;
      }
      await shutdown(data, 4);
      if (shutdownNative) {
        await shutdownNative.wait();
        if (semantic._native) throw new Error("Shutdown leaked native inference");
      }
      if (!openManager.closed) throw new Error("Shutdown did not close Tag Manager");
      if (doc.getElementById("similar-works-graph-menu")) throw new Error("Shutdown leaked graph entry");
      if (corpus._db || SWScope.SWSection._registered || SWScope.SWSection._preferencePane || doc.getElementById("similar-works-organize-tags") || SWScope.SWTags._dialogs.size)
        throw new Error("Shutdown leaked resources");
      result.ok = true;
    } catch (error) { result.error = String(error) + "\\n" + error.stack; }
    Zotero.HTTP.request = request;
    await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify(result));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  }, 1000);
};
`,
);
new Script(strFromU8(files["bootstrap.js"]), { filename: "host-bootstrap.js" });
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
const exited = new Promise((resolve, reject) => {
  child.once("exit", (code) => resolve(code));
  child.once("error", reject);
});
let timeout;
let passed = false;
try {
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Zotero host test timed out")),
        process.env.SW_HOST_NATIVE_MODEL_DIR ? 300000 : 90000,
      );
    }),
  ]);
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (code !== 0 || !result.ok)
    throw new Error(JSON.stringify({ code, result }));
  console.log(
    process.env.KNOWLEDGE_BASE_STARTUP_PROBE
      ? "PASS Lazy startup: notes are ready before index/model loading; explicit activation takes priority; shutdown drains scheduled work (wake " +
          result.foregroundWakeMs +
          " ms)."
      : "PASS Knowledge Base: local text and semantic retrieval, no generative AI runtime/settings, tag filtering and native operations, indexing progress and shutdown cleanup.",
  );
  if (result.runtimeDownload)
    console.log(
      JSON.stringify({
        runtimeDownload: result.runtimeDownload,
        backend: result.nativeBackend,
        minimumCosine: result.runtimeMinimumCosine,
        ranking: result.runtimeRanking,
      }),
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
  else console.error(`Host test profile and logs retained at ${root}`);
}
