# Export Query Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to export query results from the data grid to a local CSV or JSON file using native macOS save dialogs.

**Architecture:** We add formatting logic to the React frontend (`ResultPanel`), send the formatted string to a new Wails backend function (`ExportQueryResult`), and use `runtime.SaveFileDialog` to save the file natively.

**Tech Stack:** Go (Wails runtime), React (JSX), JavaScript.

---

### Task 1: Add ExportQueryResult backend method

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Write backend implementation**

```go
// In app.go, add the ExportQueryResult method to the App struct:

func (a *App) ExportQueryResult(content string, defaultFilename string, filterName string, filterPattern string) (string, error) {
	ctx := a.ctx
	if ctx == nil {
		return "", fmt.Errorf("app context is nil")
	}

	options := runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Filters: []runtime.FileFilter{
			{
				DisplayName: filterName,
				Pattern:     filterPattern,
			},
		},
	}

	filepath, err := runtime.SaveFileDialog(ctx, options)
	if err != nil {
		return "", err
	}

	if filepath == "" {
		// User cancelled the dialog
		return "", nil
	}

	// Write content to the selected file path
	err = os.WriteFile(filepath, []byte(content), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to save file: %w", err)
	}

	return filepath, nil
}
```

- [ ] **Step 2: Commit**

```bash
git add app.go
git commit --no-gpg-sign -m "feat: add ExportQueryResult to Go backend"
```

### Task 2: Add Download icon

**Files:**
- Modify: `frontend/src/icons.jsx`

- [ ] **Step 1: Add Download icon to icons.jsx**

```jsx
// In frontend/src/icons.jsx, add this export:

export function Download({ size = 24, color = "currentColor", ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/icons.jsx
git commit --no-gpg-sign -m "feat: add Download icon"
```

### Task 3: Generate Wails Bindings

**Files:**
- Modify: `frontend/wailsjs/go/main/App.js` and `frontend/wailsjs/go/main/App.d.ts` (auto-generated)

- [ ] **Step 1: Run wails build/generate to update bindings**

```bash
wails generate module
```
*Note: If `wails generate module` is not available, building the app or running the dev server via `wails dev` usually regenerates bindings.* For this plan, we assume `wails generate module` or manually updating the imports in `frontend/src/main.jsx`.

- [ ] **Step 2: Commit generated bindings**

```bash
git add frontend/wailsjs
git commit --no-gpg-sign -m "chore: update wails bindings for ExportQueryResult"
```


### Task 4: Add Export UI and Logic to ResultPanel

**Files:**
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Import new dependencies in main.jsx**

At the top of `frontend/src/main.jsx`, import `Download` and `ExportQueryResult`:

```jsx
// In frontend/src/main.jsx, update imports:
import {
  /* existing icons... */
  Download
} from "./icons";

// And in the wailsjs imports:
import {
  /* existing methods... */
  ExportQueryResult
} from "../../wailsjs/go/main/App";
```

- [ ] **Step 2: Add Export Dropdown to ResultPanel**

Modify `ResultPanel` in `frontend/src/main.jsx`:

```jsx
function ResultPanel({ title, result, onUpdateTTL }) {
  const [selectedRow, setSelectedRow] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  // Add click outside handler for export menu
  useEffect(() => {
    function handleClickOutside(event) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!result) return null;
  const isExplain = title.toLowerCase().includes("explain");

  const handleExport = async (format) => {
    setExportMenuOpen(false);
    if (!result.columns || !result.rows || result.rows.length === 0) {
      return;
    }

    try {
      let content = "";
      let defaultFilename = "";
      let filterName = "";
      let filterPattern = "";

      if (format === "json") {
        content = JSON.stringify(result.rows, null, 2);
        defaultFilename = "export.json";
        filterName = "JSON Files (*.json)";
        filterPattern = "*.json";
      } else if (format === "csv") {
        // Escape CSV field
        const escapeCSV = (val) => {
          if (val === null || val === undefined) return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes("\\n") || str.includes("\\r")) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        };

        const headers = result.columns.map(escapeCSV).join(",");
        const rows = result.rows.map(row => 
          result.columns.map(col => escapeCSV(row[col])).join(",")
        ).join("\\n");
        
        content = headers + "\\n" + rows;
        defaultFilename = "export.csv";
        filterName = "CSV Files (*.csv)";
        filterPattern = "*.csv";
      }

      await ExportQueryResult(content, defaultFilename, filterName, filterPattern);
    } catch (e) {
      console.error("Export failed:", e);
      // Ideally show toast here, but showToast is in App scope. Let's just log for now or pass showToast down.
    }
  };

  return (
    <section className="panel resultPanel">
      <div className="panelHead">
        <h2>{title}</h2>
        <div className="rowActions">
          
          {/* Add export button right here, before the existing rowActions */}
          {result.columns?.length > 0 && result.rows?.length > 0 && (
            <div className="exportContainer" style={{ position: "relative" }} ref={exportMenuRef}>
              <button 
                className="iconButton" 
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                title="Export Results"
              >
                <Download size={14} />
              </button>
              {exportMenuOpen && (
                <div className="contextMenu" style={{ position: "absolute", top: "100%", right: 0, marginTop: "4px" }}>
                  <button onClick={() => handleExport("csv")}>Export to CSV</button>
                  <button onClick={() => handleExport("json")}>Export to JSON</button>
                </div>
              )}
            </div>
          )}

          {result.redisKey && (
            // Existing TTL display
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main.jsx
git commit --no-gpg-sign -m "feat: add export results UI and formatting logic"
```