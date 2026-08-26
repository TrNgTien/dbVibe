.PHONY: help all start dev run build build-portable frontend frontend-build deps install-wails doctor release

WAILS_VERSION ?= v2.10.2
WAILS ?= go run github.com/wailsapp/wails/v2/cmd/wails@$(WAILS_VERSION)
PORTABLE_DIR ?= build/portable
PORTABLE_ZIP ?= $(PORTABLE_DIR)/dbVibe-macos-universal.zip
RELEASES_DIR ?= releases

export GOCACHE ?= $(CURDIR)/.gocache
export GOMODCACHE ?= $(CURDIR)/.gomodcache
export npm_config_cache ?= $(CURDIR)/frontend/.npm-cache

help:
	@echo "Targets:"
	@echo "  make start          Run the Wails desktop app in dev mode"
	@echo "  make build          Build the macOS desktop app"
	@echo "  make build-portable Build a portable macOS zip, bump VERSION, copy into releases/"
	@echo "  make frontend       Run the Vite frontend only"
	@echo "  make frontend-build Build the Vite frontend only"
	@echo "  make deps           Install/download Go and frontend dependencies"
	@echo "  make install-wails  Install the Wails CLI on PATH"
	@echo "  make doctor         Show tool versions"
	@echo "  make release VERSION=v1.0.0  Full release flow (tests, tag, push, GitHub Release page)"

all: build

start: dev

run: dev

dev:
	env -u GOROOT $(WAILS) dev

build:
	osascript -e 'quit app "dbVibe"' 2>/dev/null || true
	env -u GOROOT $(WAILS) build -clean
	cp -R build/bin/dbVibe.app /Applications/
	ls -d /Applications/dbVibe.app && stat -f "%Sm" /Applications/dbVibe.app
	open /Applications/dbVibe.app

build-portable:
	NEW_VERSION=$$(./scripts/bump-version.sh); \
	echo "==> Building dbVibe v$$NEW_VERSION"; \
	env -u GOROOT $(WAILS) build -clean -platform darwin/universal; \
	mkdir -p $(PORTABLE_DIR) $(RELEASES_DIR); \
	ditto -c -k --sequesterRsrc --keepParent build/bin/dbVibe.app $(PORTABLE_ZIP); \
	cp $(PORTABLE_ZIP) $(RELEASES_DIR)/dbVibe-macos-universal.zip; \
	cp $(PORTABLE_ZIP) $(RELEASES_DIR)/dbVibe-macos-universal-v$$NEW_VERSION.zip; \
	echo "==> $(RELEASES_DIR)/dbVibe-macos-universal-v$$NEW_VERSION.zip"

frontend:
	pnpm -C frontend run dev

frontend-build:
	pnpm -C frontend run build

deps:
	go mod download
	pnpm -C frontend install

install-wails:
	go install github.com/wailsapp/wails/v2/cmd/wails@$(WAILS_VERSION)

doctor:
	go version
	node --version
	pnpm --version
	env -u GOROOT $(WAILS) version

release:
	./scripts/release.sh $(VERSION)
