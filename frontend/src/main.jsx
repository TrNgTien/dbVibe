import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Database,
  KeyRound,
  ListTree,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Table2,
  Trash2,
} from 'lucide-react';
import './styles.css';

const defaultConnection = {
  id: '',
  name: '',
  driver: 'postgres',
  host: 'localhost',
  port: 5432,
  database: '',
  user: '',
  password: '',
  sslMode: 'disable',
  useTLS: false,
};

const defaultShortcuts = {
  execute: 'Meta+Enter',
  explain: 'Meta+Shift+Enter',
  saveQuery: 'Meta+S',
  focusEditor: 'Meta+K',
};

const sampleConnections = [
  { id: 'demo-pg', name: 'Local Postgres', driver: 'postgres', host: 'localhost', port: 5432, database: 'app', user: 'postgres', sslMode: 'disable' },
  { id: 'demo-my', name: 'Local MySQL', driver: 'mysql', host: 'localhost', port: 3306, database: 'app', user: 'root', useTLS: false },
];

const demoTables = [
  { schema: 'public', name: 'users', type: 'table', rows: 1248 },
  { schema: 'public', name: 'orders', type: 'table', rows: 44819 },
  { schema: 'public', name: 'billing_sessions', type: 'table', rows: 76 },
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
  if (name === 'ListConnections') return sampleConnections;
  if (name === 'SaveConnection') return { ...args[0], id: args[0].id || `demo-${Date.now()}` };
  if (name === 'DeleteConnection') return null;
  if (name === 'TestConnection') return null;
  if (name === 'Connect') return { driver: 'postgres', database: 'app', tables: demoTables };
  if (name === 'ListSavedQueries') return [
    { id: 'q1', connectionId: args[0], name: 'Slow users lookup', sql: 'select * from users where email like $1 limit 100', updatedAt: '2026-05-29T08:00:00Z' },
  ];
  if (name === 'SaveQuery') return { ...args[0], id: args[0].id || `q-${Date.now()}`, updatedAt: new Date().toISOString() };
  if (name === 'DeleteQuery') return null;
  if (name === 'GetTableDetail') return {
    table: { schema: args[1], name: args[2], type: 'table', rows: 1248 },
    columns: [
      { name: 'id', type: 'bigint', nullable: false, default: "nextval('users_id_seq')", ordinal: 1 },
      { name: 'email', type: 'text', nullable: false, default: '', ordinal: 2 },
      { name: 'created_at', type: 'timestamp', nullable: false, default: 'now()', ordinal: 3 },
    ],
    indexes: [
      { name: 'users_pkey', columns: 'id', unique: true, sql: 'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)' },
      { name: 'users_email_idx', columns: 'email', unique: true, sql: 'CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)' },
    ],
    createSql: 'create table "public"."users" (\n  "id" bigint not null,\n  "email" text not null,\n  "created_at" timestamp not null default now()\n);',
    sample: {
      columns: ['id', 'email', 'created_at'],
      rows: [
        { id: '1', email: 'tien@example.com', created_at: '2026-05-29 08:00:00' },
        { id: '2', email: 'dev@example.com', created_at: '2026-05-29 08:01:00' },
      ],
      durationMs: 12,
    },
  };
  if (name === 'ExplainAnalyze') return {
    columns: ['QUERY PLAN'],
    rows: [
      { 'QUERY PLAN': 'Index Scan using users_email_idx on users  (cost=0.28..8.30 rows=1 width=80) (actual time=0.018..0.020 rows=1 loops=1)' },
      { 'QUERY PLAN': 'Planning Time: 0.110 ms' },
      { 'QUERY PLAN': 'Execution Time: 0.041 ms' },
    ],
    durationMs: 41,
  };
  if (name === 'Execute') return {
    columns: ['id', 'email', 'created_at'],
    rows: [
      { id: '1', email: 'tien@example.com', created_at: '2026-05-29 08:00:00' },
      { id: '2', email: 'dev@example.com', created_at: '2026-05-29 08:01:00' },
    ],
    durationMs: 18,
    message: 'Demo result. Run inside Wails to connect real databases.',
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
  const [sqlText, setSqlText] = useState('select * from ');
  const [result, setResult] = useState(null);
  const [explain, setExplain] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [vimMode, setVimMode] = useLocalStorage('tnt-sql-vim', true);
  const [commandMode, setCommandMode] = useState(false);
  const [shortcuts, setShortcuts] = useLocalStorage('tnt-sql-shortcuts', defaultShortcuts);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    refreshConnections();
  }, []);

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
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, sqlText, selected]);

  const filteredTables = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!detail?.tables) return [];
    if (!term) return detail.tables;
    return detail.tables.filter((table) => `${table.schema}.${table.name}`.toLowerCase().includes(term));
  }, [detail, filter]);

  async function run(label, action) {
    setLoading(label);
    setError('');
    try {
      return await action();
    } catch (err) {
      setError(err?.message || String(err));
      throw err;
    } finally {
      setLoading('');
    }
  }

  async function refreshConnections() {
    const items = await run('connections', () => api.call('ListConnections'));
    setConnections(items || []);
    if (!selected && items?.length) {
      setSelected(items[0]);
      setDraft({ ...defaultConnection, ...items[0] });
    }
  }

  async function saveConnection() {
    const saved = await run('save connection', () => api.call('SaveConnection', draft));
    await refreshConnections();
    setSelected(saved);
    setDraft({ ...defaultConnection, ...saved });
  }

  async function deleteConnection() {
    if (!draft.id) return;
    await run('delete connection', () => api.call('DeleteConnection', draft.id));
    setSelected(null);
    setDraft(defaultConnection);
    setDetail(null);
    setTableDetail(null);
    await refreshConnections();
  }

  async function testConnection() {
    await run('test connection', () => api.call('TestConnection', draft));
  }

  async function connect(conn = selected) {
    if (!conn?.id) return;
    const next = await run('connect', () => api.call('Connect', conn.id));
    const savedQueries = await api.call('ListSavedQueries', conn.id);
    setDetail(next);
    setQueries(savedQueries || []);
    setTableDetail(null);
  }

  async function openTable(table) {
    if (!selected?.id) return;
    const next = await run('table detail', () => api.call('GetTableDetail', selected.id, table.schema, table.name, 100));
    setTableDetail(next);
    setResult(next.sample);
    setSqlText(`select * from ${quoteName(detail?.driver, table.schema, table.name)} limit 100`);
  }

  async function execute() {
    if (!selected?.id) return;
    const next = await run('execute', () => api.call('Execute', selected.id, sqlText, 500));
    setResult(next);
  }

  async function explainAnalyze() {
    if (!selected?.id) return;
    const next = await run('explain', () => api.call('ExplainAnalyze', selected.id, sqlText));
    setExplain(next);
  }

  async function saveCurrentQuery() {
    if (!selected?.id || !sqlText.trim()) return;
    const name = sqlText.trim().split('\n')[0].slice(0, 64);
    await run('save query', () => api.call('SaveQuery', { connectionId: selected.id, name, sql: sqlText }));
    setQueries(await api.call('ListSavedQueries', selected.id));
  }

  function selectConnection(conn) {
    setSelected(conn);
    setDraft({ ...defaultConnection, ...conn });
    setDetail(null);
    setTableDetail(null);
    setResult(null);
    setExplain(null);
  }

  function onEditorKeyDown(event) {
    if (!vimMode) return;
    if (event.key === 'Escape') {
      setCommandMode(true);
      event.currentTarget.blur();
      event.preventDefault();
      return;
    }
    if (!commandMode) return;
    if (event.key === 'i') {
      setCommandMode(false);
      editorRef.current?.focus();
      event.preventDefault();
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Database size={22} />
          <div>
            <strong>TNT SQL</strong>
            <span>MySQL / PostgreSQL</span>
          </div>
        </div>
        <button className="primary" onClick={() => { setSelected(null); setDraft(defaultConnection); setDetail(null); }}>
          <Plus size={16} /> New connection
        </button>
        <div className="connectionList">
          {connections.map((conn) => (
            <button key={conn.id} className={selected?.id === conn.id ? 'connection active' : 'connection'} onClick={() => selectConnection(conn)}>
              <span>{conn.name}</span>
              <small>{conn.driver} · {conn.host}:{conn.port}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{selected?.name || 'Dashboard'}</h1>
            <p>{selected ? `${selected.driver}://${selected.host}:${selected.port}/${selected.database}` : 'Stored connections and query workspace'}</p>
          </div>
          <div className="actions">
            <button title="Settings" onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={16} /></button>
            <button title="Refresh" onClick={() => selected ? connect(selected) : refreshConnections()}><RefreshCw size={16} /></button>
            <button className="primary" onClick={() => connect()} disabled={!selected?.id}><Database size={16} /> Connect</button>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {loading && <div className="loading">Running {loading}...</div>}

        {settingsOpen && <SettingsPanel shortcuts={shortcuts} setShortcuts={setShortcuts} vimMode={vimMode} setVimMode={setVimMode} />}

        <section className="grid">
          <section className="panel connectionPanel">
            <div className="panelHead">
              <h2>Connection Detail</h2>
              <div className="rowActions">
                <button onClick={testConnection}><Activity size={15} /> Test</button>
                <button onClick={saveConnection}><Save size={15} /> Save</button>
                <button onClick={deleteConnection} disabled={!draft.id}><Trash2 size={15} /></button>
              </div>
            </div>
            <ConnectionForm draft={draft} setDraft={setDraft} />
          </section>

          <section className="panel queryPanel">
            <div className="panelHead">
              <h2>Command</h2>
              <div className="rowActions">
                <span className={vimMode ? 'mode enabled' : 'mode'}>{vimMode ? (commandMode ? 'VIM NORMAL' : 'VIM INSERT') : 'VIM OFF'}</span>
                <button onClick={saveCurrentQuery}><Save size={15} /> Query</button>
                <button onClick={explainAnalyze}><Activity size={15} /> Explain</button>
                <button className="primary" onClick={execute}><Play size={15} /> Run</button>
              </div>
            </div>
            <textarea
              ref={editorRef}
              value={sqlText}
              onChange={(event) => setSqlText(event.target.value)}
              onFocus={() => setCommandMode(false)}
              onKeyDown={onEditorKeyDown}
              spellCheck="false"
            />
          </section>
        </section>

        <section className="workspace">
          <aside className="panel objectPanel">
            <div className="panelHead compact">
              <h2><ListTree size={16} /> Objects</h2>
            </div>
            <label className="search">
              <Search size={15} />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter tables" />
            </label>
            <div className="tableList">
              {filteredTables.map((table) => (
                <button key={`${table.schema}.${table.name}`} onClick={() => openTable(table)} className={tableDetail?.table?.name === table.name ? 'tableItem active' : 'tableItem'}>
                  <Table2 size={15} />
                  <span>{table.name}</span>
                  <small>{table.schema} · {formatNumber(table.rows)}</small>
                </button>
              ))}
            </div>
            <SavedQueries queries={queries} onOpen={(query) => setSqlText(query.sql)} />
          </aside>

          <section className="content">
            {tableDetail && <TableInspector detail={tableDetail} />}
            <ResultPanel title="Rows" result={result} />
            <ResultPanel title="Explain Analyze" result={explain} />
          </section>
        </section>
      </main>
    </div>
  );
}

function ConnectionForm({ draft, setDraft }) {
  function patch(value) {
    const next = { ...draft, ...value };
    if (value.driver === 'postgres' && !draft.id) next.port = 5432;
    if (value.driver === 'mysql' && !draft.id) next.port = 3306;
    setDraft(next);
  }
  return (
    <div className="form">
      <label>Name<input value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></label>
      <label>Driver<select value={draft.driver} onChange={(e) => patch({ driver: e.target.value })}><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option></select></label>
      <label>Host<input value={draft.host} onChange={(e) => patch({ host: e.target.value })} /></label>
      <label>Port<input type="number" value={draft.port} onChange={(e) => patch({ port: Number(e.target.value) })} /></label>
      <label>Database<input value={draft.database} onChange={(e) => patch({ database: e.target.value })} /></label>
      <label>User<input value={draft.user} onChange={(e) => patch({ user: e.target.value })} /></label>
      <label>Password<input type="password" value={draft.password || ''} onChange={(e) => patch({ password: e.target.value })} /></label>
      {draft.driver === 'postgres' ? (
        <label>SSL mode<select value={draft.sslMode || 'disable'} onChange={(e) => patch({ sslMode: e.target.value })}><option>disable</option><option>require</option><option>verify-ca</option><option>verify-full</option></select></label>
      ) : (
        <label className="checkbox"><input type="checkbox" checked={!!draft.useTLS} onChange={(e) => patch({ useTLS: e.target.checked })} /> TLS</label>
      )}
    </div>
  );
}

function SettingsPanel({ shortcuts, setShortcuts, vimMode, setVimMode }) {
  return (
    <section className="panel settingsPanel">
      <div className="panelHead"><h2><KeyRound size={16} /> Shortcuts</h2></div>
      <div className="settingsGrid">
        {Object.entries(shortcuts).map(([key, value]) => (
          <label key={key}>{key}<input value={value} onChange={(e) => setShortcuts({ ...shortcuts, [key]: e.target.value })} /></label>
        ))}
        <label className="checkbox"><input type="checkbox" checked={vimMode} onChange={(e) => setVimMode(e.target.checked)} /> Vim mode</label>
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
              <small>{column.nullable ? 'nullable' : 'not null'} {column.default ? `· ${column.default}` : ''}</small>
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
              <span>{index.unique ? 'unique' : 'index'} {index.columns}</span>
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
  if (!result) return null;
  return (
    <section className="panel resultPanel">
      <div className="panelHead">
        <h2>{title}</h2>
        <span>{result.durationMs ?? 0}ms {result.message ? `· ${result.message}` : ''}</span>
      </div>
      {result.columns?.length ? (
        <div className="resultScroll">
          <table>
            <thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {(result.rows || []).map((row, index) => (
                <tr key={index}>{result.columns.map((column) => <td key={column}>{row[column]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">{result.message || `${result.rowsAffected || 0} rows affected`}</p>}
    </section>
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

function eventCombo(event) {
  const parts = [];
  if (event.metaKey) parts.push('Meta');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

function quoteName(driver, schema, table) {
  if (driver === 'mysql') return `\`${table}\``;
  return `"${schema}"."${table}"`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

createRoot(document.getElementById('root')).render(<App />);
