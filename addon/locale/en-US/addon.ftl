startup-begin = Loading Zettel Knowledge Base
startup-finish = Zettel Knowledge Base ready
startup-db-error = Failed to initialize the knowledge base. See Help → Debug Output Logging

menu-open-manager = Zettel Knowledge Base…
menu-new-zettel = New Zettel Card

section-header =
    .label = Zettel Cards
section-sidenav =
    .tooltiptext = Zettel Cards
section-count =
    { $count } zettels
section-no-item = Select an item to see its zettels
section-loading = Loading…
section-new = ＋ New zettel

manager-title = Zettel Knowledge Base
manager-new = New Zettel
manager-search-placeholder = Search title, body or ID…
manager-empty-detail = Select a zettel on the left; double-click to edit
manager-outgoing = Links
manager-backlinks = Backlinks
manager-preview = Preview
manager-edit = Edit
manager-delete = Delete
manager-unresolved = Unresolved refs (click to create)
manager-unresolved-tip = Not created yet, click to create
manager-untitled = Untitled
manager-source = Source
manager-source-open = Open this item in Zotero
manager-source-missing = The source item no longer exists (it may have been deleted)
manager-count =
    { $count } zettels
manager-updated = updated
manager-confirm-delete =
    Delete "{ $title }"? Links pointing to it will become unresolved refs.

editor-title-new = New Zettel
editor-title-edit = Edit Zettel
editor-title-placeholder = Zettel title
editor-source-label = Source:
editor-src-none = No source item linked
editor-src-pick = Pick source
editor-src-change = Change source
editor-src-jump = Open item
editor-src-anno = Insert highlights
editor-src-placeholder = Search title / author…
editor-anno-empty = No highlight annotations on this item
editor-anno-insert = Insert selected
editor-anno-cancel = Cancel
editor-cancel = Close
editor-save = Save
editor-confirm-discard = Unsaved changes, discard them?
editor-save-failed = Save failed:

# Citation rendering (highlight -> card body)
citation-source = Source: { $source }
citation-source-page = Source: { $source }, p. { $page }
citation-page-note = (p. { $page })

# Item pane: batch import from highlights
section-import-highlights = From highlights ({ $count })
section-import-highlights-all-done = All highlights imported
section-import-highlights-tip = { $total } highlight annotations on this item

# PDF reader
reader-menu-new-zettel = Create Zettel card(s) ({ $count })
reader-menu-open-zettel = Open existing card(s) ({ $count })
reader-anno-new = +Zettel
reader-anno-open = Zettel·{ $count }
reader-anno-new-tip = Create a card from this highlight
reader-anno-open-tip = Open the card created from this highlight
reader-created = Created { $count } card(s)
reader-skipped = Skipped { $count } existing card(s)
reader-failed = { $count } failed
reader-create-failed = Could not create the card. See Help → Debug Output Logging

# Batch import dialog
picker-title = Create cards from highlights
picker-close = Close
picker-empty = This item has no convertible highlights
picker-create = Create cards
picker-create-count = Create { $count } card(s)
picker-toggle = Select / deselect all
picker-no-card = no card yet
picker-cards = { $count } card(s)
picker-created = Created { $count } card(s)
picker-skipped = Skipped { $count } (already imported)
picker-failed = { $count } failed
picker-nothing = Nothing to create

# Markdown editing and links
editor-src-selected = Use selected Zotero item
editor-src-no-selection = Select a reference in Zotero first
editor-src-insert = Insert source link
editor-link-pick = Insert card link
editor-link-placeholder = Search card title, body or ID…
editor-link-empty = No matching cards. You can also write [[New concept]].
editor-preview = Live preview
editor-body-placeholder = Write in Markdown: headings, lists, quotes, code and tables. Type [[ or use Insert card link to connect cards.
editor-format-text = text
editor-searching = Searching…
editor-search-empty = No matching references
editor-search-failed = Search failed:
editor-action-failed = Action failed:
editor-url-insert = Insert link
editor-url-prompt = Link URL (https://, mailto: or zotero://)
editor-image = Insert image
editor-relations-empty = No connections yet

graph-title = Card graph
graph-all = All cards
graph-local-one = Current card · 1 hop
graph-local-two = Current card · 2 hops
graph-sources = Reference sources
graph-unresolved = Unresolved references
graph-fit = Fit view
graph-refresh = Refresh
graph-focus = Focus this node
graph-open = Open
graph-create = Create card
graph-connections = Connections and context
graph-search = Search node title, body or ID…
graph-hint = Click a node to inspect connections; double-click to open. Scroll to zoom, drag the canvas to pan, or drag a node. Arrows show the direction of references.
graph-empty = No nodes match this view. Create a card and insert card links in its body to connect ideas.
graph-stats = { $cards } cards · { $links } connections
graph-kind-card = Zettel card
graph-kind-source = Reference source
graph-kind-unresolved = Unresolved concept
graph-legend-cards = ● Cards · arrows: references
graph-legend-sources = ◈ Sources · dashed: provenance
graph-legend-unresolved = ○ Unresolved references

section-load-error = Could not load cards. Select the item again to retry.
