.PHONY: help all start dev run build build-portable frontend frontend-build deps install-wails doctor

WAILS_VERSION ?= v2.10.2
WAILS ?= go run github.com/wailsapp/wails/v2/cmd/wails@$(WAILS_VERSION)
PORTABLE_DIR ?= build/portable
PORTABLE_ZIP ?= $(PORTABLE_DIR)/dbVibe-macos.zip

export GOCACHE ?= $(CURDIR)/.gocache
export GOMODCACHE ?= $(CURDIR)/.gomodcache
export npm_config_cache ?= $(CURDIR)/frontend/.npm-cache

help:
	@echo "Targets:"
	@echo "  make start          Run the Wails desktop app in dev mode"
	@echo "  make build          Build the macOS desktop app"
	@echo "  make build-portable Build a portable macOS zip"
	@echo "  make frontend       Run the Vite frontend only"
	@echo "  make frontend-build Build the Vite frontend only"
	@echo "  make deps           Install/download Go and frontend dependencies"
	@echo "  make install-wails  Install the Wails CLI on PATH"
	@echo "  make doctor         Show tool versions"

all: build

start: dev

run: dev

dev:
	env -u GOROOT $(WAILS) dev

build:
	env -u GOROOT $(WAILS) build -clean &&  cp -R build/bin/dbVibe.app /Applications/

build-portable:
	env -u GOROOT $(WAILS) build -clean -platform darwin/universal
	mkdir -p $(PORTABLE_DIR)
	ditto -c -k --sequesterRsrc --keepParent build/bin/dbVibe.app $(PORTABLE_ZIP)

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
