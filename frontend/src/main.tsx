import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast, Toaster } from "react-hot-toast";
import {
  Activity,
  Bot,
  Check,
  ChevronsUp,
  ChevronsDown,
  Copy,
  Database,
  FileDown,
  FolderPlus,
  Upload,
  Download,
  Gauge,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Table2,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Zap,
} from "lucide-react";
import "./index.css";
import "./codemirror.css";
import { SqlEditor } from "./components/SqlEditor";
import {
  api,
  connectionString,
  databaseKey,
  driverLabel,
  eventCombo,
  useLocalStorage,
  quoteName,
} from "./utils/api";
import { StartupPage } from "./pages/StartupPage";
import { TraceLogPage } from "./pages/TraceLogPage";
import { ExportsPage } from "./pages/ExportsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { QueryInsightsPage } from "./pages/QueryInsightsPage";
import { QueryOptimizerPage } from "./pages/QueryOptimizerPage";
import { ResultPanel, TableInspector } from "./components/ResultPanel";
import { ConnectionForm } from "./components/ConnectionForm";
import { SettingsPanel } from "./components/SettingsPanel";
import { SidebarTree, ConnectionContextMenu } from "./components/SidebarTree";
import { SavedQueries } from "./components/SavedQueries";
import { AiChatPanel } from "./components/AiChatPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const defaultConnection = {
  id: "",
  name: "",
  driver: "mysql",
  host: "localhost",
  port: 3306,
  binlogHost: "",
  binlogPort: 0,
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
  aiChat: "Meta+L",
};

function savedQueryField(query, camelName, goName) {
  return query?.[camelName] ?? query?.[goName] ?? "";
}

const SQL_SAMPLE_COMMAND = "select * from ";
const REDIS_SAMPLE_COMMAND = "GET key";
const MONGODB_SAMPLE_COMMAND = '{"find":"collection","filter":{}}';

function sampleCommand(driver) {
  if (driver === "redis") return REDIS_SAMPLE_COMMAND;
  if (driver === "mongodb") return MONGODB_SAMPLE_COMMAND;
  return SQL_SAMPLE_COMMAND;
}

