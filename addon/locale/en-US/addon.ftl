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
pref-source-help = Manage styles in Settings → Cite.
source-style-missing = Choose an available citation style.
editor-source-format-failed = Could not format Source:
editor-more = More
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
section-new = ＋ New Note

manager-title = Knowledge Base
manager-new = New Note
manager-copy-zettels = Copy Zettel outline
manager-copy-zettels-done = Copied { $count } Zettels
manager-copy-zettels-empty = No Zettels to copy
manager-search-placeholder = Search notes…
manager-empty-detail = Select a note
manager-outgoing = Linked notes
manager-backlinks = Backlinks
manager-preview = Preview
manager-edit = Edit
manager-delete = Move to Zotero Trash
manager-unresolved = Unavailable links
manager-unresolved-tip = Open the referring note to fix this link
manager-link-trashed = Restore the note from Zotero Trash to reconnect.
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
manager-confirm-delete = Move “{ $title }” to Zotero Trash?

editor-title-new = New Note
editor-title-edit = Edit Note
editor-source-label = Source:
editor-src-none = No source
editor-src-pick = Choose source
editor-src-change = Change
editor-src-jump = Open item
editor-src-anno = Insert highlights
editor-src-placeholder = Search title or author…
editor-anno-empty = No highlights
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
editor-src-no-selection = Select a reference in Zotero first
editor-src-insert = Insert source link
editor-reference-insert = Insert item or note reference
editor-link-pick = Insert note link
editor-link-placeholder = Search notes…
editor-link-empty = No matching notes
editor-reading = Reading View
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
graph-connections = Links & backlinks
graph-search = Search notes…
graph-hint = Click to select; double-click to open.
graph-empty = No matching notes
graph-stats = { $cards } notes · { $links } connections
graph-kind-card = Note
graph-kind-source = Source item
graph-kind-unresolved = Missing card
graph-legend-cards = ● Notes · solid: parent–child · dashed: card links
graph-legend-sources = ◈ Sources
graph-legend-unresolved = ○ Missing cards

section-load-error = Could not load notes. Select the item again.

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

graph-hierarchy = Hierarchy

graph-links = Note links

graph-outgoing = Outgoing links

graph-backlinks = Backlinks

graph-open-card = Edit note

graph-open-source = Open source item

column-card-count = Notes

editor-source-mode = Markdown source
editor-unsaved = Waiting to save…
editor-saving = Saving…
editor-saved = Saved
editor-save-conflict = Note changed elsewhere. Draft kept; reopen to merge.
editor-close-unsaved = Save changes or keep a draft before closing?
editor-close-cancel = Cancel
editor-save-close = Save and close
editor-draft-close = Keep draft and close
citation-unresolved = No unique item matches citation key { $key }. Check the key or use a direct item link.
editor-draft-restored = Draft restored; save to apply.
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

note-kind = Note type
note-kind-all = All notes
note-kind-literature = Literature Note
note-kind-zettel = Zettel
note-kind-thinking = Thinking Note
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

editor-key = Note ID

editor-key-auto = Automatic

editor-parent-none = No parent

editor-change-source = Change Source…

editor-change-parent = Change Parent…

editor-key-invalid = Use an ID without spaces, brackets, | or a leading @.

editor-key-exists = This ID belongs to another note.
editor-key-resolve = Use available ID

pref-tags-heading = Note tags
pref-inherit-tags =
    .label = Inherit parent tags
pref-inherit-tags-help = Include tags from source items and parent notes.
pref-groups-heading = Graph groups
pref-graph-label-length = Title length
pref-graph-label-length-unit = characters
pref-groups-help = First matching group takes priority.
pref-add-group =
    .label = New group
graph-group-tag = Choose tag
graph-group-color = Group color
graph-group-up = Move up
graph-group-remove = Remove group

graph-global = Global Graph
graph-local = Local Graph
pref-graph-local-depth = Local graph depth

