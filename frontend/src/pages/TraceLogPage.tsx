import React, { useState, useMemo } from "react";
import { FileText, Search, X } from "lucide-react";
import { driverLabel } from "../utils/api";

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

export function TraceLogPage({ connection }) {
  const [traceText, setTraceText] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState(null);

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

  async function loadTraceFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setTraceText(await file.text());
    event.target.value = "";
  }

  return (
    <section className="tracePage">
      <section className="panel traceInputPanel">
        <div className="panelHead">
          <div>
            <h2>Trace Log</h2>
            <small>
              {driverLabel(connection?.driver)} · {connection?.host}:{connection?.port}
            </small>
          </div>
          <div className="rowActions">
            <label className="fileButton">
              <FileText size={15} />
              Load log
              <input
                type="file"
                accept=".log,.sql,.txt"
                onChange={loadTraceFile}
              />
            </label>
          </div>
        </div>
        <textarea
          className="traceText"
          value={traceText}
          onChange={(event) => setTraceText(event.target.value)}
          spellCheck={false}
          placeholder="Paste mysqlbinlog output or SQL audit text here"
        />
      </section>

      <section className="panel traceEventsPanel">
        <div className="panelHead">
          <div>
            <h2>Mutation Events</h2>
            <small>
              {stats.insert} insert · {stats.update} update · {stats.delete} delete
            </small>
          </div>
          <span>{filteredEvents.length} events</span>
        </div>
        <div className="traceToolbar">
          <label className="traceSearch">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter table or SQL"
            />
          </label>
          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
          >
            <option value="all">All actions</option>
            <option value="insert">INSERT</option>
            <option value="update">UPDATE</option>
            <option value="delete">DELETE</option>
          </select>
        </div>
        <div className="traceEvents">
          {filteredEvents.map((event) => (
            <button
              key={event.id}
              className="traceEvent"
              onClick={() => setSelectedEvent(event)}
            >
              <span className={`traceAction ${event.action.toLowerCase()}`}>
                {event.action}
              </span>
              <span className="traceEventBody">
                <strong>{event.table}</strong>
                <small>{event.summary}</small>
              </span>
              <span className="traceTime">{event.timestampLabel}</span>
            </button>
          ))}
          {!filteredEvents.length && (
            <div className="traceEmpty">
              <FileText size={24} />
              <span>No INSERT, UPDATE, or DELETE statements found</span>
            </div>
          )}
        </div>
      </section>

      {selectedEvent && (
        <TraceEventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </section>
  );
}

function TraceEventModal({ event, onClose }) {
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modalPanel traceModal" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>
              {event.action} · {event.table}
            </h2>
            <small>{event.timestampLabel}</small>
          </div>
          <button title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="traceEventDetail">
          <div className="traceSummaryGrid">
            <div>
              <span>Action</span>
              <strong>{event.action}</strong>
            </div>
            <div>
              <span>Table</span>
              <strong>{event.table}</strong>
            </div>
            <div>
              <span>Time</span>
              <strong>{event.timestampLabel || "Unknown"}</strong>
            </div>
          </div>
          <div className="traceCodeBlock">
            <div className="traceCodeLabel">SQL Statement</div>
            <pre>{event.sql}</pre>
          </div>
          {event.context && (
            <div className="traceCodeBlock">
              <div className="traceCodeLabel">Context / Metadata</div>
              <pre className="traceContext">{event.context}</pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}