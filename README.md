# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Notes, tags and similar items in Zotero.

## Install

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest). Open **Plugins** in the **Tools** menu, choose **Install Plugin From File**, and restart Zotero.

## Use

Open **Knowledge Base** from the **Tools** menu or its library and PDF toolbar buttons.

- **Notes:** Existing Zotero notes appear automatically, linked to the original note and its parent source. Right-click **Open in Knowledge Base**; double-click keeps Zotero's default behavior. Edit in the native editor or Markdown with autosave. A small type selector offers Literature, Zettel, Thinking and Entity (default) without adding tags. Link notes with `[[ID]]`, search and browse the graph. Notes inherit source and parent tags. Settings provides **Manage Templates…**.
- **Suggested Tags:** Reuse topics from related library papers and propose supported new topics. Recommendations combine metadata, existing full-text fingerprints, cached text and the shared semantic model. Relevance, topic coverage and redundancy determine how many to show. Existing labels keep their spelling; new labels follow the Sentence case / Title Case and optional # prefix settings.
- **Tag Manager:** Organize Similar Tags groups name variants, explicit aliases and semantic matches, showing the actual labels and matching reasons. Review Group selects just that group and suggests its most-used name; check the retained name and affected items before merging. Semantic matches need a meaning check. Merge, single-tag rename and delete remain explicit actions. Format previews each rename directly in the tag list, preserves fixed spellings and structures, and skips name conflicts for separate merging. Excluded Tags accepts names, `*` patterns and `@colored` for colored tags in the current library, separated by commas or new lines. For example, `@colored, reading*` hides colored tags and names beginning with “reading”. Rules apply to suggestions, Tag Manager and note displays without deleting Zotero tags.
- **Similar Items:** Find similar papers locally. Items without full text are included. Recommendations do not create note links. On macOS, semantic search downloads required files automatically.

The three tabs share one library runtime across windows. Startup restores the completed search cache; unchanged papers reuse their vectors and saved results. New or changed papers update in the background. The first launch after upgrading prepares the new cache from the existing index. Settings uses neutral headings and thin separators. Graph has its own section. Status shows cache progress and note counts by type. Templates has matching selectors for Literature, Zettel, Thinking and Entity, plus one shared Manage button. Each type keeps its own selection; templates can be reused across types. Types without a selected template stay blank.

The graph switches between note types and Parent Items. The latter includes only papers with notes and reuses the local search cache with stricter, mutual top-three similarity links. Note graphs show hierarchy and references without Source nodes. Relationship lists show titles; IDs stay in tooltips and copy controls.

The editor keeps Source, Parent and Tags above the note, with changes made in place. Click the Parent title to navigate; use its pencil to change the hierarchy. Long titles stay on one line, with the complete title in a tooltip. Its bottom status bar holds the type and directly editable ID with a copy action; long IDs stay compact and remain fully editable. Native and Markdown editing share a wider, responsive writing area and compact spacing. Single-click a note in the Knowledge Base list to view it; double-click to open it in a separate window. Graph actions stay in the top toolbar and list context menu.

## Backup

Note content uses Zotero sync. IDs, hierarchy and links stay in the local `knowledge-base.sqlite` database. Quit Zotero before backing up its data directory, including this database and the `knowledge-base/` folder.

Resources have one storage entry point and the following layout under the Zotero data directory:

```text
knowledge-base.sqlite
knowledge-base/
  assets/
  cache/
    similar-items/
    coreml/minilm-l6-v2/
  models/minilm-l6-v2/
  runtime/onnx/
```

Images use `assets/`; search and compiled model caches use `cache/`; downloaded resources use `models/` and `runtime/`. Existing retrieval and Core ML caches are adopted when the destination is absent. Standalone Related Work data is retained separately. SQLite manages its own `-wal` and `-shm` files.

Schemas 12 and 13 are upgraded in one transaction; the former Note type becomes Entity. Existing classification tags initialize the type field and remain intact. Discovery preserves original HTML, tags and placement; read-only libraries remain read-only.

## Development

Edit `addon/content/library/tag-terms.json` to maintain fixed spellings and explicit aliases. Formatting uses spellings only. Tag operations reuse the existing document index and vectors; missing PDF text is never indexed or OCRed on demand. Semantic matching falls back to text rules when the model is unavailable. `SW_HOST_NATIVE_MODEL_DIR=/path/to/local/model npm run test:tag-semantics` runs the offline quality probe with an existing model.

Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-knowledge-base.xpi`.

## License

Copyright 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Developed with ChatGPT and DeepSeek.
