import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  MemoryStick,
  RefreshCw,
  X,
} from "lucide-react";
import { api, driverLabel, formatBytes, formatNumber } from "../utils/api";

function formatDuration(value) {
  const ms = Number(value || 0);
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  if (ms >= 1) return `${ms.toFixed(ms >= 100 ? 0 : 1)}ms`;
  return `${(ms * 1000).toFixed(0)}µs`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function resourcePercent(used, limit) {
  const current = Number(used || 0);
  const maximum = Number(limit || 0);
  if (!maximum) return 0;
  return current / maximum * 100;
}

function summaryCards(summary, driver) {
  if (driver === "redis") {
    return [
      ["Tracked commands", formatNumber(summary?.statementCount)],
      ["Total calls", formatNumber(summary?.calls)],
      ["Total command time", formatDuration(summary?.totalTimeMs)],
      ["Operations / sec", formatNumber(summary?.operationsPerSecond)],
      ["Cache hit ratio", formatPercent(summary?.cacheHitRatio)],
    ];
  }
  if (driver === "mongodb") {
    return [
      ["Tracked query shapes", formatNumber(summary?.statementCount)],
      ["Total executions", formatNumber(summary?.calls)],
      ["Total execution time", formatDuration(summary?.totalTimeMs)],
      ["Average execution", formatDuration(summary?.averageTimeMs)],
      ["Documents examined", formatNumber(summary?.rowsExamined)],
    ];
  }
  return [
    ["Tracked statements", formatNumber(summary?.statementCount)],
    ["Total calls", formatNumber(summary?.calls)],
    ["Total execution time", formatDuration(summary?.totalTimeMs)],
    ["Average execution", formatDuration(summary?.averageTimeMs)],
    [
      driver === "mysql" ? "Rows examined" : "Rows returned",
      formatNumber(driver === "mysql" ? summary?.rowsExamined : summary?.rows),
    ],
  ];
}

const REFRESH_INTERVALS = [
  [0, "Off"],
  [-1, "Auto"],
  [5, "5s"],
  [10, "10s"],
  [30, "30s"],
  [60, "1m"],
  [300, "5m"],
  [900, "15m"],
  [1800, "30m"],
  [3600, "1h"],
  [7200, "2h"],
  [86400, "1d"],
];

function effectiveRefreshSeconds(interval) {
  return interval === -1 ? 5 : interval;
}

export function QueryInsightsPage({ connection, database }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() => {
    const stored = Number(localStorage.getItem("tnt-sql-insights-refresh") || 0);
    return REFRESH_INTERVALS.some(([seconds]) => seconds === stored) ? stored : 0;
  });
  const [nextRefreshAt, setNextRefreshAt] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false);
  const previousCPURef = useRef(null);
  const loadingRef = useRef(false);
  const refreshMenuRef = useRef(null);

  const cards = useMemo(
    () => summaryCards(insights?.summary, connection?.driver),
    [connection?.driver, insights?.summary],
  );

  const refresh = useCallback(async () => {
    if (!connection?.id || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const next = await api.call(
        "GetQueryInsights",
        connection.id,
        database || "",
        25,
      );
      const cpuTotal = Number(next?.resources?.cpuTotalSeconds || 0);
      const collectedAt = Date.parse(next?.collectedAt || "");
      const previous = previousCPURef.current;
      if (
        next?.resources?.source !== "docker" &&
        next?.resources?.cpuAvailable &&
        previous &&
        collectedAt > previous.collectedAt
      ) {
        const elapsedSeconds = (collectedAt - previous.collectedAt) / 1000;
        next.resources.cpuUsagePercent =
          Math.max(0, cpuTotal - previous.cpuTotal) / elapsedSeconds * 100;
      }
      if (
        next?.resources?.source !== "docker" &&
        next?.resources?.cpuAvailable &&
        Number.isFinite(collectedAt)
      ) {
        previousCPURef.current = { cpuTotal, collectedAt };
      }
      setInsights(next);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      const intervalSeconds = effectiveRefreshSeconds(refreshIntervalSeconds);
      setNextRefreshAt(
        intervalSeconds > 0
          ? Date.now() + intervalSeconds * 1000
          : null,
      );
    }
  }, [connection?.id, database, refreshIntervalSeconds]);

  useEffect(() => {
    setInsights(null);
    setError("");
    setSelectedInsight(null);
    previousCPURef.current = null;
    setNextRefreshAt(null);
    if (connection?.id) refresh();
  }, [connection?.id, database, refresh]);

  useEffect(() => {
    localStorage.setItem(
      "tnt-sql-insights-refresh",
      String(refreshIntervalSeconds),
    );
    const intervalSeconds = effectiveRefreshSeconds(refreshIntervalSeconds);
    setNextRefreshAt(
      intervalSeconds > 0
        ? Date.now() + intervalSeconds * 1000
        : null,
    );
  }, [refreshIntervalSeconds]);

  useEffect(() => {
    if (!nextRefreshAt || effectiveRefreshSeconds(refreshIntervalSeconds) <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      if (now >= nextRefreshAt && !loadingRef.current) {
        refresh();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [nextRefreshAt, refresh, refreshIntervalSeconds]);

  useEffect(() => {
    if (!refreshMenuOpen) return;
    const close = (event) => {
      if (
        event.type === "keydown" &&
        event.key !== "Escape"
      ) {
        return;
      }
      if (
        event.type === "mousedown" &&
        refreshMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setRefreshMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [refreshMenuOpen]);

  const refreshCountdown = nextRefreshAt
    ? Math.max(0, Math.ceil((nextRefreshAt - clockNow) / 1000))
    : null;

  return (
    <section className="insightsPage">
      <section className="panel insightsPanel">
        <div className="panelHead">
          <div>
            <h2>
              {connection?.driver === "redis"
                ? "Redis Performance Trace"
                : "Query Insights"}
            </h2>
            <small>
              {driverLabel(connection?.driver)} · {database || connection?.database}
            </small>
          </div>
          <div className="insightsRefreshControls">
            <div className="insightsRefreshSplit" ref={refreshMenuRef}>
              <button
                className="insightsRefreshButton"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw size={15} className={loading ? "spinning" : ""} />
                {loading
                  ? "Loading"
                  : refreshCountdown !== null
                    ? `Refresh in ${refreshCountdown}s`
                    : "Refresh"}
              </button>
              <button
                className="insightsRefreshMenuButton"
                title="Auto refresh interval"
                aria-label="Auto refresh interval"
                aria-expanded={refreshMenuOpen}
                onClick={() => setRefreshMenuOpen((open) => !open)}
              >
                {refreshMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {refreshMenuOpen && (
                <div className="insightsRefreshMenu">
                  {REFRESH_INTERVALS.map(([seconds, label]) => (
                    <button
                      key={seconds}
                      className={refreshIntervalSeconds === seconds ? "active" : ""}
                      onClick={() => {
                        setRefreshIntervalSeconds(seconds);
                        setRefreshMenuOpen(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <div className="error insightsError">{error}</div>}

        {insights && <ResourceTelemetry resources={insights.resources} />}

        {insights && !insights.available && (
          <div className="insightsEmpty">
            <Activity size={28} />
            <strong>Query statistics are not enabled</strong>
            <span>{insights.message}</span>
          </div>
        )}

        {insights?.available && (
          <>
            <div className="insightsSummary">
              {cards.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            {insights.message && !insights.queries?.length ? (
              <div className="insightsEmpty">
                <Activity size={28} />
                <strong>No workload data yet</strong>
                <span>{insights.message}</span>
              </div>
            ) : (
              <div className="insightsTableScroll">
                <table className="insightsTable">
                  <thead>
                    <tr>
                      <th>Impact</th>
                      <th>
                        {connection?.driver === "redis"
                          ? "Command"
                          : connection?.driver === "mongodb"
                            ? "Query shape"
                            : "Query"}
                      </th>
                      <th>Calls</th>
                      <th>Total time</th>
                      <th>Average</th>
                      <th>
                        {connection?.driver === "redis"
                          ? "Failed"
                          : connection?.driver === "mongodb"
                            ? "Examined"
                          : connection?.driver === "mysql"
                            ? "Examined"
                            : "Rows"}
                      </th>
                      <th>
                        {connection?.driver === "redis"
                          ? "Rejected"
                          : connection?.driver === "mongodb"
                            ? "Returned"
                          : connection?.driver === "mysql"
                            ? "Disk temp"
                            : "Cache hit"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(insights.queries || []).map((item, index) => (
                      <tr
                        key={`${item.query}-${index}`}
                        className="insightRow"
                        tabIndex={0}
                        onClick={() => setSelectedInsight(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedInsight(item);
                          }
                        }}
                        aria-label={`Open performance details for ${item.query}`}
                      >
                        <td className="impactCell">
                          <strong>{formatPercent(item.impactPercent)}</strong>
                          <span>
                            <i style={{ width: `${Math.max(2, item.impactPercent)}%` }} />
                          </span>
                        </td>
                        <td className="insightQuery">
                          <span className="insightQueryText">{item.query}</span>
                          <span className="insightQueryTooltip" role="tooltip">
                            {item.query}
                          </span>
                        </td>
                        <td>{formatNumber(item.calls)}</td>
                        <td>{formatDuration(item.totalTimeMs)}</td>
                        <td>{formatDuration(item.averageTimeMs)}</td>
                        <td>
                          {formatNumber(
                            connection?.driver === "redis"
                              ? item.failedCalls
                              : connection?.driver === "mongodb"
                                ? item.rowsExamined
                              : connection?.driver === "mysql"
                                ? item.rowsExamined
                                : item.rows,
                          )}
                        </td>
                        <td>
                          {connection?.driver === "redis"
                            ? formatNumber(item.rejectedCalls)
                            : connection?.driver === "mongodb"
                              ? formatNumber(item.rows)
                            : connection?.driver === "mysql"
                              ? formatNumber(item.tempDiskTables)
                              : formatPercent(item.cacheHitRatio)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      {selectedInsight && (
        <QueryInsightModal
          item={selectedInsight}
          insights={insights}
          connection={connection}
          database={database}
          onClose={() => setSelectedInsight(null)}
        />
      )}
    </section>
  );
}

function ResourceTelemetry({ resources }) {
  const memoryUsed = Number(resources?.memoryUsedBytes || 0);
  const memoryLimit = Number(resources?.memoryLimitBytes || 0);
  const memoryPercent =
    resources?.source === "docker" &&
    Number.isFinite(resources?.memoryUsagePercent)
    ? Number(resources.memoryUsagePercent)
    : resourcePercent(memoryUsed, memoryLimit);
  const cpuUsage = resources?.cpuUsagePercent;
  const sourceLabel =
    resources?.source === "docker"
      ? `Docker container: ${resources?.containerName || "detected container"}`
      : resources?.source
        ? `${resources.source} connection metrics`
        : "Metrics unavailable";

  return (
    <section className="resourceTelemetry">
      <div className="resourceTelemetryHead">
        <strong>Server Resources</strong>
        <span>{sourceLabel}</span>
      </div>
      <div className="resourceCards">
        <div className="resourceCard">
          <div className="resourceCardHead">
            <span><Cpu size={15} /> CPU %</span>
            <strong>
              {Number.isFinite(cpuUsage) ? formatPercent(cpuUsage) : "Unavailable"}
            </strong>
          </div>
          {Number.isFinite(cpuUsage) ? (
            <>
              <div className="resourceProgress cpu">
                <i style={{ width: `${Math.min(100, cpuUsage)}%` }} />
              </div>
              <small>
                {resources?.source === "docker"
                  ? "Current Docker container CPU usage"
                  : "CPU consumed by the server between the last two refreshes"}
              </small>
            </>
          ) : (
            <small>
              {resources?.cpuAvailable
                ? "Refresh again to calculate current CPU usage."
                : resources?.cpuMessage || "Current CPU usage is unavailable."}
            </small>
          )}
        </div>

        <div className="resourceCard">
          <div className="resourceCardHead">
            <span><MemoryStick size={15} /> MEM USAGE / LIMIT</span>
            <strong>
              {resources?.memoryAvailable
                ? memoryLimit > 0
                  ? `${formatBytes(memoryUsed) || "0B"} / ${formatBytes(memoryLimit)}`
                  : formatBytes(memoryUsed) || "0B"
                : "Unavailable"}
            </strong>
          </div>
          <small>
            {resources?.memoryAvailable
              ? resources?.memoryLimitLabel || "Memory limit"
              : `Current memory usage is not exposed. Configured ${
                  resources?.memoryLimitLabel || "limit"
                }: ${formatBytes(memoryLimit) || "Unavailable"}`}
          </small>
        </div>

        <div className="resourceCard">
          <div className="resourceCardHead">
            <span><MemoryStick size={15} /> MEM %</span>
            <strong>
              {resources?.memoryAvailable && memoryLimit > 0
                ? formatPercent(memoryPercent)
                : "Unavailable"}
            </strong>
          </div>
          {resources?.memoryAvailable && memoryLimit > 0 ? (
            <>
              <div className="resourceProgress">
                <i style={{ width: `${Math.min(100, memoryPercent)}%` }} />
              </div>
              <small>{resources?.memoryLimitLabel || "Memory"} utilization</small>
            </>
          ) : (
            <small>
              A comparable memory usage and limit are required.
            </small>
          )}
        </div>
      </div>
    </section>
  );
}

function QueryInsightModal({ item, insights, connection, database, onClose }) {
  const detail = {
    source: insights?.source,
    collectedAt: insights?.collectedAt,
    driver: connection?.driver,
    database: database || connection?.database,
    ...item,
  };

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section
        className="modalPanel insightModal"
        role="dialog"
        aria-modal="true"
        aria-label="Query performance detail"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHead">
          <div>
            <h2>Performance Impact Detail</h2>
            <small>{formatPercent(item.impactPercent)} of tracked execution time</small>
          </div>
          <button title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="insightModalBody">
          <div className="traceCodeBlock">
            <div className="traceCodeLabel">
              {connection?.driver === "redis"
                ? "Command"
                : connection?.driver === "mongodb"
                  ? "Query shape"
                  : "Query"}
            </div>
            <pre>{item.query}</pre>
          </div>
          <div className="traceCodeBlock">
            <div className="traceCodeLabel">JSON Data</div>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}
