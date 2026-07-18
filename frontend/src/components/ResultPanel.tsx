import React, { useState, useRef, useEffect, useMemo } from "react";
import { X, Copy, Download, Search } from "lucide-react";

export function ResultPanel({
  title,
  result,
  onUpdateTTL,
  onExport,
  gridSettings = {},
}) {
  const [selectedRow, setSelectedRow] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const rowDensity = gridSettings.resultRowDensity || "normal";
  const nullDisplay = gridSettings.nullDisplay || "NULL";
  const showAlternateRows = gridSettings.showAlternateRows ?? true;

  // Add click outside handler for export menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target as Node)
      ) {
        setExportMenuOpen(false);
      }
    }
    if (exportMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportMenuOpen]);

  if (!result) return null;
  const isExplain = title.toLowerCase().includes("explain");
  const formatCellValue = (value) =>
    value === null || value === undefined || value === "NULL" ? (
      <span className="nullValue">{nullDisplay}</span>
    ) : (
      value
    );

  const handleExport = async (format: "csv" | "json") => {
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
        const escapeCSV = (val: any) => {
          if (val === null || val === undefined) return "";
          const str = String(val);
          if (
            str.includes(",") ||
            str.includes('"') ||
            str.includes("\n") ||
            str.includes("\r")
          ) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        };

        const headers = result.columns.map(escapeCSV).join(",");
        const rows = result.rows
          .map((row: any) =>
            result.columns.map((col: any) => escapeCSV(row[col])).join(","),
          )
          .join("\n");

        content = headers + "\n" + rows;
        defaultFilename = "export.csv";
        filterName = "CSV Files (*.csv)";
        filterPattern = "*.csv";
      }

      await onExport?.({
        format,
        content,
        defaultFilename,
        filterName,
        filterPattern,
        rows: result.rows.length,
      });
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  return (
    <section
      className={`panel resultPanel resultDensity-${rowDensity}${showAlternateRows ? " alternateRows" : ""}`}
    >
      <div className="panelHead">
        <h2>{title}</h2>
        <div className="rowActions">
          {result.columns?.length > 0 && result.rows?.length > 0 && (
            <div
              className="exportContainer"
              style={{ position: "relative" }}
              ref={exportMenuRef}
            >
              <button
                className="iconButton"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                title="Export Results"
              >
                <Download size={14} />
              </button>
              {exportMenuOpen && (
                <div
                  className="contextMenu"
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "4px",
                  }}
                >
                  <button onClick={() => handleExport("csv")}>
                    Export to CSV
                  </button>
                  <button onClick={() => handleExport("json")}>
                    Export to JSON
                  </button>
                </div>
              )}
            </div>
          )}
          {result.redisKey && (
            <div className="ttlDisplay">
              <span>
                {result.redisTTL === -1
                  ? "TTL: persistent forever"
                  : `TTL: ${result.redisTTL}s`}
              </span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    onUpdateTTL(Number(e.target.value));
                    e.target.value = "";
                  }
                }}
                value=""
              >
                <option value="" disabled>
                  Update TTL...
                </option>
                <option value="-1">Persistent (Remove TTL)</option>
                <option value="60">1 minute</option>
                <option value="300">5 minutes</option>
                <option value="3600">1 hour</option>
                <option value="86400">1 day</option>
              </select>
            </div>
          )}
          <span>
            {result.durationMs ?? 0}ms{" "}
            {result.message ? `· ${result.message}` : ""}
          </span>
        </div>
      </div>
      {result.columns?.length ? (
        <div className="resultScroll">
          <table>
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(result.rows || []).map((row, index) => (
                <tr
                  key={index}
                  className="clickableRow"
                  onClick={() => setSelectedRow({ row, index })}
                >
                  {result.columns.map((column) => (
                    <td key={column}>{formatCellValue(row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          {result.message || `${result.rowsAffected || 0} rows affected`}
        </p>
      )}
      {selectedRow && (
        <RowDetailModal
          title={`${title} row ${selectedRow.index + 1}`}
          row={selectedRow.row}
          isExplain={isExplain}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </section>
  );
}

export function TableInspector({ detail, onToast }) {
  const copyCreateSql = async () => {
    try {
      await navigator.clipboard.writeText(detail.createSql || "");
      onToast?.("Copied");
    } catch (error) {
      console.error("Failed to copy create table SQL", error);
      onToast?.("Copy failed");
    }
  };

  return (
    <section className="inspector">
      <div className="panel mini">
        <h2>Columns</h2>
        <div className="columns">
          {detail.columns.map((column) => (
            <div key={column.name}>
              <strong>{column.name}</strong>
              <span>{column.type}</span>
              <small>
                {column.nullable ? "nullable" : "not null"}{" "}
                {column.default ? `· ${column.default}` : ""}
              </small>
            </div>
          ))}
        </div>
      </div>
      <div className="panel mini">
        <h2>Indexes</h2>
        <div className="indexes">
          {detail.indexes.map((index) => (
            <div key={index.name}>
              <strong>{index.name}</strong>
              <span>
                {index.unique ? "unique" : "index"} {index.columns}
              </span>
              <small>{index.sql}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="panel mini ddl">
        <div className="ddlHead">
          <h2>Create Table</h2>
          <button
            className="iconButton"
            title="Copy create table SQL"
            onClick={copyCreateSql}
          >
            <Copy size={15} />
          </button>
        </div>
        <pre>{detail.createSql}</pre>
      </div>
    </section>
  );
}

function RowDetailModal({ title, row, isExplain, onClose }) {
  const [viewMode, setViewMode] = useState(isExplain ? "list" : "json");
  const [fieldSearch, setFieldSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredEntries = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase();
    const entries = Object.entries(row);
    if (!query) return entries;
    return entries.filter(([key]) => key.toLowerCase().includes(query));
  }, [fieldSearch, row]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (
        event.key.toLowerCase() === "f" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    searchInputRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isExplain, onClose]);

  const isJson = (val) => {
    if (typeof val !== "string") return false;
    try {
      const parsed = JSON.parse(val);
      return typeof parsed === "object" && parsed !== null;
    } catch {
      return false;
    }
  };

  const formatValue = (val) => {
    if (val === null || val === undefined)
      return <span className="nullValue">null</span>;
    if (typeof val === "string" && isJson(val)) {
      return (
        <pre className="jsonValue">
          {JSON.stringify(JSON.parse(val), null, 2)}
        </pre>
      );
    }
    return String(val);
  };

  const getJsonRow = () => {
    const jsonRow = {};
    for (const [k, v] of filteredEntries) {
      if (typeof v === "string" && isJson(v)) {
        try {
          jsonRow[k] = JSON.parse(v);
        } catch {
          jsonRow[k] = v;
        }
      } else {
        // Convert numeric strings back to numbers for prettier JSON if they strictly match
        if (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== "") {
          jsonRow[k] = Number(v);
        } else if (v === "true" || v === "false") {
          jsonRow[k] = v === "true";
        } else {
          jsonRow[k] = v;
        }
      }
    }
    return JSON.stringify(jsonRow, null, 2);
  };

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div
        className="modalPanel rowModal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHead">
          <h2>{title}</h2>
          {!isExplain && (
            <div className="viewTabs" style={{ margin: "0 auto 0 16px" }}>
              <button
                className={viewMode === "list" ? "active" : ""}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
              <button
                className={viewMode === "json" ? "active" : ""}
                onClick={() => setViewMode("json")}
              >
                JSON
              </button>
            </div>
          )}
          <button className="iconButton" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="rowDetailToolbar">
          <label className="rowFieldSearch">
            <Search size={15} />
            <input
              ref={searchInputRef}
              value={fieldSearch}
              onChange={(event) => setFieldSearch(event.target.value)}
              placeholder="Search fields..."
              aria-label="Search fields"
            />
          </label>
          <span>
            {filteredEntries.length} of {Object.keys(row).length} fields
          </span>
        </div>
        <div className="modalBody rowDetail">
          {viewMode === "json" ? (
            <div style={{ position: "relative" }}>
              <button
                className="iconButton small"
                style={{ position: "absolute", top: 8, right: 8 }}
                title="Copy JSON"
                onClick={() => navigator.clipboard.writeText(getJsonRow())}
              >
                <Copy size={14} />
              </button>
              <pre className="jsonValue" style={{ margin: 0 }}>
                {getJsonRow()}
              </pre>
            </div>
          ) : (
            <div className="rowFields">
              {filteredEntries.map(([key, value]) => (
                <div key={key} className="rowField">
                  <div className="rowFieldHeader">
                    <strong>{key}</strong>
                    <button
                      className="iconButton small"
                      title="Copy value"
                      onClick={() =>
                        navigator.clipboard.writeText(String(value || ""))
                      }
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  <div className="rowFieldValue">{formatValue(value)}</div>
                </div>
              ))}
              {!filteredEntries.length && (
                <p className="empty">No fields match your search.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
