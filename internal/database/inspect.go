package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func postgresTables(ctx context.Context, db *sql.DB) ([]TableInfo, error) {
	rows, err := db.QueryContext(ctx, `
		select schemaname, relname, case when schemaname = 'pg_catalog' then 'system' else 'table' end, n_live_tup
		from pg_stat_user_tables
		union all
		select table_schema, table_name, table_type, 0
		from information_schema.views
		where table_schema not in ('pg_catalog', 'information_schema')
		order by 1, 2`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTableInfo(rows)
}

func mysqlTables(ctx context.Context, db *sql.DB, database string) ([]TableInfo, error) {
	rows, err := db.QueryContext(ctx, `
		select table_schema, table_name, table_type, coalesce(table_rows, 0)
		from information_schema.tables
		where table_schema = ?
		order by table_name`, database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTableInfo(rows)
}

func inspectPostgresTable(ctx context.Context, db *sql.DB, schema, table string, limit int) (TableDetail, error) {
	if schema == "" {
		schema = "public"
	}
	columns, err := postgresColumns(ctx, db, schema, table)
	if err != nil {
		return TableDetail{}, err
	}
	indexes, err := postgresIndexes(ctx, db, schema, table)
	if err != nil {
		return TableDetail{}, err
	}
	createSQL := postgresCreateSQL(schema, table, columns)
	sampleSQL := fmt.Sprintf("select * from %s.%s limit %d", quotePG(schema), quotePG(table), limit)
	sample, err := Execute(ctx, db, "postgres", sampleSQL, limit)
	if err != nil {
		return TableDetail{}, err
	}
	return TableDetail{
		Table:     TableInfo{Schema: schema, Name: table, Type: "table"},
		Columns:   columns,
		Indexes:   indexes,
		CreateSQL: createSQL,
		Sample:    sample,
	}, nil
}

func inspectMySQLTable(ctx context.Context, db *sql.DB, database, table string, limit int) (TableDetail, error) {
	columns, err := mysqlColumns(ctx, db, database, table)
	if err != nil {
		return TableDetail{}, err
	}
	indexes, err := mysqlIndexes(ctx, db, database, table)
	if err != nil {
		return TableDetail{}, err
	}
	createSQL, err := mysqlCreateSQL(ctx, db, table)
	if err != nil {
		return TableDetail{}, err
	}
	sampleSQL := fmt.Sprintf("select * from %s limit %d", quoteMySQL(table), limit)
	sample, err := Execute(ctx, db, "mysql", sampleSQL, limit)
	if err != nil {
		return TableDetail{}, err
	}
	return TableDetail{
		Table:     TableInfo{Schema: database, Name: table, Type: "table"},
		Columns:   columns,
		Indexes:   indexes,
		CreateSQL: createSQL,
		Sample:    sample,
	}, nil
}

func postgresColumns(ctx context.Context, db *sql.DB, schema, table string) ([]Column, error) {
	rows, err := db.QueryContext(ctx, `
		select column_name, data_type, is_nullable = 'YES', coalesce(column_default, ''), ordinal_position
		from information_schema.columns
		where table_schema = $1 and table_name = $2
		order by ordinal_position`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanColumns(rows)
}

func mysqlColumns(ctx context.Context, db *sql.DB, database, table string) ([]Column, error) {
	rows, err := db.QueryContext(ctx, `
		select column_name, column_type, is_nullable = 'YES', coalesce(column_default, ''), ordinal_position
		from information_schema.columns
		where table_schema = ? and table_name = ?
		order by ordinal_position`, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanColumns(rows)
}

func postgresIndexes(ctx context.Context, db *sql.DB, schema, table string) ([]Index, error) {
	rows, err := db.QueryContext(ctx, `
		select indexname, '', false, indexdef
		from pg_indexes
		where schemaname = $1 and tablename = $2
		order by indexname`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanIndexes(rows)
}

func mysqlIndexes(ctx context.Context, db *sql.DB, database, table string) ([]Index, error) {
	rows, err := db.QueryContext(ctx, `
		select index_name, group_concat(column_name order by seq_in_index separator ', '), non_unique = 0, ''
		from information_schema.statistics
		where table_schema = ? and table_name = ?
		group by index_name, non_unique
		order by index_name`, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanIndexes(rows)
}

func mysqlCreateSQL(ctx context.Context, db *sql.DB, table string) (string, error) {
	rows, err := db.QueryContext(ctx, "show create table "+quoteMySQL(table))
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var name, createSQL string
	if rows.Next() {
		if err := rows.Scan(&name, &createSQL); err != nil {
			return "", err
		}
	}
	return createSQL, rows.Err()
}

func postgresCreateSQL(schema, table string, columns []Column) string {
	lines := make([]string, 0, len(columns))
	for _, column := range columns {
		line := fmt.Sprintf("  %s %s", quotePG(column.Name), column.Type)
		if !column.Nullable {
			line += " not null"
		}
		if column.Default != "" {
			line += " default " + column.Default
		}
		lines = append(lines, line)
	}
	return fmt.Sprintf("create table %s.%s (\n%s\n);", quotePG(schema), quotePG(table), strings.Join(lines, ",\n"))
}

func scanTableInfo(rows *sql.Rows) ([]TableInfo, error) {
	items := make([]TableInfo, 0)
	for rows.Next() {
		var item TableInfo
		if err := rows.Scan(&item.Schema, &item.Name, &item.Type, &item.Rows); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanColumns(rows *sql.Rows) ([]Column, error) {
	items := make([]Column, 0)
	for rows.Next() {
		var item Column
		if err := rows.Scan(&item.Name, &item.Type, &item.Nullable, &item.Default, &item.Ordinal); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanIndexes(rows *sql.Rows) ([]Index, error) {
	items := make([]Index, 0)
	for rows.Next() {
		var item Index
		if err := rows.Scan(&item.Name, &item.Columns, &item.Unique, &item.SQL); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func quotePG(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func quoteMySQL(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}
