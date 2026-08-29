# GonzoWrite

GonzoWrite is a Linux-first, local-first WYSIWYG Markdown editor designed to produce clean GitHub-Flavored Markdown.

The current repository contains the Tauri 2/React application shell and its Phase 1 document core. Native file dialogs, tabs, atomic autosave, session restore, recent notes, external-change protection, drag-and-drop opening, and command-line/single-instance opening are functional.

Raw Markdown is the editable view in Phase 1. The visual view is intentionally a read-only placeholder until the tested GFM/TipTap round-trip layer is introduced in Phase 2.

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
