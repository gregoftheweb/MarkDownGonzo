#!/usr/bin/env bash
# Install the latest MarkDownGonzo release for this Linux distro.
#
#   curl -fsSL https://raw.githubusercontent.com/gregoftheweb/MarkDownGonzo/main/scripts/install.sh | bash
#
# Detects the system package manager, downloads the matching asset from the
# latest GitHub release, and installs it with sudo. Falls back to a portable
# AppImage under ~/.local/bin when no supported package manager is found.
set -euo pipefail

REPO="gregoftheweb/MarkDownGonzo"
API_URL="https://api.github.com/repos/$REPO/releases/latest"

echo "Fetching the latest MarkDownGonzo release..."
release_json=$(curl -fsSL "$API_URL")

# Extracts the browser_download_url for the first asset whose name matches
# the given regex (grep -E), without requiring jq to be installed.
asset_url() {
  echo "$release_json" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed -E 's/.*"(https[^"]+)"/\1/' \
    | grep -E "$1" \
    | head -n 1
}

download() {
  local url="$1" dest="$2"
  echo "Downloading $(basename "$url")..."
  curl -fsSL -o "$dest" "$url"
}

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

if command -v pacman >/dev/null 2>&1; then
  url=$(asset_url '\.pkg\.tar\.zst$')
  [ -n "$url" ] || { echo "No Arch package found in the latest release." >&2; exit 1; }
  file="$tmpdir/$(basename "$url")"
  download "$url" "$file"
  sudo pacman -U --noconfirm "$file"
elif command -v apt-get >/dev/null 2>&1 || command -v apt >/dev/null 2>&1; then
  url=$(asset_url '\.deb$')
  [ -n "$url" ] || { echo "No .deb package found in the latest release." >&2; exit 1; }
  file="$tmpdir/$(basename "$url")"
  download "$url" "$file"
  sudo apt install -y "$file"
elif command -v dnf >/dev/null 2>&1; then
  url=$(asset_url '\.rpm$')
  [ -n "$url" ] || { echo "No .rpm package found in the latest release." >&2; exit 1; }
  file="$tmpdir/$(basename "$url")"
  download "$url" "$file"
  sudo dnf install -y "$file"
elif command -v zypper >/dev/null 2>&1; then
  url=$(asset_url '\.rpm$')
  [ -n "$url" ] || { echo "No .rpm package found in the latest release." >&2; exit 1; }
  file="$tmpdir/$(basename "$url")"
  download "$url" "$file"
  sudo zypper install -y "$file"
else
  url=$(asset_url '\.AppImage$')
  if [ -z "$url" ]; then
    echo "No supported package manager found, and no AppImage is available" \
      "in the latest release." >&2
    exit 1
  fi
  mkdir -p "$HOME/.local/bin"
  dest="$HOME/.local/bin/markdowngonzo.AppImage"
  download "$url" "$dest"
  chmod +x "$dest"
  echo "Installed to $dest"
  echo "Add ~/.local/bin to PATH if it isn't already, then run: markdowngonzo.AppImage"
  echo "(Needs FUSE 2: sudo apt install libfuse2, or run with --appimage-extract-and-run.)"
  exit 0
fi

echo "MarkDownGonzo installed."
