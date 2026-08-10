# dbVibe

Minimal macOS database client built with Wails, Go, and React. It focuses on fast database debugging without Electron.

![Release](https://img.shields.io/github/v/release/TrNgTien/dbVibe)

![dbVibe overview](docs/assets/app-overview.png)

## Features

- Stored connection dashboard
- PostgreSQL, MySQL, MongoDB, Redis, and Elasticsearch connection forms
- Execute SQL, MongoDB JSON commands, and Redis commands
- Save and reopen query snippets per connection
- CodeMirror query editor with autocomplete
- Customizable shortcuts stored in local storage
- Table browser with row preview
- First-glance table diagnostics: columns, indexes, create table SQL, sample rows
- `EXPLAIN ANALYZE` panel
- MySQL binlog trace viewer

The MySQL binlog trace viewer requires the `mysqlbinlog` client:

```bash
brew install mysql-client
```

## Why dbVibe

| | dbVibe | DBeaver | MySQL Workbench |
|---|---|---|---|
| Runtime | Native Go binary (Wails), no bundled JVM/Electron | Bundles a JVM | Qt-based, MySQL-only |
| App size | ~21 MB (~15 MB portable zip) | Several hundred MB with JRE | ~300 MB |
| Config storage | Single local `store.json` file | Embedded workspace metadata DB | Local XML/SQLite workspace |
| Engines | Postgres, MySQL, MongoDB, Redis, Elasticsearch | Many (via JDBC plugins) | MySQL only |
| Query plan | Animated, interactive optimizer with per-step I/O and CPU cost formulas | Static `EXPLAIN` text/tree | Static `EXPLAIN` visual (non-interactive) |
| Binlog trace viewer | Built in (`mysqlbinlog`) | Not built in | Not built in |

dbVibe trades broad feature coverage for a small, fast, native client focused on the debugging loop: connect, run a query, see why it's slow, fix it.

![Query Optimizer Lab comparing candidate access paths with I/O and CPU cost breakdowns](docs/assets/query-optimizer.png)

The Query Optimizer Lab walks a real `EXPLAIN ANALYZE` through parse, rewrite, cost-based optimization, and execution — at the optimize step it shows the exact candidates the planner priced (e.g. Seq Scan vs. Index Scan vs. Bitmap Heap Scan) with their I/O and CPU cost formulas, not just the winning plan.

## Install (macOS)

### One-line install

No repo checkout, no instructions — paste this into Terminal and hit Enter:

```bash
curl -fsSL https://github.com/TrNgTien/dbVibe/releases/latest/download/dbVibe-macos-universal.zip -o /tmp/dbVibe-macos.zip && curl -fsSL https://raw.githubusercontent.com/TrNgTien/dbVibe/main/install.sh -o /tmp/dbVibe-install.sh && bash /tmp/dbVibe-install.sh /tmp/dbVibe-macos.zip
```

This downloads the latest release build plus the installer, installs `dbVibe.app` to `/Applications` (clearing the Gatekeeper quarantine flag), and launches it. Re-run it any time to update.

### From a checkout

Clone or download this repo, then run:

```bash
./install.sh
```

This downloads the latest macOS release, clears the Gatekeeper quarantine
flag (the build is unsigned), installs `dbVibe.app` to `/Applications`, and
launches it. Re-running it updates an existing install.

If you already have the zip, pass its path:

```bash
./install.sh /path/to/dbVibe-macos-universal.zip
```

### Manual install

Prefer to do it by hand instead of running a script?

1. Download `dbVibe-macos-universal.zip` from the latest release.
2. Unzip it.
3. Drag `dbVibe.app` to `/Applications`.
4. If macOS blocks the app on first launch, clear quarantine:
   ```bash
   xattr -dr com.apple.quarantine /Applications/dbVibe.app
   ```

## Releases

Every version tag (`v*`) triggers the `Release` GitHub Actions workflow:

1. **Run tests first** — the workflow builds the frontend, then runs
   `go test ./...`. If any test fails, the job fails and the release is
   cancelled; no artifacts are published.
2. **Build the matrix** — macOS (universal), Windows (amd64), and Linux (amd64)
   on native runners.
3. **Publish** — packages the binaries and creates a GitHub Release with
   auto-generated notes.

Prebuilt downloads are under the [Releases](https://github.com/TrNgTien/dbVibe/releases) page.

| Asset | Platform |
|---|---|
| `dbVibe-macos-universal.zip` | macOS (Apple Silicon + Intel) |
| `dbVibe-windows-amd64.zip` | Windows x64 |
| `dbVibe-linux-amd64.tar.gz` | Linux x64 |

### Cut a new release

1. Make sure the test suite passes locally:
   ```bash
   pnpm -C frontend install
   pnpm -C frontend run build
   go test ./...
   ```
2. Tag and push the version — this triggers the workflow:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   Use a higher version than the latest tag. Track the run under the
   [Actions](https://github.com/TrNgTien/dbVibe/actions) "Release" workflow.

## Platform support

dbVibe is a Wails v2 app and runs natively on macOS, Windows, and Linux.
Prebuilt binaries for all three platforms are published on every release:

| Platform | Install | Notes |
|---|---|---|
| macOS | `./install.sh` | Prebuilt universal zip, one-line install |
| Windows | Download `dbVibe-windows-amd64.zip` | Unzip and run `dbVibe.exe` |
| Linux | Download `dbVibe-linux-amd64.tar.gz` | Extract and run `./dbVibe` |

Openers, file reveal, and path handling already branch per-OS in
`app.go`; the only macOS-only feature is "Open in Terminal", which requires
`osascript` and is unavailable on Windows/Linux.

## Develop

Install the Wails CLI if it is not already available:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
```

Run the app:

```bash
cd sql-gui
env -u GOROOT wails dev
```

Build the macOS app:

```bash
cd sql-gui
env -u GOROOT wails build
```

Build a portable macOS zip (shareable without installation):

```bash
cd sql-gui
make build-portable
```

The zip is created at `build/portable/dbVibe-macos-universal.zip`. Recipients can unzip and run `dbVibe.app`.

If your shell has GVM variables loaded, `env -u GOROOT` avoids mixing Homebrew Go 1.25 with a Go 1.24 GVM root.

## Frontend Only

The React UI has demo fallback data when it is opened outside Wails:

```bash
cd sql-gui/frontend
pnpm run dev
```
