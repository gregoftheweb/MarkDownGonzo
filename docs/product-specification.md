# MarkDownGonzo Product Specification

Status: Approved for initial implementation  
Platform: Linux  
Document format: GitHub-Flavored Markdown (GFM)

## Product statement

MarkDownGonzo is a fast, local-first Markdown editor for people who spend most of their time in a polished WYSIWYG document but still want direct access to clean, portable Markdown. It is deliberately smaller and more opinionated than a general note-taking system or IDE.

The application must produce ordinary GitHub-compatible Markdown. A document edited in MarkDownGonzo, including its relative image assets, must render correctly when committed to a GitHub repository without conversion or application-specific metadata.

## Product principles

- The WYSIWYG editor is the primary experience; raw Markdown is one command away.
- Files remain the source of truth. MarkDownGonzo has no proprietary document format and no document database.
- The interface is fast, attractive, colorful, and capable of becoming nearly chrome-free.
- Markdown output is clean, portable, and compatible with GitHub.
- Local content remains local. There are no accounts, cloud storage, telemetry, or Git integration.
- Preferences are understandable Linux configuration, not opaque application state.

## Supported platform

- Linux only.
- Desktop application with a standard launcher and file association for `.md` and `.markdown` files.
- Command-line opening is a first-class workflow: `markdowngonzo README.md`.
- MarkDownGonzo is single-instance. Files opened from the command line enter the existing window as tabs.

## Application layout

The primary window contains:

1. A collapsible recent-notes sidebar.
2. A tab strip for open documents.
3. A collapsible top formatting toolbar.
4. A single editor pane, displaying either WYSIWYG or raw Markdown.
5. A compact status area for save state, word count, and zoom.

The sidebar and toolbar are independently collapsible. Focus mode hides both. Visibility is restored between sessions.

## Document model

- Documents are UTF-8 `.md` or `.markdown` files.
- GFM is the supported dialect, including tables, task lists, fenced code blocks, autolinks, and strikethrough.
- YAML frontmatter must be preserved without destructive normalization.
- MarkDownGonzo must not add hidden comments, identifiers, or proprietary metadata to documents.
- Switching between WYSIWYG and raw mode must preserve the document's meaning and supported syntax.
- Existing constructs that cannot be represented visually must be preserved and exposed safely rather than discarded.
- Raw Markdown and WYSIWYG are alternate views of one tab, never a side-by-side layout.
- Raw edits are parsed into the visual document when the user switches back to WYSIWYG.

### Underline

GFM has no underline syntax. The toolbar's underline action uses inline HTML:

```html
<u>underlined text</u>
```

This exception must be visible in raw mode and documented in the interface.

## Editing features

The initial editor supports:

- Paragraphs and headings H1, H2, and H3.
- Bold, italic, underline, and strikethrough.
- Links, blockquotes, inline code, and fenced code blocks.
- Ordered, unordered, and task lists.
- GFM tables with visual row, column, and alignment controls.
- Images from the file picker, drag and drop, and the clipboard.
- Undo, redo, find, replace, and system spellcheck.
- Word and character counts.
- Syntax highlighting and language selection for fenced code blocks.
- Keyboard-accessible formatting and tooltips for discoverability.

Formatting controls are presented in a top toolbar. Less frequently used controls may move into an overflow menu at narrow window widths.

## Typography and zoom

- The toolbar includes a document-wide body-font family selector.
- The selector exposes only a small, curated set of four to six fonts.
- The initial body family is the fontconfig generic family `sans-serif`, which follows the current Omarchy/system default.
- Inline and fenced code use a separately configured monospace family and are not affected by the body-font selector.
- The initial code family is the fontconfig generic family `monospace`.
- Code is visually distinguished with appropriate background, padding, and syntax colors.
- Font choices are display preferences and are never written into Markdown.
- `Ctrl++` and `Ctrl+-` zoom the editor; `Ctrl+0` resets zoom.
- Zoom scales the document while preserving the relative type scale.

The final curated font list will be supplied later. Missing configured fonts fall back safely to the appropriate generic family.

## Files, tabs, and saving

- Native Linux Open and Save dialogs are used.
- Files can also be opened by command line, file association, and drag and drop.
- Multiple documents are managed as reorderable tabs.
- Open tabs, the active tab, cursor positions, scroll positions, and per-file zoom are restored after restart.
- Autosave occurs approximately one second after editing stops.
- `Ctrl+S` saves immediately.
- Writes are atomic wherever the target filesystem permits it.
- New unnamed documents are recovered from application state until assigned a filename.
- If another application changes an open file, MarkDownGonzo must not overwrite it silently. The user chooses whether to reload or retain the in-memory version.
- Closing succeeds without confirmation when all content is safely saved. MarkDownGonzo warns for save failures, unresolved external changes, or unnamed drafts.

