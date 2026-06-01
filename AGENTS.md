# dbVibe Agent Instructions

## Stack
Wails v2 | Go 1.24 | React 19 | Vite | CodeMirror 6 | MySQL/PGX

## Token Optimization Rules
- **No fluff**: Skip pleasantries, conversational filler, and redundant explanations.
- **Code first**: Provide exact diffs or full file replacements.
- **Comments**: Only explain non-obvious logic.
- **Concise**: Use bullet points and terse language.

## Go Best Practices
- **Idiomatic**: `gofmt`, small functions, explicit error returns.
- **Errors**: Wrap with context (`fmt.Errorf("...: %w", err)`). Never swallow errors.
- **Concurrency**: Use `context.Context` for cancellation. Prevent goroutine leaks.
- **Wails Bridge**: Expose strongly-typed structs. Batch data transfers. Keep heavy logic in Go.
- **DB**: Use connection pooling. Always `defer rows.Close()`.

## macOS App Optimization
- **Native UI**: Use `macOS.TitleBarHiddenInset` in `main.go` for native window controls. Match Apple HIG (San Francisco font, standard paddings).
- **Performance**: Minimize Go<->JS bridge calls. Send large datasets as JSON strings or batch them.
- **Build**: Use `wails build -platform darwin/universal` for Apple Silicon/Intel support.
- **Permissions**: Configure `Info.plist` (in `build/darwin/`) for required macOS entitlements.
- **CGO**: Avoid unless strictly requiring native Objective-C/Cocoa APIs.

## Frontend (React)
- **Editor**: Optimize CodeMirror 6 for large SQL files (lazy load extensions).
- **Icons**: Use `lucide-react`.
- **State**: Keep state minimal and close to components.