manager-sort = Sort notes
manager-sort-updated-desc = Recently modified
manager-sort-updated-asc = Oldest modified
manager-sort-created-desc = Recently created
manager-sort-created-asc = Oldest created
manager-sort-title-asc = Title: A to Z
manager-sort-title-desc = Title: Z to A
manager-sort-id-asc = ID: Ascending
manager-sort-id-desc = ID: Descending
pref-ai-heading = AI (Experimental)
pref-ai-provider = Service
pref-ai-model = Model
pref-ai-key = API key
pref-ai-show-key = Show API key
pref-ai-hide-key = Hide API key
pref-ai-path = CLI path
ai-remove-key = Remove
ai-connect = Establish connections
ai-apply = Apply
ai-close = Close
ai-cancel = Cancel
ai-parent = Suggested parent
ai-review = Parents: { $parents } · Connections: { $links } · Full notes checked: { $read }. Compare both passages, then select changes. Highlighted words become links.
ai-evidence-current = This note
ai-evidence-target = Target note
ai-parent-from = Current parent: { $parent }
ai-parent-none = No parent
ai-link-preview = Link “{ $anchor }” in place.
ai-relation-supports = Supports
ai-relation-contradicts = Contradicts
ai-relation-qualifies = Qualifies
ai-relation-applies = Application
ai-relation-extends = Extends
ai-relation-shared-mechanism = Shared mechanism
ai-no-connections = No suggestions
ai-preparing = Saving…
ai-progress-titles = Finding notes · { $count } / { $total }
ai-progress-retrieval = Searching note bodies and cached summaries…
ai-progress-evidence = Checking both source passages…
ai-progress-summaries = Reading summaries · { $count } / { $total }
ai-progress-reading = Reading notes · { $count }
ai-applied = Applied
ai-zettel-required = Open an editable Zettel.
ai-save-required = Save the note first.
ai-plan-stale = Notes changed. Analyze again.
ai-note-too-long = Note exceeds 60,000 characters; no changes applied.
ai-response-invalid = Invalid response. Retry or change model.
ai-json-invalid = Invalid response format. Retry or change model.
ai-response-empty = No answer. Retry or change model.
ai-response-truncated = Incomplete answer; no changes applied. Try another model.
ai-settings-invalid = Check the AI service settings.
ai-key-required = Add a { $provider } API key in Settings.
ai-busy = This analysis is already running.
ai-cancelled = Analysis cancelled.
ai-timeout = The AI request timed out. Try again.
ai-cli-failed = { $provider } failed ({ $code }). Test the connection in Settings.
ai-http-failed = { $provider } failed ({ $code }). Check service settings.
ai-key-stored = Key stored; enter a replacement
ai-key-placeholder = API key
ai-test = Test connection
ai-testing = Testing connection…
ai-test-success = Connection successful.

pref-general-heading = General
pref-ai-advanced = Advanced
pref-ai-api-help = Uses an existing environment key when available.
pref-ai-opencode-go-help = Uses your OpenCode Go subscription key.
ai-context-too-long = Selected full notes exceed the analysis context limit. No changes were applied.
ai-free-restricted = OpenCode rejected this Free model outside OpenCode. Choose a supported Go or API model. Your saved keys are unchanged.
pref-ai-cli-help = Uses your { $provider } login.
pref-ai-privacy = Analysis sends this note and related notes to the selected service.
ai-cli-auto-path = Find automatically
ai-cli-not-found = Install { $provider } or set its path under Advanced.
ai-balance-required = Insufficient { $provider } balance.
ai-models-unavailable = Could not load models. Enter a model name.
ai-show-key-short = Show
ai-hide-key-short = Hide

pref-graph-appearance = Graph appearance

ai-list-models = Choose model
ai-listing-models = Loading models…
ai-models-listed = { $count } models
ai-default-model = Default model

ai-provider-unavailable = Service unavailable. Choose another.
pref-ai-open = AI Settings…
pref-ai-enabled = Enable AI features
pref-ai-enabled-help = Off by default. Disable to cancel analysis and hide AI actions. Saved settings and keys are retained.
ai-disabled = Enable AI features in Settings first.
