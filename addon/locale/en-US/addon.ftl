startup-begin = Loading Knowledge Base
startup-finish = Knowledge Base ready
startup-db-error = Failed to initialize the knowledge base. See Help → Debug Output Logging

menu-open-manager = Knowledge Base
pref-workbench-heading = Workbench
pref-workbench-mode = Open in
pref-workbench-tab =
    .label = Zotero tab
pref-workbench-window =
    .label = Separate window
pref-source-heading = Source References
pref-source-style = Bibliography style
pref-source-help = Uses styles installed in Zotero. Change or add styles in Settings → Cite.
source-style-missing = Bibliography style unavailable — choose an installed style
editor-source-format-failed = Could not format Source:
editor-more = More actions
editor-open-window = Open in Separate Window
editor-convert-zettel = Convert to Zettel
editor-convert-thinking = Convert to Thinking
personal-knowledge-title = Personal Knowledge

menu-new-zettel = New Card

section-header =
    .label = Cards
section-sidenav =
    .tooltiptext = Cards
section-count =
    { $count ->
        [one] { $count } note
       *[other] { $count } notes
    }
section-no-item = Select an item to see its notes
section-loading = Loading…
section-new = ＋ New card

manager-title = Knowledge Base
manager-new = New Note
manager-search-placeholder = Search title, body or ID…
manager-empty-detail = Select a note; double-click to edit
manager-outgoing = Linked notes
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
        [one] { $count } note
       *[other] { $count } notes
    }
manager-updated = Updated
manager-confirm-delete = Delete "{ $title }"? Links to this note will remain but will no longer open it.

editor-title-new = New Note
editor-title-edit = Edit Note
editor-title-placeholder = Note title
editor-source-label = Source:
editor-src-none = No source
editor-src-pick = Choose source
editor-src-change = Change
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
editor-reference-insert = Insert item or note reference
editor-link-pick = Insert note link
editor-link-placeholder = Search note title, body or ID…
editor-link-empty = No matching notes. You can also write [[New concept]].
editor-reading = Reading View
editor-mode = Editor mode
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

graph-title = Note graph
graph-all = All notes
graph-local-one = Show in graph
graph-local-two = Extended connections
graph-unresolved = Missing cards
graph-fit = Fit view
graph-refresh = Refresh
graph-focus = Focus this node
graph-open = Open
graph-create = Create card
graph-connections = Links & backlinks
graph-search = Search notes…
graph-hint = Click to inspect; double-click to open. Solid lines show parent → child; dashed lines show references.
graph-empty = No nodes match this view. Create a card and insert card links in its body to connect ideas.
graph-stats = { $cards } notes · { $links } connections
graph-kind-card = Note
graph-kind-source = Source item
graph-kind-unresolved = Missing card
graph-legend-cards = ● Notes · solid: parent–child · dashed: card links
graph-legend-sources = ◈ Sources
graph-legend-unresolved = ○ Missing cards

section-load-error = Could not load notes. Select the item again to retry.


editor-relations = Connections

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

graph-open-card = Edit note

graph-open-source = Open source item

column-card-count = Notes

editor-source-mode = Markdown source
editor-unsaved = Waiting to save…
editor-saving = Saving…
editor-saved = Saved
editor-save-conflict = This card changed elsewhere. Your draft is preserved. Reopen the latest card before merging your changes.
editor-close-unsaved = Save changes or keep a draft before closing?
editor-close-cancel = Cancel
editor-save-close = Save and close
editor-draft-close = Keep draft and close
citation-unresolved = No unique item matches citation key { $key }. Check the key or use a direct item link.
editor-draft-restored = Recovered draft. Save to apply it to the note.
editor-draft-missing = This draft has already been saved or is unavailable.
manager-back = Back
manager-forward = Forward
manager-drafts = Recovery drafts
manager-restore-draft = Open draft
editor-save-copy = Save as new card
editor-remove-source = Remove source

editor-note-missing = The linked Zotero note is missing or in the trash. Restore it in Zotero before editing this card.

editor-browse = Browse
editor-edit = Edit

note-kind = Note type
note-kind-all = All notes
note-kind-literature = Literature Note
note-kind-zettel = Zettel
note-kind-thinking = Thinking Note
literature-source-required = Choose a literature item as the source.
literature-exists = This item already has a Literature Note. Open it from the item pane.
manager-confirm-remove = Remove “{ $title }” from Knowledge Base? The original Zotero note will be kept.

relations-hierarchy = Hierarchy
panel-resize = Resize panel
health-note-trashed = This note is in Zotero Trash. Restoring it reconnects the same card.
health-note-missing = The original Zotero note is unavailable.
health-source-trashed = The source is in Trash. The original link is retained.
health-source-missing = The source is unavailable. Choose another source to relink it.
health-restore = Restore original
health-read-only = This library is read-only.
editor-format-native = Rich text
editor-format-markdown = Markdown
graph-outline = Hierarchy
graph-references = References
graph-sources = Sources
graph-hide-isolated = Hide isolated nodes

preview-image-missing = Image unavailable

native-markdown-label = Markdown note
native-markdown-reload = Reload note
native-markdown-conflict = This note changed elsewhere. Your draft is kept.
native-markdown-failed = Could not save. Your draft is kept.
native-markdown-draft = Draft restored
native-markdown-close = Save changes before closing?

editor-outline-parent = Parent

manager-source-item = Source · Zotero

note-reference-copy = Copy note reference

markdown-node-citation = Citation
markdown-node-annotation = Annotation
markdown-node-note-link = Note link
markdown-node-image = Image

editor-key = Key

editor-key-auto = Automatic

editor-parent-none = No parent

editor-change-source = Change Source…

editor-change-parent = Change Parent…

editor-key-invalid = Use a key without spaces, brackets, | or a leading @.

editor-key-exists = This key belongs to another note.

manager-deleted-notes = In Zotero Trash

pref-tags-heading = Note tags
pref-inherit-tags =
    .label = Inherit parent tags
pref-inherit-tags-help = Include tags from Zotero parent items and ancestor cards. Native note tags remain unchanged.
pref-groups-heading = Graph groups
pref-graph-label-length = Graph title length
pref-graph-label-length-unit = characters
pref-groups-help = Choose a tag and color for each group. The first matching group takes priority; matching notes cluster together.
pref-add-group =
    .label = New group
graph-group-tag = Choose tag
graph-group-color = Group color
graph-group-up = Move up
graph-group-remove = Remove group
