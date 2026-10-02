startup-begin = Loading Knowledge Base
startup-finish = Knowledge Base ready
startup-db-error = Failed to initialize the knowledge base. See Help → Debug Output Logging

menu-open-manager = Knowledge Base
menu-new-zettel = New Card

section-header =
    .label = Cards
section-sidenav =
    .tooltiptext = Cards
section-count =
    { $count ->
        [one] { $count } card
       *[other] { $count } cards
    }
section-no-item = Select an item to see its cards
section-loading = Loading…
section-new = ＋ New card

manager-title = Knowledge Base
manager-new = New Card
manager-search-placeholder = Search title, body or ID…
manager-empty-detail = Select a card on the left; double-click to edit
manager-outgoing = Linked cards
manager-backlinks = Backlinks
manager-preview = Preview
manager-edit = Edit
manager-delete = Delete
manager-unresolved = Missing cards
manager-unresolved-tip = Click to create a card
manager-untitled = Untitled
manager-source = Source
manager-source-open = Open this item in Zotero
manager-source-missing = Source item deleted or unavailable
manager-count =
    { $count ->
        [one] { $count } card
       *[other] { $count } cards
    }
manager-updated = Updated
manager-confirm-delete = Delete "{ $title }"? Links to this card will remain but will no longer open it.

editor-title-new = New Card
editor-title-edit = Edit Card
editor-title-placeholder = Card title
editor-source-label = Source:
editor-src-none = No source item linked
editor-src-pick = Choose source
editor-src-change = Change source
editor-src-jump = Open item
editor-src-anno = Insert highlights
editor-src-placeholder = Search title or author…
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
section-import-highlights = Create cards from highlights ({ $count })
section-import-highlights-all-done = All highlights imported
section-import-highlights-tip = { $total } highlight annotations on this item

# PDF reader
reader-menu-new-zettel = Create cards ({ $count })
reader-menu-open-zettel = Open cards ({ $count })
reader-anno-new = +Card
reader-anno-open = Cards · { $count }
reader-anno-new-tip = Create a card from this highlight
reader-anno-open-tip = Open the card created from this highlight
reader-created =
    { $count ->
        [one] Created { $count } card
       *[other] Created { $count } cards
    }
reader-skipped =
    { $count ->
        [one] Skipped { $count } highlight (card already exists)
       *[other] Skipped { $count } highlights (cards already exist)
    }
reader-failed = { $count } failed
reader-create-failed = Could not create the card. See Help → Debug Output Logging

# Batch import dialog
picker-title = Create cards from highlights
picker-close = Close
picker-empty = This item has no convertible highlights
picker-create = Create cards
picker-create-count =
    { $count ->
        [one] Create { $count } card
       *[other] Create { $count } cards
    }
picker-toggle = Select / deselect all
picker-no-card = No card yet
picker-cards =
    { $count ->
        [one] { $count } card
       *[other] { $count } cards
    }
picker-created =
    { $count ->
        [one] Created { $count } card
       *[other] Created { $count } cards
    }
picker-skipped = Skipped { $count } (already imported)
picker-failed = { $count } failed
picker-nothing = Nothing to create

# Markdown editing and links
editor-src-selected = Use selected item
editor-src-no-selection = Select a reference in Zotero first
editor-src-insert = Insert source link
editor-link-pick = Insert card link
editor-link-placeholder = Search card title, body or ID…
editor-link-empty = No matching cards. You can also write [[New concept]].
editor-preview = Live preview
editor-body-placeholder = Write in Markdown. Type [[ID]] to reference a card.
editor-format-text = Text
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
graph-local-one = Show in graph
graph-local-two = Extended connections
graph-sources = Source items
graph-unresolved = Missing cards
graph-fit = Fit view
graph-refresh = Refresh
graph-focus = Focus this node
graph-open = Open
graph-create = Create card
graph-connections = Links & backlinks
graph-search = Search cards…
graph-hint = Click to inspect; double-click to open. Solid lines show parent → child; dashed lines show references.
graph-empty = No nodes match this view. Create a card and insert card links in its body to connect ideas.
graph-stats = { $cards } cards · { $links } connections
graph-kind-card = Card
graph-kind-source = Source item
graph-kind-unresolved = Missing card
graph-legend-cards = ● Cards · solid: parent–child · dashed: card links
graph-legend-sources = ◈ Sources
graph-legend-unresolved = ○ Missing cards

section-load-error = Could not load cards. Select the item again to retry.


editor-relations = Card connections

editor-visual = Visual editing

hierarchy = Knowledge outline
parent = Parent
children = Children
entries = Entry points
root = Entry point
parent-search = Find parent by ID or title
references = References
both = Outline + references

new-child = New child

command-menu = Insert
command-search = Find a command…
command-empty = No matching commands
command-heading = Heading
command-list = List
command-task = Task
command-quote = Quote
command-code = Code block
command-table = Table
more-actions = More actions

manager-show-graph = Show in graph

graph-display = Display

graph-hierarchy = Parent–child hierarchy

graph-links = Card links

graph-outgoing = Outgoing links

graph-backlinks = Backlinks

graph-open-card = Edit card

graph-open-source = Open source item
