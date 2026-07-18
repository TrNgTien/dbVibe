---
name: ship
description: Ship a new portable dbVibe build — runs make build-portable and replaces build/portable/dbVibe-macos.zip, the artifact other people download and install. Use when the user wants to ship, release, or package a new portable version.
---

# Ship dbVibe (portable zip)

Build the portable universal-macOS zip and replace the artifact in `build/portable/`.

## Steps

1. **Build** from the repo root (generous timeout, 600000 ms):
   ```bash
   make build-portable
   ```
   This runs `wails build -clean -platform darwin/universal` (arm64 + x86_64) and
   overwrites `build/portable/dbVibe-macos.zip`.

2. **Sanity-check** the new zip:
   ```bash
   ls -lh build/portable/dbVibe-macos.zip
   unzip -l build/portable/dbVibe-macos.zip | head
   ```
   It must contain `dbVibe.app` and have a non-trivial size (tens of MB), with a
   modification time from this build.

3. **Report** in 1–2 sentences: zip path and size. Include the install note for
   whoever receives the zip: unzip, drag `dbVibe.app` to `/Applications`; the build
   is unsigned, so on first launch right-click → Open (or run
   `xattr -cr /Applications/dbVibe.app` once) to get past Gatekeeper.

## Notes

- One zip serves both Apple Silicon and Intel Macs (universal build).
- Do not tag, push, or publish anywhere — shipping here means refreshing
  `build/portable/dbVibe-macos.zip` only.
