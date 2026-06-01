package database

import (
	"context"
	"database/sql"
	"sql-gui/internal/store"
)

type CompletionItem struct {
	Label  string `json:"label"`
	Detail string `json:"detail"`
	Type   string `json:"type"`
	Apply  string `json:"apply"`
}

func GetCompletions(ctx context.Context, db *sql.DB, conn store.Connection, text string, position int) ([]CompletionItem, error) {
	if conn.Driver == "redis" {
		return getRedisCompletions(ctx, conn, text, position)
	}
	if conn.Driver == "elasticsearch" {
		return getElasticsearchCompletions(ctx, conn, text, position)
	}
	return nil, nil
}

func getRedisCompletions(ctx context.Context, conn store.Connection, text string, position int) ([]CompletionItem, error) {
	return nil, nil
}

func getElasticsearchCompletions(ctx context.Context, conn store.Connection, text string, position int) ([]CompletionItem, error) {
	return nil, nil
}
