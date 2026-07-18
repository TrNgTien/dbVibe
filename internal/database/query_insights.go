package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sql-gui/internal/store"
)

type QueryInsights struct {
	Available   bool                `json:"available"`
	Source      string              `json:"source"`
	Message     string              `json:"message,omitempty"`
	CollectedAt string              `json:"collectedAt"`
	Resources   ResourceInsight     `json:"resources"`
	Summary     QueryInsightSummary `json:"summary"`
	Queries     []QueryInsight      `json:"queries"`
}

type ResourceInsight struct {
	Source             string  `json:"source,omitempty"`
	ContainerName      string  `json:"containerName,omitempty"`
	MemoryUsedBytes    int64   `json:"memoryUsedBytes"`
	MemoryLimitBytes   int64   `json:"memoryLimitBytes"`
	MemoryUsagePercent float64 `json:"memoryUsagePercent"`
	MemoryAvailable    bool    `json:"memoryAvailable"`
	MemoryLimitLabel   string  `json:"memoryLimitLabel,omitempty"`
	CPUAvailable       bool    `json:"cpuAvailable"`
	CPUUsagePercent    float64 `json:"cpuUsagePercent"`
	CPUTotalSeconds    float64 `json:"cpuTotalSeconds"`
	CPUMessage         string  `json:"cpuMessage,omitempty"`
}

type QueryInsightSummary struct {
	StatementCount      int     `json:"statementCount"`
	Calls               int64   `json:"calls"`
	TotalTimeMS         float64 `json:"totalTimeMs"`
	AverageTimeMS       float64 `json:"averageTimeMs"`
	Rows                int64   `json:"rows"`
	RowsExamined        int64   `json:"rowsExamined"`
	FailedCalls         int64   `json:"failedCalls"`
	RejectedCalls       int64   `json:"rejectedCalls"`
	OperationsPerSecond int64   `json:"operationsPerSecond"`
	CacheHitRatio       float64 `json:"cacheHitRatio"`
}

type QueryInsight struct {
	Query          string  `json:"query"`
	Calls          int64   `json:"calls"`
	TotalTimeMS    float64 `json:"totalTimeMs"`
	AverageTimeMS  float64 `json:"averageTimeMs"`
	Rows           int64   `json:"rows"`
	RowsExamined   int64   `json:"rowsExamined"`
	TempDiskTables int64   `json:"tempDiskTables"`
	CacheHitRatio  float64 `json:"cacheHitRatio"`
	ImpactPercent  float64 `json:"impactPercent"`
	FailedCalls    int64   `json:"failedCalls"`
	RejectedCalls  int64   `json:"rejectedCalls"`
}

func InspectQueryInsights(ctx context.Context, db *sql.DB, conn store.Connection, limit int) (QueryInsights, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}

	var insights QueryInsights
	var err error
	switch conn.Driver {
	case "postgres", "timescaledb":
		insights, err = postgresQueryInsights(ctx, db, limit)
	case "mysql":
		insights, err = mysqlQueryInsights(ctx, db, conn.Database, limit)
	case "redis":
		insights, err = redisQueryInsights(ctx, conn, limit)
	case "mongodb":
		insights, err = mongoQueryInsights(ctx, conn, limit)
	default:
		return QueryInsights{}, fmt.Errorf("query insights are not supported for %s", conn.Driver)
	}
	if err != nil {
		return QueryInsights{}, err
	}
	if resource, ok := dockerResourceInsight(ctx, conn); ok {
		insights.Resources = resource
	}
	return insights, nil
}