## Recent notes sidebar

- The sidebar lists only Markdown documents previously opened or created in MarkDownGonzo.
- Entries are ordered by filesystem modification time, newest first.
- A search field filters the in-memory list by filename and path.
- Missing files are removed automatically.
- The list offers a Clear Recent Notes action.
- MarkDownGonzo does not scan note directories, index document content, create backlinks, or manage a knowledge base.

## Images and assets

- Existing local and remote image references are preserved.
- New local images are copied into a document-relative asset directory.
- MarkDownGonzo reuses a nearby existing `assets`, `images`, or `img` directory when selected by the user; otherwise it defaults to `assets` beside the Markdown document.
- Markdown uses relative links without a leading slash, for example `![Diagram](assets/diagram.png)`.
- Imported filenames are cleaned and collisions receive a numeric suffix. Existing files are never silently overwritten.
- Removing an image from the document removes only its Markdown reference.
- Deleting an underlying image is a separate, explicit, recoverable action.
- Remote HTTPS images load by default, with a privacy setting to disable them.
- MarkDownGonzo does not perform Git operations or display Git status.

Post-MVP sharing features may include a Markdown-and-assets ZIP, a self-contained HTML export, and PDF export.

## Links

- Normal clicking selects or edits a link.
- `Ctrl+Click` opens it.
- Web URLs, `mailto:` URLs, heading fragments, and relative file links are supported.
- External URLs are opened through the system handler.

## Appearance

MarkDownGonzo supports light and dark foundations with these initial accent themes:

- Tron Blue
- Ferrari Red
- McLaren Orange
- Lambo Green

Theme and accent are independent settings. The interface must retain accessible contrast and focus indicators across all combinations.

## Configuration and state

User-editable preferences follow the XDG base-directory convention:

```text
~/.config/markdowngonzo/config.toml
```

The configuration includes editor fonts and sizes, the curated font list, theme, accent, autosave timing, default asset directory, and remote-image behavior. Unknown keys are tolerated, invalid values fall back safely, and a Reload Configuration command is available.

Ephemeral application-managed state is stored separately:

```text
~/.local/state/markdowngonzo/session.json
```

It contains recent paths, open tabs, active tab, cursor and scroll positions, zoom, and interface visibility. State writes are atomic. Document contents are never stored in the recent-file index; only unnamed recovery drafts may be held in session recovery storage.

SQLite is intentionally excluded. The expected metadata is small, loaded into memory, and better served by transparent files. A database may be reconsidered only if a future version adds full-text indexing or knowledge-base features.

## Privacy and network behavior

- No account, analytics, telemetry, advertising, or cloud synchronization.
- No automatic Git, GitHub, or repository integration.
- Network access is limited to resources explicitly referenced by the open document, such as remote images, and can be disabled.
- Spellcheck uses local system capabilities rather than a remote grammar service.

## Initial keyboard commands

Exact bindings may become configurable after the first release.

| Action | Shortcut |
| --- | --- |
| Open | `Ctrl+O` |
| Save | `Ctrl+S` |
| New tab | `Ctrl+N` |
| Close tab | `Ctrl+W` |
| WYSIWYG/raw mode | `Ctrl+Alt+M` |
| Toggle sidebar | `Ctrl+Shift+S` |
| Toggle toolbar | `Ctrl+Shift+T` |
| Focus mode | `Ctrl+Shift+F` |
| Zoom in | `Ctrl++` |
| Zoom out | `Ctrl+-` |
| Reset zoom | `Ctrl+0` |

## MVP acceptance criteria

The first usable release is complete when a user can:

1. Create, open, edit, autosave, explicitly save, and reopen GFM files.
2. Edit the supported syntax in WYSIWYG mode and switch safely to and from raw Markdown.
3. Work with several restorable tabs.
4. Find previously edited files from the collapsible, searchable sidebar.
5. Format text and insert tables, links, lists, code, and images from the top toolbar.
6. Paste, drop, or select an image and receive a portable relative asset reference.
7. Select a curated body font, configure the code font, zoom the document, and use all four accent themes in light or dark mode.
8. Edit a repository README whose resulting GFM and relative assets render correctly on GitHub.
9. Recover safely from a failed save, external file modification, or application restart.

## Explicit non-goals for MVP

- Git or GitHub integration.
- Folder workspaces or content indexing.
- Backlinks, tags, wiki links, or graph views.
- Cloud sync, collaboration, accounts, or mobile support.
- Side-by-side Markdown preview.
- Arbitrary per-selection fonts, sizes, or colors.
- Plugin architecture.
- A proprietary document format.
