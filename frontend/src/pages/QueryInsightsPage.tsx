import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  MemoryStick,
  RefreshCw,
} from "lucide-react";
import { api, driverLabel, formatBytes, formatNumber } from "../utils/api";
import { Page, Panel, PanelHeader } from "../components/shared/layout";
import { CodeBlock } from "../components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

const REFRESH_INTERVALS: [number, string][] = [
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

  const refreshCountdown = nextRefreshAt
    ? Math.max(0, Math.ceil((nextRefreshAt - clockNow) / 1000))
    : null;

  const label =
    connection?.driver === "redis"
      ? "Command"
      : connection?.driver === "mongodb"
        ? "Query shape"
        : "Query";

  return (
    <Page>
      <Panel>
        <PanelHeader
          title={
            connection?.driver === "redis"
              ? "Redis Performance Trace"
              : "Query Insights"
          }
          description={`${driverLabel(connection?.driver)} · ${database || connection?.database}`}
          actions={
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="min-w-[102px]"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw
                  className={loading ? "animate-spin" : ""}
                  data-icon="inline-start"
                />
                {loading
                  ? "Loading"
                  : refreshCountdown !== null
                    ? `Refresh in ${refreshCountdown}s`
                    : "Refresh"}
              </Button>
              <DropdownMenu
                open={refreshMenuOpen}
                onOpenChange={setRefreshMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title="Auto refresh interval"
                    aria-label="Auto refresh interval"
                  >
                    {refreshMenuOpen ? <ChevronUp /> : <ChevronDown />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {REFRESH_INTERVALS.map(([seconds, intervalLabel]) => (
                    <DropdownMenuItem
                      key={seconds}
                      onSelect={() => setRefreshIntervalSeconds(seconds)}
                      className={cn(
                        refreshIntervalSeconds === seconds && "bg-accent",
                      )}
                    >
                      {intervalLabel}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

        {error && (
          <Alert
            variant="destructive"
            className="rounded-none border-x-0 border-t-0"
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {insights && <ResourceTelemetry resources={insights.resources} />}

        {insights && !insights.available && (
          <div className="flex min-h-56 flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center text-muted-foreground">
            <Activity className="size-7" />
            <strong className="text-sm font-semibold text-foreground">
              Query statistics are not enabled
            </strong>
            <span className="max-w-[560px] text-sm">{insights.message}</span>
          </div>
        )}

        {insights?.available && (
          <>
            <div className="grid grid-cols-5 gap-2.5 border-b border-border p-3">
              {cards.map(([cardLabel, value]) => (
                <div
                  key={cardLabel}
                  className="grid gap-1.5 rounded-lg border border-border bg-background p-3"
                >
                  <span className="text-xs text-muted-foreground">{cardLabel}</span>
                  <strong className="text-xl font-semibold tabular-nums">
                    {value}
                  </strong>
                </div>
              ))}
            </div>

            {insights.message && !insights.queries?.length ? (
              <div className="flex min-h-56 flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center text-muted-foreground">
                <Activity className="size-7" />
                <strong className="text-sm font-semibold text-foreground">
                  No workload data yet
                </strong>
                <span className="max-w-[560px] text-sm">{insights.message}</span>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <Table className="text-xs [&_th]:h-auto [&_th]:px-3 [&_th]:py-2.5 [&_td]:px-3 [&_td]:py-2.5">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[110px]">Impact</TableHead>
                      <TableHead className="text-left">{label}</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Total time</TableHead>
                      <TableHead className="text-right">Average</TableHead>
                      <TableHead className="text-right">
                        {connection?.driver === "redis"
                          ? "Failed"
                          : connection?.driver === "mongodb"
                            ? "Examined"
                          : connection?.driver === "mysql"
                            ? "Examined"
                            : "Rows"}
                      </TableHead>
                      <TableHead className="text-right">
                        {connection?.driver === "redis"
                          ? "Rejected"
                          : connection?.driver === "mongodb"
                            ? "Returned"
                          : connection?.driver === "mysql"
                            ? "Disk temp"
                            : "Cache hit"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(insights.queries || []).map((item, index) => (
                      <TableRow
                        key={`${item.query}-${index}`}
                        tabIndex={0}
                        onClick={() => setSelectedInsight(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedInsight(item);
                          }
                        }}
                        aria-label={`Open performance details for ${item.query}`}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <TableCell>
                          <strong className="block text-sm font-semibold text-primary">
                            {formatPercent(item.impactPercent)}
                          </strong>
                          <Progress
                            value={Math.max(2, item.impactPercent)}
                            className="mt-1 h-1"
                          />
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block max-w-[560px] truncate font-mono text-muted-foreground">
                                {item.query}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="bottom"
                              align="start"
                              className="max-h-44 max-w-[640px] overflow-auto whitespace-pre-wrap break-words"
                            >
                              <p className="font-mono text-xs">{item.query}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(item.calls)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(item.totalTimeMs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(item.averageTimeMs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(
                            connection?.driver === "redis"
                              ? item.failedCalls
                              : connection?.driver === "mongodb"
                                ? item.rowsExamined
                              : connection?.driver === "mysql"
                                ? item.rowsExamined
                                : item.rows,
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {connection?.driver === "redis"
                            ? formatNumber(item.rejectedCalls)
                            : connection?.driver === "mongodb"
                              ? formatNumber(item.rows)
                            : connection?.driver === "mysql"
                              ? formatNumber(item.tempDiskTables)
                              : formatPercent(item.cacheHitRatio)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Panel>
      {selectedInsight && (
        <QueryInsightModal
          item={selectedInsight}
          insights={insights}
          connection={connection}
          database={database}
          onClose={() => setSelectedInsight(null)}
        />
      )}
    </Page>
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
    <section className="grid gap-2.5 border-b border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-xs font-semibold uppercase text-foreground">
          Server Resources
        </strong>
        <span className="text-[11px] text-muted-foreground">{sourceLabel}</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="size-3.5" /> CPU %
            </span>
            <strong className="text-sm font-semibold tabular-nums">
              {Number.isFinite(cpuUsage) ? formatPercent(cpuUsage) : "Unavailable"}
            </strong>
          </div>
          {Number.isFinite(cpuUsage) ? (
            <>
              <Progress value={Math.min(100, cpuUsage)} className="h-1.5" />
              <small className="text-[11px] text-muted-foreground">
                {resources?.source === "docker"
                  ? "Current Docker container CPU usage"
                  : "CPU consumed by the server between the last two refreshes"}
              </small>
            </>
          ) : (
            <small className="text-[11px] text-muted-foreground">
              {resources?.cpuAvailable
                ? "Refresh again to calculate current CPU usage."
                : resources?.cpuMessage || "Current CPU usage is unavailable."}
            </small>
          )}
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MemoryStick className="size-3.5" /> MEM USAGE / LIMIT
            </span>
            <strong className="text-sm font-semibold tabular-nums">
              {resources?.memoryAvailable
                ? memoryLimit > 0
                  ? `${formatBytes(memoryUsed) || "0B"} / ${formatBytes(memoryLimit)}`
                  : formatBytes(memoryUsed) || "0B"
                : "Unavailable"}
            </strong>
          </div>
          <small className="text-[11px] text-muted-foreground">
            {resources?.memoryAvailable
              ? resources?.memoryLimitLabel || "Memory limit"
              : `Current memory usage is not exposed. Configured ${
                  resources?.memoryLimitLabel || "limit"
                }: ${formatBytes(memoryLimit) || "Unavailable"}`}
          </small>
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MemoryStick className="size-3.5" /> MEM %
            </span>
            <strong className="text-sm font-semibold tabular-nums">
              {resources?.memoryAvailable && memoryLimit > 0
                ? formatPercent(memoryPercent)
                : "Unavailable"}
            </strong>
          </div>
          {resources?.memoryAvailable && memoryLimit > 0 ? (
            <>
              <Progress value={Math.min(100, memoryPercent)} className="h-1.5" />
              <small className="text-[11px] text-muted-foreground">
                {resources?.memoryLimitLabel || "Memory"} utilization
              </small>
            </>
          ) : (
            <small className="text-[11px] text-muted-foreground">
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

  const label =
    connection?.driver === "redis"
      ? "Command"
      : connection?.driver === "mongodb"
        ? "Query shape"
        : "Query";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] w-[min(820px,calc(100vw-3rem))] max-w-full overflow-y-auto">
        <DialogHeader className="min-h-[48px] border-b border-border p-[10px_12px]">
          <DialogTitle>Performance Impact Detail</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {formatPercent(item.impactPercent)} of tracked execution time
          </p>
        </DialogHeader>
        <div className="grid gap-2.5">
          <CodeBlock label={label}>{item.query}</CodeBlock>
          <CodeBlock label="JSON Data" className="max-h-96 overflow-y-auto">
            {JSON.stringify(detail, null, 2)}
          </CodeBlock>
        </div>
      </DialogContent>
    </Dialog>
  );
}