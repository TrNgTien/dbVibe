#!/usr/bin/env bash
# Bump the patch component of VERSION in place and print the new version.
# Usage: ./scripts/bump-version.sh   (prints e.g. 1.0.4)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/VERSION"

CURRENT="$(cat "$VERSION_FILE" 2>/dev/null || echo "0.0.0")"
IFS=. read -r MAJOR MINOR PATCH <<< "$CURRENT"
PATCH=$((PATCH + 1))
NEW="$MAJOR.$MINOR.$PATCH"

echo "$NEW" > "$VERSION_FILE"
echo "$NEW"
