# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Manage notes, organize tags and find similar items in Zotero.

## Install

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest), install it through **Tools → Plugins → Install Plugin From File**, and restart Zotero.

## Use

Open **Tools → Knowledge Base** or its toolbar button in the library or PDF reader.
In a PDF, the button opens the paper's existing Literature Note, or the default workbench if none exists.

- Create a **New Note** and organize notes with editable tags. Edit with Zotero's native editor or Markdown; the chosen mode carries across notes and restarts. Changes save automatically.
- One Knowledge Base sidebar pane has **Notes**, **Tags** and **Similar Items** tabs. Notes shows its single Literature Note and related Zettels. Use **＋** to add a Zettel. Four toolbar icons filter **All Notes** (default), **Literature**, **Zettel** and **Thinking** by the note's own tags. **Trash** has a separate icon.
- Rendered headings show subtle H1–H6 labels; labels are not saved in the note.
- Link notes with `[[ID]]`, use `[[ID|label]]` for custom text, and cite papers with `[@CitationKey]`. Type `[[` to choose a note.
- Search by title, body or ID. Combine keywords with spaces; quote exact phrases with `"…"`. Results show the matching passage, including matches deep in long notes. Browse parents, children, backlinks and the local or global graph.
- Click a note’s ID to copy its reference; choose **Edit Note ID** in **…** to rename it. Sources display full citations in the selected citation style; click to open the paper.
- Click **Normalize** (Tt) in the editor toolbar to normalize formula delimiters. The search icon toggles find; enable **Replace** when needed. Use **⌘/Ctrl+F** to find, **⌘⌥F** (macOS) or **Ctrl+H** (Windows/Linux) to replace. Formatting applies to the selection, or the whole note when nothing is selected, and supports Undo. Available in native and Markdown modes, including ordinary Zotero notes.

In **Settings → Knowledge Base → Note Templates**, add, name, edit or delete your own Markdown templates and choose one for new notes. No templates are preloaded, and **No template** is selected by default. Changing or deleting a template leaves existing notes unchanged.

Settings use one native page, divided into **General**, **Note System**, **Tag Manager**, **Similar Items** and **Index Status** sections. Menus use Zotero’s native full-width layout.

Use **Literature Note**, **Zettel** or **Thinking Note** tags to group notes. Removing these tags does not change note content, sources or links.

Choose **Minimal** (default) or **Bear** in Settings. The interface uses restrained colors and system-font controls; Bear typography is reserved for Knowledge Base note content. Settings use Zotero’s native appearance.

## Similar items and tags

- Select a paper and open **Similar Items** in Zotero’s sidebar. Click a result to browse similar items; **From** returns to the previous paper. From a Knowledge Base note, click its source citation to open the paper.
- The **Tags** tab shows the selected item’s existing tags. Choose **Manage tags**, or open **Tools → Tag Manager**, to rename, merge, format or remove native Zotero tags; review changes before applying.
- Configure retrieval under **Settings → Knowledge Base → Similar Items**, and tag naming and protection under **Settings → Knowledge Base → Tag Manager**. Settings use native Zotero controls.

Item recommendations combine a local text index with MiniLM embeddings. They are candidates, not saved relationships: they never create note links, change parents or add graph edges. The note graph continues to show manually authored links, hierarchy and source relationships.

Notes and controls are available first. The sidebar opens on Notes; selecting Similar Items prioritizes retrieval. Background preparation waits 30 seconds and an idle opportunity, then loads the text index, vectors and library scan in sequence. Loading yields between small batches; unchanged files and vectors are reused. On macOS, local semantic preparation runs in the background; missing model weights (about 90 MB), tokenizer files and the ONNX Runtime archive (about 52 MiB) are downloaded and verified. Existing valid assets and vectors are reused. MiniLM primarily supports English papers; Windows and Linux currently use text retrieval. Notes are not submitted to a generative model.

## Data and backup

Tag operations use native Zotero tags; no separate tag database is created. Retrieval files are grouped under `knowledge-base/` in the Zotero data directory:

| Contents                                             | Location                |
| ---------------------------------------------------- | ----------------------- |
| Rebuildable paper index and status                   | `cache/related-papers/` |
| MiniLM weights, tokenizer and compiled Core ML cache | `models/minilm-l6-v2/`  |
| Native inference helper and ONNX Runtime             | `runtime/onnx/`         |
| Note images                                          | `assets/`               |

Models and runtime are reusable downloads; indexes and status are rebuildable caches. Note structure and drafts in `knowledge-base.sqlite`, native notes, tags and templates are user data. Cache cleanup must never remove them.

Note bodies and images use Zotero storage and sync. Card IDs, hierarchy, links and recovery drafts are stored locally in `knowledge-base.sqlite` and do not sync through Zotero.

Choose **Trash** in the workbench to view or restore deleted notes, delete a selected note permanently, or empty Knowledge Base Trash after confirmation. Emptying Trash removes only managed notes and their attachments; source papers and other Zotero items are preserved. Deleting a note first moves its original to Zotero Trash, retaining its ID, hierarchy and links until permanent deletion. Conflicting edits retain a recovery draft.

Quit Zotero before backing up its full data directory, including `knowledge-base.sqlite` and `knowledge-base/assets/`. The plugin starts empty and does not import existing notes automatically. Unsupported database formats are rejected without rewriting data.

## Development

Use Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-knowledge-base.xpi`. `npm run test:host` uses disposable Zotero directories. `npm run release` prepares local files under `release/v<version>/` without uploading.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Code developed with ChatGPT and DeepSeek.

The shared library engine lives in `src/library/`, native views in `addon/content/library/`, and its tests in `tests/library/`. `src/library/storage.js` defines paths for both note data and retrieval. Settings are registered centrally in `src/modules/settings.ts`. `npm run test:library:host` checks the single Settings page, shared status, retrieval, native tag operations and lifecycle in a disposable profile.
