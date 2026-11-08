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
source-item-required = Choose a Zotero item as Source.
editor-source-format-failed = Could not format Source:
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
section-new = New note
section-new-zettel = New Note
section-zettels = Notes · { $count }

manager-title = Knowledge Base
manager-new = New Note
manager-copy-zettels = Copy note outline
manager-copy-zettels-done = Copied { $count } notes
manager-copy-zettels-empty = No notes to copy
manager-search-placeholder = Search notes…
manager-empty-detail = Select a note
manager-outgoing = Linked notes
manager-backlinks = Backlinks
manager-preview = Preview
manager-edit = Edit
manager-delete = Move to Trash
manager-unresolved = Unavailable links
manager-unresolved-tip = Open the referring note to fix this link
manager-link-trashed = Restore the note from Trash to reconnect.
manager-unavailable-note = Note ({ $key })
manager-formula = [formula]
manager-untitled = Untitled
manager-source = Source
manager-source-open = Open source
manager-source-missing = Source unavailable
manager-count =
    { $count ->
        [one] { $count } note
       *[other] { $count } notes
    }
manager-updated = Updated
manager-confirm-delete = Move “{ $title }” to Trash?

editor-title-new = New Note
editor-title-edit = Edit Note
editor-source-label = Source
reading-open = Read & Write
clip-figure = Copy Figure
clip-unavailable = This PDF view cannot capture a figure yet.
clip-note-required = This note is not editable.
clip-insert-failed = The figure could not be saved. Keep the note open and try again.
reading-no-pdf = This note’s source has no PDF.
reading-file-missing = The PDF is not available locally. Download it in Zotero first.
editor-src-none = No source
editor-src-pick = Choose source
editor-src-change = Change
editor-src-jump = Open item
editor-src-anno = Insert highlights
editor-src-placeholder = Search Zotero items by title or author…
editor-anno-empty = No highlights
editor-anno-insert = Insert selected
editor-anno-cancel = Cancel
editor-cancel = Close
editor-apply-draft = Apply draft
search-query-too-long = Use up to 16 keywords, or put a phrase in double quotes.
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
picker-empty = No highlights
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
editor-src-no-selection = Select a Zotero item first.
editor-src-insert = Insert source link
editor-reference-insert = Insert item or note reference
editor-link-pick = Insert note link
editor-link-placeholder = Search notes…
editor-link-empty = No matching notes
editor-mode = Editor mode
editor-body-placeholder = Write a note… Use [[ID]] to link notes.
editor-format-text = Text
editor-searching = Searching…
editor-search-empty = No matching references
editor-search-failed = Search failed:
editor-action-failed = Action failed:
editor-url-insert = Insert link
editor-url-prompt = Link address
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
graph-connections = Connections
graph-search = Search notes…
graph-hint = Click to select. Double-click to open.
graph-empty = No matching notes
graph-stats = { $cards } notes · { $links } connections
graph-kind-card = Note
graph-kind-unresolved = Missing card

section-load-error = Could not load notes. Select the item again.

editor-relations = Connections

editor-visual = Visual editing

hierarchy = Knowledge outline
parent = Parent
children = Children
root = No parent
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

graph-hierarchy = Hierarchy

graph-links = Note links

graph-outgoing = References

graph-backlinks = Cited by

graph-open-card = Edit note


column-card-count = Notes

editor-source-mode = Markdown source
editor-unsaved = Waiting to save…
editor-saving = Saving…
editor-saved = Saved
editor-save-conflict = Note changed elsewhere. Draft kept. Reopen to merge.
editor-close-unsaved = Save changes or keep a draft before closing?
editor-close-cancel = Cancel
editor-save-close = Save and close
editor-draft-close = Keep draft and close
citation-unresolved = No unique item matches citation key { $key }. Check the key or use a direct item link.
editor-draft-restored = Draft preview. Apply to restore.
editor-draft-missing = This draft has already been saved or is unavailable.
manager-back = Back
manager-forward = Forward
manager-drafts = Recovery drafts
manager-restore-draft = Open draft
editor-save-copy = Save as new card
editor-remove-source = Remove source

editor-note-missing = Note unavailable. Check Zotero Trash.

editor-browse = Browse
editor-edit = Edit

literature-source-required = Choose a literature item as the source.
literature-exists = This item already has a Literature Note. Open it from the item pane.

relations-hierarchy = Hierarchy
panel-resize = Resize panel
health-note-trashed = Note in Zotero Trash. Restore to reconnect.
health-note-missing = The original Zotero note is unavailable.
health-source-trashed = Source in Zotero Trash
health-source-missing = Source unavailable. Choose another source.
health-restore = Restore original
health-read-only = This library is read-only.
editor-format-native = Rich text
editor-format-markdown = Markdown
graph-outline = Structure
graph-references = References
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
note-reference-copied = Reference copied.

markdown-node-citation = Citation
markdown-node-annotation = Annotation
markdown-node-note-link = Note link
markdown-node-image = Image

editor-key = ID

editor-key-auto = Automatic

editor-parent-none = No parent

editor-change-source = Change Source…

editor-change-parent = Change Parent…

editor-key-invalid = Use an ID without spaces, brackets, | or a leading @.

editor-key-exists = This ID belongs to another note.
editor-key-resolve = Use available ID

pref-groups-heading = Groups
pref-graph-label-length = Title length
pref-graph-label-length-unit = characters
pref-add-group =
    .label = New group
graph-group-tag = Tag
graph-group-tag-placeholder = Choose or type a tag
graph-group-tag-hint = Set graph colors for matching note tags.
graph-group-color = Group color
graph-group-up = Move up
graph-group-remove = Remove group

