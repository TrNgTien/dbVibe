import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Copy,
  Download,
  Search,
  Pencil,
  Trash2,
  CopyPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ROW_ACTION_DRIVERS = ["postgres", "mysql", "timescaledb"];

const densityClasses = {
  compact: "[&_th]:px-[7px] [&_th]:py-1 [&_td]:px-[7px] [&_td]:py-1",
  comfortable:
    "[&_th]:px-[9px] [&_th]:py-2.5 [&_td]:px-[9px] [&_td]:py-2.5",
  normal: "[&_th]:px-2 [&_th]:py-[7px] [&_td]:px-2 [&_td]:py-[7px]",
};

function quoteIdentifier(driver, name) {
  if (driver === "mysql") return "`" + String(name).replace(/`/g, "``") + "`";
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function quoteLiteral(value) {
  if (value === null || value === undefined || value === "NULL") return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function qualifiedTableName(driver, table) {
  const schema = table?.table?.schema;
  const name = table?.table?.name;
  if (!name) return "";
  return schema
    ? `${quoteIdentifier(driver, schema)}.${quoteIdentifier(driver, name)}`
    : quoteIdentifier(driver, name);
}

function primaryKeyColumns(table, columns) {
  const pk = (table?.columns || [])
    .filter((c) => c.primaryKey)
    .map((c) => c.name)
    .filter((name) => columns.includes(name));
  return pk.length ? pk : columns;
}

function buildUpdateSql(driver, table, columns, row) {
  const whereCols = primaryKeyColumns(table, columns);
  const setClause = columns
    .map((col) => `  ${quoteIdentifier(driver, col)} = ${quoteLiteral(row[col])}`)
    .join(",\n");
  const whereClause = whereCols
    .map((col) => `${quoteIdentifier(driver, col)} = ${quoteLiteral(row[col])}`)
    .join(" AND ");
  return `UPDATE ${qualifiedTableName(driver, table)}\nSET\n${setClause}\nWHERE ${whereClause};`;
}

function buildDeleteSql(driver, table, columns, row) {
  const whereCols = primaryKeyColumns(table, columns);
  const whereClause = whereCols
    .map((col) => `${quoteIdentifier(driver, col)} = ${quoteLiteral(row[col])}`)
    .join(" AND ");
  return `DELETE FROM ${qualifiedTableName(driver, table)}\nWHERE ${whereClause};`;
}

function buildInsertSql(driver, table, columns, rows) {
  const columnList = columns.map((col) => quoteIdentifier(driver, col)).join(", ");
  const valuesList = rows
    .map((row) => `  (${columns.map((col) => quoteLiteral(row[col])).join(", ")})`)
    .join(",\n");
  return `INSERT INTO ${qualifiedTableName(driver, table)} (${columnList})\nVALUES\n${valuesList};`;
}

export function ResultPanel({
  title,
  result,
  table,
  driver,
  onAppendQuery,
  onUpdateTTL,
  onExport,
  gridSettings = {} as Record<string, any>,
  onToast,
}) {
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const rowDensity = gridSettings.resultRowDensity || "normal";
  const nullDisplay = gridSettings.nullDisplay || "NULL";
  const showAlternateRows = gridSettings.showAlternateRows ?? true;

  useEffect(() => {
    setSelectionMode(false);
    setSelectedRows(new Set());
  }, [result]);

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedRows(new Set());
  };

  if (!result) return null;
  const isExplain = title.toLowerCase().includes("explain");
  const formatCellValue = (value) =>
    value === null || value === undefined || value === "NULL" ? (
      <span className="italic text-muted-foreground">{nullDisplay}</span>
    ) : (
      value
    );

  const canRowActions =
    !isExplain &&
    ROW_ACTION_DRIVERS.includes(driver) &&
    !!table?.table?.name &&
    !!table?.columns?.length &&
    !!onAppendQuery;

  const toggleRow = (index: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedRows((prev) =>
      prev.size === (result.rows || []).length
        ? new Set()
        : new Set((result.rows || []).map((_, index) => index)),
    );
  };

  const selectedRowData = () =>
    (result.rows || []).filter((_, index) => selectedRows.has(index));

  const handleEditClick = () => {
    if (!selectionMode) {
      setSelectionMode(true);
      return;
    }
    const rows = selectedRowData();
    if (rows.length !== 1) return;
    onAppendQuery?.(buildUpdateSql(driver, table, result.columns, rows[0]));
    onToast?.("UPDATE statement appended to editor");
    exitSelection();
  };

  const handleDeleteClick = () => {
    if (!selectionMode) {
      setSelectionMode(true);
      return;
    }
    const rows = selectedRowData();
    if (!rows.length) return;
    const sql = rows
      .map((row) => buildDeleteSql(driver, table, result.columns, row))
      .join("\n");
    onAppendQuery?.(sql);
    onToast?.(
      `DELETE statement${rows.length === 1 ? "" : "s"} for ${rows.length} row${rows.length === 1 ? "" : "s"} appended to editor`,
    );
    exitSelection();
  };

  const handleDuplicateClick = () => {
    if (!selectionMode) {
      setSelectionMode(true);
      return;
    }
    const rows = selectedRowData();
    if (!rows.length) return;
    onAppendQuery?.(buildInsertSql(driver, table, result.columns, rows));
    onToast?.(
      `INSERT statement for ${rows.length} row${rows.length === 1 ? "" : "s"} appended to editor`,
    );
    exitSelection();
  };

  const handleExport = async (format: "csv" | "json") => {
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
      onToast?.(e?.message || "Export failed");
    }
  };

  return (
    <section
      className={cn(
        "flex min-h-[180px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card",
        densityClasses[rowDensity] || densityClasses.normal,
        showAlternateRows && "[&_tbody_tr:nth-child(even)_td]:bg-muted/30",
      )}
    >
      <div className="flex min-h-[45px] flex-none items-center justify-between gap-3 border-b border-border px-3 py-[9px]">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <div className="flex flex-none items-center gap-1.5">
          {canRowActions && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(selectionMode && "bg-accent text-primary")}
                disabled={selectionMode && selectedRows.size !== 1}
                onClick={handleEditClick}
                title={
                  selectionMode
                    ? "Generate UPDATE for selected row"
                    : "Select a row to edit"
                }
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(selectionMode && "bg-accent text-primary")}
                disabled={selectionMode && selectedRows.size === 0}
                onClick={handleDuplicateClick}
                title={
                  selectionMode
                    ? "Generate INSERT (duplicate) for selected row(s)"
                    : "Select rows to duplicate"
                }
              >
                <CopyPlus />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(selectionMode && "bg-accent text-primary")}
                disabled={selectionMode && selectedRows.size === 0}
                onClick={handleDeleteClick}
                title={
                  selectionMode
                    ? "Generate DELETE for selected row(s)"
                    : "Select rows to delete"
                }
              >
                <Trash2 />
              </Button>
              {selectionMode && (
                <>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {selectedRows.size} selected
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={exitSelection}
                    title="Cancel row selection"
                  >
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
          {result.columns?.length > 0 && result.rows?.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Export Results"
                >
                  <Download />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleExport("csv")}>
                  Export to CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport("json")}>
                  Export to JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {result.redisKey && (
            <div className="flex items-center gap-2 border-r border-border py-0.5 pr-3 mr-3">
              <span className="text-xs text-foreground/70">
                {result.redisTTL === -1
                  ? "TTL: persistent forever"
                  : `TTL: ${result.redisTTL}s`}
              </span>
              <NativeSelect
                size="sm"
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
              </NativeSelect>
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {result.durationMs ?? 0}ms{" "}
            {result.message ? `· ${result.message}` : ""}
          </span>
        </div>
      </div>
      {result.columns?.length ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {canRowActions && selectionMode && (
                  <th className="w-8 p-0 text-center">
                    <label className="flex h-full w-full cursor-pointer items-center justify-center p-1.5">
                      <Checkbox
                        checked={
                          selectedRows.size > 0 &&
                          selectedRows.size === (result.rows || []).length
                        }
                        onCheckedChange={toggleAll}
                        aria-label="Select all rows"
                      />
                    </label>
                  </th>
                )}
                {result.columns.map((column) => (
                  <th
                    key={column}
                    className="sticky top-0 z-10 border-b border-r border-border bg-muted/80 text-left font-semibold text-foreground backdrop-blur-sm"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(result.rows || []).map((row, index) => (
                <tr
                  key={index}
                  className={cn(
                    "cursor-pointer transition-colors",
                    selectionMode && selectedRows.has(index)
                      ? "[&_td]:bg-primary/10"
                      : "hover:[&_td]:bg-muted",
                  )}
                  onClick={() =>
                    selectionMode
                      ? toggleRow(index)
                      : setSelectedRow({ row, index })
                  }
                >
                  {canRowActions && selectionMode && (
                    <td
                      className="w-8 p-0 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="flex h-full w-full cursor-pointer items-center justify-center p-1.5">
                        <Checkbox
                          checked={selectedRows.has(index)}
                          onCheckedChange={() => toggleRow(index)}
                          aria-label={`Select row ${index + 1}`}
                        />
                      </label>
                    </td>
                  )}
                  {result.columns.map((column) => (
                    <td
                      key={column}
                      className="max-w-[420px] overflow-hidden border-b border-r border-border font-mono text-foreground/90 whitespace-nowrap text-ellipsis"
                    >
                      {formatCellValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
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

  const miniPanel = "max-h-[260px] overflow-auto rounded-lg border border-border bg-card p-3";

  return (
    <section className="grid grid-cols-[1.1fr_1fr_1.2fr] gap-3">
      <div className={miniPanel}>
        <h2 className="mb-2.5 text-sm font-semibold text-foreground">Columns</h2>
        <div className="grid gap-2">
          {detail.columns.map((column) => (
            <div
              key={column.name}
              className="grid gap-0.5 border-b border-border pb-2 last:border-b-0"
            >
              <strong className="text-[13px] font-semibold">{column.name}</strong>
              <span className="font-mono text-xs text-foreground/80">
                {column.type}
              </span>
              <small className="text-xs text-muted-foreground">
                {column.nullable ? "nullable" : "not null"}{" "}
                {column.default ? `· ${column.default}` : ""}
              </small>
            </div>
          ))}
        </div>
      </div>
      <div className={miniPanel}>
        <h2 className="mb-2.5 text-sm font-semibold text-foreground">Indexes</h2>
        <div className="grid gap-2">
          {detail.indexes.map((index) => (
            <div
              key={index.name}
              className="grid gap-0.5 border-b border-border pb-2 last:border-b-0"
            >
              <strong className="text-[13px] font-semibold">{index.name}</strong>
              <span className="font-mono text-xs text-foreground/80">
                {index.unique ? "unique" : "index"} {index.columns}
              </span>
              <small className="truncate font-mono text-xs text-muted-foreground">
                {index.sql}
              </small>
            </div>
          ))}
        </div>
      </div>
      <div className={miniPanel}>
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Create Table</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Copy create table SQL"
            onClick={copyCreateSql}
          >
            <Copy />
          </Button>
        </div>
        <pre className="m-0 font-mono text-xs leading-relaxed text-primary/90 whitespace-pre-wrap">
          {detail.createSql}
        </pre>
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
      return <span className="italic text-muted-foreground">null</span>;
    if (typeof val === "string" && isJson(val)) {
      return (
        <pre className="m-0 rounded-md border border-border bg-background p-2.5 font-mono text-[13px] text-foreground">
          {JSON.stringify(JSON.parse(val), null, 2)}
        </pre>
      );
    }
    return String(val);
  };

  const toJsonValue = (v) => {
    if (typeof v === "string" && isJson(v)) {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    if (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== "") {
      return Number(v);
    }
    if (v === "true" || v === "false") {
      return v === "true";
    }
    return v;
  };

  const getJsonRow = () => {
    const jsonRow = {};
    for (const [k, v] of filteredEntries) {
      jsonRow[k] = toJsonValue(v);
    }
    return JSON.stringify(jsonRow, null, 2);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rowDetail flex max-h-[calc(100vh-3.5rem)] w-[min(75vw,calc(100vw-3.5rem))] max-w-full sm:max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="min-h-[48px] flex-row items-center gap-3 border-b border-border p-[10px_12px]">
          <DialogTitle className="text-sm">{title}</DialogTitle>
          {!isExplain && (
            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v)}
              className="mx-auto"
            >
              <TabsList>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </DialogHeader>
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          <div className="flex w-[min(360px,100%)] items-center gap-2 rounded-md border border-border bg-background px-2.5">
            <Search className="size-3.5 flex-none text-muted-foreground" />
            <input
              ref={searchInputRef}
              className="h-8 w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              value={fieldSearch}
              onChange={(event) => setFieldSearch(event.target.value)}
              placeholder="Search fields..."
              aria-label="Search fields"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredEntries.length} of {Object.keys(row).length} fields
          </span>
        </div>
        <div className="min-h-[220px] overflow-auto p-3.5">
          {viewMode === "json" ? (
            <div className="relative">
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2 z-10"
                title="Copy JSON"
                onClick={() => navigator.clipboard.writeText(getJsonRow())}
              >
                <Copy />
              </Button>
              <pre className="m-0 rounded-md border border-border bg-background p-2.5 font-mono text-[13px] leading-relaxed text-foreground">
                <div>{"{"}</div>
                {filteredEntries.map(([key, value], idx) => {
                  const formatted = JSON.stringify(
                    toJsonValue(value),
                    null,
                    2,
                  );
                  const indented = formatted.split("\n").join("\n  ");
                  const comma = idx < filteredEntries.length - 1 ? "," : "";
                  return (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-2 hover:[&_.json-line-copy]:opacity-100"
                    >
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        {"  "}
                        {JSON.stringify(key)}: {indented}
                        {comma}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="json-line-copy flex-none p-0.5 opacity-0 transition-opacity text-muted-foreground"
                        title="Copy key/value"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `${JSON.stringify(key)}: ${formatted}`,
                          )
                        }
                      >
                        <Copy className="size-3" />
                      </Button>
                    </div>
                  );
                })}
                <div>{"}"}</div>
              </pre>
            </div>
          ) : (
            <div className="grid min-w-0 gap-4">
              {filteredEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="group grid min-w-0 gap-1.5 border-b border-border pb-3 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <strong className="text-[13px] font-semibold text-muted-foreground">
                      {key}
                    </strong>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      title="Copy value"
                      onClick={() =>
                        navigator.clipboard.writeText(String(value || ""))
                      }
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                  <div className="min-w-0 font-mono text-[13px] whitespace-pre-wrap break-words text-foreground">
                    {formatValue(value)}
                  </div>
                </div>
              ))}
              {!filteredEntries.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  No fields match your search.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}