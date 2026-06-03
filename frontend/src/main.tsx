import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ChevronsUp,
  ChevronsDown,
  Copy,
  Database,
  FileDown,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Table2,
  Terminal,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import "./styles.css";
import { SqlEditor } from "./components/SqlEditor";
import {
  api,
  databaseKey,
  driverLabel,
  eventCombo,
  useLocalStorage,
  quoteName,
} from "./utils/api";
import { StartupPage } from "./pages/StartupPage";
import { TraceLogPage } from "./pages/TraceLogPage";
import { ExportsPage } from "./pages/ExportsPage";
import { ResultPanel, TableInspector } from "./components/ResultPanel";
import { ConnectionForm } from "./components/ConnectionForm";
import { SettingsPanel } from "./components/SettingsPanel";
import { SidebarTree, ConnectionContextMenu } from "./components/SidebarTree";
import { SavedQueries } from "./components/SavedQueries";

const defaultConnection = {
  id: "",
  name: "",
  driver: "mysql",
  host: "localhost",
  port: 3306,
  database: "",
  user: "",
  password: "",
  sslMode: "disable",
  useTLS: false,
};

const defaultShortcuts = {
  execute: "Meta+Enter",
  explain: "Meta+Shift+Enter",
  saveQuery: "Meta+S",
  focusEditor: "Meta+K",
};

function savedQueryField(query, camelName, goName) {
  return query?.[camelName] ?? query?.[goName] ?? "";
}

function redisKeyCommand(key) {
  const name = `"${String(key.name || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  switch (key.type) {
    case "hash":
      return `HGETALL ${name}`;
    case "list":
      return `LRANGE ${name} 0 -1`;
    case "set":
      return `SMEMBERS ${name}`;
    case "zset":
      return `ZRANGE ${name} 0 -1 WITHSCORES`;
    case "stream":
      return `XRANGE ${name} - + COUNT 100`;
    default:
      return `GET ${name}`;
  }
}

function redisCommandToRun(selection, currentLine, text) {
  if (selection?.trim()) return selection.trim();
  if (currentLine?.trim()) return currentLine.trim();
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

const defaultGeneralSettings = {
  autoDeleteQueryDays: 0,
  editorFontSize: 14,
  showLineNumbers: true,
  highlightCurrentLine: true,
  wordWrap: true,
  tabWidth: 4,
  uppercaseKeywords: false,
  defaultSelectLimit: 100,
  queryResultLimit: 500,
  resultRowDensity: "normal",
  showAlternateRows: true,
  nullDisplay: "NULL",
  redisRefreshSeconds: 0,
};

function firstSqlKeyword(sqlText) {
  let i = 0;
  while (i < sqlText.length) {
    const char = sqlText[i];
    const next = sqlText[i + 1];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === "-" && next === "-") {
      i = sqlText.indexOf("\n", i + 2);
      if (i === -1) return "";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sqlText.indexOf("*/", i + 2);
      if (end === -1) return "";
      i = end + 2;
      continue;
    }
    const match = sqlText.slice(i).match(/^[a-z]+/i);
    return match?.[0].toLowerCase() || "";
  }
  return "";
}

function hasTopLevelLimit(sqlText) {
  let depth = 0;
  let quote = "";

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1];

    if (quote) {
      if (char === quote) {
        if (sqlText[i + 1] === quote) {
          i++;
        } else {
          quote = "";
        }
      } else if (char === "\\" && quote !== "`") {
        i++;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      i = sqlText.indexOf("\n", i + 2);
      if (i === -1) return false;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sqlText.indexOf("*/", i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth++;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      depth === 0 &&
      sqlText.slice(i, i + 5).toLowerCase() === "limit" &&
      !/[a-z0-9_]/i.test(sqlText[i - 1] || "") &&
      !/[a-z0-9_]/i.test(sqlText[i + 5] || "")
    ) {
      return true;
    }
  }

  return false;
}

