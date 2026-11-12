# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

**English** | [简体中文](README.zh-CN.md)

Notes, tags and similar items in Zotero. Requires Zotero 10.

## Features

Open **Knowledge Base** from the **Tools** menu, the library, or the PDF toolbar.

### Notes

Open a Zotero note from the item pane with **Open in Knowledge Base**, or enable **Use Knowledge Base for native notes** in Settings to edit notes in their sidebar, tab or window. Write in rich text or Markdown; changes save automatically. Set **Source** to a Zotero item, **Parent** to build the note hierarchy (the pencil searches notes), and **Tags** to classify it. Choose Literature, Zettel, Thinking or Entity; the footer shows the type and editable ID, and templates live in Settings. **Enhancement → Math preview** renders formulas in note cards and PDF comments.

### Note links

Type `[[` at the cursor to search notes. Candidates start from the current paragraph, title, tags and existing connections; keep typing to search the whole library. Use ↑/↓ to choose, Enter or Tab to insert, and Escape to close. Links keep a stable ID and show the target’s current title. To keep your own wording, write `[[ID|display text]]`, select text before inserting, or edit the link text later; manual labels survive renames. Markdown source keeps `[[ID]]`; the visual editor and previews show titles. If no note matches, choose **Create Entity** to create and link one. Hover a link in the visual editor or preview for its title, type, parent and backlink count. Backlinks list every referring paragraph. Parent expresses hierarchy; links express associations.

### Tags

Suggested Tags and Tag Manager are available from the Tags section of a paper in the item pane. **Suggested Tags** proposes topics from related papers and existing library vocabulary; review the list and add the ones you want. **Tag Manager** groups similar names, shows why they match, and lets you review a merge, rename or format labels. Excluded Tags accepts names, `*` patterns, `@colored` and `@auto`; for example, `@colored, reading*` hides colored tags and names beginning with “reading”. Rules apply to suggestions, the manager and note displays.

### Similar items

Open the **Similar Items** section for a paper in the item pane. Results load locally and continue as you scroll, including papers without full text. On macOS, semantic search downloads the files it needs.

### Graph

Open the graph from the Knowledge Base toolbar; **Show in graph** opens a local view for the selected note. **Structure** follows parents, **References** follows note links. Filter by note type or relationship and switch between all notes and the local neighborhood. Node colors come from Group tags configured in Settings.

### Reading

**Read & Write** beside Source opens the PDF and selects the note in Zotero’s sidebar. **Use Knowledge Base for native notes** controls whether the sidebar, note tabs and note windows use this editor. Command-Shift-X on macOS (Ctrl-Shift-X elsewhere) captures a dragged region to the clipboard. The Knowledge Base button beside the page number opens the paper’s Literature Note; Command/Ctrl-click creates one when missing. **Show in Library** opens the personal parent used for notes without a paper source.

### Appearance

Choose Minimal, Bear or Notes and light or dark colors in Settings. Closing a note with unsaved changes asks to save, cancel or discard.

## License

Copyright 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Developed with ChatGPT and DeepSeek.
