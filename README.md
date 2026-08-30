# MarkDownGonzo

A local-first, WYSIWYG Markdown editor for Linux that writes clean GitHub-Flavored Markdown.

You spend your time in a polished document. The file on disk stays ordinary `.md`.

---

## Why this exists

I write in [Typora](https://typora.io/) and I love it. Live preview that actually
feels like a document, no split panes, no syntax to fight — it gets out of the
way and lets you write. It set the bar for what a Markdown editor should feel
like.

But I kept wanting a bit more: something Linux-native that I could shape to my own
workflow, tune, and extend instead of waiting on someone else's roadmap.

The nudge to actually build it came from DHH. After he shipped **omawrite** — his
own small writing app — it clicked that I didn't need to keep wishing. If he can
scratch his own itch, so can I.

So MarkDownGonzo is my version: the Typora writing feel, plus the extra pieces I
kept reaching for, on a stack (Tauri + React) I can bend.

## What it does

- **Visual and Raw modes**, one keystroke apart. Write in WYSIWYG; drop to raw
  Markdown whenever you want to see exactly what's on disk.
- **Clean GFM output.** Round-trips are fixture-tested; YAML frontmatter is
  preserved byte-for-byte. A document (and its relative images) renders correctly
  when you commit it to GitHub — no app-specific metadata.
- **Your files stay yours.** No accounts, no sync, no database, no telemetry.
  Just `.md` files in folders you chose.
- Tables, task lists, blockquotes, syntax-highlighted code blocks, and images.
- **Image workflow:** paste, drag-and-drop, or pick a file. Assets are copied
  into a sensible folder next to the document and linked with relative paths.
- Autosave, external-change detection, session restore, and a recent-notes
  sidebar.
- Find and replace across the document.
- **Export to ODT** (built in, no dependencies) and **PDF** (via LibreOffice).
- A clean, tiling-friendly window on Hyprland / Omarchy — no redundant title bar.
- Native Arch package with a `.desktop` entry and `.md` file association.

## Install

### Arch Linux / Omarchy

Build the package from the app directory:

```bash
cd markdowngonzo
./scripts/build-arch-package.sh
sudo pacman -U packaging/arch/markdowngonzo-*-x86_64.pkg.tar.zst
```

Runtime dependencies: `webkit2gtk-4.1`, `gtk3`. For PDF export, install
`libreoffice-fresh` (optional — ODT export works without it).

An AUR package is planned once the first tagged release is out.

## Export to PDF

PDF export renders the document to ODT and hands it to LibreOffice in headless
mode. If LibreOffice isn't installed, PDF export tells you so and ODT export
still works. On Arch:

```bash
sudo pacman -S libreoffice-fresh
```

## Building from source

Requirements: Node.js + npm, Rust, and the Tauri/WebKitGTK system libraries.

```bash
cd markdowngonzo
npm install
npm run tauri dev      # run the app
npm test               # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

Product and implementation notes live in [`docs/`](docs).

## License

MIT — see [LICENSE](LICENSE).
