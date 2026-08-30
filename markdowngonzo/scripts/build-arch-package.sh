#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
package_dir="$project_dir/packaging/arch"
version=$(node -p "require('$project_dir/package.json').version")
archive="$package_dir/markdowngonzo-$version.tar.gz"

for tool in cargo node npm makepkg tar; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

rm -f "$archive"
tar --create --gzip --file "$archive" \
  --transform "s,^,markdowngonzo-$version/," \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=src-tauri/target \
  --exclude=packaging/arch/pkg \
  --exclude=packaging/arch/src \
  --exclude=packaging/arch/target \
  --exclude='packaging/arch/*.pkg.tar.zst' \
  --exclude="packaging/arch/markdowngonzo-$version.tar.gz" \
  -C "$project_dir" .

(cd "$package_dir" && makepkg --nodeps --force --cleanbuild --clean)
rm -f "$archive"
