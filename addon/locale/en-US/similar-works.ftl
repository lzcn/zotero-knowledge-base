similar-works-empty = No related papers
similar-works-no-text = No full text or abstract
similar-works-unavailable = Similarity index unavailable
similar-works-based-on-weak = metadata only


similar-works-progress =
    .aria-label = Similarity calculation progress

similar-works-pref-limit =
    .value = Initial results
similar-works-pref-index-heading = Cache
similar-works-pref-error = Cache unavailable
similar-works-pref-index-value = { $known ->
    [1] { $phase } · { $count } / { $total }
   *[0] { $phase } · { $count }
    }
similar-works-pref-index-progress =
    .aria-label = Text indexing progress
similar-works-state-preparing = Loading
similar-works-state-waiting = Waiting
similar-works-state-scanning = Checking
similar-works-state-indexing = Updating
similar-works-state-idle = Ready
similar-works-state-disabled = Paused
similar-works-state-stopped = Stopped
similar-works-state-error = Failed
similar-works-state-loading = Preparing
similar-works-state-downloading = Downloading

similar-works-tags-menu =
    .label = Tag Manager
similar-works-tags-search =
    .placeholder = Search existing tags…
    .aria-label = Search existing tags
similar-works-tags-duplicates = Organize similar tags
similar-works-tags-keep = Keep name
similar-works-tags-preview = { $tags } tags → 1 · { $count } items
similar-works-tags-close =
    .label = Close
similar-works-tags-merged = Updated { $count } tags to “{ $name }”.
similar-works-tags-readonly = This library or item cannot be edited.
similar-works-tags-changed = Tags changed. Refresh and select again.
similar-works-tags-cancelled = Operation cancelled.
similar-works-tags-error = Could not update tags: { $message }

similar-works-tags-refresh =
    .label = Refresh
similar-works-tags-invalid-name = Enter a valid name (up to 255 characters).

similar-works-pref-excluded-tags =
    .value = Excluded tags
similar-works-tags-protected = Tag excluded. Check Settings.

similar-works-tags-select-all = Select all
similar-works-tags-selection-count = { $visible } / { $total } · Selected { $selected }
    { $hidden ->
        [0] { "" }
       *[other] · { $hidden } hidden
    }
similar-works-tags-action = Action
similar-works-tags-rename-action =
    .label = Rename
similar-works-tags-merge-action =
    .label = Merge
similar-works-tags-preparing = Preparing preview…
similar-works-tags-no-matches = No matching tags.

similar-works-tags-delete-action =
    .label = Delete

similar-works-tags-delete-button =
    .label = Delete

similar-works-tags-merge-button =
    .label = Merge

similar-works-tags-rename-button =
    .label = Rename

similar-works-tags-delete-preview = Remove { $tags } tags from { $count } items?

similar-works-tags-rename-preview = Rename the tag on { $count } items.

similar-works-tags-deleted = Deleted { $count } tags.

similar-works-tags-renamed = Renamed to “{ $name }”.

similar-works-tags-clear-selection =
    .label = Clear selection




similar-works-source = From

similar-works-tags-window =
    .title = Tag Manager


similar-works-tags-name-column = Name
similar-works-tags-count-column = Items
similar-works-tags-group-column = Similar tag
similar-works-tags-match-name = Name
similar-works-tags-match-plural = Plural
similar-works-tags-match-abbreviation = Abbreviation
similar-works-tags-match-spelling = Spelling

similar-works-tags-collision = This name exists. The tags will be merged.
similar-works-tags-match-alias = Terminology

similar-works-more = More
similar-works-evidence = Match evidence
similar-works-evidence-current = Current paper
similar-works-evidence-match = Matched paper
similar-works-evidence-empty = No shared wording was located in the available text.
similar-works-evidence-failed = Could not load the evidence. Try again.

similar-works-pref-cache-ready = Ready · { $count } items

similar-works-pref-tag-style =
    .value = Tag format
similar-works-pref-tag-sentence =
    .label = Sentence case
similar-works-pref-tag-title =
    .label = Title Case
similar-works-pref-tag-hashtag =
    .label = Add a # prefix
similar-works-tags-format-action =
    .label = Format
similar-works-tags-format-button =
    .label = Format
similar-works-tags-format-to = Formatted
similar-works-tags-format-preview = Change { $tags } tags on { $count } items · Skip { $skipped }
similar-works-tags-format-change = Rename
similar-works-tags-format-unchanged = Unchanged
similar-works-tags-format-structured = Keep structure
similar-works-tags-format-invalid = Invalid name
similar-works-tags-format-protected = Excluded
similar-works-tags-format-collision = Name conflict; merge separately
similar-works-tags-invalid-format = Choose Sentence case or Title Case in Settings.
similar-works-tags-formatted = Formatted { $count } tags.

similar-works-tags-match-semantic = Semantically similar
similar-works-tags-semantic-preparing = Finding similar tags…
similar-works-tags-semantic-unavailable = Name matches only
similar-works-tags-semantic-error = Semantic matching unavailable: { $message }

similar-works-tags-review-group =
    .label = Review group
    .aria-label = Review tags around { $name }
similar-works-tags-review-semantic = Similar meaning; review before merging

similar-works-tags-new-name = New name
