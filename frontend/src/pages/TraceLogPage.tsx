import React, { useEffect, useMemo, useState } from "react";
import { Download, FileText, RefreshCw, Search, X } from "lucide-react";
import { api, driverLabel } from "../utils/api";
import { Page, Panel, PanelHeader } from "../components/shared/layout";
import { CodeBlock } from "../components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function parseTraceEvents(text) {
  const source = String(text || "");
  if (!source.trim()) return [];
  const statements = collectTraceStatements(source);

  return statements
    .map((stmt, index) => {
      const sql = stmt.sql.trim();
      const actionMatch = sql.match(/^(INSERT|UPDATE|DELETE)\b/i);
      if (!actionMatch) return null;

      const action = actionMatch[1].toUpperCase();
      let table = "unknown";
      if (action === "INSERT") {
        table = sql.match(/INSERT\s+INTO\s+([^\s(]+)/i)?.[1] || table;
      } else if (action === "UPDATE") {
        table = sql.match(/UPDATE\s+([^\s]+)/i)?.[1] || table;
      } else if (action === "DELETE") {
        table = sql.match(/DELETE\s+FROM\s+([^\s]+)/i)?.[1] || table;
      }

      const timestampMatch = stmt.context.match(/#(\d{6}\s+\d{2}:\d{2}:\d{2})/);
      const timestampLabel = timestampMatch ? timestampMatch[1] : "";

      return {
        id: `evt-${index}`,
        action,
        table: table.replace(/[`"]/g, ""),
        sql,
        summary: summarizeSql(sql),
        timestampLabel,
        context: stmt.context,
      };
    })
    .filter(Boolean);
}

function collectTraceStatements(source) {
  const lines = source.split("\n");
  const statements = [];
  let currentContext = [];
  let currentSql = [];
  let inStatement = false;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      inStatement = true;
      currentSql.push(line.slice(4));
      continue;
    }

    if (line.startsWith("#") || line.startsWith("/*")) {
      if (inStatement) {
        statements.push({
          context: currentContext.join("\n"),
          sql: currentSql.join("\n"),
        });
        currentContext = [];
        currentSql = [];
        inStatement = false;
      }
      currentContext.push(line);
      continue;
    }

    if (line.trim()) {
      inStatement = true;
      currentSql.push(line);
    }
  }

  if (inStatement) {
    statements.push({
      context: currentContext.join("\n"),
      sql: currentSql.join("\n"),
    });
  }

  return statements;
}

function summarizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim().slice(0, 180);
}

function traceStats(events) {
  return events.reduce(
    (totals, event) => {
      totals[event.action.toLowerCase()] += 1;
      return totals;
    },
    { insert: 0, update: 0, delete: 0 },
  );
}

const traceActionStyles = {
  insert: "text-emerald-400 border-emerald-500/40",
  update: "text-yellow-400 border-yellow-500/40",
  delete: "text-red-400 border-red-500/40",
};

export function TraceLogPage({ connection, onExport }) {
  const [traceText, setTraceText] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [binlogs, setBinlogs] = useState([]);
  const [selectedBinlog, setSelectedBinlog] = useState("");
  const [binlogLoading, setBinlogLoading] = useState(false);
  const [binlogError, setBinlogError] = useState("");

  const events = useMemo(() => parseTraceEvents(traceText), [traceText]);
  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((event) => {
      const matchesAction =
        actionFilter === "all" || event.action.toLowerCase() === actionFilter;
      const matchesSearch =
        !term ||
        `${event.action} ${event.table} ${event.timestampLabel} ${event.sql}`
          .toLowerCase()
          .includes(term);
      return matchesAction && matchesSearch;
    });
  }, [actionFilter, events, search]);
  const stats = useMemo(() => traceStats(events), [events]);
  const binlogHost = connection?.binlogHost || connection?.host;
  const binlogPort = connection?.binlogPort || connection?.port;

  useEffect(() => {
    setBinlogs([]);
    setSelectedBinlog("");
    setBinlogError("");
  }, [connection?.id]);

  async function loadTraceFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setTraceText(await file.text());
    event.target.value = "";
  }

  async function refreshBinlogs() {
    if (!connection?.id || connection.driver !== "mysql") return;
    setBinlogLoading(true);
    setBinlogError("");
    try {
      const items = (await api.call("ListBinlogs", connection.id)) || [];
      setBinlogs(items);
      setSelectedBinlog((current) =>
        items.includes(current) ? current : items.at(-1) || "",
      );
    } catch (err) {
      setBinlogError(err?.message || String(err));
    } finally {
      setBinlogLoading(false);
    }
  }

  async function loadBinlog() {
    if (!connection?.id || !selectedBinlog) return;
    setBinlogLoading(true);
    setBinlogError("");
    try {
      setTraceText(await api.call("ReadBinlog", connection.id, selectedBinlog));
    } catch (err) {
      setBinlogError(err?.message || String(err));
    } finally {
      setBinlogLoading(false);
    }
  }

  async function exportBinlog() {
    if (!traceText || !selectedBinlog) return;
    await onExport?.({
      content: traceText,
      format: "sql",
      defaultFilename: `${selectedBinlog}.sql`,
      filterName: "SQL Files (*.sql)",
      filterPattern: "*.sql",
      rows: events.length,
    });
  }

  return (
    <Page className="grid grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)] gap-3">
      <Panel className="min-h-0">
        <PanelHeader
          title="Trace Log"
          description={`${driverLabel(connection?.driver)} · ${binlogHost}:${binlogPort}`}
          className="items-start"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {connection?.driver === "mysql" && (
                <>
                  <NativeSelect
                    size="sm"
                    value={selectedBinlog}
                    onChange={(event) => setSelectedBinlog(event.target.value)}
                    disabled={binlogLoading || !binlogs.length}
                    title="MySQL binary log"
                  >
                    <option value="">
                      {binlogs.length ? "Select binlog" : "No binlogs loaded"}
                    </option>
                    {binlogs.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    variant="outline"
                    size="sm"
                    title="Refresh binlogs"
                    onClick={refreshBinlogs}
                    disabled={binlogLoading}
                  >
                    <RefreshCw data-icon="inline-start" /> Binlogs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadBinlog}
                    disabled={binlogLoading || !selectedBinlog}
                  >
                    <FileText data-icon="inline-start" /> Load
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportBinlog}
                    disabled={!traceText || !selectedBinlog}
                  >
                    <Download data-icon="inline-start" /> Export
                  </Button>
                </>
              )}
              <Button asChild variant="outline" size="sm" className="min-h-8">
                <label className="cursor-pointer">
                  <FileText data-icon="inline-start" />
                  Load log
                  <input
                    type="file"
                    className="hidden"
                    accept=".log,.sql,.txt"
                    onChange={loadTraceFile}
                  />
                </label>
              </Button>
            </div>
          }
        />
        {binlogError && (
          <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
            <AlertDescription>{binlogError}</AlertDescription>
          </Alert>
        )}
        <Textarea
          className="min-h-0 flex-1 resize-none rounded-none border-0 bg-background font-mono text-xs shadow-none focus-visible:ring-0"
          value={traceText}
          onChange={(event) => setTraceText(event.target.value)}
          spellCheck={false}
          placeholder="Paste mysqlbinlog output or SQL audit text here"
        />
      </Panel>

      <Panel className="min-h-0">
        <PanelHeader
          title="Mutation Events"
          description={`${stats.insert} insert · ${stats.update} update · ${stats.delete} delete`}
          actions={<span className="text-xs text-muted-foreground">{filteredEvents.length} events</span>}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2 border-b border-border p-2.5">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5">
            <Search className="size-4 flex-none text-muted-foreground" />
            <input
              className="h-8 w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter table or SQL"
            />
          </div>
          <NativeSelect
            size="sm"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
          >
            <option value="all">All actions</option>
            <option value="insert">INSERT</option>
            <option value="update">UPDATE</option>
            <option value="delete">DELETE</option>
          </NativeSelect>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5">
          {filteredEvents.map((event) => (
            <button
              key={event.id}
              type="button"
              className={cn(
                "grid w-full min-h-[68px] grid-cols-[74px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border bg-background p-2.5 text-left transition-colors",
                "hover:border-primary hover:bg-muted/50",
              )}
              onClick={() => setSelectedEvent(event)}
            >
              <span
                className={cn(
                  "w-fit rounded-full border px-2 py-1 text-[11px] font-bold",
                  traceActionStyles[event.action.toLowerCase()] ||
                    "border-border text-muted-foreground",
                )}
              >
                {event.action}
              </span>
              <span className="grid min-w-0 gap-1.5">
                <strong className="truncate text-sm font-semibold">
                  {event.table}
                </strong>
                <small className="truncate font-mono text-xs text-muted-foreground">
                  {event.summary}
                </small>
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {event.timestampLabel}
              </span>
            </button>
          ))}
          {!filteredEvents.length && (
            <div className="flex min-h-56 flex-1 flex-col items-center justify-center gap-2.5 text-muted-foreground">
              <FileText className="size-6" />
              <span className="text-sm">
                No INSERT, UPDATE, or DELETE statements found
              </span>
            </div>
          )}
        </div>
      </Panel>

      {selectedEvent && (
        <TraceEventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </Page>
  );
}

function TraceEventModal({ event, onClose }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] w-[min(1120px,calc(100vw-3.5rem))] max-w-full overflow-y-auto">
        <DialogHeader className="min-h-[48px] border-b border-border p-[10px_12px]">
          <DialogTitle>
            {event.action} · {event.table}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{event.timestampLabel}</p>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2.5">
          {[
            ["Action", event.action],
            ["Table", event.table],
            ["Time", event.timestampLabel || "Unknown"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1.5 rounded-lg border border-border bg-background p-2.5"
            >
              <span className="text-xs text-muted-foreground">{label}</span>
              <strong className="truncate text-sm font-semibold">{value}</strong>
            </div>
          ))}
        </div>
        <CodeBlock label="SQL Statement">{event.sql}</CodeBlock>
        {event.context && (
          <CodeBlock label="Context / Metadata" className="max-h-64 overflow-y-auto">
            {event.context}
          </CodeBlock>
        )}
      </DialogContent>
    </Dialog>
  );
}