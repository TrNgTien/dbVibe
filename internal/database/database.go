package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"sql-gui/internal/store"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type ConnectionDetail struct {
	Driver   string      `json:"driver"`
	Database string      `json:"database"`
	Tables   []TableInfo `json:"tables"`
}

type TableInfo struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Rows   int64  `json:"rows"`
}

type TableDetail struct {
	Table     TableInfo   `json:"table"`
	Columns   []Column    `json:"columns"`
	Indexes   []Index     `json:"indexes"`
	CreateSQL string      `json:"createSql"`
	Sample    QueryResult `json:"sample"`
}

type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Default  string `json:"default"`
	Ordinal  int    `json:"ordinal"`
}

type Index struct {
	Name    string `json:"name"`
	Columns string `json:"columns"`
	Unique  bool   `json:"unique"`
	SQL     string `json:"sql"`
}

type QueryResult struct {
	Columns      []string            `json:"columns"`
	Rows         []map[string]string `json:"rows"`
	RowsAffected int64               `json:"rowsAffected"`
	DurationMS   int64               `json:"durationMs"`
	Message      string              `json:"message"`
}

func Open(conn store.Connection) (*sql.DB, error) {
	switch conn.Driver {
	case "postgres":
		db, err := sql.Open("pgx", postgresDSN(conn))
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(4)
		db.SetMaxIdleConns(1)
		db.SetConnMaxLifetime(10 * time.Minute)
		return db, nil
	case "mysql":
		db, err := sql.Open("mysql", mysqlDSN(conn))
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(4)
		db.SetMaxIdleConns(1)
		db.SetConnMaxLifetime(10 * time.Minute)
		return db, nil
	default:
		return nil, fmt.Errorf("unsupported driver %q", conn.Driver)
	}
}

func InspectConnection(ctx context.Context, db *sql.DB, conn store.Connection) (ConnectionDetail, error) {
	var tables []TableInfo
	var err error
	if conn.Driver == "postgres" {
		tables, err = postgresTables(ctx, db)
	} else {
		tables, err = mysqlTables(ctx, db, conn.Database)
	}
	if err != nil {
		return ConnectionDetail{}, err
	}
	return ConnectionDetail{Driver: conn.Driver, Database: conn.Database, Tables: tables}, nil
}

func InspectTable(ctx context.Context, db *sql.DB, conn store.Connection, schema, table string, limit int) (TableDetail, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if conn.Driver == "postgres" {
		return inspectPostgresTable(ctx, db, schema, table, limit)
	}
	return inspectMySQLTable(ctx, db, conn.Database, table, limit)
}

func Execute(ctx context.Context, db *sql.DB, driver, sqlText string, limit int) (QueryResult, error) {
	if limit <= 0 || limit > 1000 {
		limit = 300
	}
	start := time.Now()
	rows, err := db.QueryContext(ctx, sqlText)
	if err == nil {
		defer rows.Close()
		result, scanErr := scanRows(rows, limit)
		result.DurationMS = time.Since(start).Milliseconds()
		return result, scanErr
	}
	result, execErr := db.ExecContext(ctx, sqlText)
	if execErr != nil {
		return QueryResult{}, err
	}
	affected, _ := result.RowsAffected()
	return QueryResult{
		RowsAffected: affected,
		DurationMS:   time.Since(start).Milliseconds(),
		Message:      fmt.Sprintf("%d rows affected", affected),
	}, nil
}

func ExplainAnalyze(ctx context.Context, db *sql.DB, driver, sqlText string) (QueryResult, error) {
	query := strings.TrimSpace(strings.TrimRight(sqlText, ";"))
	if driver == "postgres" {
		query = "EXPLAIN (ANALYZE, BUFFERS, VERBOSE) " + query
	} else {
		query = "EXPLAIN ANALYZE " + query
	}
	return Execute(ctx, db, driver, query, 300)
}

func postgresDSN(conn store.Connection) string {
	sslMode := conn.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}
	values := url.Values{}
	values.Set("sslmode", sslMode)
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(conn.User, conn.Password),
		Host:     conn.Host + ":" + strconv.Itoa(conn.Port),
		Path:     conn.Database,
		RawQuery: values.Encode(),
	}
	return u.String()
}

func mysqlDSN(conn store.Connection) string {
	tlsMode := "false"
	if conn.UseTLS {
		tlsMode = "true"
	}
	values := url.Values{}
	values.Set("parseTime", "true")
	values.Set("timeout", "6s")
	values.Set("readTimeout", "60s")
	values.Set("writeTimeout", "60s")
	values.Set("tls", tlsMode)
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?%s", conn.User, conn.Password, conn.Host, conn.Port, conn.Database, values.Encode())
}

func scanRows(rows *sql.Rows, limit int) (QueryResult, error) {
	columns, err := rows.Columns()
	if err != nil {
		return QueryResult{}, err
	}
	values := make([]sql.NullString, len(columns))
	dest := make([]interface{}, len(columns))
	for i := range values {
		dest[i] = &values[i]
	}
	result := QueryResult{Columns: columns, Rows: make([]map[string]string, 0)}
	count := 0
	for rows.Next() {
		if count >= limit {
			result.Message = fmt.Sprintf("Showing first %d rows", limit)
			break
		}
		if err := rows.Scan(dest...); err != nil {
			return QueryResult{}, err
		}
		row := make(map[string]string, len(columns))
		for i, column := range columns {
			if values[i].Valid {
				row[column] = values[i].String
			} else {
				row[column] = "NULL"
			}
		}
		result.Rows = append(result.Rows, row)
		count++
	}
	if err := rows.Err(); err != nil {
		return QueryResult{}, err
	}
	return result, nil
}
