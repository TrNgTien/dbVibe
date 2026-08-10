---
description: Ship a new dbVibe release — verify the build, tag a version, and push so GitHub Actions builds and publishes a GitHub Release.
agent: build
---

Use the `ship` skill to ship a dbVibe release.

Requested version: $ARGUMENTS
(If blank, compute the next patch version after the latest tag.)

Do the following:
1. Run tests FIRST: `pnpm -C frontend install`, `pnpm -C frontend run build`,
   then `go test ./...`. **If any test fails, STOP — cancel the ship**: report
   the failure, do not tag, and do not push.
2. Determine the target version — the requested one, or the next patch after
   `git describe --tags --abbrev=0`. The tag must start with `v`.
3. Create and push the tag: `git tag <version>` and `git push origin <version>`.
4. Report back the release page URL
   (https://github.com/TrNgTien/dbVibe/releases) and note that the "Release"
   GitHub Actions workflow builds macOS/Windows/Linux artifacts in a few
   minutes.

Do not commit anything else and do not create the GitHub Release manually —
the workflow does that.
