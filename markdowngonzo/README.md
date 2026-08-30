# MarkDownGonzo

MarkDownGonzo is a Linux-first, local-first WYSIWYG Markdown editor designed to produce clean GitHub-Flavored Markdown.

The current repository contains the Tauri 2/React application shell and its Phase 1 document core. Native file dialogs, tabs, atomic autosave, session restore, recent notes, external-change protection, drag-and-drop opening, and command-line/single-instance opening are functional.

Phase 2 adds the TipTap WYSIWYG editor, CodeMirror raw editor, GFM tables and task lists, exact YAML-frontmatter preservation, GitHub-compatible HTML underline, and fixture-tested Markdown round trips. Known unsupported constructs are protected from lossy visual conversion and remain available in Raw mode.

## Development

Requirements:

- Node.js and npm
- Rust
- The Linux system dependencies required by Tauri/WebKitGTK

```bash
npm install
npm run dev
```

To run the desktop shell:

```bash
npm run tauri dev
```

To verify frontend and Rust builds:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Product and implementation documentation lives in [`../docs`](../docs).
