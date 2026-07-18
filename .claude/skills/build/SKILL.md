---
name: build
description: Build the dbVibe macOS desktop app and install it to /Applications. Use when the user wants to build, rebuild, or install dbVibe locally.
---

# Build & install dbVibe

Build the Wails desktop app and install it to `/Applications` on this machine.

## Steps

1. **Quit dbVibe if it is running** — overwriting a running app can leave a stale bundle:
   ```bash
   osascript -e 'quit app "dbVibe"' 2>/dev/null || true
   ```

2. **Build and install** from the repo root:
   ```bash
   make build
   ```
   This runs `wails build -clean` (which also runs the frontend `pnpm run build`) and then copies `build/bin/dbVibe.app` to `/Applications/`. It can take a few minutes on a clean build — use a generous Bash timeout (600000 ms).

3. **Verify** the install landed:
   ```bash
   ls -d /Applications/dbVibe.app && stat -f "%Sm" /Applications/dbVibe.app
   ```
   The modification time must be from this build.

4. **Relaunch** the freshly installed app:
   ```bash
   open /Applications/dbVibe.app
   ```

5. Report the result in one or two sentences (built, installed, launched — or the failure).

## Troubleshooting

- **Missing dependencies** (Go modules or `node_modules`): run `make deps`, then retry `make build`.
- **Frontend build errors**: fix them in `frontend/src/` first; `npx vite build` in `frontend/` is a faster iteration loop than a full `make build`.
- **Wails/tool problems**: `make doctor` prints Go, Node, pnpm, and Wails versions. The Makefile pins Wails via `go run`, so no global install is required.
- **Portable zip instead of /Applications**: use `make build-portable` (universal binary, outputs `build/portable/dbVibe-macos.zip`). Only do this when the user asks for the portable build.

## Arguments

- No args: build + install + relaunch (steps above).
- `portable`: run `make build-portable` instead; skip the /Applications steps and report the zip path.
- `no-launch` / `nolaunch`: skip step 4.
