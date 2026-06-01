import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MySQLIcon, PostgreSQLIcon, RedisIcon, ElasticsearchIcon } from "./icons";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { MySQL, PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  FileText,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Table2,
  Trash2,
  View,
  X,
  Pencil,
  PowerOff,
} from "lucide-react";
import "./styles.css";

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

const sampleConnections = [
  {
    id: "demo-pg",
    name: "Local Postgres",
    driver: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "postgres",
    sslMode: "disable",
  },
  {
    id: "demo-my",
    name: "Local MySQL",
    driver: "mysql",
    host: "localhost",
    port: 3306,
    database: "app",
    user: "root",
    useTLS: false,
  },
];

const demoTables = [
  { schema: "public", name: "users", type: "table", rows: 1248 },
  { schema: "public", name: "orders", type: "table", rows: 44819 },
  { schema: "public", name: "billing_sessions", type: "table", rows: 76 },
];

const sqlCompletions = [
  { label: "select", detail: "query rows", apply: "select * from ", type: "keyword" },
  { label: "from", detail: "source table", apply: "from ", type: "keyword" },
  { label: "where", detail: "filter rows", apply: "where ", type: "keyword" },
  { label: "join", detail: "join table", apply: "join ", type: "keyword" },
  { label: "left join", detail: "optional join", apply: "left join ", type: "keyword" },
  { label: "inner join", detail: "matching join", apply: "inner join ", type: "keyword" },
  { label: "group by", detail: "aggregate groups", apply: "group by ", type: "keyword" },
  { label: "order by", detail: "sort rows", apply: "order by ", type: "keyword" },
  { label: "limit", detail: "cap results", apply: "limit ", type: "keyword" },
  { label: "insert into", detail: "add rows", apply: "insert into ", type: "keyword" },
  { label: "update", detail: "modify rows", apply: "update ", type: "keyword" },
  { label: "delete from", detail: "remove rows", apply: "delete from ", type: "keyword" },
  { label: "create table", detail: "define table", apply: "create table ", type: "keyword" },
  { label: "alter table", detail: "change table", apply: "alter table ", type: "keyword" },
  { label: "drop table", detail: "remove table", apply: "drop table ", type: "keyword" },
  { label: "explain analyze", detail: "query plan", apply: "explain analyze ", type: "keyword" },
  { label: "count(*)", detail: "aggregate count", apply: "count(*)", type: "function" },
];

const api = {
  async call(name, ...args) {
    const app = window.go?.main?.App;
    if (app?.[name]) return app[name](...args);
    return demoCall(name, ...args);
  },
};

