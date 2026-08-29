# GonzoWrite

GonzoWrite is a Linux-first, local-first WYSIWYG Markdown editor designed to produce clean GitHub-Flavored Markdown.

The current repository contains the Tauri 2/React application scaffold and an interactive design shell. File persistence and the production editing engines are intentionally scheduled as the next implementation slices.

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

