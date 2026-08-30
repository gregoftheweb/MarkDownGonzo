# MarkDownGonzo (app)

This directory is the Tauri 2 / React application. For the project overview,
motivation, and install instructions see the [repository README](../README.md).

## Development

Requirements: Node.js + npm, Rust, and the Tauri/WebKitGTK system libraries.

```bash
npm install
npm run tauri dev        # run the desktop app
npm run dev              # frontend only (Vite)
```

## Checks

```bash
npm run build                                     # tsc + Vite production build
npm test                                          # frontend tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored   # + LibreOffice export round-trip
```

## Packaging (Arch)

```bash
./scripts/build-arch-package.sh
sudo pacman -U packaging/arch/markdowngonzo-*-x86_64.pkg.tar.zst
```

Product and implementation documentation lives in [`../docs`](../docs).

## License

MIT — see [LICENSE](LICENSE).
