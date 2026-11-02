# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Notes, tags and similar items in Zotero.

## Install

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest). Open **Plugins** in the **Tools** menu, choose **Install Plugin From File**, and restart Zotero.

## Use

Open **Knowledge Base** from the **Tools** menu or its library and PDF toolbar buttons.

- **Notes:** Edit in the native editor or Markdown with autosave. Link notes with `[[ID]]`, search and browse the graph. Templates are optional.
- **Tags:** Rename, merge or remove native Zotero tags with Tag Manager.
- **Similar Items:** Find similar papers locally. Recommendations do not create note links. On macOS, semantic search downloads required files automatically.

Options are in the Knowledge Base settings.

## Backup

Note content uses Zotero sync. IDs, hierarchy and links stay in the local `knowledge-base.sqlite` database. Quit Zotero before backing up its data directory, including this database and the `knowledge-base/` folder.

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
