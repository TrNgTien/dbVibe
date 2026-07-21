#!/usr/bin/env bash
# Install dbVibe.app to /Applications from the portable zip.
#
# Usage:
#   ./install.sh              # uses build/portable/dbVibe-macos.zip next to this script
#   ./install.sh path/to/dbVibe-macos.zip
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP_PATH="${1:-$SCRIPT_DIR/build/portable/dbVibe-macos.zip}"
APP_NAME="dbVibe.app"
DEST="/Applications/$APP_NAME"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: dbVibe is a macOS app; this installer only runs on macOS." >&2
  exit 1
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "error: zip not found at $ZIP_PATH" >&2
  echo "Pass the path explicitly: ./install.sh /path/to/dbVibe-macos.zip" >&2
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
