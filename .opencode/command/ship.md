---
description: Ship a new dbVibe release — verify the build, tag a version, and push so GitHub Actions builds and publishes a GitHub Release.
agent: build
---

Use the `ship` skill to ship a dbVibe release.

Requested version: $ARGUMENTS
(If blank, compute the next patch version after the latest tag.)

Do the following:
1. Determine the target version — the requested one, or the next patch after
   `git describe --tags --abbrev=0`. It must be `vX.Y.Z`.
2. Run the full release flow with the ship script:
   `./scripts/release.sh <version>` (equiv. `make release VERSION=<version>`).
   This verifies a clean tree, runs tests first (frontend build + `go test
   ./...`), creates and pushes the tag, and waits for the GitHub Release page.
   **If the tests fail, the script aborts — do not tag or push.**
3. Report back the release page URL
   (https://github.com/TrNgTien/dbVibe/releases) and confirm the Release
   workflow is building macOS/Windows/Linux artifacts.
