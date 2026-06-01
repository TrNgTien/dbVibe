package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"sql-gui/internal/database"
	"sql-gui/internal/store"
)

type App struct {
	ctx      context.Context
	store    *store.Store
	sessions map[string]*connectionSession
	mu       sync.Mutex
}

type connectionSession struct {
	conn     store.Connection
	db       *sql.DB
	lastUsed time.Time
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.store = store.New("tnt-sql")
	a.sessions = make(map[string]*connectionSession)
	go a.reapIdleSessions()
}

func (a *App) ListConnections() ([]store.Connection, error) {
	return a.store.ListConnections()
}

func (a *App) SaveConnection(conn store.Connection) (store.Connection, error) {
	return a.store.SaveConnection(conn)
}

func (a *App) DeleteConnection(id string) error {
	return a.store.DeleteConnection(id)
}

func (a *App) TestConnection(conn store.Connection) error {
	ctx, cancel := context.WithTimeout(a.ctx, 6*time.Second)
	defer cancel()
	return database.TestConnection(ctx, conn)
}

func (a *App) Connect(connectionID string) (database.ConnectionDetail, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return database.ConnectionDetail{}, err
	}
	if conn.Driver == "redis" || conn.Driver == "elasticsearch" {
		ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
		defer cancel()
		detail, err := database.InspectExternalConnection(ctx, conn)
		if err == nil {
			a.touchExternalSession(connectionID, conn)
		}
		return detail, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
	defer cancel()
	conn, db, err := a.openSession(ctx, connectionID, conn, conn.Database)
	if err != nil {
		return database.ConnectionDetail{}, err
	}
	return database.InspectConnection(ctx, db, conn)
}

func (a *App) ConnectDatabase(connectionID, databaseName string) (database.ConnectionDetail, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return database.ConnectionDetail{}, err
	}
	if strings.TrimSpace(databaseName) != "" {
		conn.Database = strings.TrimSpace(databaseName)
	}
	if conn.Driver == "redis" || conn.Driver == "elasticsearch" {
		ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
		defer cancel()
		detail, err := database.InspectExternalConnection(ctx, conn)
		if err == nil {
			a.touchExternalSession(connectionID, conn)
		}
		return detail, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
	defer cancel()
	conn, db, err := a.openSession(ctx, connectionID, conn, conn.Database)
	if err != nil {
		return database.ConnectionDetail{}, err
	}
	return database.InspectConnectionDatabase(ctx, db, conn, conn.Database)
}

func (a *App) GetTableDetail(connectionID, schema, table string, limit int) (database.TableDetail, error) {
	return a.GetDatabaseTableDetail(connectionID, "", schema, table, limit)
}

func (a *App) GetCompletions(connectionID, databaseName, text string, position int) ([]database.CompletionItem, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(databaseName) != "" {
		conn.Database = strings.TrimSpace(databaseName)
	}
	
	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Second)
	defer cancel()

	if conn.Driver == "redis" || conn.Driver == "elasticsearch" {
		return database.GetCompletions(ctx, nil, conn, text, position)
	}
	
	conn, db, err := a.openSession(ctx, connectionID, conn, conn.Database)
	if err != nil {
		return nil, err
	}
	return database.GetCompletions(ctx, db, conn, text, position)
}

func (a *App) GetDatabaseTableDetail(connectionID, databaseName, schema, table string, limit int) (database.TableDetail, error) {
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return database.TableDetail{}, err
	}
	if strings.TrimSpace(databaseName) != "" && strings.TrimSpace(databaseName) != conn.Database {
		conn.Database = strings.TrimSpace(databaseName)
	}
	ctx, cancel := context.WithTimeout(a.ctx, 12*time.Second)
	defer cancel()
	conn, db, err = a.openSession(ctx, connectionID, conn, conn.Database)
	if err != nil {
		return database.TableDetail{}, err
	}
	return database.InspectTable(ctx, db, conn, schema, table, limit)
}

func (a *App) Execute(connectionID, sqlText string, limit int) (database.QueryResult, error) {
	return a.ExecuteDatabase(connectionID, "", sqlText, limit)
}

func (a *App) ExecuteDatabase(connectionID, databaseName, sqlText string, limit int) (database.QueryResult, error) {
	if strings.TrimSpace(sqlText) == "" {
		return database.QueryResult{}, errors.New("SQL is empty")
	}
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return database.QueryResult{}, err
	}
	if strings.TrimSpace(databaseName) != "" && strings.TrimSpace(databaseName) != conn.Database {
		conn.Database = strings.TrimSpace(databaseName)
	}
	ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()
	conn, db, err = a.openSession(ctx, connectionID, conn, conn.Database)
	if err != nil {
		return database.QueryResult{}, err
	}
	return database.Execute(ctx, db, conn.Driver, sqlText, limit)
}

func (a *App) ExplainAnalyze(connectionID, sqlText string) (database.QueryResult, error) {
	return a.ExplainAnalyzeDatabase(connectionID, "", sqlText)
}