function withDefaultSelectLimit(sqlText, limit = 100) {
  const keyword = firstSqlKeyword(sqlText);
  if (
    (keyword !== "select" && keyword !== "with") ||
    hasTopLevelLimit(sqlText)
  ) {
    return sqlText;
  }

  const trimmed = sqlText.trimEnd();
  const semicolons = trimmed.match(/;+$/)?.[0] || "";
  const base = semicolons
    ? trimmed.slice(0, -semicolons.length).trimEnd()
    : trimmed;
  return `${base} limit ${limit}${semicolons}`;
}

function App() {
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(defaultConnection);
  const [detail, setDetail] = useState(null); // Keep for the currently active/selected connection (query workspace)
  const [details, setDetails] = useState({}); // details: { [connId]: detailData }
  const [tableDetail, setTableDetail] = useState(null);
  const [showTableDetail, setShowTableDetail] = useState(false);
  const [queries, setQueries] = useState([]);
  const [deletingQueryIds, setDeletingQueryIds] = useState(() => new Set());
  const [sqlText, setSqlText] = useState("select * from ");
  const [result, setResult] = useState(null);
  const [explain, setExplain] = useState(null);
  const [filter, setFilter] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [exportProgress, setExportProgress] = useState(null);
  const [lastRedisCommand, setLastRedisCommand] = useState("");
  const toastTimeoutRef = useRef(null);
  const exportToastTimeoutRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(""), 3000);
  };

  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [connectedConnections, setConnectedConnections] = useState({});
  const [connectionMenu, setConnectionMenu] = useState(null);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [editingConnection, setEditingConnection] = useState(false);
  const [shortcuts, setShortcuts] = useLocalStorage(
    "tnt-sql-shortcuts",
    defaultShortcuts,
  );
  const [generalSettings, setGeneralSettings] = useLocalStorage(
    "tnt-sql-general-settings",
    defaultGeneralSettings,
  );
  const [exportedFiles, setExportedFiles] = useLocalStorage(
    "tnt-sql-exported-files",
    [],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(generalSettings);
  const [shortcutsDraft, setShortcutsDraft] = useState(shortcuts);
  const [workspaceView, setWorkspaceView] = useState("query");
  const [expandedConnections, setExpandedConnections] = useState({}); // { [connId]: boolean }
  const [expandedObjects, setExpandedObjects] = useState({}); // { [connId_databaseKey]: boolean }
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isResizing, setIsResizing] = useState(false);
  const editorRef = useRef(null);

  function openSettings() {
    setSettingsDraft({ ...generalSettings });
    setShortcutsDraft({ ...shortcuts });
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  function saveSettings() {
    setGeneralSettings(settingsDraft);
    setShortcuts(shortcutsDraft);
    setSettingsOpen(false);
    showToast("Settings saved");
  }

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e) => {
      const newWidth = Math.max(200, Math.min(e.clientX, 800));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsResizing(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    setLastRedisCommand("");
  }, [selected?.id]);

  useEffect(() => {
    const seconds = Number(generalSettings.redisRefreshSeconds || 0);
    if (
      seconds <= 0 ||
      selected?.driver !== "redis" ||
      !selected?.id ||
      !lastRedisCommand
    ) {
      return;
    }
    const interval = window.setInterval(async () => {
      try {
        const next = await api.call(
          "ExecuteDatabase",
          selected.id,
          detail?.database || selected.database || "",
          lastRedisCommand,
          generalSettings.queryResultLimit ?? 500,
        );
        setResult(next);
      } catch (err) {
        setError(err?.message || String(err));
      }
    }, seconds * 1000);
    return () => window.clearInterval(interval);
  }, [
    detail?.database,
    generalSettings.queryResultLimit,
    generalSettings.redisRefreshSeconds,
    lastRedisCommand,
    selected?.database,
    selected?.driver,
    selected?.id,
  ]);

  useEffect(() => {
    refreshConnections();
  }, []);

  useEffect(() => {
    if (generalSettings.autoDeleteQueryDays > 0) {
      api
        .call("AutoDeleteQueries", generalSettings.autoDeleteQueryDays)
        .then(() => {
          if (selected?.id) {
            api.call("ListSavedQueries", selected.id).then(setQueries);
          }
        });
    }
  }, [generalSettings.autoDeleteQueryDays, selected?.id]);

  useEffect(() => {
    if (!connectionMenu) return;
    const close = () => setConnectionMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [connectionMenu]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        if (settingsOpen) closeSettings();
        else openSettings();
        return;
      }
      if (settingsOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSettings();
        } else if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          saveSettings();
        }
        return;
      }

      const combo = eventCombo(event);
      if (combo === shortcuts.execute) {
        event.preventDefault();
        execute();
      }
      if (combo === shortcuts.explain) {
        event.preventDefault();
        explainAnalyze();
      }
      if (combo === shortcuts.saveQuery) {
        event.preventDefault();
        saveCurrentQuery();
      }
      if (combo === shortcuts.focusEditor) {
        event.preventDefault();
        editorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    generalSettings,
    settingsDraft,
    settingsOpen,
    shortcuts,
    shortcutsDraft,
    sqlText,
    selected,
  ]);

  const filteredConnections = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return connections;
    return connections.filter((conn) =>
      `${conn.name}.${conn.driver}.${conn.host}.${conn.port}.${conn.database}`
        .toLowerCase()
        .includes(term),
    );
  }, [filter, connections]);

  async function run(label, action) {
    setLoading(label);
    setError("");
    try {
      return await action();
    } catch (err) {
      setError(err?.message || String(err));
      throw err;
    } finally {
      setLoading("");
    }
  }

  async function refreshConnections() {
    const items = await run("connections", () => api.call("ListConnections"));
    setConnections(items || []);
  }

  async function saveConnection() {
    if (draft.id) {
      await api.call("CloseConnection", draft.id, "");
    }
    const saved = await run("save connection", () =>
      api.call("SaveConnection", draft),
    );
    await refreshConnections();
    setSelected(saved);
    setCreatingConnection(false);
    setEditingConnection(false);
    setDraft({ ...defaultConnection, ...saved });
    setConnectionStatus("disconnected");
    const connId = saved.id || draft.id;
    setDetail(null);
    setConnectedConnections((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setDetails((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setExpandedConnections((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
  }

  function duplicateConnection() {
    if (!draft.name && !selected?.id) return;
    const source = { ...defaultConnection, ...draft };
    setSelected(null);
    setCreatingConnection(true);
    setEditingConnection(true);
    setDraft({
      ...source,
      id: "",
      name: source.name ? `${source.name} copy` : "",
    });
    setDetail(null);
    setTableDetail(null);
    setResult(null);
    setExplain(null);
    setWorkspaceView("query");
    setConnectionStatus("disconnected");
  }

  async function togglePin(conn) {
    const next = { ...conn, isPinned: !conn.isPinned };
    await run("save connection", () => api.call("SaveConnection", next));
    await refreshConnections();
    if (selected?.id === conn.id) {
      setSelected(next);
      setDraft((current) => ({ ...current, isPinned: next.isPinned }));
    }
  }

  async function deleteConnection() {
    if (!draft.id) return;
    const connId = draft.id;
    const objectKeyPrefix = `${connId}_`;
    await run("delete connection", () => api.call("DeleteConnection", connId));
    setSelected(null);
    setCreatingConnection(false);
    setEditingConnection(false);
    setDraft(defaultConnection);
    setDetail(null);
    setTableDetail(null);
    setConnectionStatus("disconnected");
    setConnectedConnections((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setDetails((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setExpandedConnections((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setExpandedObjects((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(objectKeyPrefix)) {
          delete next[key];
        }
      }
      return next;
    });
    await refreshConnections();
  }

  async function testConnection() {
    try {
      await run("test connection", () => api.call("TestConnection", draft));
      showToast("Connection successful");
    } catch (e) {
      // error handled by run()
    }
  }

  async function connect(conn = selected) {
    if (!conn?.id) return;
    setSelected(conn);
    setCreatingConnection(false);
    setEditingConnection(false);
    setDraft({ ...defaultConnection, ...conn });
    setDetail(null);
    setTableDetail(null);
    setResult(null);
    setExplain(null);
    setWorkspaceView("query");
    setConnectionStatus("connecting");
    try {
      const next = await run("connect", () => api.call("Connect", conn.id));
      const savedQueries = await api.call("ListSavedQueries", conn.id);
      setDetail(next);
      setDetails((current) => ({ ...current, [conn.id]: next }));
      setQueries(savedQueries || []);
      setDraft((current) => ({ ...current, ...conn, database: next.database }));
      setTableDetail(null);
      setExpandedObjects((current) => ({
        ...current,
        [`${conn.id}_${databaseKey(next.database)}`]: true,
      }));
      setExpandedConnections((current) => ({
        ...current,
        [conn.id]: true,
      }));
      setConnectedConnections((current) => ({
        ...current,
        [conn.id]: true,
      }));
      setConnectionStatus("connected");
      return next;
    } catch (err) {
      setConnectionStatus("error");
      throw err;
    }
  }

  async function connectDatabase(databaseName, connId = selected?.id) {
    if (!connId || !databaseName) return;
    if (connId === selected?.id) {
      setConnectionStatus("connecting");
    }
    try {
      const next = await run("connect", () =>
        api.call("ConnectDatabase", connId, databaseName),
      );
      setDetails((current) => ({ ...current, [connId]: next }));
      if (connId === selected?.id) {
        setDetail(next);
        setDraft((current) => ({ ...current, database: next.database }));
        setTableDetail(null);
        setResult(null);
        setExplain(null);
        setConnectionStatus("connected");
      }
      setExpandedObjects((current) => ({
        ...current,
        [`${connId}_${databaseKey(databaseName)}`]: true,
      }));
      setConnectedConnections((current) => ({
        ...current,
        [connId]: true,
      }));
    } catch (err) {
      if (connId === selected?.id) {
        setConnectionStatus("error");
      }
      throw err;
    }
  }

  async function openTable(table, connId = selected?.id) {
    if (!connId) return;
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;
    let activeDetail =
      connId === selected?.id ? detail || details[connId] : null;
    if (connId !== selected?.id) {
      activeDetail = await connect(conn);
    }
    const driver = activeDetail?.driver || conn.driver;
    const database = activeDetail?.database || "";
    if (driver === "redis") {
      const command = redisKeyCommand(table);
      setSqlText(command);
      const next = await run("read redis key", () =>
        api.call(
          "ExecuteDatabase",
          connId,
          database,
          command,
          generalSettings.queryResultLimit ?? 500,
        ),
      );
      setTableDetail(null);
      setResult(next);
      setLastRedisCommand(command);
      setShowTableDetail(false);
      return;
    }
    const next = await run("table detail", () =>
      api.call(
        "GetDatabaseTableDetail",
        connId,
        database,
        table.schema,
        table.name,
        generalSettings.defaultSelectLimit ?? 100,
      ),
    );
    setTableDetail(next);
    setShowTableDetail(false);
    setResult(next.sample);
    setSqlText(
      `select * from ${quoteName(driver, table.schema, table.name)} limit ${generalSettings.defaultSelectLimit ?? 100}`,
    );
  }

  async function execute() {
    if (!selected?.id) return;
    const selection = editorRef.current?.getSelection?.();
    const queryToRun =
      selected.driver === "redis"
        ? redisCommandToRun(
            selection,
            editorRef.current?.getCurrentLine?.(),
            sqlText,
          )
        : withDefaultSelectLimit(
            selection || sqlText,
            generalSettings.defaultSelectLimit ?? 100,
          );
    if (!queryToRun) return;
    const redisHasSingleCommand =
      selected.driver === "redis" &&
      sqlText.split(/\r?\n/).filter((line) => line.trim()).length === 1;
    if (
      !selection &&
      queryToRun !== sqlText &&
      (selected.driver !== "redis" || redisHasSingleCommand)
    ) {
      setSqlText(queryToRun);
    }
    const next = await run("execute", () =>
      api.call(
        "ExecuteDatabase",
        selected.id,
        detail?.database || "",
        queryToRun,
        generalSettings.queryResultLimit ?? 500,
      ),
    );
    setResult(next);
    if (selected.driver === "redis") {
      setLastRedisCommand(queryToRun);
    }
    setShowTableDetail(false);
  }

  async function explainAnalyze() {
    if (!selected?.id) return;
    const selection = editorRef.current?.getSelection?.();
    const queryToRun = selection || sqlText;
    const next = await run("explain", () =>
      api.call(
        "ExplainAnalyzeDatabase",
        selected.id,
        detail?.database || "",
        queryToRun,
      ),
    );
    setExplain(next);
  }

  async function saveCurrentQuery() {
    if (!selected?.id || !sqlText.trim()) return;
    const name = sqlText.trim().split("\n")[0].slice(0, 64);
    await run("save query", () =>
      api.call("SaveQuery", { connectionId: selected.id, name, sql: sqlText }),
    );
    setQueries(await api.call("ListSavedQueries", selected.id));
  }

  async function deleteSavedQuery(query) {
    const queryId = savedQueryField(query, "id", "ID");
    const queryName = savedQueryField(query, "name", "Name");
    const connectionId =
      savedQueryField(query, "connectionId", "ConnectionID") || selected?.id;
    if (!queryId || !connectionId) return;
    const confirmed = await api.call("ConfirmDeleteQuery", queryName);
    if (!confirmed) return;

    const previousQueries = queries;
    setDeletingQueryIds((current) => new Set(current).add(queryId));
    setQueries((current) =>
      current.filter((item) => savedQueryField(item, "id", "ID") !== queryId),
    );
    try {
      await run("delete query", () => api.call("DeleteQuery", queryId));
      const latest = (await api.call("ListSavedQueries", connectionId)) || [];
      setQueries(latest);
      showToast("Query deleted");
    } catch (err) {
      setQueries(previousQueries);
      throw err;
    } finally {
      setDeletingQueryIds((current) => {
        const next = new Set(current);
        next.delete(queryId);
        return next;
      });
    }
  }

  async function exportQueryResult({
    content,
    format,
    defaultFilename,
    filterName,
    filterPattern,
    rows,
  }) {
    if (exportToastTimeoutRef.current) {
      clearTimeout(exportToastTimeoutRef.current);
    }
    setExportProgress({
      message: "Preparing export",
      progress: 25,
      status: "active",
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    setExportProgress({
      message: "Choose export location",
      progress: 45,
      status: "active",
    });

    try {
      const path = await api.call(
        "ExportQueryResult",
        content,
        defaultFilename,
        filterName,
        filterPattern,
      );
      if (!path) {
        setExportProgress({
          message: "Export canceled",
          progress: 100,
          status: "done",
        });
        exportToastTimeoutRef.current = setTimeout(
          () => setExportProgress(null),
          1800,
        );
        return;
      }

      const name = String(path).split(/[\\/]/).pop() || defaultFilename;
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        path,
        format,
        rows,
        createdAt: new Date().toISOString(),
      };
      setExportedFiles((current) => [item, ...current].slice(0, 100));
      setExportProgress({
        message: `Exported ${name}`,
        progress: 100,
        status: "done",
      });
      exportToastTimeoutRef.current = setTimeout(
        () => setExportProgress(null),
        3200,
      );
    } catch (err) {
      setExportProgress({
        message: err?.message || "Export failed",
        progress: 100,
        status: "error",
      });
      exportToastTimeoutRef.current = setTimeout(
        () => setExportProgress(null),
        4500,
      );
      throw err;
    }
  }

  function selectConnection(conn) {
    connect(conn);
  }

  function editConnection(conn) {
    setSelected(conn);
    setCreatingConnection(false);
    setEditingConnection(true);
    setDraft({ ...defaultConnection, ...conn });
    setDetail(null);
    setTableDetail(null);
    setResult(null);
    setExplain(null);
    setWorkspaceView("query");
    setConnectionStatus(
      connectedConnections[conn.id] ? "connected" : "disconnected",
    );
    setConnectionMenu(null);
  }

  async function closeConnectedConnection(conn = selected) {
    if (!conn?.id) return;
    await run("close connection", () =>
      api.call("CloseConnection", conn.id, ""),
    );
    const connId = conn.id;
    const objectKeyPrefix = `${connId}_`;
    setConnectedConnections((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setDetails((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setExpandedConnections((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setExpandedObjects((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(objectKeyPrefix)) {
          delete next[key];
        }
      }
      return next;
    });
    if (selected?.id === conn.id) {
      setConnectionStatus("disconnected");
      setDetail(null);
      setTableDetail(null);
      setResult(null);
      setExplain(null);
    }
    setConnectionMenu(null);
  }

  async function openConnectionTerminal(conn = selected) {
    if (!conn?.id) return;
    await run("open terminal", () =>
      api.call(
        "OpenConnectionTerminal",
        conn.id,
        selected?.id === conn.id
          ? detail?.database || conn.database || ""
          : conn.database || "",
      ),
    );
    setConnectionMenu(null);
  }

  function openConnectionMenu(event, conn) {
    event.preventDefault();
    setConnectionMenu({
      conn,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function toggleConnectionExpanded(conn, event) {
    if (event) {
      event.stopPropagation();
    }
    const isExpanded = expandedConnections[conn.id];
    const willExpand = !isExpanded;
    if (willExpand && !details[conn.id] && !connectedConnections[conn.id]) {
      api
        .call("Connect", conn.id)
        .then((next) => {
          setDetails((prev) => ({ ...prev, [conn.id]: next }));
          setConnectedConnections((prev) => ({ ...prev, [conn.id]: true }));
        })
        .catch((err) => {
          console.error("Failed to connect on expand", err);
          setExpandedConnections((prev) => ({ ...prev, [conn.id]: false }));
        });
    }
    setExpandedConnections((current) => ({
      ...current,
      [conn.id]: willExpand,
    }));
  }

  function toggleObject(connId, key) {
    setExpandedObjects((current) => ({
      ...current,
      [`${connId}_${key}`]: !current[`${connId}_${key}`],
    }));
  }

  function collapseAll() {
    setExpandedConnections({});
    setExpandedObjects({});
  }

  function expandAll() {
    const nextConnections = {};
    const nextObjects = {};
    for (const conn of connections) {
      nextConnections[conn.id] = true;
      const detail = details[conn.id];
      if (detail && connectedConnections[conn.id]) {
        const rawDatabases = detail.databases?.length
          ? detail.databases
          : detail.database
            ? [{ name: detail.database }]
            : [];
        if (rawDatabases.length > 1) {
          nextObjects[`${conn.id}_databases`] = true;
        }
        nextObjects[`${conn.id}_tables`] = true;
        nextObjects[`${conn.id}_views`] = true;
        nextObjects[`${conn.id}_functions`] = true;
        nextObjects[`${conn.id}_procedures`] = true;
      }
    }
    setExpandedConnections(nextConnections);
    setExpandedObjects(nextObjects);
  }

  const editingNewConnection = creatingConnection && !selected;
  const editingConnectionDetails = editingNewConnection || editingConnection;

  function startNewConnection() {
    setSelected(null);
    setCreatingConnection(true);
    setEditingConnection(true);
    setDraft(defaultConnection);
    setDetail(null);
    setTableDetail(null);
    setResult(null);
    setExplain(null);
    setWorkspaceView("query");
    setConnectionStatus("disconnected");
  }

  if (!selected && !creatingConnection) {
    return (
      <StartupPage
        connections={filteredConnections}
        filter={connectionFilter}
        setFilter={setConnectionFilter}
        onSelect={selectConnection}
        onCreate={startNewConnection}
        onTogglePin={togglePin}
      />
    );
  }

  return (
    <div
      className={`app ${sidebarVisible ? "" : "sidebar-hidden"}`}
      style={{
        gridTemplateColumns: sidebarVisible ? `${sidebarWidth}px 1fr` : "1fr",
      }}
    >
      {sidebarVisible && (
        <>
          <aside className="sidebar">
            <div className="sidebarHeader">
              <div className="sidebarTitle">
                <strong>DATABASE</strong>
              </div>
              <div className="sidebarActions">
                <button
                  className="iconButton"
                  onClick={refreshConnections}
                  title="Refresh"
                >
                  <RefreshCw size={15} />
                </button>
                {Object.values(expandedConnections).some(Boolean) ? (
                  <button
                    className="iconButton"
                    onClick={collapseAll}
                    title="Collapse All"
                  >
                    <ChevronsUp size={15} />
                  </button>
                ) : (
                  <button
                    className="iconButton"
                    onClick={expandAll}
                    title="Expand All"
                  >
                    <ChevronsDown size={15} />
                  </button>
                )}
                <button
                  className="iconButton"
                  onClick={startNewConnection}
                  title="New Connection"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            <section className="panel sidebarPanel">
              <label className="search sidebarSearch">
                <Search size={15} />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter connections"
                />
              </label>
              <SidebarTree
                connections={filteredConnections}
                details={details}
                expandedConnections={expandedConnections}
                expandedObjects={expandedObjects}
                connectedConnections={connectedConnections}
                selected={selected}
                onSelectConnection={selectConnection}
                onToggleConnection={toggleConnectionExpanded}
                onToggleObject={toggleObject}
                onOpenDatabase={connectDatabase}
                onOpenTable={openTable}
                onNewQuery={() => editorRef.current?.focus()}
                onContextMenu={openConnectionMenu}
              />
              <SavedQueries
                queries={queries}
                deletingQueryIds={deletingQueryIds}
                onOpen={(query) => setSqlText(savedQueryField(query, "sql", "SQL"))}
                onDelete={deleteSavedQuery}
              />
            </section>
            {connectionMenu && (
              <ConnectionContextMenu
                menu={connectionMenu}
                connected={!!connectedConnections[connectionMenu.conn.id]}
                onCloseConnection={() =>
                  closeConnectedConnection(connectionMenu.conn)
                }
                onEditConnection={() => editConnection(connectionMenu.conn)}
                onOpenTerminal={() => openConnectionTerminal(connectionMenu.conn)}
                onTogglePin={() => {
                  togglePin(connectionMenu.conn);
                  setConnectionMenu(null);
                }}
              />
            )}
          </aside>
          <div
            className={`sidebar-resizer ${isResizing ? "resizing" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizing(true);
            }}
            style={{ left: `${sidebarWidth - 2}px` }}
          />
        </>
      )}

      <main className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              className="iconButton"
              onClick={() => setSidebarVisible(!sidebarVisible)}
              title={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
              style={{
                flex: "0 0 auto",
                height: "32px",
                width: "32px",
                border: "1px solid #333a44",
              }}
            >
              {sidebarVisible ? (
                <PanelLeftClose size={16} />
              ) : (
                <PanelLeftOpen size={16} />
              )}
            </button>
            <div>
              <h1>{selected?.name || "Dashboard"}</h1>
              <p>
                {selected
                  ? `${driverLabel(selected.driver)}://${selected.host}:${selected.port}/${detail?.database || selected.database}`
                  : "Stored connections and query workspace"}
              </p>
            </div>
          </div>
          <div className="actions">
            {!editingConnectionDetails && selected && (
              <div className="viewTabs" aria-label="Workspace">
                <button
                  className={workspaceView === "query" ? "active" : ""}
                  onClick={() => setWorkspaceView("query")}
                >
                  Query
                </button>
                <button
                  className={workspaceView === "trace" ? "active" : ""}
                  onClick={() => setWorkspaceView("trace")}
                >
                  Trace Log
                </button>
                <button
                  className={workspaceView === "exports" ? "active" : ""}
                  onClick={() => setWorkspaceView("exports")}
                >
                  <FileDown size={14} /> Exports
                </button>
              </div>
            )}
            <button
              title="Open connection terminal"
              onClick={() => openConnectionTerminal()}
              disabled={!selected?.id}
            >
              <Terminal size={16} />
            </button>
            <button
              title="Settings (Cmd+,)"
              onClick={openSettings}
            >
              <Settings size={16} />
            </button>
            <button
              title="Refresh"
              onClick={() =>
                selected ? connect(selected) : refreshConnections()
              }
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="primary"
              onClick={() => connect()}
              disabled={!selected?.id}
            >
              <Database size={16} />
              {connectionStatus === "connected" ? "Connected" : "Connect"}
            </button>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {loading && <div className="loading">Running {loading}...</div>}
        {toast && <div className="toast">{toast}</div>}
        {exportProgress && (
          <div className={`toast exportToast ${exportProgress.status}`}>
            <div className="exportToastHead">
              <span>{exportProgress.message}</span>
              <small>{exportProgress.progress}%</small>
            </div>
            <div className="exportProgressTrack">
              <div
                className="exportProgressBar"
                style={{ width: `${exportProgress.progress}%` }}
              />
            </div>
          </div>
        )}

        {settingsOpen && (
          <SettingsPanel
            shortcuts={shortcutsDraft}
            setShortcuts={setShortcutsDraft}
            generalSettings={settingsDraft}
            setGeneralSettings={setSettingsDraft}
            onSave={saveSettings}
            onCancel={closeSettings}
          />
        )}

        {(editingConnectionDetails || workspaceView === "query") && (
          <section
            className={
              connectionStatus === "connected" || editingConnectionDetails
                ? "grid queryOnly"
                : "grid"
            }
          >
            {(connectionStatus !== "connected" || editingConnectionDetails) && (
              <section className="panel connectionPanel">
                <div className="panelHead">
                  <h2>Connection Detail</h2>
                  <div className="rowActions">
                    <button onClick={testConnection}>
                      <Activity size={15} /> Test
                    </button>
                    <button onClick={saveConnection}>
                      <Save size={15} /> Save
                    </button>
                    <button
                      onClick={duplicateConnection}
                      disabled={!draft.name}
                    >
                      <Copy size={15} /> Duplicate
                    </button>
                    <button onClick={deleteConnection} disabled={!draft.id}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <ConnectionForm draft={draft} setDraft={setDraft} />
              </section>
            )}

            {!editingConnectionDetails && workspaceView === "query" && (
              <section className="panel queryPanel">
                <div className="panelHead">
                  <h2>Command</h2>
                  <div className="rowActions">
                    {tableDetail && (
                      <button
                        onClick={() => setShowTableDetail(!showTableDetail)}
                        title="Toggle Table Detail"
                      >
                        <Table2 size={15} />{" "}
                        {showTableDetail ? "Hide DDL" : "Show DDL"}
                      </button>
                    )}
                    <button onClick={saveCurrentQuery}>
                      <Save size={15} /> Query
                    </button>
                    {(selected?.driver === "mysql" ||
                      selected?.driver === "postgres") && (
                      <button onClick={explainAnalyze}>
                        <Activity size={15} /> Explain
                      </button>
                    )}
                    <button className="primary" onClick={execute}>
                      <Play size={15} /> Run
                    </button>
                  </div>
                </div>
                <SqlEditor
                  value={sqlText}
                  onChange={setSqlText}
                  detail={detail}
                  editorRef={editorRef}
                  fontSize={generalSettings.editorFontSize || 14}
                  settings={generalSettings}
                />
              </section>
            )}
          </section>
        )}

        {!editingConnectionDetails &&
          workspaceView === "query" &&
          (tableDetail || result || explain) && (
            <section className="workspace">
              <section className="content">
                {tableDetail && showTableDetail && (
                  <TableInspector detail={tableDetail} />
                )}
                <ResultPanel
                  title="Rows"
                  result={result}
                  onExport={exportQueryResult}
                  gridSettings={generalSettings}
                  onUpdateTTL={async (seconds) => {
                    const cmd =
                      seconds === -1
                        ? `PERSIST "${result.redisKey}"`
                        : `EXPIRE "${result.redisKey}" ${seconds}`;
                    await run("update TTL", () =>
                      api.call(
                        "ExecuteDatabase",
                        selected?.id,
                        detail?.database || "",
                        cmd,
                        generalSettings.queryResultLimit ?? 500,
                      ),
                    );
                    execute();
                  }}
                />
                <ResultPanel
                  title="Explain Analyze"
                  result={explain}
                  onExport={exportQueryResult}
                  gridSettings={generalSettings}
                  onUpdateTTL={() => {}}
                />
              </section>
            </section>
          )}

        {!editingConnectionDetails && workspaceView === "trace" && (
          <TraceLogPage connection={selected} onExport={exportQueryResult} />
        )}

        {!editingConnectionDetails && workspaceView === "exports" && (
          <ExportsPage
            exports={exportedFiles}
            onClear={() => setExportedFiles([])}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
