# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[中文](README.zh-CN.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

Manage connected idea cards in Zotero. Write one idea in your own words, keep its sources, and link related ideas.

## Features

- Link existing Zotero items and notes without copying their content.
- Write Markdown or use the visual editor, with images, links, tables, code, and math (`$…$` or `$$…$$`). Click a formula in the visual editor to edit its LaTeX.
- Reference cards with `[[ID]]`; the body shows a numbered link, while relation panels show ID and title.
- Associate Zotero sources and view cards in the item sidebar.
- Build a knowledge outline with one parent per card; children are derived automatically.
- Start from entry points (cards without parents).
- Show parent–child connections and card links separately. Hide source items and their connections by right-clicking the graph or using its settings button.
- Create cards from PDF highlights, individually or in batches.
- Remove images no longer used by saved cards or open drafts.

## Installation

Requires Zotero 10.

Download the `.xpi` file from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases). Open **Tools → Plugins** in Zotero, select **Install Plugin From File** from the gear menu, choose the `.xpi` file, and restart Zotero.

## Usage

Open **Tools → Knowledge Base**. Write one idea per card, choose a source, and link related cards. Use `Ctrl/Cmd+S` to save and `Ctrl/Cmd+K` to find a card to link.

Start from entry points, then follow parents and children. Choose **New child card** to create a child of the current card. Parent selection builds the outline; `[[ID]]` in the body creates a separate reference. Relationship groups show titles and stable IDs, with counts and collapsible lists. In the reference picker, use arrow keys to choose a card and Enter to insert it.

Click ➕ in the editor for insertion options, or type `/` at the start of a Markdown line to search commands. Use arrow keys and Enter to choose; Escape cancels. Parent selection opens on click. The graph reserves space for titles and subtrees, uses curved connections, and preserves your view when toggling relationships.

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

`npm run test:host` tests real Zotero startup, saving, and quitting with the manager, editor, and graph open. It uses temporary profile and data directories. The default executable is the macOS app; set `ZOTERO_BINARY` for another path.

`npm run release` prepares the XPI, checksums, and update metadata under `release/`. It does not create a Git tag or publish a GitHub release.

After configuring Zotero paths and a development profile in your local `.env`, use `npm start` for development.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Third-party libraries keep their own licenses.