func (a *App) ExplainAnalyzeDatabase(connectionID, databaseName, sqlText string) (database.QueryResult, error) {
	if strings.TrimSpace(sqlText) == "" {
		return database.QueryResult{}, errors.New("SQL is empty")
	}
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return database.QueryResult{}, err
	}
	if strings.TrimSpace(databaseName) != "" && strings.TrimSpace(databaseName) != conn.Database {
		conn.Database = strings.TrimSpace(databaseName)
	}
	ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
	defer cancel()
	conn, db, err = a.openSession(ctx, connectionID, conn, conn.Database)
	if err != nil {
		return database.QueryResult{}, err
	}
	return database.ExplainAnalyze(ctx, db, conn.Driver, sqlText)
}

func (a *App) CloseConnection(connectionID, databaseName string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	prefix := connectionID + "|"
	key := sessionKey(connectionID, databaseName)
	for existingKey, session := range a.sessions {
		if existingKey == key || (strings.TrimSpace(databaseName) == "" && strings.HasPrefix(existingKey, prefix)) {
			if session.db != nil {
				_ = session.db.Close()
			}
			delete(a.sessions, existingKey)
		}
	}
	return nil
}

func (a *App) ListSavedQueries(connectionID string) ([]store.SavedQuery, error) {
	return a.store.ListQueries(connectionID)
}

func (a *App) SaveQuery(query store.SavedQuery) (store.SavedQuery, error) {
	if strings.TrimSpace(query.SQL) == "" {
		return store.SavedQuery{}, errors.New("SQL is empty")
	}
	return a.store.SaveQuery(query)
}

func (a *App) DeleteQuery(id string) error {
	return a.store.DeleteQuery(id)
}

func (a *App) ListBinlogs(connectionID string) ([]string, error) {
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	if conn.Driver != "mysql" {
		return nil, errors.New("binlogs are only supported for MySQL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := db.QueryContext(ctx, "SHOW BINARY LOGS")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var binlogs []string
	for rows.Next() {
		cols, _ := rows.Columns()
		vals := make([]interface{}, len(cols))
		for i := range cols {
			vals[i] = new(sql.RawBytes)
		}
		if err := rows.Scan(vals...); err != nil {
			return nil, err
		}
		binlogs = append(binlogs, string(*vals[0].(*sql.RawBytes)))
	}
	return binlogs, nil
}

func (a *App) ReadBinlog(connectionID, logName string) (string, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return "", err
	}
	if conn.Driver != "mysql" {
		return "", errors.New("binlogs are only supported for MySQL")
	}

	tmpFile, err := os.CreateTemp("", "binlog-*.sql")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	args := []string{
		"--read-from-remote-server",
		"--host=" + conn.Host,
		"--port=" + strconv.Itoa(conn.Port),
		"--user=" + conn.User,
		"--password=" + conn.Password,
		"--base64-output=DECODE-ROWS",
		"-v",
		logName,
	}

	cmd := exec.Command("mysqlbinlog", args...)

	outFile, err := os.Create(tmpPath)
	if err != nil {
		return "", err
	}
	cmd.Stdout = outFile
	cmd.Stderr = outFile

	err = cmd.Run()
	outFile.Close()

	content, readErr := os.ReadFile(tmpPath)
	if readErr != nil {
		return "", readErr
	}

	if err != nil {
		return "", fmt.Errorf("mysqlbinlog failed: %v\nOutput: %s", err, string(content))
	}

	return string(content), nil
}

func (a *App) openStored(connectionID string) (store.Connection, *sql.DB, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return store.Connection{}, nil, err
	}
	return conn, nil, nil
}

func (a *App) openSession(ctx context.Context, connectionID string, conn store.Connection, databaseName string) (store.Connection, *sql.DB, error) {
	if strings.TrimSpace(databaseName) != "" {
		conn.Database = strings.TrimSpace(databaseName)
	}
	key := sessionKey(connectionID, conn.Database)
	a.mu.Lock()
	if session := a.sessions[key]; session != nil && session.db != nil {
		session.lastUsed = time.Now()
		session.conn = conn
		db := session.db
		a.mu.Unlock()
		return conn, db, nil
	}
	a.mu.Unlock()

	db, err := database.Open(conn)
	if err != nil {
		return store.Connection{}, nil, fmt.Errorf("open connection: %w", err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return store.Connection{}, nil, err
	}

	a.mu.Lock()
	a.sessions[key] = &connectionSession{conn: conn, db: db, lastUsed: time.Now()}
	a.mu.Unlock()
	return conn, db, nil
}

func (a *App) touchExternalSession(connectionID string, conn store.Connection) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.sessions[sessionKey(connectionID, conn.Database)] = &connectionSession{conn: conn, lastUsed: time.Now()}
}

func (a *App) reapIdleSessions() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-a.ctx.Done():
			a.closeAllSessions()
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-10 * time.Minute)
			a.mu.Lock()
			for key, session := range a.sessions {
				if session.lastUsed.Before(cutoff) {
					if session.db != nil {
						_ = session.db.Close()
					}
					delete(a.sessions, key)
				}
			}
			a.mu.Unlock()
		}
	}
}

func (a *App) closeAllSessions() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, session := range a.sessions {
		if session.db != nil {
			_ = session.db.Close()
		}
		delete(a.sessions, key)
	}
}

func sessionKey(connectionID, databaseName string) string {
	return connectionID + "|" + strings.TrimSpace(databaseName)
}
