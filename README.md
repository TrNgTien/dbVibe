# dbVibe

Minimal macOS database client built with Wails, Go, and React. It focuses on fast database debugging without Electron.

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

## Install (macOS)

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
