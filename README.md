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

## Install

### From a checkout (works today)

The one-liner below only works once a [release](https://github.com/TrNgTien/dbVibe/releases) is published (none yet). Until then, build the portable zip from the repo and install it:

```bash
make build-portable
./install.sh build/portable/dbVibe-macos-universal.zip
```

Or point the installer at any `dbVibe-macos-universal.zip` you already have:

```bash
./install.sh /path/to/dbVibe-macos-universal.zip
```

### Quick install (once a release exists)

Paste this into Terminal and hit Enter — no checkout, no building:

```bash
curl -fsSL https://raw.githubusercontent.com/TrNgTien/dbVibe/main/install.sh | bash
```

It downloads the latest release, clears the Gatekeeper quarantine flag (the
build is unsigned, so macOS marks it "damaged" or blocks it otherwise), installs
`dbVibe.app` to `/Applications`, and opens it. Re-run the same command any time
to update.

### Manual install (macOS)

Prefer doing it by hand?

1. Get a zip: no release published yet, so grab the prebuilt zip checked into the repo at [`releases/dbVibe-macos-universal.zip`](releases/dbVibe-macos-universal.zip) and unzip it. (Or build it yourself with `make build-portable`, which produces `build/portable/dbVibe-macos-universal.zip`.)
2. Clear the quarantine flag so macOS doesn't call the app "damaged" (it's just unsigned):
   ```bash
   xattr -cr dbVibe.app
   ```
3. Drag `dbVibe.app` to `/Applications`.

## Platform support

Prebuilt binaries for all three platforms are published on every release:

| Platform | Install | Notes |
|---|---|---|
| macOS | `./install.sh` | Prebuilt universal zip, one-line install |
| Windows | Download `dbVibe-windows-amd64.zip` | Unzip and run `dbVibe.exe` |
| Linux | Download `dbVibe-linux-amd64.tar.gz` | Extract and run `./dbVibe` |

Downloads are under the [Releases](https://github.com/TrNgTien/dbVibe/releases) page.

## How to use

1. **Add a connection** — from the dashboard, create a connection for PostgreSQL, MySQL, MongoDB, Redis, or Elasticsearch and save it.
2. **Run queries** — open a connection and use the query editor to execute SQL, MongoDB JSON commands, or Redis commands.
3. **Inspect tables** — browse tables with row preview, and check columns, indexes, create-table SQL, and sample rows.
4. **Optimize slow queries** — run `EXPLAIN ANALYZE` to see why a query is slow; on MySQL use the binlog trace viewer to trace writes.
5. **Reuse snippets** — save queries per connection and reopen them later.

On macOS, only "Open in Terminal" is macOS-specific (it requires `osascript`); it is unavailable on Windows/Linux.