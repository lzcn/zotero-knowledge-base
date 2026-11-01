# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Manage linked notes in Zotero.

## Install

Supports Zotero 7–10. Download the XPI from [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest), install it through **Tools → Plugins → Install Plugin From File**, and restart Zotero.

## Use

Open **Tools → Knowledge Base** or its toolbar button in the library or PDF reader.

- Create a **New Note** and organize notes with editable tags. Edit with Zotero's native editor or Markdown; changes save automatically.
- The item sidebar separates its single Literature Note from related Zettels. Use **＋** to add a Zettel. The workbench toolbar switches between **Notes** and **Trash** without a tag filter.
- Rendered headings show subtle H1–H6 labels in editing and reading views; labels are not saved in the note.
- Link notes with `[[ID]]`, use `[[ID|label]]` for custom text, and cite papers with `[@CitationKey]`. Type `[[` to choose a note.
- Search by title, body or ID. Browse parents, children, backlinks and the local or global graph. Right-click a note for links, tags, child notes and Trash actions.
- Click a note’s ID to copy its reference; choose **Edit Note ID** in **…** to rename it. Sources display full citations in the selected citation style; click to open the paper.
- Click **Normalize** (Tt) in the editor toolbar to normalize formula delimiters. The separate search icon opens find and replace; use **⌘/Ctrl+F** to find, **⌘⌥F** (macOS) or **Ctrl+H** (Windows/Linux) to replace. Formatting applies to the selection, or the whole note when nothing is selected, and supports Undo. Available in native and Markdown modes, including ordinary Zotero notes.

In **Settings → Knowledge Base → Note Templates**, add, name, edit or delete your own Markdown templates and choose one for new notes. No templates are preloaded, and **No template** is selected by default. Changing or deleting a template leaves existing notes unchanged.

Settings control the workbench window, citation style, tag inheritance and graph appearance. Experimental AI connection suggestions are off by default; enabling them requires provider configuration. Review and select suggestions before applying.

Existing note types are converted once to ordinary **Literature Note**, **Zettel** or **Thinking Note** tags. Removing these tags does not change note content, sources or links.

Choose **Minimal** (default) or **Bear** in Settings. The plugins share restrained colors and system-font controls; Bear typography is reserved for Knowledge Base note content. Settings use Zotero’s native appearance.

## Data and backup

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