async function demoCall(name, ...args) {
  await new Promise((resolve) => setTimeout(resolve, 160));
  if (name === "ListConnections") return sampleConnections;
  if (name === "SaveConnection")
    return { ...args[0], id: args[0].id || `demo-${Date.now()}` };
  if (name === "DeleteConnection") return null;
  if (name === "TestConnection") return null;
  if (name === "Connect" || name === "ConnectDatabase")
    return {
      driver: "postgres",
      database: args[1] || "app",
      databases: [
        { name: "app", size: 3_560_000_000 },
        { name: "analytics", size: 1_170_000 },
        { name: "mysql", size: 0 },
      ],
      tables: demoTables,
      routines: [
        { schema: "public", name: "refresh_billing_sessions", type: "function" },
      ],
    };
  if (name === "GetCompletions") {
    return [
      { label: "SET", detail: "command", type: "keyword", apply: "SET " },
      { label: "GET", detail: "command", type: "keyword", apply: "GET " }
    ];
  }
  if (name === "ListSavedQueries")
    return [
      {
        id: "q1",
        connectionId: args[0],
        name: "Slow users lookup",
        sql: "select * from users where email like $1 limit 100",
        updatedAt: "2026-05-29T08:00:00Z",
      },
    ];
  if (name === "SaveQuery")
    return {
      ...args[0],
      id: args[0].id || `q-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
  if (name === "DeleteQuery") return null;
  if (name === "GetTableDetail" || name === "GetDatabaseTableDetail")
    return {
      table: { schema: args[1], name: args[2], type: "table", rows: 1248 },
      columns: [
        {
          name: "id",
          type: "bigint",
          nullable: false,
          default: "nextval('users_id_seq')",
          ordinal: 1,
        },
        {
          name: "email",
          type: "text",
          nullable: false,
          default: "",
          ordinal: 2,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
          default: "now()",
          ordinal: 3,
        },
      ],
      indexes: [
        {
          name: "users_pkey",
          columns: "id",
          unique: true,
          sql: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
        },
        {
          name: "users_email_idx",
          columns: "email",
          unique: true,
          sql: "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
        },
      ],
      createSql:
        'create table "public"."users" (\n  "id" bigint not null,\n  "email" text not null,\n  "created_at" timestamp not null default now()\n);',
      sample: {
        columns: ["id", "email", "created_at"],
        rows: [
          {
            id: "1",
            email: "tien@example.com",
            created_at: "2026-05-29 08:00:00",
          },
          {
            id: "2",
            email: "dev@example.com",
            created_at: "2026-05-29 08:01:00",
          },
        ],
        durationMs: 12,
      },
    };
  if (name === "ExplainAnalyze" || name === "ExplainAnalyzeDatabase")
    return {
      columns: ["QUERY PLAN"],
      rows: [
        {
          "QUERY PLAN":
            "Index Scan using users_email_idx on users  (cost=0.28..8.30 rows=1 width=80) (actual time=0.018..0.020 rows=1 loops=1)",
        },
        { "QUERY PLAN": "Planning Time: 0.110 ms" },
        { "QUERY PLAN": "Execution Time: 0.041 ms" },
      ],
      durationMs: 41,
    };
  if (name === "Execute" || name === "ExecuteDatabase")
    return {
      columns: ["id", "email", "created_at"],
      rows: [
        {
          id: "1",
          email: "tien@example.com",
          created_at: "2026-05-29 08:00:00",
        },
        {
          id: "2",
          email: "dev@example.com",
          created_at: "2026-05-29 08:01:00",
        },
      ],
      durationMs: 18,
      message: "Demo result. Run inside Wails to connect real databases.",
    };
  return null;
}

function App() {
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(defaultConnection);
  const [detail, setDetail] = useState(null);
  const [tableDetail, setTableDetail] = useState(null);
  const [queries, setQueries] = useState([]);
  const [sqlText, setSqlText] = useState("select * from ");
  const [result, setResult] = useState(null);
  const [explain, setExplain] = useState(null);
  const [filter, setFilter] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState("query");
  const [expandedObjects, setExpandedObjects] = useState({
    database: true,
    tables: true,
    views: false,
    functions: false,
    procedures: false,
  });
  const editorRef = useRef(null);

  useEffect(() => {
    refreshConnections();
  }, []);

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
  }, [shortcuts, sqlText, selected]);

  const filteredObjects = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!detail?.tables) return [];
    const objects = detail.tables.map((table) => ({
      ...table,
      objectType: normalizeObjectType(table.type),
    }));
    if (!term) return objects;
    return objects.filter((table) =>
      `${table.schema}.${table.name}.${table.objectType}`
        .toLowerCase()
        .includes(term),
    );
  }, [detail, filter]);

  const filteredDatabases = useMemo(() => {
    const databases = detail?.databases?.length
      ? detail.databases
      : selected?.database
        ? [{ name: selected.database, size: 0 }]
        : [];
    return databases;
  }, [detail, selected]);

  const objectTables = useMemo(
    () => filteredObjects.filter((table) => table.objectType === "table"),
    [filteredObjects],
  );

  const objectViews = useMemo(
    () => filteredObjects.filter((table) => table.objectType === "view"),
    [filteredObjects],
  );

  const filteredRoutines = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const routines = detail?.routines || [];
    if (!term) return routines;
    return routines.filter((routine) =>
      `${routine.schema}.${routine.name}.${routine.type}`
        .toLowerCase()
        .includes(term),
    );
  }, [detail, filter]);

  const objectFunctions = useMemo(
    () => filteredRoutines.filter((routine) => routine.type === "function"),
    [filteredRoutines],
  );

  const objectProcedures = useMemo(
    () => filteredRoutines.filter((routine) => routine.type === "procedure"),
    [filteredRoutines],
  );

  const filteredConnections = useMemo(() => {
    const term = connectionFilter.trim().toLowerCase();
    if (!term) return connections;
    return connections.filter((conn) =>
      `${conn.name}.${conn.driver}.${conn.host}.${conn.port}.${conn.database}`
        .toLowerCase()
        .includes(term),
    );
  }, [connectionFilter, connections]);

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
    setConnectedConnections((current) => {
      const next = { ...current };
      delete next[saved.id];
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

  async function deleteConnection() {
    if (!draft.id) return;
    await run("delete connection", () =>
      api.call("DeleteConnection", draft.id),
    );
    setSelected(null);
    setCreatingConnection(false);
    setEditingConnection(false);
    setDraft(defaultConnection);
    setDetail(null);
    setTableDetail(null);
    setConnectionStatus("disconnected");
    setConnectedConnections((current) => {
      const next = { ...current };
      delete next[draft.id];
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
      setQueries(savedQueries || []);
      setDraft((current) => ({ ...current, ...conn, database: next.database }));
      setTableDetail(null);
      setExpandedObjects((current) => ({
        ...current,
        [databaseKey(next.database)]: true,
      }));
      setConnectedConnections((current) => ({
        ...current,
        [conn.id]: true,
      }));
      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("error");
      throw err;
    }
  }

  async function connectDatabase(databaseName) {
    if (!selected?.id || !databaseName) return;
    setConnectionStatus("connecting");
    try {
      const next = await run("connect", () =>
        api.call("ConnectDatabase", selected.id, databaseName),
      );
      setDetail(next);
      setDraft((current) => ({ ...current, database: next.database }));
      setTableDetail(null);
      setResult(null);
      setExplain(null);
      setExpandedObjects((current) => ({
        ...current,
        [databaseKey(databaseName)]: true,
      }));
      setConnectedConnections((current) => ({
        ...current,
        [selected.id]: true,
      }));
      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("error");
      throw err;
    }
  }

  async function openTable(table) {
    if (!selected?.id) return;
    const next = await run("table detail", () =>
      api.call(
        "GetDatabaseTableDetail",
        selected.id,
        detail?.database || "",
        table.schema,
        table.name,
        100,
      ),
    );
    setTableDetail(next);
    setResult(next.sample);
    setSqlText(
      `select * from ${quoteName(detail?.driver, table.schema, table.name)} limit 100`,
    );
  }

  async function execute() {
    if (!selected?.id) return;
    const next = await run("execute", () =>
      api.call("ExecuteDatabase", selected.id, detail?.database || "", sqlText, 500),
    );
    setResult(next);
  }

  async function explainAnalyze() {
    if (!selected?.id) return;
    const next = await run("explain", () =>
      api.call("ExplainAnalyzeDatabase", selected.id, detail?.database || "", sqlText),
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
    setConnectionStatus(connectedConnections[conn.id] ? "connected" : "disconnected");
    setConnectionMenu(null);
  }

  async function closeConnectedConnection(conn = selected) {
    if (!conn?.id) return;
    await run("close connection", () => api.call("CloseConnection", conn.id, ""));
    setConnectedConnections((current) => {
      const next = { ...current };
      delete next[conn.id];
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

  function openConnectionMenu(event, conn) {
    event.preventDefault();
    setConnectionMenu({
      conn,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function statusForConnection(conn) {
    if (selected?.id === conn.id) return connectionStatus;
    return connectedConnections[conn.id] ? "connected" : "disconnected";
  }

  function toggleObject(key) {
    setExpandedObjects((current) => ({
      ...current,
      [key]: !current[key],
    }));
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
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Database size={22} />
          <div>
            <strong>dbVibe</strong>
            <span>MySQL / PostgreSQL / Redis / Elasticsearch</span>
          </div>
        </div>
        <button
          className="primary"
          onClick={startNewConnection}
        >
          <Plus size={16} /> New connection
        </button>
        <div className="connectionList">
          {connections.map((conn) => (
            <button
              key={conn.id}
              className={
                selected?.id === conn.id ? "connection active" : "connection"
              }
              onClick={() => selectConnection(conn)}
              onContextMenu={(event) => openConnectionMenu(event, conn)}
            >
              <span className="connectionName">
                <StatusDot status={statusForConnection(conn)} />
                <DriverLogo driver={conn.driver} />
                {conn.name}
              </span>
              <small>
                {driverLabel(conn.driver)} · {conn.host}:{conn.port}
                {conn.database ? `/${conn.database}` : ""}
              </small>
            </button>
          ))}
        </div>
        <section className="panel sidebarPanel">
          <label className="search sidebarSearch">
            <Search size={15} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter objects"
            />
          </label>
          <ConnectionTree
            detail={detail}
            databases={filteredDatabases}
            tables={objectTables}
            views={objectViews}
            functions={objectFunctions}
            procedures={objectProcedures}
            tableDetail={tableDetail}
            expanded={expandedObjects}
            onToggle={toggleObject}
            onOpenDatabase={connectDatabase}
            onOpenTable={openTable}
            onNewQuery={() => editorRef.current?.focus()}
          />
          <SavedQueries
            queries={queries}
            onOpen={(query) => setSqlText(query.sql)}
          />
        </section>
        {connectionMenu && (
          <ConnectionContextMenu
            menu={connectionMenu}
            connected={!!connectedConnections[connectionMenu.conn.id]}
            onCloseConnection={() => closeConnectedConnection(connectionMenu.conn)}
            onEditConnection={() => editConnection(connectionMenu.conn)}
          />
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{selected?.name || "Dashboard"}</h1>
            <p>
              {selected
                ? `${driverLabel(selected.driver)}://${selected.host}:${selected.port}/${detail?.database || selected.database}`
                : "Stored connections and query workspace"}
            </p>
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
              </div>
            )}
            <button
              title="Settings"
              onClick={() => setSettingsOpen(!settingsOpen)}
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

        {settingsOpen && (
          <SettingsPanel
            shortcuts={shortcuts}
            setShortcuts={setShortcuts}
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
                  <button onClick={duplicateConnection} disabled={!draft.name}>
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
                  <button onClick={saveCurrentQuery}>
                    <Save size={15} /> Query
                  </button>
                  <button onClick={explainAnalyze}>
                    <Activity size={15} /> Explain
                  </button>
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
              />
            </section>
          )}
        </section>
        )}

        {!editingConnectionDetails && workspaceView === "query" && (
          <section className="workspace">
            <section className="content">
              {tableDetail && <TableInspector detail={tableDetail} />}
              <ResultPanel title="Rows" result={result} />
              <ResultPanel title="Explain Analyze" result={explain} />
            </section>
          </section>
        )}

        {!editingConnectionDetails && workspaceView === "trace" && (
          <TraceLogPage connection={selected} />
        )}
      </main>
    </div>
  );
}

