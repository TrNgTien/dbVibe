# Export Query Results to CSV/JSON

## Purpose
Allow users to easily export the results of a SQL query from the frontend data grid into standard formats (CSV or JSON) and save them to the local disk using a native macOS file save dialog.

## Scope
- Affects the `ResultPanel` in the frontend (`frontend/src/main.jsx`).
- Affects the Wails Go backend (`app.go`) to handle the file saving dialog.
- Supports only the current result set loaded in memory (no backend re-streaming of millions of rows).
- Supports JSON and CSV formats.

## Architecture & Data Flow
1. **Frontend Formatting**: The React frontend (`ResultPanel`) already holds the `columns` and `rows` data. When export is triggered, the frontend will convert this JSON array of objects into the desired string format (CSV or JSON).
2. **IPC Call**: The frontend calls a new Wails binding method `ExportQueryResult(content string, defaultFilename string, filterName string, filterPattern string) error`.
3. **Backend Dialog**: The Go backend invokes `runtime.SaveFileDialog` using the provided filters. 
4. **File Write**: If the user selects a path (doesn't cancel), Go writes the `content` string to the selected path.

## Components

### Frontend
- **Icon**: Add a `Download` icon to `frontend/src/icons.jsx`.
- **Button & Menu**: Add an export button to `ResultPanel`'s header row Actions. Clicking it shows a dropdown with "Export to CSV" and "Export to JSON".
- **Formatters**:
  - JSON formatter is simply `JSON.stringify(rows, null, 2)`.
  - CSV formatter loops over `columns` to create a header row, then loops over `rows` to output data, escaping quotes and commas correctly.

### Backend (`app.go`)
- **`ExportQueryResult(ctx context.Context, content string, defaultFilename string, filterName string, filterPattern string) (string, error)`**
  - Uses `runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{...})`.
  - Filter setup: `Filters: []runtime.FileFilter{{DisplayName: filterName, Pattern: filterPattern}}`
  - Returns the file path on success, or empty string if cancelled. Returns an error if the disk write fails.

## Error Handling
- If `SaveFileDialog` returns an empty string (user canceled), do nothing.
- If writing fails, return the error to the frontend, which will display it using the existing `showToast` or error notification mechanisms.

## Constraints & Trade-offs
- **Memory Limit**: Because formatting happens in the browser and the full string is passed over the Wails bridge to Go, very large result sets (e.g., 100k+ rows) might cause memory pressure or lag. Given this is a GUI query tool, result sets are typically paginated/limited (e.g., `LIMIT 1000`), so this trade-off is acceptable for the complexity reduction.
