# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[中文](README.zh-CN.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

Manage connected idea cards in Zotero. Write one idea in your own words, keep its sources, and link related ideas.

## Features

- Link existing Zotero items and notes without copying their content.

- Write Markdown with images, links, tables, code, and a live preview.
- Search cards, insert links, and see backlinks.
- Associate Zotero sources and view cards in the item sidebar.
- Explore all cards or a card’s connections in a graph.
- Create cards from PDF highlights, individually or in batches.
- Remove images no longer used by saved cards or open drafts.

## Installation

Requires Zotero 7–10.

Open **Tools → Plugins** in Zotero, select **Install Plugin From File** from the gear menu, choose the `.xpi` file, and restart Zotero.

## Usage

Open **Tools → Knowledge Base**. Write one idea per card, choose a source, and link related cards. Use `Ctrl/Cmd+S` to save and `Ctrl/Cmd+K` to find a card to link.

## Data and backup

Cards are stored in `knowledge-base.sqlite` in your Zotero data directory; images are in `knowledge-base/assets/`. Quit Zotero and back up both the database and the image directory.

Cards do not currently sync through Zotero. Markdown file import and export are not supported.

## Development

Requires Node.js 22.13+ (22.x) or 24+. Run these commands in the plugin directory:

```sh
npm ci             # Install locked dependencies
npm run build      # Check types and build the XPI
npm run check      # Check formatting, lint, tests, and build
npm run release    # Run all checks and prepare local release files
```

For local testing, install `dist/zotero-knowledge-base.xpi`, restart Zotero, and test the plugin. Rebuild and reinstall after changes.

Release files are prepared in `release/v0.1.0/`: `zotero-knowledge-base-0.1.0.xpi`, `SHA256SUMS`, and `updates.json`. `npm run release` does not upload files. For publication, upload the XPI and `updates.json` as assets of the corresponding version’s Release.

After configuring Zotero paths and a development profile in your local `.env`, use `npm start` for development.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Third-party libraries keep their own licenses.