function StartupPage({ connections, filter, setFilter, onSelect, onCreate }) {
  return (
    <div className="startup">
      <aside className="startupIntro">
        <div className="startupLogo">
          <Database size={76} />
        </div>
        <h1>dbVibe</h1>
        <p>MySQL / PostgreSQL / Redis / Elasticsearch</p>
        <button className="primary startupButton" onClick={onCreate}>
          <Plus size={18} /> Create Connection
        </button>
      </aside>

      <main className="startupMain">
        <div className="startupToolbar">
          <button title="Create connection" onClick={onCreate}>
            <Plus size={18} />
          </button>
          <label className="startupSearch">
            <Search size={18} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search for connection..."
            />
          </label>
        </div>

        <div className="startupList">
          {connections.map((conn) => (
            <button
              key={conn.id}
              className="startupConnection"
              onClick={() => onSelect(conn)}
            >
              <DriverLogo driver={conn.driver} />
              <span>
                <strong>{conn.name}</strong>
                <small>
                  {conn.host}:{conn.port}
                  {conn.database ? `/${conn.database}` : ""}
                </small>
              </span>
              {isLocalConnection(conn) && (
                <small className="localBadge">
                  <StatusDot status="connected" /> local
                </small>
              )}
            </button>
          ))}
          {!connections.length && (
            <div className="startupEmpty">
              <Database size={28} />
              <span>No connections found</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ConnectionContextMenu({
  menu,
  connected,
  onCloseConnection,
  onEditConnection,
}) {
  return (
    <div
      className="contextMenu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button onClick={onEditConnection}>
        <Pencil size={15} /> Edit connection
      </button>
      <button onClick={onCloseConnection} disabled={!connected}>
        <PowerOff size={15} /> Close connection
      </button>
    </div>
  );
}

function ConnectionTree({
  detail,
  databases,
  tables,
  views,
  functions,
  procedures,
  tableDetail,
  expanded,
  onToggle,
  onOpenDatabase,
  onOpenTable,
  onNewQuery,
}) {
  const activeDatabase = detail?.database || "";
  const tableCount = tables.length;
  const viewCount = views.length;
  const functionCount = functions.length;
  const procedureCount = procedures.length;

  return (
    <div className="objectTree">
      {databases.map((database) => (
        <DatabaseBranch
          key={database.name}
          database={database}
          active={database.name === activeDatabase}
          expanded={!!expanded[databaseKey(database.name)]}
          onToggle={onToggle}
          onOpen={onOpenDatabase}
        >
          <button className="treeItem leaf queryLeaf" onClick={onNewQuery}>
            <span className="treeIndent" />
            <FileText size={15} />
            <span>Query</span>
          </button>

          <TreeBranch
            id="tables"
            icon={<Table2 size={16} />}
            label="Tables"
            meta={String(tableCount)}
            expanded={expanded.tables}
            onToggle={onToggle}
          >
            {tables.map((table) => (
              <ObjectLeaf
                key={`${table.schema}.${table.name}`}
                table={table}
                active={
                  tableDetail?.table?.schema === table.schema &&
                  tableDetail?.table?.name === table.name
                }
                onOpen={onOpenTable}
              />
            ))}
            {!tables.length && <div className="treeEmpty">No tables</div>}
          </TreeBranch>

          <TreeBranch
            id="views"
            icon={<View size={16} />}
            label="Views"
            meta={viewCount ? String(viewCount) : ""}
            expanded={expanded.views}
            onToggle={onToggle}
          >
            {views.map((table) => (
              <ObjectLeaf
                key={`${table.schema}.${table.name}`}
                table={table}
                active={
                  tableDetail?.table?.schema === table.schema &&
                  tableDetail?.table?.name === table.name
                }
                onOpen={onOpenTable}
              />
            ))}
            {!views.length && <div className="treeEmpty">No views</div>}
          </TreeBranch>

          <TreeBranch
            id="functions"
            icon={<Code2 size={16} />}
            label="Functions"
            meta={functionCount ? String(functionCount) : ""}
            expanded={expanded.functions}
            onToggle={onToggle}
          >
            {functions.map((routine) => (
              <RoutineLeaf
                key={`${routine.schema}.${routine.name}`}
                routine={routine}
              />
            ))}
            {!functions.length && <div className="treeEmpty">No functions</div>}
          </TreeBranch>

          <TreeBranch
            id="procedures"
            icon={<Code2 size={16} />}
            label="Procedures"
            meta={procedureCount ? String(procedureCount) : ""}
            expanded={expanded.procedures}
            onToggle={onToggle}
          >
            {procedures.map((routine) => (
              <RoutineLeaf
                key={`${routine.schema}.${routine.name}`}
                routine={routine}
              />
            ))}
            {!procedures.length && (
              <div className="treeEmpty">No procedures</div>
            )}
          </TreeBranch>
        </DatabaseBranch>
      ))}
      {!databases.length && <div className="treeEmpty">No databases</div>}
    </div>
  );
}

function TreeBranch({ id, icon, label, meta, expanded, onToggle, children }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="treeBranch">
      <button className="treeItem" onClick={() => onToggle(id)}>
        <Chevron size={15} className="treeChevron" />
        {icon}
        <span>{label}</span>
        {meta && <small>{meta}</small>}
      </button>
      {expanded && <div className="treeChildren">{children}</div>}
    </div>
  );
}

function DatabaseBranch({ database, active, expanded, onToggle, onOpen, children }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const id = databaseKey(database.name);
  return (
    <div className="treeBranch">
      <button
        className={active ? "treeItem active" : "treeItem"}
        onClick={() => {
          if (!active) onOpen(database.name);
          onToggle(id);
        }}
      >
        <Chevron size={15} className="treeChevron" />
        <Database size={16} />
        <span>{database.name}</span>
        <small>{formatBytes(database.size)}</small>
      </button>
      {active && expanded && <div className="treeChildren">{children}</div>}
    </div>
  );
}

function ObjectLeaf({ table, active, onOpen }) {
  return (
    <button
      className={active ? "treeItem leaf active" : "treeItem leaf"}
      onClick={() => onOpen(table)}
    >
      <span className="treeIndent" />
      <Table2 size={15} />
      <span>{table.name}</span>
      <small>{formatCompactCount(table.rows)}</small>
    </button>
  );
}

function RoutineLeaf({ routine }) {
  return (
    <button className="treeItem leaf" disabled>
      <span className="treeIndent" />
      <Code2 size={15} />
      <span>{routine.name}</span>
      <small>{routine.schema}</small>
    </button>
  );
}

function StatusDot({ status }) {
  return <span className={`statusDot ${status}`} title={connectionLabel(status)} />;
}

function DriverLogo({ driver }) {
  switch (driver) {
    case "postgres":
      return <PostgreSQLIcon className="driverLogo" />;
    case "redis":
      return <RedisIcon className="driverLogo" />;
    case "elasticsearch":
      return <ElasticsearchIcon className="driverLogo" />;
    case "mysql":
    default:
      return <MySQLIcon className="driverLogo" />;
  }
}

function ConnectionStatus({ status, driver }) {
  return (
    <span className="connectionStatus">
      <StatusDot status={status} />
      {status === "connected" ? driverLabel(driver) : connectionLabel(status)}
    </span>
  );
}

function SqlEditor({ value, onChange, detail, editorRef }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    if (!containerRef.current) return;

    const dialect = detail?.driver === "mysql" ? MySQL : PostgreSQL;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          sql({ dialect }),
          autocompletion({
            activateOnTyping: true,
            override: [
              detail?.driver === "redis" || detail?.driver === "elasticsearch"
                ? createBackendCompletionSource(detail)
                : createSqlCompletionSource(detail)
            ],
          }),
          keymap.of([
            ...completionKeymap,
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            valueRef.current = next;
            onChangeRef.current(next);
          }),
        ],
      }),
    });

    viewRef.current = view;
    editorRef.current = { focus: () => view.focus() };

    return () => {
      if (editorRef.current?.focus) editorRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
  }, [detail, editorRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="sqlEditor" ref={containerRef} />;
}

