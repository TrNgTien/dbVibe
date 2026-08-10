---
name: ship
description: Ship a new dbVibe release — tag a version so the GitHub Actions release workflow builds the matrix (macOS universal, Windows amd64, Linux amd64) and publishes a GitHub Release with auto-generated notes. Use when the user wants to ship, release, publish, or cut a new version.
---

# Ship dbVibe (GitHub Release)

Versioned builds are published via GitHub Actions. Shipping = tagging a version
and pushing it; the `.github/workflows/release.yml` workflow does the rest.

## Steps

The full flow is one command — `scripts/release.sh` (or `make release
VERSION=v1.0.1`). It:

1. requires a clean working tree
2. runs the tests first (frontend build + `go test ./...`) — **aborts on
   failure; no tag, no push**
3. creates the version tag
4. pushes the tag, triggering the `Release` GitHub Actions workflow
5. waits for the GitHub Release page to appear and prints its URL

Run it:

```bash
./scripts/release.sh v1.0.1
```

The script also mirrors the CI gating: the workflow runs tests before building,
and a test failure fails the build job, which cancels the release jobs.

If the script is unavailable, do it manually:
1. **Run tests FIRST**:
   ```bash
   pnpm -C frontend install
   pnpm -C frontend run build
   go test ./...
   ```
   **If any test fails, CANCEL the ship** — fix, re-run until green, then
   continue.
2. **Create and push the tag** (use a higher version than the latest tag,
   `git tag` / `git describe --tags`):
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. **Confirm the release** at
   https://github.com/TrNgTien/dbVibe/releases — the workflow builds
   `dbVibe-macos-universal.zip`, `dbVibe-windows-amd64.zip`, and
   `dbVibe-linux-amd64.tar.gz`, then publishes them as a GitHub Release with
   generated release notes. It takes a few minutes; check the Actions tab for
   the "Release" workflow run.

## Notes

- The macOS zip is unsigned; `./install.sh` clears the Gatekeeper quarantine
  flag. Notarization requires an Apple Developer cert and is not wired up.
- The one-line install in the README downloads the latest release asset via
  `https://github.com/TrNgTien/dbVibe/releases/latest/download/dbVibe-macos-universal.zip`.
- Do not commit build artifacts. `build/portable/` and `build/bin/` are
  gitignored; the release artifacts live on the GitHub Release.
