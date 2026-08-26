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

## Install

Just want the app? No Go/Node toolchain needed for any of this — clone (or download) the repo and run one of the following.

### Quick install (macOS)

Install the prebuilt app checked into the repo:

```bash
./install.sh releases/dbVibe-macos-universal.zip
```

Or, once a GitHub Release exists, fetch the latest one automatically:

```bash
./install.sh
```

Either way this unzips `dbVibe.app`, clears the quarantine flag (it's unsigned), and installs it to `/Applications`.

### Manual install (macOS)

Prefer doing it by hand?

1. Get a zip: grab the prebuilt zip checked into the repo at [`releases/dbVibe-macos-universal.zip`](releases/dbVibe-macos-universal.zip) and unzip it.
2. Clear the quarantine flag so macOS doesn't call the app "damaged" (it's just unsigned):
   ```bash
   xattr -cr dbVibe.app
   ```
3. Drag `dbVibe.app` to `/Applications`.

### Build from source

Only needed if you're developing dbVibe or want changes newer than the checked-in zip:

```bash
make build-portable
./install.sh build/portable/dbVibe-macos-universal.zip
```

`make build-portable` also bumps `VERSION` and drops a matching `releases/dbVibe-macos-universal-vX.Y.Z.zip` alongside the checked-in `releases/dbVibe-macos-universal.zip`.

## Platform support

| Platform | Install | Notes |
|---|---|---|
| macOS | `./install.sh` | Prebuilt universal zip, one-line install |
| Windows | Not available yet | |
| Linux | Not available yet | |

## How to use

1. **Add a connection** — from the dashboard, create a connection for PostgreSQL, MySQL, MongoDB, Redis, or Elasticsearch and save it.
2. **Run queries** — open a connection and use the query editor to execute SQL, MongoDB JSON commands, or Redis commands.
3. **Inspect tables** — browse tables with row preview, and check columns, indexes, create-table SQL, and sample rows.
4. **Optimize slow queries** — run `EXPLAIN ANALYZE` to see why a query is slow; on MySQL use the binlog trace viewer to trace writes.
5. **Reuse snippets** — save queries per connection and reopen them later.

On macOS, only "Open in Terminal" is macOS-specific (it requires `osascript`); it is unavailable on Windows/Linux.