function ConnectionForm({ draft, setDraft }) {
  const connectionInputProps = {
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
  };

  function patch(value) {
    const next = { ...draft, ...value };
    if (value.driver && !draft.id) next.port = defaultPort(value.driver);
    setDraft(next);
  }
  return (
    <div className="form">
      <label style={{ gridColumn: "span 2" }}>
        Name
        <input
          {...connectionInputProps}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label style={{ gridColumn: "span 2" }}>
        Driver
        <div className="driverGrid">
          {[
            { id: "mysql", name: "MySQL" },
            { id: "postgres", name: "PostgreSQL" },
            { id: "redis", name: "Redis" },
            { id: "elasticsearch", name: "Elasticsearch" },
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              className={`driverOption ${draft.driver === d.id ? "active" : ""}`}
              onClick={() => patch({ driver: d.id })}
            >
              <DriverLogo driver={d.id} />
              <span>{d.name}</span>
            </button>
          ))}
        </div>
      </label>
      <label>
        Host
        <input
          {...connectionInputProps}
          value={draft.host}
          onChange={(e) => patch({ host: e.target.value })}
        />
      </label>
      <label>
        Port
        <input
          {...connectionInputProps}
          type="number"
          value={draft.port}
          onChange={(e) => patch({ port: Number(e.target.value) })}
        />
      </label>
      <label>
        {draft.driver === "redis" ? "Database index" : "Database"}
        <input
          {...connectionInputProps}
          value={draft.database}
          onChange={(e) => patch({ database: e.target.value })}
        />
      </label>
      <label>
        User
        <input
          {...connectionInputProps}
          value={draft.user}
          onChange={(e) => patch({ user: e.target.value })}
        />
      </label>
      <label>
        Password
        <input
          {...connectionInputProps}
          type="password"
          value={draft.password || ""}
          onChange={(e) => patch({ password: e.target.value })}
        />
      </label>
      {draft.driver === "postgres" ? (
        <label>
          SSL mode
          <select
            value={draft.sslMode || "disable"}
            onChange={(e) => patch({ sslMode: e.target.value })}
          >
            <option>disable</option>
            <option>require</option>
            <option>verify-ca</option>
            <option>verify-full</option>
          </select>
        </label>
      ) : (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!draft.useTLS}
            onChange={(e) => patch({ useTLS: e.target.checked })}
          />{" "}
          {draft.driver === "elasticsearch" ? "HTTPS" : "TLS"}
        </label>
      )}
    </div>
  );
}

