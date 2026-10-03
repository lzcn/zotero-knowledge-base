# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[中文](README.zh-CN.md)

Manage connected idea cards in Zotero, keeping sources and links between ideas.

## Install and use

The manifest supports Zotero 7–10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases), install it through **Tools → Plugins → Install Plugin From File**, and restart Zotero.

Open **Tools → Knowledge Base**. Write one idea per card, select its sources, and connect related cards with `[[ID]]`. Each card has at most one parent; the graph shows hierarchy, references and sources separately. Cards can also be created from PDF highlights.

Use Markdown or the visual editor for images, tables, code and math (`$…$` or `$$…$$`). Click a formula to edit its LaTeX. `Ctrl/Cmd+S` saves; `Ctrl/Cmd+K` finds a card to link. The ➕ button and `/` at the start of a Markdown line offer insertion commands.

## Data

Cards are in `knowledge-base.sqlite`; images are in `knowledge-base/assets/`, both under the Zotero data directory. Quit Zotero before backing up both. Cards do not currently sync through Zotero; Markdown file import and export are not supported.

## Development

Use Node.js 22.13+ (22.x) or 24+. Run `npm ci`, then `npm run check`.

- `npm run build`: reuse valid output when inputs have not changed.
- `npm run build:force`: rebuild from scratch.
- `npm run check`: formatting, lint, tests and type checking; reuse valid XPI output.
- `npm run release`: full checks, then prepare the XPI, `SHA256SUMS` and `updates.json` under `release/v<version>/`.

Build output: `dist/zotero-knowledge-base.xpi`. Install and verify changes in Zotero. `npm run test:host` checks startup, saving and shutdown using temporary profile and data directories; `ZOTERO_BINARY` selects another executable. Configure local paths in `.env` before using `npm start` for development.

Release preparation does not create a tag or upload files. Shared working rules live in the plugin workspace's root `AGENTS.md`.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Third-party licenses remain applicable.
