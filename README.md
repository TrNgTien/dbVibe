# dbVibe

Minimal macOS database client built with Wails, Go, and React. It focuses on fast database debugging without Electron.

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
curl -fsSL https://github.com/TrNgTien/dbVibe/raw/main/build/portable/dbVibe-macos.zip -o /tmp/dbVibe-macos.zip && curl -fsSL https://raw.githubusercontent.com/TrNgTien/dbVibe/main/install.sh -o /tmp/dbVibe-install.sh && bash /tmp/dbVibe-install.sh /tmp/dbVibe-macos.zip
```

This downloads the latest portable build plus the installer, installs `dbVibe.app` to `/Applications` (clearing the Gatekeeper quarantine flag), and launches it. Re-run it any time to update.

### From a checkout

Clone or download this repo, then run:

```bash
./install.sh
```

This unzips `build/portable/dbVibe-macos.zip`, clears the Gatekeeper quarantine
flag (the build is unsigned), installs `dbVibe.app` to `/Applications`, and
launches it. Re-running it updates an existing install.

If you only have the zip (no repo checkout), pass its path:

```bash
./install.sh /path/to/dbVibe-macos.zip
```

### Manual install

Prefer to do it by hand instead of running a script?

1. Download `build/portable/dbVibe-macos.zip`.
2. Unzip it.
3. Drag `dbVibe.app` to `/Applications`.
4. If macOS blocks the app on first launch, clear quarantine:
   ```bash
   xattr -dr com.apple.quarantine /Applications/dbVibe.app
   ```

## Platform support

dbVibe is a Wails v2 app and runs natively on macOS, Windows, and Linux. The
portable zip above is the macOS build; Windows and Linux users build from
source:

| Platform | Install | Notes |
|---|---|---|
| macOS | `./install.sh` | Prebuilt portable zip, one-line install |
| Windows | `wails build -platform windows/amd64` | Produces `dbVibe.exe` |
| Linux | `wails build -platform linux/amd64` | Produces `dbVibe` binary |

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

The zip is created at `build/portable/dbVibe-macos.zip`. Recipients can unzip and run `dbVibe.app`.

If your shell has GVM variables loaded, `env -u GOROOT` avoids mixing Homebrew Go 1.25 with a Go 1.24 GVM root.

## Frontend Only

The React UI has demo fallback data when it is opened outside Wails:

```bash
cd sql-gui/frontend
pnpm run dev
```
