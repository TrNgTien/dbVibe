---
name: ship
description: Ship a new dbVibe release — tag a version so the GitHub Actions release workflow builds the matrix (macOS universal, Windows amd64, Linux amd64) and publishes a GitHub Release with auto-generated notes. Use when the user wants to ship, release, publish, or cut a new version.
---

# Ship dbVibe (GitHub Release)

Versioned builds are published via GitHub Actions. Shipping = tagging a version
and pushing it; the `.github/workflows/release.yml` workflow does the rest.

## Steps

1. **Run tests FIRST — tests gate the release.** Build the frontend (the Go
   binary embeds `frontend/dist`, so it must exist before `go test`), then run
   the Go test suite:
   ```bash
   pnpm -C frontend install
   pnpm -C frontend run build
   go test ./...
   ```
   **If any test fails, CANCEL the ship**: do not tag, do not push. Fix the
   failing test, re-run `go test ./...` until green, and only then continue.
   The CI workflow does the same — it runs the tests before building, and a
   test failure fails the job, which cancels the release jobs.

2. **Create and push the tag.** The tag name drives the release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   Use a higher version than the latest tag (`git tag` / `git describe --tags`).

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
