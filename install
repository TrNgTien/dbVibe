#!/usr/bin/env bash
# Install dbVibe.app to /Applications.
#
# Usage:
#   ./install.sh                        # downloads the latest macOS release from GitHub Releases
#   ./install.sh path/to/dbVibe-macos-universal.zip
set -euo pipefail

APP_NAME="dbVibe.app"
DEST="/Applications/$APP_NAME"
RELEASE_URL="https://github.com/TrNgTien/dbVibe/releases/latest/download/dbVibe-macos-universal.zip"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: dbVibe is a macOS app; this installer only runs on macOS." >&2
  exit 1
fi

# Resolve a relative zip arg against the caller's cwd before we cd away.
ZIP_PATH="${1:-}"
if [[ -n "$ZIP_PATH" ]]; then
  ZIP_PATH="$(cd "$(dirname "$ZIP_PATH")" && pwd)/$(basename "$ZIP_PATH")"
fi

# Run from $HOME from here on so behavior never depends on the caller's cwd
# (matters when this script is piped straight into bash).
cd "$HOME"

if [[ -z "$ZIP_PATH" ]]; then
  echo "Downloading latest dbVibe release..."
  ZIP_PATH="$(mktemp -t dbvibe-XXXXXX).zip"
  curl -fL --retry 3 "$RELEASE_URL" -o "$ZIP_PATH"
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "error: zip not found at $ZIP_PATH" >&2
  echo "Pass the path explicitly: ./install.sh /path/to/dbVibe-macos-universal.zip" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Unzipping $ZIP_PATH..."
unzip -q "$ZIP_PATH" -d "$WORK_DIR"

if [[ ! -d "$WORK_DIR/$APP_NAME" ]]; then
  echo "error: $APP_NAME not found inside $ZIP_PATH" >&2
  exit 1
fi

echo "Removing quarantine attribute (unsigned build)..."
xattr -cr "$WORK_DIR/$APP_NAME"

echo "Quitting dbVibe if it is running..."
osascript -e 'quit app "dbVibe"' 2>/dev/null || true

if [[ -d "$DEST" ]]; then
  echo "Replacing existing $DEST..."
  rm -rf "$DEST"
fi

echo "Installing to $DEST..."
cp -R "$WORK_DIR/$APP_NAME" "$DEST"

echo "Launching dbVibe..."
open "$DEST"

echo "Done. dbVibe is installed at $DEST"