function quoteRedisArg(value) {
  const text = String(value ?? "");
  if (!text || (/^\S+$/.test(text) && !text.includes('"'))) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function redisKeyCommand(key) {
  const name = quoteRedisArg(key.name || "");
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
  return (
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
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

// Splits a SQL blob into individual statements on top-level semicolons,
// ignoring semicolons inside string/backtick literals and comments so a
// multi-statement selection can be run one statement at a time.
function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let quote = null;
  let i = 0;
  const text = String(sqlText || "");
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      const comment = end === -1 ? text.slice(i) : text.slice(i, end);
      current += comment;
      i += comment.length;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const comment = end === -1 ? text.slice(i) : text.slice(i, end + 2);
      current += comment;
      i += comment.length;
      continue;
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}

function sqlIdentifierTokens(sqlText) {
  const tokens = [];

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1];

    if (/\s/.test(char)) continue;
    if (char === "-" && next === "-") {
      i = sqlText.indexOf("\n", i + 2);
      if (i === -1) break;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sqlText.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (char === "'") {
      for (i++; i < sqlText.length; i++) {
        if (sqlText[i] === "'" && sqlText[i + 1] === "'") {
          i++;
        } else if (sqlText[i] === "'") {
          break;
        } else if (sqlText[i] === "\\") {
          i++;
        }
      }
      continue;
    }
    if (char === '"' || char === "`") {
      let value = "";
      for (i++; i < sqlText.length; i++) {
        if (sqlText[i] === char && sqlText[i + 1] === char) {
          value += char;
          i++;
        } else if (sqlText[i] === char) {
          break;
        } else {
          value += sqlText[i];
        }
      }
      tokens.push(value);
      continue;
    }
    if (char === "." || char === "(" || char === ")") {
      tokens.push(char);
      continue;
    }
    const match = sqlText.slice(i).match(/^[a-z0-9_$]+/i);
    if (match) {
      tokens.push(match[0]);
      i += match[0].length - 1;
    }
  }

  return tokens;
}

function findQueryTable(sqlText) {
  const keyword = firstSqlKeyword(sqlText);
  if (keyword !== "select" && keyword !== "with") return null;

  const tokens = sqlIdentifierTokens(sqlText);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase();
    if (token !== "from" && token !== "join") continue;
    if (!tokens[i + 1] || tokens[i + 1] === "(") continue;

    let schema = "";
    let table = tokens[i + 1];
    if (tokens[i + 2] === "." && tokens[i + 3]) {
      schema = table;
      table = tokens[i + 3];
    }

    return { schema, name: table };
  }

  return null;
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
  const [sqlTexts, setSqlTexts] = useLocalStorage("tnt-sql-editor-texts", {});
  const editorTextKey = selected?.id || "scratch";
  const sqlText = sqlTexts[editorTextKey] ?? sampleCommand(selected?.driver);
  const setSqlText = (next) =>
    setSqlTexts((current) => ({
      ...current,
      [editorTextKey]:
        typeof next === "function"
          ? next(current[editorTextKey] ?? sampleCommand(selected?.driver))
          : next,
    }));
  const [result, setResult] = useState(null);
  const [resultTabs, setResultTabs] = useState([]);
  const [activeResultTab, setActiveResultTab] = useState(0);
  const [explain, setExplain] = useState(null);

  // Sets a single, non-tabbed result and clears any stale multi-statement
  // tabs from a previous run so sidebar/table/redis-key clicks don't leave
  // an old tab's result showing behind the new one.
  function applyResult(next) {
    setResult(next);
    setResultTabs(next ? [{ label: "Query 1", statement: "", result: next }] : []);
    setActiveResultTab(0);
  }
  const [filter, setFilter] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [exportProgress, setExportProgress] = useState(null);
  const [lastRedisCommand, setLastRedisCommand] = useState("");
  const exportToastTimeoutRef = useRef(null);

  const showToast = (message) => toast.success(message);

  useEffect(() => {
    if (!error) return;
    toast.error(error);
    setError("");
  }, [error]);

  useEffect(() => {
    if (loading) {
      toast.loading(`Running ${loading}...`, { id: "run-loading" });
    } else {
      toast.dismiss("run-loading");
    }
  }, [loading]);

  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [connectedConnections, setConnectedConnections] = useState({});
  const [connectionMenu, setConnectionMenu] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedConnIds, setSelectedConnIds] = useState(() => new Set());
  const [selectionMoveTarget, setSelectionMoveTarget] = useState("");
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [editingConnection, setEditingConnection] = useState(false);
  const [shortcuts, setShortcuts] = useLocalStorage(
    "tnt-sql-shortcuts",
    defaultShortcuts,
  );
  const mergedShortcuts = { ...defaultShortcuts, ...shortcuts };
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
  const [workspaces, setWorkspaces] = useState([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState({});
  const [workspacePromptOpen, setWorkspacePromptOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState(null);
  const [expandedConnections, setExpandedConnections] = useState({}); // { [connId]: boolean }
  const [expandedObjects, setExpandedObjects] = useState({}); // { [connId_databaseKey]: boolean }
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isResizing, setIsResizing] = useState(false);
  const [resultsHeight, setResultsHeight] = useState(0); // 0 = auto (flex)
  const [isResizingResults, setIsResizingResults] = useState(false);
  const [aiPanelVisible, setAiPanelVisible] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(400);
  const [isResizingAi, setIsResizingAi] = useState(false);
  const editorRef = useRef(null);
  const aiChatRef = useRef(null);
  const connectAttemptRef = useRef(0);

  function openSettings() {
    setSettingsDraft({ ...generalSettings });
    setShortcutsDraft({ ...mergedShortcuts });
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
    if (!isResizingResults) return;
    const onMouseMove = (e) => {
      const next = Math.max(
        160,
        Math.min(window.innerHeight - e.clientY, window.innerHeight - 220),
      );
      setResultsHeight(next);
    };
    const onMouseUp = () => setIsResizingResults(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingResults]);

  useEffect(() => {
    if (!isResizingAi) return;
    const onMouseMove = (e) => {
      const next = Math.max(280, Math.min(window.innerWidth - e.clientX, 700));
      setAiPanelWidth(next);
    };
    const onMouseUp = () => setIsResizingAi(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingAi]);

  useEffect(() => {
    if (!showTableDetail) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShowTableDetail(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showTableDetail]);

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
        applyResult(next);
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
      if (combo === mergedShortcuts.execute) {
        event.preventDefault();
        execute();
      }
      if (combo === mergedShortcuts.explain) {
        event.preventDefault();
        explainAnalyze();
      }
      if (combo === mergedShortcuts.saveQuery) {
        event.preventDefault();
        saveCurrentQuery();
      }
      if (combo === mergedShortcuts.focusEditor) {
        event.preventDefault();
        editorRef.current?.focus();
      }
      if (combo === mergedShortcuts.aiChat) {
        event.preventDefault();
        askSelection();
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
    const term = connectionFilter.trim().toLowerCase();
    if (!term) return connections;
    return connections.filter((conn) =>
      `${conn.name}.${conn.driver}.${conn.host}.${conn.port}.${conn.database}`
        .toLowerCase()
        .includes(term),
    );
  }, [connectionFilter, connections]);

  const groupedConnections = useMemo(() => {
    const groups = workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      isUngrouped: false,
      connections: [],
    }));
    const byId = {};
    for (const group of groups) byId[group.id] = group;
    const ungrouped = { id: "", name: "Ungrouped", isUngrouped: true, connections: [] };
    for (const conn of filteredConnections) {
      (byId[conn.workspaceId] || ungrouped).connections.push(conn);
    }
    if (ungrouped.connections.length) groups.push(ungrouped);
    return groups;
  }, [filteredConnections, workspaces]);

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
    const ws = await api.call("ListWorkspaces");
    setWorkspaces(ws || []);
  }

  async function createWorkspace(name = workspaceName) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const ws = await run("create workspace", () =>
      api.call("SaveWorkspace", { id: "", name: trimmed }),
    );
    setExpandedWorkspaces((current) => ({ ...current, [ws.id]: true }));
    setWorkspacePromptOpen(false);
    setWorkspaceName("");
    await refreshConnections();
    showToast("Workspace created");
  }

  async function confirmDeleteWorkspace() {
    if (!deleteWorkspaceTarget) return;
    const id = deleteWorkspaceTarget.id;
    await run("delete workspace", () => api.call("DeleteWorkspace", id));
    setDeleteWorkspaceTarget(null);
    await refreshConnections();
    showToast("Workspace deleted");
  }

  async function exportWorkspace(id) {
    const path = await run("export workspace", () =>
      api.call("ExportWorkspace", id),
    );
    if (path) showToast("Workspace exported");
  }

  async function renameWorkspace(id, name) {
    await run("rename workspace", () =>
      api.call("SaveWorkspace", { id, name }),
    );
    await refreshConnections();
    showToast("Workspace renamed");
  }

  async function importWorkspace() {
    const ws = await run("import workspace", () => api.call("ImportWorkspace"));
    if (ws?.id) {
      setExpandedWorkspaces((current) => ({ ...current, [ws.id]: true }));
      await refreshConnections();
      showToast(`Imported "${ws.name}"`);
    }
  }

  function toggleWorkspaceExpanded(id) {
    setExpandedWorkspaces((current) => ({ ...current, [id]: !current[id] }));
  }

  async function moveConnectionToWorkspace(conn, workspaceId) {
    await run("move connection", () =>
      api.call("SaveConnection", { ...conn, workspaceId }),
    );
    setConnectionMenu(null);
    await refreshConnections();
    showToast("Connection moved");
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) {
        setSelectedConnIds(new Set());
        setSelectionMoveTarget("");
      }
      return !current;
    });
  }

  function toggleConnSelected(conn) {
    setSelectedConnIds((current) => {
      const next = new Set(current);
      if (next.has(conn.id)) next.delete(conn.id);
      else next.add(conn.id);
      return next;
    });
  }

  async function moveSelectedConnections() {
    if (!selectedConnIds.size) return;
    const target =
      selectionMoveTarget === ""
        ? ""
        : workspaces.find((w) => w.id === selectionMoveTarget)?.id || "";
    await run("move connections", async () => {
      for (const conn of connections) {
        if (selectedConnIds.has(conn.id)) {
          await api.call("SaveConnection", { ...conn, workspaceId: target });
        }
      }
    });
    setSelectedConnIds(new Set());
    setSelectionMoveTarget("");
    setSelectionMode(false);
    await refreshConnections();
    showToast("Connections moved");
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
    await connect(saved);
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
    applyResult(null);
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

  async function deleteConnection(conn = draft) {
    if (!conn?.id) return;
    const connId = conn.id;
    const objectKeyPrefix = `${connId}_`;
    try {
      await run("delete connection", () => api.call("DeleteConnection", connId));
    } finally {
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
      setSqlTexts((current) => {
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
  }

  async function testConnection() {
    try {
      await run("test connection", () => api.call("TestConnection", draft));
      showToast("Connection successful");
    } catch (e) {
      // error handled by run()
    }
  }

  async function connect(conn = selected, expand = true) {
    if (!conn?.id) return;
    const attempt = ++connectAttemptRef.current;
    if (connectedConnections[conn.id]) {
      const cached = details[conn.id] || null;
      setSelected(conn);
      setCreatingConnection(false);
      setEditingConnection(false);
      setDraft({ ...defaultConnection, ...conn, database: cached?.database });
      setDetail(cached);
      setTableDetail(null);
      applyResult(null);
      setExplain(null);
      setWorkspaceView("query");
      setConnectionStatus("connected");
      setExpandedConnections((current) => ({ ...current, [conn.id]: expand }));
      if (cached) {
        setExpandedObjects((current) => ({
          ...current,
          [`${conn.id}_${databaseKey(cached.database)}`]: true,
        }));
      }
      const savedQueries = await api.call("ListSavedQueries", conn.id);
      setQueries(savedQueries || []);
      return cached;
    }
    setSelected(conn);
    setCreatingConnection(false);
    setEditingConnection(false);
    setDraft({ ...defaultConnection, ...conn });
    setDetail(null);
    setTableDetail(null);
    applyResult(null);
    setExplain(null);
    setWorkspaceView("query");
    setConnectionStatus("connecting");
    setLoading("connect");
    try {
      const next = await api.call("Connect", conn.id);
      if (connectAttemptRef.current !== attempt) return next;
      const savedQueries = await api.call("ListSavedQueries", conn.id);
      if (connectAttemptRef.current !== attempt) return next;
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
        [conn.id]: expand,
      }));
      setConnectedConnections((current) => ({
        ...current,
        [conn.id]: true,
      }));
      setConnectionStatus("connected");
      return next;
    } catch (err) {
      if (connectAttemptRef.current !== attempt) return null;
      setError(err?.message || String(err));
      setConnectionStatus("error");
      throw err;
    } finally {
      if (connectAttemptRef.current === attempt) setLoading("");
    }
  }

  async function connectDatabase(databaseName, connId = selected?.id) {
    if (!connId || !databaseName) return;
    const switchingConnection = connId !== selected?.id;
    const conn = switchingConnection
      ? connections.find((item) => item.id === connId)
      : selected;
    if (!conn) return;
    if (switchingConnection) {
      setSelected(conn);
      setCreatingConnection(false);
      setEditingConnection(false);
      setDraft({ ...defaultConnection, ...conn });
      setDetail(details[connId] || null);
      setTableDetail(null);
      applyResult(null);
      setExplain(null);
      setWorkspaceView("query");
    }
    setConnectionStatus("connecting");
    try {
      const next = await run("connect", () =>
        api.call("ConnectDatabase", connId, databaseName),
      );
      setDetails((current) => ({ ...current, [connId]: next }));
      setDetail(next);
      setDraft((current) => ({ ...current, database: next.database }));
      setTableDetail(null);
      applyResult(null);
      setExplain(null);
      setConnectionStatus("connected");
      if (switchingConnection) {
        const savedQueries = await api.call("ListSavedQueries", connId);
        setQueries(savedQueries || []);
      }
      setExpandedObjects((current) => ({
        ...current,
        [`${connId}_${databaseKey(databaseName)}`]: true,
      }));
      setExpandedConnections((current) => ({
        ...current,
        [connId]: true,
      }));
      setConnectedConnections((current) => ({
        ...current,
        [connId]: true,
      }));
    } catch (err) {
      setConnectionStatus("error");
      throw err;
    }
  }

  async function refreshRedisConnection(connId, databaseName) {
    const conn = connections.find((item) => item.id === connId);
    if (!conn) return null;
    const next = await run("refresh redis connection", () =>
      api.call("ConnectDatabase", connId, databaseName || conn.database || ""),
    );
    setDetails((current) => ({ ...current, [connId]: next }));
    if (connId === selected?.id) {
      setDetail(next);
      setDraft((current) => ({ ...current, database: next.database }));
      setConnectionStatus("connected");
    }
    return next;
  }

  async function openTable(table, connId = selected?.id) {
    if (!connId) return;
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;
    setWorkspaceView("query");
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
      applyResult(next);
      setLastRedisCommand(command);
      setShowTableDetail(false);
      return;
    }
    if (driver === "mongodb") {
      const command = JSON.stringify({
        find: table.name,
        filter: {},
        limit: generalSettings.defaultSelectLimit ?? 100,
      });
      const next = await run("collection detail", () =>
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
      applyResult(next.sample);
      setSqlText(command);
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
    applyResult(next.sample);
    setSqlText(
      `select * from ${quoteName(driver, table.schema, table.name)} limit ${generalSettings.defaultSelectLimit ?? 100}`,
    );
  }

  async function deleteRedisKey(key, connId = selected?.id) {
    if (!connId || !key?.name) return;
    const conn = connections.find((item) => item.id === connId);
    if (!conn) return;
    const currentDetail =
      connId === selected?.id ? detail || details[connId] : details[connId];
    const keyDatabase =
      typeof key?.schema === "string" && key.schema.trim()
        ? key.schema.trim()
        : "";
    const databaseName =
      keyDatabase || currentDetail?.database || conn.database || "";
    const displayName = key.name;
    const confirmed = await api.call(
      "ConfirmDeleteRedisKey",
      displayName,
      databaseName,
    );
    if (!confirmed) return;

    await run("delete redis key", () =>
      api.call("DeleteRedisKey", connId, databaseName, displayName),
    );
    if (result?.redisKey === displayName) {
      applyResult(null);
      setLastRedisCommand("");
    }
    await refreshRedisConnection(connId, databaseName);
  }

  async function execute() {
    if (!selected?.id) return;
    const selection = editorRef.current?.getSelection?.();
    const isPlainSqlDriver =
      selected.driver !== "redis" && selected.driver !== "mongodb";
    const rawQuery = isPlainSqlDriver
      ? selection || sqlText
      : selected.driver === "redis"
        ? redisCommandToRun(
            selection,
            editorRef.current?.getCurrentLine?.(),
            sqlText,
          )
        : selection || sqlText;
    if (!rawQuery) return;
    const statements = isPlainSqlDriver
      ? splitSqlStatements(rawQuery)
      : [rawQuery];
    if (statements.length === 0) return;
    const redisHasSingleCommand =
      selected.driver === "redis" &&
      sqlText.split(/\r?\n/).filter((line) => line.trim()).length === 1;
    if (
      !selection &&
      rawQuery !== sqlText &&
      (selected.driver !== "redis" || redisHasSingleCommand)
    ) {
      setSqlText(rawQuery);
    }
    let next;
    const tabs = [];
    for (const statement of statements) {
      const stmt = isPlainSqlDriver
        ? withDefaultSelectLimit(
            statement,
            generalSettings.defaultSelectLimit ?? 100,
          )
        : statement;
      next = await run("execute", () =>
        api.call(
          "ExecuteDatabase",
          selected.id,
          detail?.database || "",
          stmt,
          generalSettings.queryResultLimit ?? 500,
        ),
      );
      tabs.push({ label: `Query ${tabs.length + 1}`, statement, result: next });
      setResult(next);
      setResultTabs([...tabs]);
      setActiveResultTab(tabs.length - 1);
    }
    const queryToRun = statements[statements.length - 1];
    setExplain(null);
    if (selected.driver === "redis") {
      setLastRedisCommand(queryToRun);
    }
    const queryTable =
      selected.driver === "mongodb" ? null : findQueryTable(queryToRun);
    if (queryTable) {
      try {
        const nextTableDetail = await api.call(
          "GetDatabaseTableDetail",
          selected.id,
          detail?.database || "",
          queryTable.schema,
          queryTable.name,
          generalSettings.defaultSelectLimit ?? 100,
        );
        setTableDetail(nextTableDetail);
      } catch (err) {
        console.error("Failed to load table DDL:", err);
        setTableDetail(null);
      }
    } else {
      setTableDetail(null);
    }
    setShowTableDetail(false);
  }

  function appendToEditor(sql) {
    if (!sql) return;
    setSqlText((prev) => {
      const trimmed = (prev || "").trimEnd();
      return trimmed ? `${trimmed}\n\n${sql}` : sql;
    });
    requestAnimationFrame(() => editorRef.current?.focus());
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
    applyResult(null);
  }

  function askSelection() {
    setAiPanelVisible(true);
    const selection = editorRef.current?.getSelection?.();
    const query = selection?.trim() || sqlText?.trim();
    if (!query) {
      aiChatRef.current?.ask("");
      return;
    }
    const prompt = selection
      ? `Please explain this SQL and suggest improvements:\n\`\`\`sql\n${selection}\n\`\`\``
      : `Please explain what this query does and how it can be optimized:\n\`\`\`sql\n${query}\n\`\`\``;
    aiChatRef.current?.ask(prompt);
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
    connect(conn, !expandedConnections[conn.id]);
  }

  function editConnection(conn) {
    setSelected(conn);
    setCreatingConnection(false);
    setEditingConnection(true);
    setDraft({ ...defaultConnection, ...conn });
    setDetail(null);
    setTableDetail(null);
    applyResult(null);
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
      applyResult(null);
      setExplain(null);
    }
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

  const workspaceModals = (
    <>
      {workspacePromptOpen && (
        <Dialog
          open
          onOpenChange={(open) => !open && setWorkspacePromptOpen(false)}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>New Workspace</DialogTitle>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  autoFocus
                  className="min-h-[38px]"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createWorkspace();
                  }}
                  placeholder="e.g. Production"
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="-mx-0 -mb-0 bg-transparent p-3">
              <Button
                variant="outline"
                onClick={() => setWorkspacePromptOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => createWorkspace()}
                disabled={!workspaceName.trim()}
              >
                <FolderPlus data-icon="inline-start" /> Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteWorkspaceTarget && (
        <Dialog
          open
          onOpenChange={(open) => !open && setDeleteWorkspaceTarget(null)}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Workspace</DialogTitle>
            </DialogHeader>
            <p className="text-sm leading-relaxed text-foreground/80">
              Delete "{deleteWorkspaceTarget.name}"? Its connections will be
              deleted too.
            </p>
            <DialogFooter className="-mx-0 -mb-0 bg-transparent p-3">
              <Button
                variant="outline"
                onClick={() => setDeleteWorkspaceTarget(null)}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDeleteWorkspace}>
                <Trash2 data-icon="inline-start" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );

  function startNewConnection() {
    setSelected(null);
    setCreatingConnection(true);
    setEditingConnection(true);
    setDraft(defaultConnection);
    setDetail(null);
    setTableDetail(null);
    applyResult(null);
    setExplain(null);
    setWorkspaceView("query");
    setConnectionStatus("disconnected");
  }

  if (!selected && !creatingConnection) {
    return (
      <TooltipProvider>
        <StartupPage
          groups={groupedConnections}
          expandedWorkspaces={expandedWorkspaces}
          onToggleWorkspace={toggleWorkspaceExpanded}
          filter={connectionFilter}
          setFilter={setConnectionFilter}
          onSelect={selectConnection}
          onCreate={startNewConnection}
          onTogglePin={togglePin}
          onCreateWorkspace={() => {
            setWorkspaceName("");
            setWorkspacePromptOpen(true);
          }}
          onImportWorkspace={importWorkspace}
          onExportWorkspace={exportWorkspace}
          onDeleteWorkspace={(id) =>
            setDeleteWorkspaceTarget(
              workspaces.find((w) => w.id === id) || null,
            )
          }
        />
        {workspaceModals}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
            },
            success: {
              style: { borderColor: "oklch(0.696 0.17 162.48 / 0.6)" },
            },
          }}
        />
      </TooltipProvider>
    );
  }

  const gridColumns = [
    ...(sidebarVisible ? [`${sidebarWidth}px`] : []),
    "minmax(0, 1fr)",
    ...(aiPanelVisible ? [`${aiPanelWidth}px`] : []),
  ].join(" ");

  return (
    <TooltipProvider>
      <div
        className="relative grid h-screen overflow-hidden"
        style={{
          gridTemplateColumns: gridColumns,
        }}
      >
      {sidebarVisible && (
        <>
          <aside className="flex min-h-0 flex-col gap-3 overflow-hidden border-r border-border bg-card p-3.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <strong className="text-[11px] font-bold tracking-wider text-muted-foreground">
                  DATABASE
                </strong>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    selected ? connect(selected) : refreshConnections()
                  }
                  aria-label="Refresh connection"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                {Object.values(expandedConnections).some(Boolean) ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={collapseAll}
                    aria-label="Collapse all"
                  >
                    <ChevronsUp className="size-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={expandAll}
                    aria-label="Expand all"
                  >
                    <ChevronsDown className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={startNewConnection}
                  aria-label="New connection"
                >
                  <Plus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(selectionMode && "bg-accent text-primary")}
                  onClick={toggleSelectionMode}
                  aria-label={
                    selectionMode ? "Exit select mode" : "Select connections"
                  }
                  title={
                    selectionMode ? "Exit select mode" : "Select connections"
                  }
                >
                  <ListChecks className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setWorkspaceName("");
                    setWorkspacePromptOpen(true);
                  }}
                  aria-label="New workspace"
                >
                  <FolderPlus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={importWorkspace}
                  aria-label="Import workspace"
                >
                  <Download className="size-3.5" />
                </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
              <label className="flex flex-none items-center gap-2 border-b border-border p-2.5">
                <Search className="size-3.5 flex-none text-muted-foreground" />
                <input
                  className="h-6 w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter tables"
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="min-h-0 flex-1 overflow-auto">
                <SidebarTree
                  groups={groupedConnections}
                  expandedWorkspaces={expandedWorkspaces}
                  onToggleWorkspace={toggleWorkspaceExpanded}
                  onExportWorkspace={exportWorkspace}
                  onDeleteWorkspace={(id) =>
                    setDeleteWorkspaceTarget(
                      workspaces.find((w) => w.id === id) || null,
                    )
                  }
                  objectFilter={filter}
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
                  onDeleteRedisKey={deleteRedisKey}
                  onNewQuery={() => editorRef.current?.focus()}
                  onContextMenu={openConnectionMenu}
                  selectionMode={selectionMode}
                  selectedConnIds={selectedConnIds}
                  onToggleConnSelected={toggleConnSelected}
                />
              </div>
              <div className="flex-none overflow-auto">
                <SavedQueries
                  queries={queries}
                  deletingQueryIds={deletingQueryIds}
                  onOpen={(query) =>
                    setSqlText(savedQueryField(query, "sql", "SQL"))
                  }
                  onDelete={deleteSavedQuery}
                />
              </div>
            </section>
            {selectionMode && (
              <div className="flex flex-none items-center gap-2 border-t border-border bg-muted/20 p-2">
                <div className="inline-flex flex-none items-center gap-1.5 text-xs text-muted-foreground">
                  <Check size={14} className="text-primary" />
                  <strong className="text-foreground">
                    {selectedConnIds.size}
                  </strong>
                  <span>selected</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Clear selection"
                    onClick={() => setSelectedConnIds(new Set())}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <NativeSelect
                  size="sm"
                  className="min-w-0 flex-1"
                  value={selectionMoveTarget}
                  onChange={(e) => setSelectionMoveTarget(e.target.value)}
                  aria-label="Move to workspace"
                >
                  <option value="">Ungrouped</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  className="flex-none"
                  disabled={!selectedConnIds.size}
                  onClick={moveSelectedConnections}
                >
                  Move
                </Button>
              </div>
            )}
            {connectionMenu && (
              <ConnectionContextMenu
                menu={connectionMenu}
                connected={!!connectedConnections[connectionMenu.conn.id]}
                workspaces={workspaces}
                onCloseConnection={() =>
                  closeConnectedConnection(connectionMenu.conn)
                }
                onEditConnection={() => editConnection(connectionMenu.conn)}
                onDeleteConnection={async () => {
                  const conn = connectionMenu.conn;
                  const confirmed = await api.call(
                    "ConfirmDeleteConnection",
                    conn.name,
                  );
                  if (!confirmed) return;
                  setConnectionMenu(null);
                  await deleteConnection(conn);
                  showToast("Connection deleted");
                }}
                onTogglePin={() => {
                  togglePin(connectionMenu.conn);
                  setConnectionMenu(null);
                }}
                onCopyConnectionString={() => {
                  navigator.clipboard?.writeText(
                    connectionString(connectionMenu.conn),
                  );
                  showToast("Connection string copied");
                  setConnectionMenu(null);
                }}
                onMoveToWorkspace={moveConnectionToWorkspace}
              />
            )}
          </aside>
          <div
            className={cn(
              "absolute inset-y-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors",
              isResizing && "bg-primary",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizing(true);
            }}
            style={{ left: `${sidebarWidth - 2}px` }}
          />
        </>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-[18px]">
        <header className="mb-3.5 flex flex-none items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSidebarVisible(!sidebarVisible)}
              title={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
            >
              {sidebarVisible ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </Button>
            <div>
              <h1 className="text-[22px] font-bold text-foreground">
                {selected?.name || "Dashboard"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {selected
                  ? `${driverLabel(selected.driver)}://${selected.host}:${selected.port}/${detail?.database || selected.database}`
                  : "Stored connections and query workspace"}
              </p>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            {!editingConnectionDetails && selected && (
              <Tabs
                value={workspaceView}
                onValueChange={(view) => setWorkspaceView(view)}
                aria-label="Workspace"
              >
                <TabsList>
                  <TabsTrigger value="workspace">
                    <FolderPlus className="size-3.5" data-icon="inline-start" />{" "}
                    Workspace
                  </TabsTrigger>
                  <TabsTrigger value="query">Query</TabsTrigger>
                  <TabsTrigger
                    value="insights"
                    disabled={
                      selected?.driver !== "mysql" &&
                      selected?.driver !== "postgres" &&
                      selected?.driver !== "timescaledb" &&
                      selected?.driver !== "redis" &&
                      selected?.driver !== "mongodb"
                    }
                  >
                    <Gauge className="size-3.5" data-icon="inline-start" />{" "}
                    Insights
                  </TabsTrigger>
                  <TabsTrigger
                    value="optimizer"
                    disabled={
                      selected?.driver !== "mysql" &&
                      selected?.driver !== "postgres" &&
                      selected?.driver !== "timescaledb"
                    }
                  >
                    <Zap className="size-3.5" data-icon="inline-start" />{" "}
                    Optimizer
                  </TabsTrigger>
                  <TabsTrigger value="trace">Trace Log</TabsTrigger>
                  <TabsTrigger value="exports">
                    <FileDown className="size-3.5" data-icon="inline-start" />{" "}
                    Exports
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <Button variant="outline" title="Settings (Cmd+,)" onClick={openSettings}>
              <Settings className="size-4" />
            </Button>
            <Button
              variant="outline"
              className={cn(
                "size-[38px] rounded-[9px]",
                aiPanelVisible && "border-primary bg-accent text-primary",
              )}
              title="AI Chat (Cmd+L)"
              aria-label="Toggle AI chat panel"
              onClick={() => setAiPanelVisible(!aiPanelVisible)}
            >
              <Bot className="size-[19px]" />
            </Button>
          </div>
        </header>

        {exportProgress && (
          <div
            className={cn(
              "mb-2.5 flex-none rounded-lg border p-2.5",
              exportProgress.status === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : exportProgress.status === "done"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-border bg-card text-foreground",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{exportProgress.message}</span>
              <small className="text-xs opacity-80">
                {exportProgress.progress}%
              </small>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200 ease-linear",
                  exportProgress.status === "error"
                    ? "bg-destructive"
                    : "bg-emerald-400",
                )}
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
            className={cn(
              "mb-3 grid min-h-0 flex-1 gap-3",
              connectionStatus === "connected" || editingConnectionDetails
                ? "grid-cols-[minmax(0,1fr)]"
                : "grid-cols-[430px_minmax(0,1fr)]",
            )}
          >
            {(connectionStatus !== "connected" || editingConnectionDetails) && (
              <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex min-h-[45px] flex-none items-center border-b border-border px-3 py-[9px]">
                  <h2 className="text-sm font-semibold">Connection Detail</h2>
                </div>
                <ConnectionForm draft={draft} setDraft={setDraft} workspaces={workspaces} />
                <div className="flex flex-none items-center justify-between gap-3 border-t border-border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={duplicateConnection}
                      disabled={!draft.name}
                    >
                      <Copy data-icon="inline-start" /> Duplicate
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => deleteConnection()}
                      disabled={!draft.id}
                      title="Delete connection"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={testConnection}>
                      <Activity data-icon="inline-start" /> Test
                    </Button>
                    <Button size="sm" onClick={saveConnection}>
                      <Save data-icon="inline-start" /> Save & Connect
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {!editingConnectionDetails && workspaceView === "query" && (
              <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex min-h-[45px] flex-none items-center justify-between gap-3 border-b border-border px-3 py-[9px]">
                  <h2 className="text-sm font-semibold">Command</h2>
                  {selected && (
                    <span
                      className="mr-auto flex max-w-[40%] items-center gap-1.5 overflow-hidden rounded-full border border-border bg-background px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground"
                      title={`${driverLabel(selected.driver)}://${selected.host}:${selected.port}/${detail?.database || selected.database || ""}`}
                    >
                      <Database className="size-3.5 flex-none" />
                      <select
                        className="max-w-[180px] cursor-pointer appearance-none border-0 bg-transparent p-0 pr-2 font-semibold text-foreground outline-none"
                        value={selected.id}
                        onChange={(e) => {
                          const conn = connections.find(
                            (c) => c.id === e.target.value,
                          );
                          if (conn && conn.id !== selected.id) connect(conn);
                        }}
                      >
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const currentDb =
                          detail?.database || selected.database || "";
                        const names = (detail?.databases || []).map(
                          (db) => db.name,
                        );
                        if (currentDb && !names.includes(currentDb)) {
                          names.unshift(currentDb);
                        }
                        if (!names.length) return null;
                        return (
                          <>
                            <span className="flex-none text-muted-foreground/50">/</span>
                            <select
                              className="max-w-[180px] cursor-pointer appearance-none border-0 bg-transparent p-0 pr-2 text-primary outline-none"
                              value={currentDb}
                              onChange={(e) => {
                                if (
                                  e.target.value &&
                                  e.target.value !== currentDb
                                ) {
                                  connectDatabase(e.target.value);
                                }
                              }}
                            >
                              {names.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </>
                        );
                      })()}
                    </span>
                  )}
                  <div className="flex flex-none items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowTableDetail(!showTableDetail)}
                      title={
                        tableDetail
                          ? "Toggle Table Detail"
                          : "Run a SELECT or select a table to view its DDL"
                      }
                      disabled={!tableDetail}
                    >
                      <Table2 data-icon="inline-start" />{" "}
                      {showTableDetail ? "Hide DDL" : "Show DDL"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={saveCurrentQuery}>
                      <Save data-icon="inline-start" /> Query
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={askSelection}
                      title="Ask AI about the selected text or current query (Cmd+L)"
                    >
                      <Sparkles data-icon="inline-start" /> Ask AI
                    </Button>
                    {(selected?.driver === "mysql" ||
                      selected?.driver === "postgres" ||
                      selected?.driver === "timescaledb") && (
                      <Button variant="ghost" size="sm" onClick={explainAnalyze}>
                        <Activity data-icon="inline-start" /> Explain
                      </Button>
                    )}
                    <Button size="sm" onClick={execute}>
                      <Play data-icon="inline-start" /> Run
                    </Button>
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
          tableDetail &&
          showTableDetail && (
            <Dialog
              open
              onOpenChange={(open) => !open && setShowTableDetail(false)}
            >
              <DialogContent className="w-[min(1240px,calc(100vw-3.5rem))] max-w-full overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {tableDetail.table?.schema
                      ? `${tableDetail.table.schema}.`
                      : ""}
                    {tableDetail.table?.name || "Table Detail"}
                  </DialogTitle>
                </DialogHeader>
                <TableInspector detail={tableDetail} onToast={showToast} />
              </DialogContent>
            </Dialog>
          )}

        {!editingConnectionDetails &&
          workspaceView === "query" &&
          (result || explain) && (
            <section
              className="flex min-h-[160px] flex-1 flex-col"
              style={
                resultsHeight
                  ? { flex: "0 0 auto", height: `${resultsHeight}px` }
                  : undefined
              }
            >
              <div
                className="-mt-[3px] mb-[3px] h-1.5 flex-none cursor-row-resize rounded-full hover:bg-primary/60"
                title="Drag to resize results"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingResults(true);
                }}
              />
              <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
                {resultTabs.length > 1 && (
                  <div className="flex flex-none items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-background p-[3px]">
                    {resultTabs.map((tab, index) => (
                      <button
                        key={index}
                        className={cn(
                          "min-h-6 cursor-pointer rounded-md px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground",
                          index === activeResultTab &&
                            "bg-accent text-foreground",
                        )}
                        title={tab.statement}
                        onClick={() => setActiveResultTab(index)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                )}
                <ResultPanel
                  title="Rows"
                  result={resultTabs[activeResultTab]?.result ?? result}
                  table={tableDetail}
                  driver={selected?.driver}
                  onAppendQuery={appendToEditor}
                  onExport={exportQueryResult}
                  gridSettings={generalSettings}
                  onToast={showToast}
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
                  table={null}
                  driver={null}
                  onAppendQuery={null}
                  onExport={exportQueryResult}
                  gridSettings={generalSettings}
                  onToast={showToast}
                  onUpdateTTL={() => {}}
                />
              </section>
            </section>
          )}

        {!editingConnectionDetails && workspaceView === "trace" && (
          <TraceLogPage connection={selected} onExport={exportQueryResult} />
        )}

        {!editingConnectionDetails && workspaceView === "insights" && (
          <QueryInsightsPage
            connection={selected}
            database={detail?.database || selected?.database}
          />
        )}

        {!editingConnectionDetails && workspaceView === "optimizer" && (
          <QueryOptimizerPage
            connection={selected}
            database={detail?.database || selected?.database}
            sqlText={sqlText}
          />
        )}

        {!editingConnectionDetails && workspaceView === "exports" && (
          <ExportsPage
            exports={exportedFiles}
            onClear={() => setExportedFiles([])}
          />
        )}

        {!editingConnectionDetails && workspaceView === "workspace" && (
          <WorkspacePage
            workspaces={workspaces}
            selected={selected}
            onCreate={createWorkspace}
            onImport={importWorkspace}
            onExport={exportWorkspace}
            onRename={renameWorkspace}
            onDelete={(id) =>
              setDeleteWorkspaceTarget(
                workspaces.find((w) => w.id === id) || null,
              )
            }
          />
        )}
      </main>

      <AiChatPanel
        ref={aiChatRef}
        detail={detail}
        connection={selected}
        visible={aiPanelVisible}
        onClose={() => setAiPanelVisible(false)}
        onInsertQuery={(sql) => {
          if (sql) {
            setSqlText((current) => {
              const trimmed = (current || "").trimEnd();
              return trimmed ? `${trimmed}\n\n${sql}` : sql;
            });
          }
          setAiPanelVisible(true);
        }}
        onToast={showToast}
      />
      {aiPanelVisible && (
        <div
          className={cn(
            "absolute inset-y-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors",
            isResizingAi && "bg-primary",
          )}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingAi(true);
          }}
          style={{ right: `${aiPanelWidth - 2}px` }}
        />
      )}

      {workspaceModals}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
          },
          success: {
            style: { borderColor: "oklch(0.696 0.17 162.48 / 0.6)" },
          },
        }}
      />
      </div>
      </TooltipProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);