graph-global = Global Graph
graph-local = Local Graph
pref-graph-local-depth = Depth

manager-sort = Sort notes
manager-sort-updated-desc = Recently modified
manager-sort-updated-asc = Oldest modified
manager-sort-created-desc = Recently created
manager-sort-created-asc = Oldest created
manager-sort-title-asc = Title: A to Z
manager-sort-title-desc = Title: Z to A
manager-sort-id-asc = ID: Ascending
manager-sort-id-desc = ID: Descending
pref-graph-appearance = Graph

pref-literature-template = Note Templates
pref-template-choice =
    .label = Use for this type
template-none = No template
pref-template-edit = Content (Markdown)
pref-template-name = Name
template-untitled = Untitled Template
template-delete-confirm = Delete template “{ $name }”? Existing notes will stay unchanged.
literature-template-invalid = Template settings are invalid. Saved templates have not been replaced.
literature-template-name-invalid = Enter a unique, nonempty template name.
pref-template-new =
    .label = New
pref-template-delete =
    .label = Delete

note-tags = Tags
note-tags-edit = Edit tags…
note-tags-done = Done
note-tag-add = Add tag, press Enter
note-tag-remove = Remove tag { $tag }
section-source-note = Literature note
section-source-note-open = Open literature note
section-source-note-new = New literature note

manager-view = Note view
manager-view-all = All Notes
manager-view-literature = Literature
manager-view-zettel = Zettel
manager-view-thinking = Thinking
trash-title = Trash
trash-restore = Restore
trash-empty = Empty Trash…
trash-cancel = Cancel
trash-delete = Delete Permanently…
trash-select-note = Select a deleted note to view or restore
trash-confirm-delete = Permanently delete “{ $title }” and its attachments? This cannot be undone.
trash-confirm-empty = Permanently delete { $count } notes and their attachments from Knowledge Base Trash? This cannot be undone. Source papers and notes outside Knowledge Base are kept.
trash-progress = Deleting notes: { $done } / { $total }
trash-delete-done = Permanently deleted { $count } notes.
trash-delete-cancelled = Cancelled. Permanently deleted { $count } notes.
trash-delete-skipped = Kept { $count } notes that were restored, unavailable or read-only.
trash-delete-failed = Deleted { $count } notes before deletion failed for { $note }: { $error }
trash-restored = Note restored.

manager-open-note = Open note
manager-open-note-window = Open in New Window
manager-copy-note-link = Copy Note Link

pref-ui-style = Style

text-tools-normalize = Normalize
text-tools-find = Find
text-tools-unchanged = No formatting changes needed.
text-tools-failed = Could not complete this text action.
text-tools-done = Formatted { $count } occurrences.
text-search-find = Find
text-search-replace = Replace
text-search-next = next
text-search-previous = previous
text-search-all = all
text-search-case = match case
text-search-regexp = regexp
text-search-word = by word
text-search-replace-all = replace all
text-search-close = close
text-search-line = Go to line
text-search-go = go
text-search-current = current match
text-search-on-line = on line
text-search-replaced-line = replaced match on line $
text-search-replaced-count = replaced $ matches


settings-common = Appearance
settings-tags = Tags
settings-notes = Notes


section-notes = Notes
section-tags = Suggested Tags
section-tags-empty = No suggested tags
section-tags-manage = Manage tags
section-similar = Similar Items
section-similar-refresh = Refresh similar items
section-tags-add = Add selected tags
section-tags-new = New
section-tags-existing = Existing
section-tags-add-error = Could not add tags. Try again.
section-tags-load-error = Could not load suggested tags. Select the item again.
pref-template-manage =
    .label = Templates…

template-empty = No templates yet

note-type-change = Change note type
note-type-literature = Literature
note-type-zettel = Zettel
note-type-thinking = Thinking
note-type-entity = Entity
manager-view-entity = Entity

menu-open-native-note = Open in Knowledge Base

graph-view = Graph view

excluded-placeholder =
    .placeholder = @colored, @auto, reading*
    .title = @auto hides automatic tags. @colored hides colored tags. * matches any text.
status-heading = Status
vectors-label = Cache
vector-ready = Ready
vector-updating = Updating
vector-error = Error
note-counts = Notes { $total } · Literature { $literature } · Zettel { $zettel } · Thinking { $thinking } · Entity { $entity }
pref-template-type =
    .value = Note type
pref-template-literature-option =
    .label = Literature
pref-template-zettel-option =
    .label = Zettel
pref-template-thinking-option =
    .label = Thinking
pref-template-entity-option =
    .label = Entity



cache-progress =
    .aria-label = Cache progress

graph-outline-hint = Parent–child relationships you organize.
graph-references-hint = References written in note text.

pref-native-note-takeover =
    .label = Use Knowledge Base for native notes
    .tooltiptext = Use the shared editor in the sidebar, note tabs and note windows.
reader-more-tools = More tools
native-note-switch-save = Save the open note before changing its editor.

pref-math-preview =
    .label = Math preview (notes and annotations)
    .tooltiptext = Render formulas in Zotero note cards and PDF annotation comments. Click a comment to edit its LaTeX. Saved content stays unchanged.
pref-ui-notes =
    .label = Notes

reader-open-literature = Open Literature Note
reader-create-literature-mac = Command-click to create a Literature Note.
reader-create-literature-ctrl = Ctrl-click to create a Literature Note.

settings-enhancement = Enhancement

editor-link-keys = ↑↓ Choose · Enter Insert · Esc Close
