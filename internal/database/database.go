package database

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"sql-gui/internal/store"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type ConnectionDetail struct {
	Driver    string         `json:"driver"`
	Database  string         `json:"database"`
	Databases []DatabaseInfo `json:"databases"`
	Tables    []TableInfo    `json:"tables"`
	Routines  []RoutineInfo  `json:"routines"`
}

type DatabaseInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type TableInfo struct {
	Schema  string   `json:"schema"`
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	Rows    int64    `json:"rows"`
	Columns []Column `json:"columns,omitempty"`
}

type RoutineInfo struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
	Type   string `json:"type"`
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
	DurationMS   float64             `json:"durationMs"`
	Message      string              `json:"message"`
	RedisKey     string              `json:"redisKey,omitempty"`
	RedisTTL     *int64              `json:"redisTTL,omitempty"` // -1 means persistent forever
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
		return nil, fmt.Errorf("%s does not use the SQL connection path", conn.Driver)
	}
}

func TestConnection(ctx context.Context, conn store.Connection) error {
	switch conn.Driver {
	case "mysql", "postgres":
		db, err := Open(conn)
		if err != nil {
			return err
		}
		defer db.Close()
		return db.PingContext(ctx)
	case "redis":
		return testRedis(ctx, conn)
	case "elasticsearch":
		_, err := elasticsearchRequest(ctx, conn, "/_cluster/health")
		return err
	default:
		return fmt.Errorf("unsupported driver %q", conn.Driver)
	}
}

func InspectConnection(ctx context.Context, db *sql.DB, conn store.Connection) (ConnectionDetail, error) {
	return InspectConnectionDatabase(ctx, db, conn, conn.Database)
}

func InspectExternalConnection(ctx context.Context, conn store.Connection) (ConnectionDetail, error) {
	switch conn.Driver {
	case "redis":
		if err := testRedis(ctx, conn); err != nil {
			return ConnectionDetail{}, err
		}
		return ConnectionDetail{
			Driver:    conn.Driver,
			Database:  redisDatabase(conn.Database),
			Databases: redisDatabases(),
		}, nil
	case "elasticsearch":
		tables, err := elasticsearchIndices(ctx, conn)
		if err != nil {
			return ConnectionDetail{}, err
		}
		databaseName := strings.TrimSpace(conn.Database)
		if databaseName == "" {
			databaseName = "indices"
		}
		return ConnectionDetail{
			Driver:    conn.Driver,
			Database:  databaseName,
			Databases: []DatabaseInfo{{Name: databaseName}},
			Tables:    tables,
		}, nil
	default:
		return ConnectionDetail{}, fmt.Errorf("unsupported external driver %q", conn.Driver)
	}
}

func InspectConnectionDatabase(ctx context.Context, db *sql.DB, conn store.Connection, database string) (ConnectionDetail, error) {
	conn.Database = strings.TrimSpace(database)
	var tables []TableInfo
	var routines []RoutineInfo
	var databases []DatabaseInfo
	var err error
	if conn.Driver == "postgres" {
		databases, err = postgresDatabases(ctx, db)
		if err != nil {
			return ConnectionDetail{}, err
		}
		tables, err = postgresTables(ctx, db)
		if err == nil {
			err = attachPostgresColumns(ctx, db, tables)
		}
		if err == nil {
			routines, err = postgresRoutines(ctx, db)
		}
	} else {
		databases, err = mysqlDatabases(ctx, db)
		if err != nil {
			return ConnectionDetail{}, err
		}
		tables, err = mysqlTables(ctx, db, conn.Database)
		if err == nil {
			err = attachMySQLColumns(ctx, db, conn.Database, tables)
		}
		if err == nil {
			routines, err = mysqlRoutines(ctx, db, conn.Database)
		}
	}
	if err != nil {
		return ConnectionDetail{}, err
	}
	return ConnectionDetail{Driver: conn.Driver, Database: conn.Database, Databases: databases, Tables: tables, Routines: routines}, nil
}

func InspectTable(ctx context.Context, db *sql.DB, conn store.Connection, schema, table string, limit int) (TableDetail, error) {
	if limit <= 0 || limit > 1000 {
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
		result.DurationMS = float64(time.Since(start).Microseconds()) / 1000.0
		return result, scanErr
	}
	result, execErr := db.ExecContext(ctx, sqlText)
	if execErr != nil {
		return QueryResult{}, err
	}
	affected, _ := result.RowsAffected()
	return QueryResult{
		RowsAffected: affected,
		DurationMS:   float64(time.Since(start).Microseconds()) / 1000.0,
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

func redisDatabase(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "0"
	}
	return value
}

func redisDatabases() []DatabaseInfo {
	items := make([]DatabaseInfo, 16)
	for i := range items {
		items[i] = DatabaseInfo{Name: strconv.Itoa(i)}
	}
	return items
}

func testRedis(ctx context.Context, conn store.Connection) error {
	dialer := net.Dialer{Timeout: 6 * time.Second}
	raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)))
	if err != nil {
		return err
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(6 * time.Second))
	reader := bufio.NewReader(raw)
	if conn.Password != "" {
		if conn.User != "" {
			if err := redisCommand(raw, reader, "AUTH", conn.User, conn.Password); err != nil {
				return err
			}
		} else if err := redisCommand(raw, reader, "AUTH", conn.Password); err != nil {
			return err
		}
	}
	if db := redisDatabase(conn.Database); db != "0" {
		if err := redisCommand(raw, reader, "SELECT", db); err != nil {
			return err
		}
	}
	return redisCommand(raw, reader, "PING")
}

func redisCommand(conn net.Conn, reader *bufio.Reader, parts ...string) error {
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("*%d\r\n", len(parts)))
	for _, part := range parts {
		builder.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(part), part))
	}
	if _, err := io.WriteString(conn, builder.String()); err != nil {
		return err
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	if strings.HasPrefix(line, "-") {
		return errors.New(strings.TrimSpace(strings.TrimPrefix(line, "-")))
	}
	return nil
}

func elasticsearchBaseURL(conn store.Connection) string {
	scheme := "http"
	if conn.UseTLS {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)))
}

func elasticsearchRequest(ctx context.Context, conn store.Connection, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, elasticsearchBaseURL(conn)+path, nil)
	if err != nil {
		return nil, err
	}
	if conn.User != "" || conn.Password != "" {
		req.SetBasicAuth(conn.User, conn.Password)
	}
	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("elasticsearch returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func elasticsearchIndices(ctx context.Context, conn store.Connection) ([]TableInfo, error) {
	body, err := elasticsearchRequest(ctx, conn, "/_cat/indices?format=json&bytes=b")
	if err != nil {
		return nil, err
	}
	var rows []map[string]string
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}
	items := make([]TableInfo, 0, len(rows))
	for _, row := range rows {
		docs, _ := strconv.ParseInt(row["docs.count"], 10, 64)
		name := row["index"]
		if name == "" {
			continue
		}
		items = append(items, TableInfo{
			Schema: conn.Host,
			Name:   name,
			Type:   "index",
			Rows:   docs,
		})
	}
	return items, nil
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