func postgresQueryInsights(ctx context.Context, db *sql.DB, limit int) (QueryInsights, error) {
	insights := newQueryInsights("pg_stat_statements")
	insights.Resources = postgresResourceInsight(ctx, db)
	var enabled bool
	if err := db.QueryRowContext(ctx, `
		select exists (
			select 1 from pg_extension where extname = 'pg_stat_statements'
		)`).Scan(&enabled); err != nil {
		return QueryInsights{}, fmt.Errorf("check pg_stat_statements: %w", err)
	}
	if !enabled {
		insights.Message = "Enable the pg_stat_statements extension in this database to collect query workload statistics."
		return insights, nil
	}

	rows, err := db.QueryContext(ctx, `
		select coalesce(query, '<query text unavailable>'), calls, total_exec_time, mean_exec_time, rows,
			shared_blks_hit, shared_blks_read
		from pg_stat_statements
		where dbid = (select oid from pg_database where datname = current_database())
			and query not ilike '%pg_stat_statements%'
		order by total_exec_time desc
		limit $1`, limit)
	if err != nil {
		return QueryInsights{}, fmt.Errorf("query pg_stat_statements: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var item QueryInsight
		var sharedHits, sharedReads int64
		if err := rows.Scan(
			&item.Query,
			&item.Calls,
			&item.TotalTimeMS,
			&item.AverageTimeMS,
			&item.Rows,
			&sharedHits,
			&sharedReads,
		); err != nil {
			return QueryInsights{}, fmt.Errorf("scan pg_stat_statements: %w", err)
		}
		if blocks := sharedHits + sharedReads; blocks > 0 {
			item.CacheHitRatio = float64(sharedHits) / float64(blocks) * 100
		}
		insights.Queries = append(insights.Queries, item)
	}
	if err := rows.Err(); err != nil {
		return QueryInsights{}, fmt.Errorf("iterate pg_stat_statements: %w", err)
	}
	finalizeQueryInsights(&insights)
	return insights, nil
}

func mysqlQueryInsights(ctx context.Context, db *sql.DB, database string, limit int) (QueryInsights, error) {
	insights := newQueryInsights("performance_schema")
	insights.Resources = mysqlResourceInsight(ctx, db)
	var enabled int
	if err := db.QueryRowContext(ctx, "select @@performance_schema").Scan(&enabled); err != nil {
		return QueryInsights{}, fmt.Errorf("check performance_schema: %w", err)
	}
	if enabled == 0 {
		insights.Message = "Enable MySQL Performance Schema to collect query workload statistics."
		return insights, nil
	}

	rows, err := db.QueryContext(ctx, `
		select digest_text, count_star,
			sum_timer_wait / 1000000000,
			avg_timer_wait / 1000000000,
			sum_rows_sent,
			sum_rows_examined,
			sum_created_tmp_disk_tables
		from performance_schema.events_statements_summary_by_digest
		where schema_name = ?
			and digest_text is not null
		order by sum_timer_wait desc
		limit ?`, strings.TrimSpace(database), limit)
	if err != nil {
		return QueryInsights{}, fmt.Errorf("query performance_schema statement digests: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var item QueryInsight
		if err := rows.Scan(
			&item.Query,
			&item.Calls,
			&item.TotalTimeMS,
			&item.AverageTimeMS,
			&item.Rows,
			&item.RowsExamined,
			&item.TempDiskTables,
		); err != nil {
			return QueryInsights{}, fmt.Errorf("scan performance_schema statement digests: %w", err)
		}
		insights.Queries = append(insights.Queries, item)
	}
	if err := rows.Err(); err != nil {
		return QueryInsights{}, fmt.Errorf("iterate performance_schema statement digests: %w", err)
	}
	finalizeQueryInsights(&insights)
	return insights, nil
}

func postgresResourceInsight(ctx context.Context, db *sql.DB) ResourceInsight {
	resource := ResourceInsight{
		Source:           "postgres",
		MemoryLimitLabel: "shared_buffers",
		CPUMessage:       "Current PostgreSQL CPU usage is not exposed by standard SQL statistics.",
	}
	_ = db.QueryRowContext(ctx, `
		select pg_size_bytes(current_setting('shared_buffers'))`).Scan(&resource.MemoryLimitBytes)
	return resource
}

func mysqlResourceInsight(ctx context.Context, db *sql.DB) ResourceInsight {
	resource := ResourceInsight{
		Source:           "mysql",
		MemoryLimitLabel: "InnoDB buffer pool",
		CPUMessage:       "Current MySQL CPU usage is not exposed by Performance Schema.",
	}
	if err := db.QueryRowContext(ctx, `
		select @@global.innodb_buffer_pool_size,
			coalesce((
				select variable_value
				from performance_schema.global_status
				where variable_name = 'Innodb_buffer_pool_pages_data'
			), 0) * @@global.innodb_page_size`).Scan(
		&resource.MemoryLimitBytes,
		&resource.MemoryUsedBytes,
	); err == nil {
		resource.MemoryAvailable = true
	}
	return resource
}

type dockerContainer struct {
	Name  string `json:"Names"`
	Ports string `json:"Ports"`
}

var dockerPublishedPortPattern = regexp.MustCompile(`(?:^|[, ])(?:[^:,\s]+:)?(\d+)->`)

func dockerResourceInsight(ctx context.Context, conn store.Connection) (ResourceInsight, bool) {
	if !isLocalHost(conn.Host) {
		return ResourceInsight{}, false
	}
	dockerPath := findDockerCLI()
	if dockerPath == "" {
		return ResourceInsight{}, false
	}
	containerName, err := findDockerContainer(ctx, dockerPath, conn.Port)
	if err != nil || containerName == "" {
		return ResourceInsight{}, false
	}
	output, err := exec.CommandContext(
		ctx,
		dockerPath,
		"stats",
		"--no-stream",
		"--format",
		"{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}",
		containerName,
	).Output()
	if err != nil {
		return ResourceInsight{}, false
	}
	resource, err := parseDockerStats(containerName, string(output))
	return resource, err == nil
}

func findDockerContainer(ctx context.Context, dockerPath string, port int) (string, error) {
	output, err := exec.CommandContext(ctx, dockerPath, "ps", "--format", "{{json .}}").Output()
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var container dockerContainer
		if err := json.Unmarshal([]byte(line), &container); err != nil {
			continue
		}
		if dockerPortsContain(container.Ports, port) {
			return container.Name, nil
		}
	}
	return "", nil
}

func dockerPortsContain(ports string, port int) bool {
	want := strconv.Itoa(port)
	for _, match := range dockerPublishedPortPattern.FindAllStringSubmatch(ports, -1) {
		if len(match) > 1 && match[1] == want {
			return true
		}
	}
	return false
}

func parseDockerStats(containerName, output string) (ResourceInsight, error) {
	fields := strings.Split(strings.TrimSpace(output), "\t")
	if len(fields) != 3 {
		return ResourceInsight{}, fmt.Errorf("unexpected docker stats output")
	}
	memoryParts := strings.Split(fields[1], " / ")
	if len(memoryParts) != 2 {
		return ResourceInsight{}, fmt.Errorf("unexpected docker memory usage")
	}
	memoryUsed, err := parseDockerBytes(memoryParts[0])
	if err != nil {
		return ResourceInsight{}, err
	}
	memoryLimit, err := parseDockerBytes(memoryParts[1])
	if err != nil {
		return ResourceInsight{}, err
	}
	cpuPercent, err := parseDockerPercent(fields[0])
	if err != nil {
		return ResourceInsight{}, err
	}
	memoryPercent, err := parseDockerPercent(fields[2])
	if err != nil {
		return ResourceInsight{}, err
	}
	return ResourceInsight{
		Source:             "docker",
		ContainerName:      containerName,
		MemoryUsedBytes:    memoryUsed,
		MemoryLimitBytes:   memoryLimit,
		MemoryUsagePercent: memoryPercent,
		MemoryAvailable:    true,
		MemoryLimitLabel:   "container limit",
		CPUAvailable:       true,
		CPUUsagePercent:    cpuPercent,
	}, nil
}

func parseDockerPercent(value string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(value, "%")), 64)
}

