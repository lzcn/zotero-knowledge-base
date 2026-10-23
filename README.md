# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Manage literature notes, idea cards and thinking notes in Zotero.

## Install

Supports Zotero 7–10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest), install it through **Tools → Plugins → Install Plugin From File**, and restart Zotero.

## Use

Open **Tools → Knowledge Base** or its toolbar button.

- Create a **Literature Note**, **Zettel** or **Thinking Note**. Edit with Zotero's native editor or Markdown; changes save automatically.
- Link notes with `[[ID]]`, use `[[ID|label]]` for custom text, and cite papers with `[@CitationKey]`. Type `[[` to choose a note.
- Search by title, body or ID. Browse parents, children, backlinks and the local or global graph.

Settings control the workbench window, citation style, tag inheritance and graph appearance. Experimental AI connection suggestions are off by default; enabling them requires provider configuration. Review and select suggestions before applying.

## Data and backup

Note bodies and images use Zotero storage and sync. Card IDs, hierarchy, links and recovery drafts are stored locally in `knowledge-base.sqlite` and do not sync through Zotero.

Deleting a card moves its linked Zotero note to Trash. Restoring that note reconnects the card; permanent deletion removes the mapping. Conflicting edits retain a recovery draft.

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
