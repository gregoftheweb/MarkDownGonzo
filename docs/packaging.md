# Packaging & release

MarkDownGonzo is a self-contained Tauri app: the only runtime dependencies are
**WebKitGTK 4.1** and **GTK 3**. Fonts, PDF logic (minus LibreOffice), and every
JS/Rust dependency are bundled.

## Cutting a release

1. Bump the version in `markdowngonzo/package.json`, `markdowngonzo/src-tauri/Cargo.toml`,
   `markdowngonzo/src-tauri/tauri.conf.json`, and add a `<release>` entry to
   `markdowngonzo/packaging/linux/com.columbiafoundry.markdowngonzo.metainfo.xml`.
2. `git tag v0.1.0 && git push --tags`.
3. `.github/workflows/release.yml` builds `.deb`, `.rpm`, and `.AppImage` on
   Ubuntu 22.04 and attaches them to a **draft** GitHub release.
4. Review the draft, edit the notes, publish.

`workflow_dispatch` runs the same build against `main` and produces a
`v<run>-dev` pre-release for testing.

## Channels

| Channel | Source | Who it reaches |
|---|---|---|
| GitHub Releases | CI artifacts (`.deb` / `.rpm` / `.AppImage`) | anyone |
| AUR | `packaging/aur/PKGBUILD` | Arch, Manjaro, EndeavourOS, Omarchy |
| Flathub | `packaging/flatpak/com.columbiafoundry.markdowngonzo.yml` | Fedora, Mint, Pop!_OS, Steam Deck, … |

### AUR

The `PKGBUILD` builds from the release tag tarball.

```bash
cd packaging/aur
updpkgsums                      # fill in sha256sums for the new tag
makepkg --printsrcinfo > .SRCINFO
namcap PKGBUILD                 # lint

# first time only: create the AUR repo
git clone ssh://aur@aur.archlinux.org/markdowngonzo.git aur-repo
cp PKGBUILD .SRCINFO aur-repo/
cd aur-repo && git add -A && git commit -m "markdowngonzo 0.1.0-1" && git push
```

(An AUR account with an SSH key added at <https://aur.archlinux.org/account/> is
required.)

### Flathub

The manifest repackages the release `.deb` (building Tauri from source in the
Flathub sandbox would mean vendoring every cargo + npm dependency).

1. Publish the GitHub release first.
2. In `packaging/flatpak/com.columbiafoundry.markdowngonzo.yml`, set the `url`
   and `sha256` of `markdowngonzo_<version>_amd64.deb`.
3. Refresh `docs/screenshots/editor-light.png` if the UI has changed
   (the metainfo points at it on `main`).
4. Test locally:
   ```bash
   flatpak install flathub org.gnome.Platform//47 org.gnome.Sdk//47
   flatpak-builder --user --install --force-clean build-dir \
     packaging/flatpak/com.columbiafoundry.markdowngonzo.yml
   flatpak run com.columbiafoundry.markdowngonzo
   ```
5. Fork <https://github.com/flathub/flathub>, add the manifest on a branch named
   `com.columbiafoundry.markdowngonzo`, open a PR. A reviewer checks it once;
   after merge you get a `flathub/com.columbiafoundry.markdowngonzo` repo you
   own and push updates to.

`--filesystem=home` in the manifest is broad; it can be narrowed to
`xdg-documents` + portals later if that covers the real workflows.

## Local Arch build (no release needed)

```bash
cd markdowngonzo
./scripts/build-arch-package.sh
sudo pacman -U packaging/arch/markdowngonzo-*-x86_64.pkg.tar.zst
```

`packaging/arch/PKGBUILD` builds from a local tarball of the working tree —
handy for testing, not for the AUR.
