# MarkDownGonzo

A local-first, WYSIWYG Markdown editor for Linux that writes clean GitHub-Flavored Markdown.

You spend your time in a polished document. The file on disk stays ordinary `.md`.

> **Status:** v1.0. Feature-complete and daily-driven.

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
- Find and replace across the document. Print via the system dialog.
- **Export to ODT** (built in, no dependencies) and **PDF** (via LibreOffice).
- Borderless on Hyprland / Omarchy, a normal titled window everywhere else —
  set it either way under Settings → Window frame.
- Bundled fonts, `.desktop` entry, and `.md` file association.

## Install

Runtime dependencies everywhere: **WebKitGTK 4.1** and **GTK 3** (both in every
mainstream distro's repos). For PDF export, `libreoffice` — optional; ODT export
and everything else work without it.

### Any distro — download a build

Grab the latest `.deb`, `.rpm`, or `.AppImage` from the
[releases page](https://github.com/gregoftheweb/MarkDownGonzo/releases).

```bash
# Debian / Ubuntu / Mint / AnduinOS
sudo apt install ./markdowngonzo_*_amd64.deb

# Fedora / openSUSE
sudo dnf install ./markdowngonzo-*.x86_64.rpm

# AppImage (any distro)
chmod +x markdowngonzo_*_amd64.AppImage
./markdowngonzo_*_amd64.AppImage
```

The AppImage needs FUSE 2. If it won't start, either
`sudo apt install libfuse2` (`libfuse2t64` on Ubuntu 24.04+) or run it with
`./markdowngonzo_*.AppImage --appimage-extract-and-run`.

### Arch Linux / Omarchy

Once the first release is tagged, install from the AUR:

```bash
yay -S markdowngonzo
```

Until then, build locally:

```bash
cd markdowngonzo
./scripts/build-arch-package.sh
sudo pacman -U packaging/arch/markdowngonzo-*-x86_64.pkg.tar.zst
```

### Flatpak

Coming to Flathub. See [`docs/packaging.md`](docs/packaging.md) for the manifest
and submission steps.

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
