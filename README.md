# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Notes, tags and similar items in Zotero.

## Install

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest). Open **Plugins** in the **Tools** menu, choose **Install Plugin From File**, and restart Zotero.

## Use

Open **Knowledge Base** from the **Tools** menu, the library, or the PDF toolbar.

- **Notes:** Zotero notes appear with their source and parent. Right-click **Open in Knowledge Base**, or enable **Use Knowledge Base for native notes** in Settings, to edit them here. Notes support rich text and Markdown with autosave. Math renders in headings. **Fix math preview** renders formulas in Zotero note cards. Choose Literature, Zettel, Thinking or Entity. Link notes with `[[ID]]` and browse them in the graph. Notes inherit tags from their source and parent. Manage templates in Settings.
- **Suggested Tags:** Reuse topics from related papers and add supported new ones. Suggestions combine metadata, full-text fingerprints and the shared semantic model, ranked by relevance and coverage. Existing labels keep their spelling. New labels follow the capitalization and optional # prefix settings.
- **Tag Manager:** **Organize similar tags** groups name variants, aliases and semantic matches, showing the actual labels and matching reasons. **Review group** selects a group and suggests its most-used name. Check the retained name and affected items before merging. Rename, merge and delete are separate actions. **Format** previews each rename in the tag list, preserves fixed spellings and structure, and skips name conflicts for separate merging. **Excluded Tags** accepts names, `*` patterns and `@colored`, separated by commas or new lines. `@colored, reading*` hides colored tags and names beginning with “reading”. Rules apply to suggestions, Tag Manager and note displays.
- **Similar Items:** Find similar papers locally, including items without full text. Results load automatically as you scroll. On macOS, semantic search downloads the required files.

The tabs share one local index. New or changed papers update in the background.

The graph shows notes by type. **Structure** follows parent–child relationships. **References** follows citations in note text. Structure keeps branches together with parents above children and solid lines. References use dashed lines. Changing a type or relationship filter rebuilds and fits the layout. Nodes take the color of their most similar tag. Configured Group tags take priority, and untagged nodes stay neutral.

Source, Parent and Tags appear directly above the note. Source accepts Zotero items. Parent sets the hierarchy. Click the Parent title to navigate or the pencil to change it. The footer shows the type and editable ID with copy. Single-click a note to view it. Double-click to open a window.

**Read & Write** beside Source opens the PDF and selects this note in Zotero’s sidebar. **Use Knowledge Base for native notes** controls the sidebar, note tabs and note windows. Command-Shift-X on macOS (Ctrl-Shift-X elsewhere) captures a dragged region to the clipboard. Escape cancels. No open note is required. Paste the image wherever you need it. Pasting into a Zotero note keeps its PDF position without creating an annotation. The Knowledge Base button sits immediately before the page number.

Appearance offers Minimal, Bear and Notes, with light and dark colors. Bear uses a soft red accent. Notes pairs a white writing canvas with a gray sidebar and an amber accent. Templates and type defaults are managed in one window.

## Backup

Note content uses Zotero sync. IDs, hierarchy and links live in `knowledge-base.sqlite` in the Zotero data directory. Quit Zotero before backing up the data directory.

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

Images use `assets/`. Search and model caches use `cache/`. Downloaded models and runtimes use `models/` and `runtime/`.

## Development

Knowledge Base uses one editor document and native-note storage across hosts. `src/modules/editor-views.ts` owns editor windows and shared drafts. `workbench.ts` owns workspace navigation.

Edit `addon/content/library/tag-terms.json` to maintain fixed spellings and aliases. Tag operations reuse the existing index and vectors. Semantic matching falls back to text rules when the model is unavailable. `SW_HOST_NATIVE_MODEL_DIR=/path/to/local/model npm run test:tag-semantics` runs the offline quality probe with an existing model.

Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-knowledge-base.xpi`.

Native inference supports macOS. Inference shares tokenization, chunking, pooling and ranking across backends. `inference-backend.h` runs ONNX with CPU fallback. `coreml-backend.h` provides the macOS backend. `SW_NATIVE_MODEL_DIR=/path/to/model node scripts/test-native.mjs` checks CPU/Core ML agreement using temporary caches.

Interactive inference takes priority at native input boundaries. Background documents resume without restarting completed chunks. macOS uses thread QoS for scheduling hints. Core ML and CPU share the model execution path.

`npm run benchmark:reading` measures PDF/note opening, note switching, figure insertion and saving, and timer delays during indexing of 24 disposable papers. Set `KNOWLEDGE_BASE_READING_BENCHMARK_OUTPUT=build/performance/reading.json` to retain the measurements.

`node scripts/benchmark-layout.mjs` measures background layout on a fixed synthetic graph.

`node scripts/benchmark-search.mjs` measures index rebuilding, signature decoding and retrieval on fixed synthetic data. It reports a ranking digest for before/after comparisons. Timings exclude Zotero storage and native inference.

## License

Copyright 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Developed with ChatGPT and DeepSeek.
