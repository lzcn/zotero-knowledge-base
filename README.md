# Zettel Knowledge Base

[中文](README.zh-CN.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/)

A Zotero plugin for connected notes. Write one idea per card, keep its sources, and link it to other ideas.

Built mainly with ChatGPT, with some help from DeepSeek.

## Features

- Write Markdown with images, links, tables, code, and a live preview.
- Search cards, add links, and see which cards link back.
- Search Zotero sources and view their cards in the item sidebar.
- Explore all cards or the connections around one card in a graph.
- Create cards from PDF highlights, one at a time or in batches.

## Install and use

Requires Zotero 7 or later.

In Zotero, open **Tools → Plugins**, select **Install Plugin From File** from the gear menu, and choose the `.xpi` file. Restart Zotero.

Open **Tools → Zettel Knowledge Base** to create a card. Write an idea, choose its source, and link related cards. Use `Ctrl/Cmd+S` to save and `Ctrl/Cmd+K` to find a card to link.

## Back up your cards

Cards are stored in `zettel-knowledge-base.sqlite` in your Zotero data directory. Images are stored in `zettel-knowledge-base-assets/`. Quit Zotero and back up both.

Cards do not currently sync through Zotero. Markdown import and export are not yet supported.

## Development

Requires Node.js 22.13 or later.

```sh
npm ci             # Install dependencies
npm run check      # Run tests, build, and check code
npm run release    # Create a local release package
```

## License

[AGPL-3.0-or-later](LICENSE). Includes code from [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template). Third-party libraries keep their own licenses.
