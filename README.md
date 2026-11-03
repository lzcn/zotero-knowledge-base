# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Notes, tags and similar items in Zotero.

## Install

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest). Open **Plugins** in the **Tools** menu, choose **Install Plugin From File**, and restart Zotero.

## Use

Open **Knowledge Base** from the **Tools** menu or its library and PDF toolbar buttons.

- **Notes:** Edit in the native editor or Markdown with autosave. Link notes with `[[ID]]`, search and browse the graph. Notes inherit source and parent tags. **Manage Templates…** in Settings opens a template list and a text editor; choose the new-note default there.
- **Suggested Tags:** Select from at most six high-confidence topics, ordered by relevance with distinct New and Existing badges, and add them to the current paper. The top action row provides Add Selected Tags and Tag Manager.
- **Similar Items:** Find similar papers locally. Items without full text are included. Recommendations do not create note links. On macOS, semantic search downloads required files automatically.

The three tabs share one library runtime across windows. Startup restores the completed search cache; unchanged papers reuse their vectors and saved results. New or changed papers update in the background. The first launch after upgrading prepares the new cache from the existing index. Settings uses subtly colored section cards and one compact Cache status.

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

## Development

Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-knowledge-base.xpi`.

## License

Copyright 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Developed with ChatGPT and DeepSeek.