function SettingsPanel({ shortcuts, setShortcuts }) {
  return (
    <section className="panel settingsPanel">
      <div className="panelHead">
        <h2>
          <KeyRound size={16} /> Shortcuts
        </h2>
      </div>
      <div className="settingsGrid">
        {Object.entries(shortcuts).map(([key, value]) => (
          <label key={key}>
            {key}
            <input
              value={value}
              onChange={(e) =>
                setShortcuts({ ...shortcuts, [key]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function SavedQueries({ queries, onOpen }) {
  return (
    <div className="savedQueries">
      <h3>Stored Query</h3>
      {queries.map((query) => (
        <button key={query.id} onClick={() => onOpen(query)}>
          <span>{query.name}</span>
          <small>{new Date(query.updatedAt).toLocaleString()}</small>
        </button>
      ))}
    </div>
  );
}

function TableInspector({ detail }) {
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
        <h2>Create Table</h2>
        <pre>{detail.createSql}</pre>
      </div>
    </section>
  );
}

function ResultPanel({ title, result }) {
  const [selectedRow, setSelectedRow] = useState(null);
  if (!result) return null;
  const isExplain = title.toLowerCase().includes("explain");

  return (
    <section className="panel resultPanel">
      <div className="panelHead">
        <h2>{title}</h2>
        <span>
          {result.durationMs ?? 0}ms{" "}
          {result.message ? `· ${result.message}` : ""}
        </span>
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
                    <td key={column}>{row[column]}</td>
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

function TraceLogPage({ connection }) {
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
              <span>Source</span>
              <strong>{event.position || "log text"}</strong>
            </div>
          </div>
          <h3>SQL</h3>
          <pre>{event.sql}</pre>
        </div>
      </section>
    </div>
  );
}

function RowDetailModal({ title, row, isExplain, onClose }) {
  const entries = Object.entries(row || {});
  const fullText = entries.map(([key, value]) => `${key}\n${value}`).join("\n\n");
  const planNodes = isExplain ? parseExplainPlan(fullText) : [];

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="modalPanel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHead">
          <h2>{title}</h2>
          <button title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {isExplain && (
          <div className="planFlow">
            <h3>Plan Flow</h3>
            {planNodes.length ? (
              <div className="planNodes">
                {planNodes.map((node, index) => (
                  <div
                    key={`${node.label}-${index}`}
                    className="planNode"
                    style={{ marginLeft: `${Math.min(node.depth, 6) * 18}px` }}
                  >
                    <strong>{node.label}</strong>
                    {node.detail && <small>{node.detail}</small>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No plan operators detected</p>
            )}
          </div>
        )}

        <div className="rowDetail">
          <h3>Full Row</h3>
          <pre>{fullText}</pre>
        </div>
      </section>
    </div>
  );
}

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

function parseTraceEvents(text) {
  const source = String(text || "");
  if (!source.trim()) return [];
  const statements = collectTraceStatements(source);

  return statements
    .map((statement, index) => parseTraceStatement(statement, index))
    .filter(Boolean);
}

function collectTraceStatements(source) {
  if (!source.includes("\n")) {
    return source
      .split(/;\s*/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  const lines = source.split(/\r?\n/);
  const statements = [];
  let pendingMetadata = [];
  let current = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const startsDml = /^\s*(insert|update|delete)\b/i.test(line);
    const isMetadata =
      !current.length &&
      (trimmed.startsWith("#") ||
        trimmed.startsWith("/*!") ||
        /^set\s+timestamp=/i.test(trimmed) ||
        /^use\s+/i.test(trimmed) ||
        /^delimiter\s+/i.test(trimmed));

    if (!startsDml && isMetadata) {
      pendingMetadata.push(line);
      continue;
    }

    if (startsDml && !current.length) {
      current = [...pendingMetadata, line];
      pendingMetadata = [];
    } else if (current.length) {
      current.push(line);
    } else if (/\b(insert|update|delete)\b/i.test(line)) {
      current = [line];
    } else {
      pendingMetadata = [];
    }

    if (current.length && /;\s*$/.test(line)) {
      statements.push(current.join("\n").trim());
      current = [];
    }
  }

  if (current.length) statements.push(current.join("\n").trim());

  if (!statements.length) {
    return source
      .split(/;\s*/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  return statements;
}

function parseTraceStatement(statement, index) {
  const actionMatch = statement.match(/\b(insert|update|delete)\b/i);
  if (!actionMatch) return null;

  const action = actionMatch[1].toUpperCase();
  const sql = stripBinlogMetadata(statement).trim().replace(/;+$/, "") + ";";
  const table = extractTraceTable(sql, action);
  const timestamp = extractTraceTimestamp(statement);
  const position = extractTracePosition(statement);

  return {
    id: `${index}-${action}-${table}`,
    action,
    table,
    sql,
    position,
    timestampLabel: timestamp || `event ${index + 1}`,
    summary: summarizeSql(sql),
  };
}

function stripBinlogMetadata(statement) {
  return statement
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("/*!") &&
        !/^set\s+timestamp=/i.test(trimmed) &&
        !/^use\s+/i.test(trimmed) &&
        !/^delimiter\s+/i.test(trimmed)
      );
    })
    .join("\n");
}

function extractTraceTable(sql, action) {
  const tablePattern = "([`\"\\w.-]+)";
  const patterns = {
    INSERT: new RegExp(`\\binsert\\s+(?:ignore\\s+)?into\\s+${tablePattern}`, "i"),
    UPDATE: new RegExp(`\\bupdate\\s+${tablePattern}`, "i"),
    DELETE: new RegExp(`\\bdelete\\s+from\\s+${tablePattern}`, "i"),
  };
  const match = sql.match(patterns[action]);
  return cleanTraceTable(match?.[1] || "unknown");
}

function cleanTraceTable(value) {
  return String(value || "unknown").replace(/^[`"]|[`"]$/g, "");
}

function extractTraceTimestamp(statement) {
  const unixMatch = statement.match(/\bset\s+timestamp=(\d+)/i);
  if (unixMatch) {
    const date = new Date(Number(unixMatch[1]) * 1000);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  const mysqlbinlogMatch = statement.match(/#(\d{6}\s+\d{1,2}:\d{2}:\d{2})/);
  if (mysqlbinlogMatch) return mysqlbinlogMatch[1];
  const isoMatch = statement.match(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\b/);
  return isoMatch?.[0] || "";
}

function extractTracePosition(statement) {
  const atMatch = statement.match(/#\s+at\s+(\d+)/i);
  if (atMatch) return `binlog position ${atMatch[1]}`;
  const serverMatch = statement.match(/\bend_log_pos\s+(\d+)/i);
  if (serverMatch) return `end log position ${serverMatch[1]}`;
  return "";
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

function eventCombo(event) {
  const parts = [];
  if (event.metaKey) parts.push("Meta");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key =
    event.key === " "
      ? "Space"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key;
  parts.push(key);
  return parts.join("+");
}

function createBackendCompletionSource(detail) {
  return async (context) => {
    const word = context.matchBefore(/[\w_$-]*/);
    if (!context.explicit && !word) return null;

    const pos = context.pos;
    const text = context.state.sliceDoc(0, pos);
    
    let items;
    try {
      items = await api.call("GetCompletions", detail?.id || "", detail?.database || "", text, pos);
    } catch (err) {
      console.error("Autocomplete error:", err);
      return null;
    }
    
    if (!items || !items.length) return null;

    return {
      from: word ? word.from : context.pos,
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: item.type,
        apply: item.apply,
      })),
      validFor: /^[\w_$-]*$/,
    };
  };
}

function createSqlCompletionSource(detail) {
  return (context) => {
    const beforeCursor = context.state.sliceDoc(0, context.pos);
    const word = context.matchBefore(/[A-Za-z_][\w$]*/);
    const tableContext = getSqlContext(beforeCursor);

    if (!context.explicit && !word && tableContext !== "table") {
      return null;
    }

    return {
      from: word ? word.from : context.pos,
      options:
        tableContext === "table"
          ? tableCompletionOptions(detail)
          : sqlCompletions,
      validFor: /^[\w$]*$/,
    };
  };
}

function getSqlContext(beforeCursor) {
  const normalized = beforeCursor.toLowerCase();
  if (/\b(from|join|update|into|table)\s+(?:"[^"]*"?|`[^`]*`?|[\w.$]*)$/.test(normalized)) {
    return "table";
  }
  return "syntax";
}

function tableCompletionOptions(detail) {
  const tables = detail?.tables || demoTables;
  return tables
    .map((table) => ({
      label: table.name,
      detail: `${table.schema} ${table.type || "table"}`,
      apply: quoteName(detail?.driver, table.schema, table.name),
      type: "class",
    }));
}

function normalizeObjectType(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("view")) return "view";
  return "table";
}

function databaseKey(name) {
  return `database:${name}`;
}

function defaultPort(driver) {
  if (driver === "postgres") return 5432;
  if (driver === "redis") return 6379;
  if (driver === "elasticsearch") return 9200;
  return 3306;
}

function driverLabel(driver) {
  if (driver === "postgres") return "PostgreSQL";
  if (driver === "redis") return "Redis";
  if (driver === "elasticsearch") return "Elasticsearch";
  return "MySQL";
}

function isLocalConnection(conn) {
  return ["localhost", "127.0.0.1", "::1"].includes(
    String(conn.host || "").toLowerCase(),
  );
}

function connectionLabel(status) {
  if (status === "connecting") return "connecting";
  if (status === "connected") return "connected";
  if (status === "error") return "error";
  return "not connected";
}

function parseExplainPlan(text) {
  return String(text || "")
    .split(/\n|->/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const depth = Math.max(0, (line.match(/^\s*/)?.[0]?.length || 0) / 2);
      const clean = line.replace(/^[-|> ]+/, "").trim();
      const costIndex = clean.search(/\b\(cost=|\(actual time=|\(cost:/i);
      const label = costIndex > 0 ? clean.slice(0, costIndex).trim() : clean;
      const detail = costIndex > 0 ? clean.slice(costIndex).trim() : "";
      return { depth, label, detail };
    })
    .filter((node) => node.label && !/^(explain|query plan)$/i.test(node.label));
}

function quoteName(driver, schema, table) {
  if (driver === "mysql") return `\`${table}\``;
  return `"${schema}"."${table}"`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatCompactCount(value) {
  const number = Number(value || 0);
  if (!number) return "";
  if (number >= 1_000_000) return `${stripTrailingZero(number / 1_000_000)}M`;
  if (number >= 1_000) return `${stripTrailingZero(number / 1_000)}K`;
  return String(number);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${stripTrailingZero(bytes / 1024 ** 3)}G`;
  if (bytes >= 1024 ** 2) return `${stripTrailingZero(bytes / 1024 ** 2)}M`;
  if (bytes >= 1024) return `${stripTrailingZero(bytes / 1024)}K`;
  return `${bytes}B`;
}

function stripTrailingZero(value) {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
}

function totalRows(tables) {
  return tables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
}

createRoot(document.getElementById("root")).render(<App />);
