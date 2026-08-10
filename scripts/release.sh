#!/usr/bin/env bash
# Ship a new dbVibe release, full flow:
#   1. verify a clean tree
#   2. run tests (frontend build + go test) — abort on failure
#   3. create the version tag
#   4. push the tag (triggers the Release GitHub Actions workflow)
#   5. wait for the GitHub Release page to appear and report its URL
#
# The workflow builds the macOS/Windows/Linux artifacts and fills the release.
#
# Usage: ./scripts/release.sh v1.0.1   (or: make release VERSION=v1.0.1)
set -euo pipefail

REPO="TrNgTien/dbVibe"
API="https://api.github.com/repos/$REPO"
TIMEOUT_SECS="${RELEASE_TIMEOUT:-900}"

usage() {
  echo "usage: $0 vX.Y.Z" >&2
  exit 1
}

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  usage
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash your changes first." >&2
  exit 1
fi

echo "==> Building frontend"
pnpm -C frontend install
pnpm -C frontend run build

echo "==> Running Go tests"
go test ./...

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  echo "error: tag $VERSION already exists." >&2
  exit 1
fi

echo "==> Creating tag $VERSION"
git tag "$VERSION"

echo "==> Pushing tag $VERSION (triggers the Release workflow)"
git push origin "$VERSION"

RELEASE_URL="$API/releases/tags/$VERSION"
echo "==> Waiting for the GitHub Release page (up to $((TIMEOUT_SECS / 60)) min)..."
for ((elapsed = 0; elapsed < TIMEOUT_SECS; elapsed += 20)); do
  if curl -fsSL "$RELEASE_URL" -o /dev/null 2>/dev/null; then
    echo "==> Release is live: https://github.com/$REPO/releases/tag/$VERSION"
    exit 0
  fi
  sleep 20
done

echo "error: release page not created after $((TIMEOUT_SECS / 60)) min." >&2
echo "Check the workflow run: https://github.com/$REPO/actions" >&2
exit 1
