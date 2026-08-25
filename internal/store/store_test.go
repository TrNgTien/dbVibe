package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	return &Store{
		appName:  "test",
		path:     filepath.Join(dir, "store.json"),
		queryDir: filepath.Join(dir, "queries"),
	}
}

func TestSaveAndDeleteQueryFile(t *testing.T) {
	s := newTestStore(t)
	query, err := s.SaveQuery(SavedQuery{
		ConnectionID: "connection-1",
		Name:         "Users",
		SQL:          "select * from users",
	})
	if err != nil {
		t.Fatalf("SaveQuery() error = %v", err)
	}

	if _, err := os.Stat(s.queryPath(query.ID)); err != nil {
		t.Fatalf("saved query file missing: %v", err)
	}

	queries, err := s.ListQueries("connection-1")
	if err != nil {
		t.Fatalf("ListQueries() error = %v", err)
	}
	if len(queries) != 1 || queries[0].ID != query.ID {
		t.Fatalf("ListQueries() = %#v, want saved query %q", queries, query.ID)
	}

	if err := s.DeleteQuery(query.ID); err != nil {
		t.Fatalf("DeleteQuery() error = %v", err)
	}
	if _, err := os.Stat(s.queryPath(query.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("query file still exists, stat error = %v", err)
	}
	if err := s.DeleteQuery(query.ID); err == nil {
		t.Fatal("DeleteQuery() missing query error = nil")
	}
}

func TestSaveQueryUpsertsByName(t *testing.T) {
	s := newTestStore(t)
	first, err := s.SaveQuery(SavedQuery{
		ConnectionID: "connection-1",
		Name:         "Users",
		SQL:          "select 1",
	})
	if err != nil {
		t.Fatalf("SaveQuery() error = %v", err)
	}

	second, err := s.SaveQuery(SavedQuery{
		ConnectionID: "connection-1",
		Name:         "Users",
		SQL:          "select 2",
	})
	if err != nil {
		t.Fatalf("SaveQuery() error = %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("upsert ID = %q, want %q", second.ID, first.ID)
	}

	queries, err := s.ListQueries("connection-1")
	if err != nil {
		t.Fatalf("ListQueries() error = %v", err)
	}
	if len(queries) != 1 {
		t.Fatalf("ListQueries() = %d queries, want 1", len(queries))
	}
	if queries[0].SQL != "select 2" {
		t.Fatalf("ListQueries() SQL = %q, want %q", queries[0].SQL, "select 2")
	}
}

func TestSaveQueryMigratesLegacyStoreEntry(t *testing.T) {
	s := newTestStore(t)
	legacy := SavedQuery{
		ID:           "legacy-query",
		ConnectionID: "connection-1",
		Name:         "Legacy",
		SQL:          "select 1",
		UpdatedAt:    "2026-01-01T00:00:00Z",
	}
	writeTestData(t, s, dataFile{Queries: []SavedQuery{legacy}})

	legacy.SQL = "select 2"
	saved, err := s.SaveQuery(legacy)
	if err != nil {
		t.Fatalf("SaveQuery() error = %v", err)
	}
	if saved.SQL != "select 2" {
		t.Fatalf("SaveQuery() SQL = %q, want %q", saved.SQL, "select 2")
	}

	data, err := s.read()
	if err != nil {
		t.Fatalf("read() error = %v", err)
	}
	if len(data.Queries) != 0 {
		t.Fatalf("legacy queries = %#v, want none", data.Queries)
	}

	queries, err := s.ListQueries("connection-1")
	if err != nil {
		t.Fatalf("ListQueries() error = %v", err)
	}
	if len(queries) != 1 || queries[0].SQL != "select 2" {
		t.Fatalf("ListQueries() = %#v, want migrated query", queries)
	}
}

func TestDeleteConnectionDeletesQueryFiles(t *testing.T) {
	s := newTestStore(t)
	query, err := s.SaveQuery(SavedQuery{
		ConnectionID: "connection-1",
		SQL:          "select 1",
	})
	if err != nil {
		t.Fatalf("SaveQuery() error = %v", err)
	}

	if err := s.DeleteConnection("connection-1"); err != nil {
		t.Fatalf("DeleteConnection() error = %v", err)
	}
	if _, err := os.Stat(s.queryPath(query.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("query file still exists, stat error = %v", err)
	}
}

func TestSaveConnectionBinlogEndpoint(t *testing.T) {
	s := newTestStore(t)

	saved, err := s.SaveConnection(Connection{
		Name:       "ProxySQL",
		Driver:     "mysql",
		Host:       "proxysql.example.internal",
		Port:       3306,
		BinlogHost: " mysql-primary.example.internal ",
	})
	if err != nil {
		t.Fatalf("SaveConnection() error = %v", err)
	}
	if saved.BinlogHost != "mysql-primary.example.internal" || saved.BinlogPort != 3306 {
		t.Fatalf("SaveConnection() binlog endpoint = %s:%d", saved.BinlogHost, saved.BinlogPort)
	}
}

func TestAISettingsRoundTrip(t *testing.T) {
	s := newTestStore(t)

	loaded, err := s.LoadAISettings()
	if err != nil {
		t.Fatalf("LoadAISettings() error = %v", err)
	}
	if loaded.Provider != "openai" {
		t.Fatalf("default provider = %q, want openai", loaded.Provider)
	}

	settings := AISettings{
		Provider: "ollama",
		APIKey:   "  ",
		BaseURL:  " http://localhost:11434/v1 ",
		Model:    " llama3.2 ",
	}
	saved, err := s.SaveAISettings(settings)
	if err != nil {
		t.Fatalf("SaveAISettings() error = %v", err)
	}
	if saved.Provider != "ollama" || saved.BaseURL != "http://localhost:11434/v1" || saved.Model != "llama3.2" {
		t.Fatalf("SaveAISettings() = %#v, want trimmed values", saved)
	}

	loaded, err = s.LoadAISettings()
	if err != nil {
		t.Fatalf("LoadAISettings() error = %v", err)
	}
	if loaded.Model != "llama3.2" {
		t.Fatalf("LoadAISettings() model = %q, want llama3.2", loaded.Model)
	}

	query, err := s.SaveQuery(SavedQuery{ConnectionID: "connection-1", SQL: "select 1"})
	if err != nil {
		t.Fatalf("SaveQuery() error = %v", err)
	}
	if err := s.DeleteQuery(query.ID); err != nil {
		t.Fatalf("DeleteQuery() error = %v", err)
	}
	loaded, err = s.LoadAISettings()
	if err != nil {
		t.Fatalf("LoadAISettings() error = %v", err)
	}
	if loaded.Model != "llama3.2" {
		t.Fatalf("AI settings lost after query write, model = %q", loaded.Model)
	}
}

func TestWorkspaceExportImport(t *testing.T) {
	s := newTestStore(t)

	ws, err := s.SaveWorkspace(Workspace{Name: "Production"})
	if err != nil {
		t.Fatalf("SaveWorkspace() error = %v", err)
	}
	conn, err := s.SaveConnection(Connection{
		Name:        "prod-db",
		Driver:      "mysql",
		Host:        "db.example.com",
		Port:        3306,
		User:        "root",
		Password:    "secret",
		WorkspaceID: ws.ID,
	})
	if err != nil {
		t.Fatalf("SaveConnection() error = %v", err)
	}

	exported, err := s.ExportWorkspace(ws.ID)
	if err != nil {
		t.Fatalf("ExportWorkspace() error = %v", err)
	}
	var exp WorkspaceExport
	if err := json.Unmarshal(exported, &exp); err != nil {
		t.Fatalf("unmarshal export error = %v", err)
	}
	if exp.Workspace.ID != ws.ID || len(exp.Connections) != 1 {
		t.Fatalf("export = %#v, want workspace %q with 1 connection", exp, ws.ID)
	}
	if exp.Connections[0].Password != "secret" {
		t.Fatalf("exported password = %q, want secret", exp.Connections[0].Password)
	}

	imported, err := s.ImportWorkspace(exported)
	if err != nil {
		t.Fatalf("ImportWorkspace() error = %v", err)
	}
	if imported.ID == ws.ID || imported.ID == "" {
		t.Fatalf("imported workspace ID = %q, want new ID", imported.ID)
	}
	if imported.Name != ws.Name+" (copy)" {
		t.Fatalf("first import name = %q, want %q", imported.Name, ws.Name+" (copy)")
	}
	second, err := s.ImportWorkspace(exported)
	if err != nil {
		t.Fatalf("second ImportWorkspace() error = %v", err)
	}
	if second.Name != ws.Name+" (copy) 2" {
		t.Fatalf("duplicate import name = %q, want %q", second.Name, ws.Name+" (copy) 2")
	}
	conns, err := s.ListConnections()
	if err != nil {
		t.Fatalf("ListConnections() error = %v", err)
	}
	if len(conns) != 3 {
		t.Fatalf("connections = %d, want 3 (original + 2 imports)", len(conns))
	}
	importedConn, err := s.GetConnection(conns[1].ID)
	if err != nil {
		t.Fatalf("GetConnection() error = %v", err)
	}
	if importedConn.ID == conn.ID {
		t.Fatalf("imported connection reused original ID %q", conn.ID)
	}
	if importedConn.WorkspaceID != imported.ID {
		t.Fatalf("imported connection workspace = %q, want %q", importedConn.WorkspaceID, imported.ID)
	}
}

func TestDeleteWorkspaceCascades(t *testing.T) {
	s := newTestStore(t)

	ws, err := s.SaveWorkspace(Workspace{Name: "Production"})
	if err != nil {
		t.Fatalf("SaveWorkspace() error = %v", err)
	}
	conn, err := s.SaveConnection(Connection{
		Name:        "prod-db",
		Driver:      "mysql",
		Host:        "db.example.com",
		Port:        3306,
		WorkspaceID: ws.ID,
	})
	if err != nil {
		t.Fatalf("SaveConnection() error = %v", err)
	}

	if err := s.DeleteWorkspace(ws.ID); err != nil {
		t.Fatalf("DeleteWorkspace() error = %v", err)
	}
	workspaces, err := s.ListWorkspaces()
	if err != nil {
		t.Fatalf("ListWorkspaces() error = %v", err)
	}
	if len(workspaces) != 0 {
		t.Fatalf("workspaces = %d, want 0 after delete", len(workspaces))
	}
	if _, err := s.GetConnection(conn.ID); err == nil {
		t.Fatalf("connection %q still exists after workspace delete", conn.ID)
	}
}

func writeTestData(t *testing.T, s *Store, data dataFile) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	content, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if err := os.WriteFile(s.path, content, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}
