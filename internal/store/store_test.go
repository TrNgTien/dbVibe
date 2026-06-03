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