func parseDockerBytes(value string) (int64, error) {
	value = strings.TrimSpace(value)
	index := 0
	for index < len(value) && (value[index] == '.' || value[index] >= '0' && value[index] <= '9') {
		index++
	}
	number, err := strconv.ParseFloat(value[:index], 64)
	if err != nil {
		return 0, err
	}
	unit := strings.ToLower(strings.TrimSpace(value[index:]))
	multiplier := float64(1)
	switch unit {
	case "kb":
		multiplier = 1000
	case "kib":
		multiplier = 1024
	case "mb":
		multiplier = 1000 * 1000
	case "mib":
		multiplier = 1024 * 1024
	case "gb":
		multiplier = 1000 * 1000 * 1000
	case "gib":
		multiplier = 1024 * 1024 * 1024
	case "tb":
		multiplier = 1000 * 1000 * 1000 * 1000
	case "tib":
		multiplier = 1024 * 1024 * 1024 * 1024
	case "b", "":
	default:
		return 0, fmt.Errorf("unsupported docker byte unit %q", unit)
	}
	return int64(number * multiplier), nil
}

func findDockerCLI() string {
	if path, err := exec.LookPath("docker"); err == nil {
		return path
	}
	for _, path := range []string{
		"/usr/local/bin/docker",
		"/opt/homebrew/bin/docker",
		"/Applications/Docker.app/Contents/Resources/bin/docker",
	} {
		if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Mode().Perm()&0111 != 0 {
			return path
		}
	}
	return ""
}

func isLocalHost(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func newQueryInsights(source string) QueryInsights {
	return QueryInsights{
		Source:      source,
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		Queries:     make([]QueryInsight, 0),
	}
}

func finalizeQueryInsights(insights *QueryInsights) {
	insights.Available = true
	insights.Summary.StatementCount = len(insights.Queries)
	for _, item := range insights.Queries {
		insights.Summary.Calls += item.Calls
		insights.Summary.TotalTimeMS += item.TotalTimeMS
		insights.Summary.Rows += item.Rows
		insights.Summary.RowsExamined += item.RowsExamined
		insights.Summary.FailedCalls += item.FailedCalls
		insights.Summary.RejectedCalls += item.RejectedCalls
	}
	if insights.Summary.Calls > 0 {
		insights.Summary.AverageTimeMS = insights.Summary.TotalTimeMS / float64(insights.Summary.Calls)
	}
	if insights.Summary.TotalTimeMS > 0 {
		for index := range insights.Queries {
			insights.Queries[index].ImpactPercent = insights.Queries[index].TotalTimeMS / insights.Summary.TotalTimeMS * 100
		}
	}
	if len(insights.Queries) == 0 {
		insights.Message = "No aggregated statement statistics are available for this database yet."
	}
}
