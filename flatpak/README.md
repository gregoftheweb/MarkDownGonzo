# Flathub submission

This directory holds the Flatpak manifest and vendored-source lockfiles for
submitting MarkDownGonzo to Flathub.

## Files

- `com.columbiafoundry.markdowngonzo.yml` — the Flatpak manifest. Builds
  `markdowngonzo` v1.0.2 from the `v1.0.2` git tag using the GNOME 51
  runtime (brings WebKitGTK), with the Rust and Node 22 SDK extensions.
  Builds a `.deb` internally via `npm run tauri build -- --bundles deb`
  and installs the files out of it, reusing the existing packaging
  metadata (`.desktop`, icons, metainfo, MIME type) already wired into
  `markdowngonzo/src-tauri/tauri.conf.json`'s `bundle.linux.deb` config
  rather than duplicating it.
- `cargo-sources.json`, `node-sources.json` — generated lockfiles so
  `flatpak-builder` can fetch every Rust crate and npm package before the
  sandboxed, network-less build starts (required by Flathub; regenerate
  whenever `Cargo.lock` or `package-lock.json` changes — see below).

No `--filesystem` permission is requested. File access goes through
`@tauri-apps/plugin-dialog`'s `open()`/`save()`, which route through the
`xdg-desktop-portal` FileChooser when sandboxed — the portal grants access
to whatever the user explicitly picks. **Verify this holds for drag-and-drop
from a file manager** when you first test the build; if it doesn't,
`--filesystem=home` is the right fallback, not `--filesystem=host`.

## Regenerating the sources files

Whenever `markdowngonzo/src-tauri/Cargo.lock` or
`markdowngonzo/package-lock.json` changes:

```bash
git clone --depth 1 https://github.com/flatpak/flatpak-builder-tools.git /tmp/fbt
python3 -m venv /tmp/fbt-venv && source /tmp/fbt-venv/bin/activate
pip install aiohttp toml tomlkit
pip install /tmp/fbt/node

python3 /tmp/fbt/cargo/flatpak-cargo-generator.py \
  markdowngonzo/src-tauri/Cargo.lock -o flatpak/cargo-sources.json

flatpak-node-generator npm markdowngonzo/package-lock.json \
  -o flatpak/node-sources.json
```

## Building and testing locally

```bash
sudo pacman -S flatpak-builder   # or apt/dnf equivalent
flatpak install flathub org.gnome.Sdk//51 org.gnome.Platform//51 \
  org.freedesktop.Sdk.Extension.node22 org.freedesktop.Sdk.Extension.rust-stable

flatpak-builder --force-clean --install --user build-dir \
  flatpak/com.columbiafoundry.markdowngonzo.yml

flatpak run com.columbiafoundry.markdowngonzo
```

Fix anything that breaks and re-run before submitting — Flathub review
will reject an unbuildable manifest outright.

## Submitting

1. Fork https://github.com/flathub/flathub
2. `git clone --branch=new-pr git@github.com:<you>/flathub.git && cd flathub`
3. `git checkout -b com.columbiafoundry.markdowngonzo`
4. Copy `com.columbiafoundry.markdowngonzo.yml`, `cargo-sources.json`, and
   `node-sources.json` into the root of that checkout, commit, push.
5. Open a PR against the `new-pr` branch.
6. After the manifest PR is approved, Flathub creates
   `github.com/flathub/com.columbiafoundry.markdowngonzo` and invites you —
   accept within a week, enable 2FA on GitHub first if you haven't.
7. Domain ownership: since the app ID is `com.columbiafoundry.*`, Flathub's
   verification flow will ask you to prove control of
   `columbiafoundry.com` (a DNS TXT record or a well-known file over
   HTTPS) — do this when the review bot asks, not before.
