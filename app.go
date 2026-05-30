package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"sql-gui/internal/database"
	"sql-gui/internal/store"
)

type App struct {
	ctx   context.Context
	store *store.Store
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.store = store.New("tnt-sql")
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
	db, err := database.Open(conn)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(a.ctx, 6*time.Second)
	defer cancel()
	return db.PingContext(ctx)
}

func (a *App) Connect(connectionID string) (database.ConnectionDetail, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return database.ConnectionDetail{}, err
	}
	db, err := database.Open(conn)
	if err != nil {
		return database.ConnectionDetail{}, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
	defer cancel()
	return database.InspectConnection(ctx, db, conn)
}

func (a *App) GetTableDetail(connectionID, schema, table string, limit int) (database.TableDetail, error) {
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return database.TableDetail{}, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(a.ctx, 12*time.Second)
	defer cancel()
	return database.InspectTable(ctx, db, conn, schema, table, limit)
}

func (a *App) Execute(connectionID, sqlText string, limit int) (database.QueryResult, error) {
	if strings.TrimSpace(sqlText) == "" {
		return database.QueryResult{}, errors.New("SQL is empty")
	}
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return database.QueryResult{}, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()
	return database.Execute(ctx, db, conn.Driver, sqlText, limit)
}

func (a *App) ExplainAnalyze(connectionID, sqlText string) (database.QueryResult, error) {
	if strings.TrimSpace(sqlText) == "" {
		return database.QueryResult{}, errors.New("SQL is empty")
	}
	conn, db, err := a.openStored(connectionID)
	if err != nil {
		return database.QueryResult{}, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
	defer cancel()
	return database.ExplainAnalyze(ctx, db, conn.Driver, sqlText)
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

func (a *App) openStored(connectionID string) (store.Connection, *sql.DB, error) {
	conn, err := a.store.GetConnection(connectionID)
	if err != nil {
		return store.Connection{}, nil, err
	}
	db, err := database.Open(conn)
	if err != nil {
		return store.Connection{}, nil, fmt.Errorf("open connection: %w", err)
	}
	return conn, db, nil
}
