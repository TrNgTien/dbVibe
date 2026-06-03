package store

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type Connection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
	SSLMode  string `json:"sslMode"`
	UseTLS   bool   `json:"useTLS"`
	IsPinned bool   `json:"isPinned"`
}

type SavedQuery struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connectionId"`
	Name         string `json:"name"`
	SQL          string `json:"sql"`
	UpdatedAt    string `json:"updatedAt"`
}

type dataFile struct {
	Connections []Connection `json:"connections"`
	Queries     []SavedQuery `json:"queries"`
}

type Store struct {
	appName  string
	path     string
	queryDir string
}

func New(appName string) *Store {
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = "."
	}
	dir := filepath.Join(configDir, appName)
	return &Store{
		appName:  appName,
		path:     filepath.Join(dir, "store.json"),
		queryDir: filepath.Join(dir, "queries"),
	}
}

func (s *Store) ListConnections() ([]Connection, error) {
	data, err := s.read()
	if err != nil {
		return nil, err
	}
	slices.SortFunc(data.Connections, func(a, b Connection) int {
		if a.IsPinned != b.IsPinned {
			if a.IsPinned {
				return -1
			}
			return 1
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return data.Connections, nil
}

func (s *Store) GetConnection(id string) (Connection, error) {
	data, err := s.read()
	if err != nil {
		return Connection{}, err
	}
	for _, conn := range data.Connections {
		if conn.ID == id {
			return conn, nil
		}
	}
	return Connection{}, errors.New("connection not found")
}

func (s *Store) SaveConnection(conn Connection) (Connection, error) {
	conn.Name = strings.TrimSpace(conn.Name)
	conn.Driver = strings.TrimSpace(conn.Driver)
	conn.Host = strings.TrimSpace(conn.Host)
	conn.Database = strings.TrimSpace(conn.Database)
	conn.User = strings.TrimSpace(conn.User)
	conn.SSLMode = strings.TrimSpace(conn.SSLMode)
	if conn.Name == "" {
		return Connection{}, errors.New("connection name is required")
	}
	if !slices.Contains([]string{"mysql", "postgres", "redis", "elasticsearch", "mongodb"}, conn.Driver) {
		return Connection{}, errors.New("driver must be mysql, postgres, redis, elasticsearch, or mongodb")
	}
	if conn.Host == "" {
		return Connection{}, errors.New("host is required")
	}
	if conn.Port == 0 {
		switch conn.Driver {
		case "postgres":
			conn.Port = 5432
		case "mysql":
			conn.Port = 3306
		case "redis":
			conn.Port = 6379
		case "elasticsearch":
			conn.Port = 9200
		case "mongodb":
			conn.Port = 27017
		}
	}
	if conn.ID == "" {
		conn.ID = randomID()
	}
	data, err := s.read()
	if err != nil {
		return Connection{}, err
	}
	replaced := false
	for i := range data.Connections {
		if data.Connections[i].ID == conn.ID {
			data.Connections[i] = conn
			replaced = true
			break
		}
	}
	if !replaced {
		data.Connections = append(data.Connections, conn)
	}
	return conn, s.write(data)
}

func (s *Store) DeleteConnection(id string) error {
	data, err := s.read()
	if err != nil {
		return err
	}
	data.Connections = slices.DeleteFunc(data.Connections, func(conn Connection) bool {
		return conn.ID == id
	})
	data.Queries = slices.DeleteFunc(data.Queries, func(query SavedQuery) bool {
		return query.ConnectionID == id
	})
	if err := s.write(data); err != nil {
		return err
	}
	queries, err := s.readQueryFiles()
	if err != nil {
		return err
	}
	for _, query := range queries {
		if query.ConnectionID == id {
			if err := s.deleteQueryFile(query.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) ListQueries(connectionID string) ([]SavedQuery, error) {
	data, err := s.read()
	if err != nil {
		return nil, err
	}
	fileQueries, err := s.readQueryFiles()
	if err != nil {
		return nil, err
	}
	byID := make(map[string]SavedQuery, len(data.Queries)+len(fileQueries))
	for _, query := range data.Queries {
		byID[query.ID] = query
	}
	for _, query := range fileQueries {
		byID[query.ID] = query
	}
	queries := make([]SavedQuery, 0)
	for _, query := range byID {
		if query.ConnectionID == connectionID {
			queries = append(queries, query)
		}
	}
	slices.SortFunc(queries, func(a, b SavedQuery) int {
		return strings.Compare(b.UpdatedAt, a.UpdatedAt)
	})
	return queries, nil
}

func (s *Store) SaveQuery(query SavedQuery) (SavedQuery, error) {
	query.Name = strings.TrimSpace(query.Name)
	query.SQL = strings.TrimSpace(query.SQL)
	if query.ConnectionID == "" {
		return SavedQuery{}, errors.New("connection id is required")
	}
	if query.Name == "" {
		query.Name = firstLine(query.SQL)
	}
	if query.ID == "" {
		query.ID = randomID()
	}
	query.UpdatedAt = time.Now().Format(time.RFC3339)
	data, err := s.read()
	if err != nil {
		return SavedQuery{}, err
	}
	data.Queries = slices.DeleteFunc(data.Queries, func(existing SavedQuery) bool {
		return existing.ID == query.ID
	})
	if err := s.writeQueryFile(query); err != nil {
		return SavedQuery{}, err
	}
	return query, s.write(data)
}

func randomID() string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return time.Now().Format("20060102150405")
	}
	return hex.EncodeToString(bytes)
}

func (s *Store) DeleteQuery(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("query id is required")
	}
	data, err := s.read()
	if err != nil {
		return err
	}
	legacyCount := len(data.Queries)
	data.Queries = slices.DeleteFunc(data.Queries, func(query SavedQuery) bool {
		return query.ID == id
	})
	removedLegacy := len(data.Queries) != legacyCount
	removedFile, err := s.deleteQueryFileIfExists(id)
	if err != nil {
		return err
	}
	if !removedLegacy && !removedFile {
		return errors.New("query not found")
	}
	return s.write(data)
}

func (s *Store) AutoDeleteQueries(days int) error {
	if days <= 0 {
		return nil
	}
	data, err := s.read()
	if err != nil {
		return err
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	data.Queries = slices.DeleteFunc(data.Queries, func(query SavedQuery) bool {
		t, err := time.Parse(time.RFC3339, query.UpdatedAt)
		if err != nil {
			return false
		}
		return t.Before(cutoff)
	})
	if err := s.write(data); err != nil {
		return err
	}
	queries, err := s.readQueryFiles()
	if err != nil {
		return err
	}
	for _, query := range queries {
		t, err := time.Parse(time.RFC3339, query.UpdatedAt)
		if err == nil && t.Before(cutoff) {
			if err := s.deleteQueryFile(query.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) read() (dataFile, error) {
	content, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return dataFile{}, nil
	}
	if err != nil {
		return dataFile{}, err
	}
	var data dataFile
	if err := json.Unmarshal(content, &data); err != nil {
		return dataFile{}, err
	}
	return data, nil
}

func (s *Store) write(data dataFile) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create store directory: %w", err)
	}
	content, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal store: %w", err)
	}
	if err := os.WriteFile(s.path, content, 0o600); err != nil {
		return fmt.Errorf("write store: %w", err)
	}
	return nil
}

func (s *Store) readQueryFiles() ([]SavedQuery, error) {
	entries, err := os.ReadDir(s.queryDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read query directory: %w", err)
	}
	queries := make([]SavedQuery, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(s.queryDir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read query file %q: %w", entry.Name(), err)
		}
		var query SavedQuery
		if err := json.Unmarshal(content, &query); err != nil {
			return nil, fmt.Errorf("unmarshal query file %q: %w", entry.Name(), err)
		}
		queries = append(queries, query)
	}
	return queries, nil
}

func (s *Store) writeQueryFile(query SavedQuery) error {
	if err := os.MkdirAll(s.queryDir, 0o700); err != nil {
		return fmt.Errorf("create query directory: %w", err)
	}
	content, err := json.MarshalIndent(query, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal query: %w", err)
	}
	if err := os.WriteFile(s.queryPath(query.ID), content, 0o600); err != nil {
		return fmt.Errorf("write query file: %w", err)
	}
	return nil
}

func (s *Store) deleteQueryFile(id string) error {
	_, err := s.deleteQueryFileIfExists(id)
	return err
}

func (s *Store) deleteQueryFileIfExists(id string) (bool, error) {
	err := os.Remove(s.queryPath(id))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("delete query file: %w", err)
	}
	return true, nil
}

func (s *Store) queryPath(id string) string {
	sum := sha256.Sum256([]byte(id))
	return filepath.Join(s.queryDir, hex.EncodeToString(sum[:])+".json")
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Untitled query"
	}
	line, _, _ := strings.Cut(value, "\n")
	if len(line) > 64 {
		return line[:64]
	}
	return line
}
