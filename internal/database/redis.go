package database

import (
	"context"
	"crypto/tls"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"sql-gui/internal/store"

	"github.com/redis/go-redis/v9"
)

func parseRedisCommand(cmd string) []interface{} {
	var args []interface{}
	var current strings.Builder
	inQuotes := false
	var quoteChar rune

	runes := []rune(strings.TrimSpace(cmd))
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if inQuotes {
			if r == quoteChar {
				if i+1 < len(runes) && runes[i+1] == quoteChar {
					current.WriteRune(quoteChar)
					i++
				} else {
					inQuotes = false
				}
			} else {
				current.WriteRune(r)
			}
		} else {
			if unicode.IsSpace(r) {
				if current.Len() > 0 {
					args = append(args, current.String())
					current.Reset()
				}
			} else if r == '\'' || r == '"' {
				inQuotes = true
				quoteChar = r
			} else {
				current.WriteRune(r)
			}
		}
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}

func firstRedisCommand(text string) string {
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if command := strings.TrimSpace(line); command != "" {
			return command
		}
	}
	return ""
}

func ExecuteRedis(ctx context.Context, conn store.Connection, sqlText string) (QueryResult, error) {
	command := firstRedisCommand(sqlText)
	if command == "" {
		return QueryResult{}, fmt.Errorf("empty command")
	}

	client := newRedisClient(conn)
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		return QueryResult{}, fmt.Errorf("redis ping failed: %w", err)
	}

	args := parseRedisCommand(command)
	if len(args) == 0 {
		return QueryResult{}, fmt.Errorf("empty command")
	}

	res, err := client.Do(ctx, args...).Result()
	if err != nil {
		return QueryResult{}, err
	}

	result, err := formatRedisResult(res)
	if err != nil {
		return QueryResult{}, err
	}

	if len(args) > 1 {
		key := fmt.Sprintf("%v", args[1])
		if !strings.EqualFold(fmt.Sprintf("%v", args[0]), "keys") && !strings.EqualFold(fmt.Sprintf("%v", args[0]), "info") {
			ttl, err := client.TTL(ctx, key).Result()
			if err == nil && ttl.Seconds() >= -1 {
				result.RedisKey = key
				secs := int64(ttl.Seconds())
				result.RedisTTL = &secs
			}
		}
	}

	return result, nil
}

func DeleteRedisKey(ctx context.Context, conn store.Connection, key string) error {
	client := newRedisClient(conn)
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping failed: %w", err)
	}
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("redis key is empty")
	}
	if err := client.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("delete redis key %q: %w", key, err)
	}
	return nil
}

func InspectRedis(ctx context.Context, conn store.Connection) (ConnectionDetail, error) {
	client := newRedisClient(conn)
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		return ConnectionDetail{}, fmt.Errorf("redis ping failed: %w", err)
	}

	databases, err := redisDatabaseInfos(ctx, client, redisDatabase(conn.Database))
	if err != nil {
		databases = redisFallbackDatabases(redisDatabase(conn.Database))
	}
	keys, err := redisKeys(ctx, client, redisDatabase(conn.Database), 200)
	if err != nil {
		keys = nil
	}
	return ConnectionDetail{
		Driver:    conn.Driver,
		Database:  redisDatabase(conn.Database),
		Databases: databases,
		Tables:    keys,
	}, nil
}

func newRedisClient(conn store.Connection) *redis.Client {
	opts := &redis.Options{
		Addr: fmt.Sprintf("%s:%d", conn.Host, conn.Port),
	}
	if conn.UseTLS {
		opts.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: conn.Host,
		}
	}
	if conn.Password != "" {
		opts.Password = conn.Password
	}
	if conn.User != "" {
		opts.Username = conn.User
	}
	dbNum := 0
	if dbStr := redisDatabase(conn.Database); dbStr != "" {
		if n, err := strconv.Atoi(dbStr); err == nil {
			dbNum = n
		}
	}
	opts.DB = dbNum

	return redis.NewClient(opts)
}

func redisFallbackDatabases(selected string) []DatabaseInfo {
	if selected == "0" {
		return []DatabaseInfo{{Name: "0"}}
	}
	return []DatabaseInfo{{Name: "0"}, {Name: selected}}
}

func redisDatabaseInfos(ctx context.Context, client *redis.Client, selected string) ([]DatabaseInfo, error) {
	info, err := client.Info(ctx, "keyspace").Result()
	if err != nil {
		return nil, fmt.Errorf("redis keyspace info: %w", err)
	}

	counts := make(map[string]int64)
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "db") {
			continue
		}
		name, values, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		keysValue := strings.Split(values, ",")[0]
		keysValue = strings.TrimPrefix(keysValue, "keys=")
		keys, err := strconv.ParseInt(keysValue, 10, 64)
		if err == nil {
			counts[strings.TrimPrefix(name, "db")] = keys
		}
	}

	counts["0"] += 0
	counts[selected] += 0
	items := make([]DatabaseInfo, 0, len(counts))
	for name, keys := range counts {
		items = append(items, DatabaseInfo{Name: name, Size: keys})
	}
	slices.SortFunc(items, func(a, b DatabaseInfo) int {
		aNumber, _ := strconv.Atoi(a.Name)
		bNumber, _ := strconv.Atoi(b.Name)
		return aNumber - bNumber
	})
	return items, nil
}

func redisKeys(ctx context.Context, client *redis.Client, database string, limit int) ([]TableInfo, error) {
	keys := make([]string, 0, limit)
	var cursor uint64
	for len(keys) < limit {
		batch, next, err := client.Scan(ctx, cursor, "*", int64(limit-len(keys))).Result()
		if err != nil {
			return nil, fmt.Errorf("scan redis keys: %w", err)
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 {
			break
		}
	}
	slices.Sort(keys)

	items := make([]TableInfo, 0, len(keys))
	for _, key := range keys {
		keyType, err := client.Type(ctx, key).Result()
		if err != nil {
			return nil, fmt.Errorf("read redis key type: %w", err)
		}
		items = append(items, TableInfo{
			Schema: database,
			Name:   key,
			Type:   keyType,
		})
	}
	return items, nil
}

func redisQueryInsights(ctx context.Context, conn store.Connection, limit int) (QueryInsights, error) {
	client := newRedisClient(conn)
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		return QueryInsights{}, fmt.Errorf("redis ping failed: %w", err)
	}

	commandStats, err := client.Info(ctx, "commandstats").Result()
	if err != nil {
		return QueryInsights{}, fmt.Errorf("redis commandstats info: %w", err)
	}
	stats, err := client.Info(ctx, "stats").Result()
	if err != nil {
		return QueryInsights{}, fmt.Errorf("redis stats info: %w", err)
	}
	resources, err := client.Info(ctx, "memory", "cpu").Result()
	if err != nil {
		return QueryInsights{}, fmt.Errorf("redis resource info: %w", err)
	}

	insights := parseRedisQueryInsights(commandStats, stats, resources, limit)
	return insights, nil
}

func parseRedisQueryInsights(commandStats, stats, resources string, limit int) QueryInsights {
	insights := newQueryInsights("redis_commandstats")
	insights.Queries = parseRedisCommandStats(commandStats)
	if limit > 0 && len(insights.Queries) > limit {
		insights.Queries = insights.Queries[:limit]
	}
	finalizeQueryInsights(&insights)

	statsValues := parseRedisInfoValues(stats)
	insights.Summary.OperationsPerSecond = parseRedisInfoInt(statsValues["instantaneous_ops_per_sec"])
	hits := parseRedisInfoInt(statsValues["keyspace_hits"])
	misses := parseRedisInfoInt(statsValues["keyspace_misses"])
	if lookups := hits + misses; lookups > 0 {
		insights.Summary.CacheHitRatio = float64(hits) / float64(lookups) * 100
	}
	resourceValues := parseRedisInfoValues(resources)
	insights.Resources.MemoryUsedBytes = parseRedisInfoInt(resourceValues["used_memory"])
	insights.Resources.MemoryLimitBytes = parseRedisInfoInt(resourceValues["maxmemory"])
	insights.Resources.MemoryAvailable = true
	insights.Resources.MemoryLimitLabel = "maxmemory"
	insights.Resources.Source = "redis"
	insights.Resources.CPUTotalSeconds =
		parseRedisInfoFloat(resourceValues["used_cpu_sys"]) +
			parseRedisInfoFloat(resourceValues["used_cpu_user"])
	insights.Resources.CPUAvailable = true
	return insights
}

func parseRedisCommandStats(info string) []QueryInsight {
	items := make([]QueryInsight, 0)
	for key, value := range parseRedisInfoValues(info) {
		if !strings.HasPrefix(key, "cmdstat_") {
			continue
		}
		values := parseRedisInfoFields(value)
		calls := parseRedisInfoInt(values["calls"])
		totalUS := parseRedisInfoFloat(values["usec"])
		averageUS := parseRedisInfoFloat(values["usec_per_call"])
		if averageUS == 0 && calls > 0 {
			averageUS = totalUS / float64(calls)
		}
		items = append(items, QueryInsight{
			Query:         strings.ToUpper(strings.TrimPrefix(key, "cmdstat_")),
			Calls:         calls,
			TotalTimeMS:   totalUS / 1000,
			AverageTimeMS: averageUS / 1000,
			FailedCalls:   parseRedisInfoInt(values["failed_calls"]),
			RejectedCalls: parseRedisInfoInt(values["rejected_calls"]),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].TotalTimeMS == items[j].TotalTimeMS {
			return items[i].Calls > items[j].Calls
		}
		return items[i].TotalTimeMS > items[j].TotalTimeMS
	})
	return items
}

func parseRedisInfoValues(info string) map[string]string {
	values := make(map[string]string)
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if ok {
			values[key] = value
		}
	}
	return values
}

func parseRedisInfoFields(value string) map[string]string {
	fields := make(map[string]string)
	for _, part := range strings.Split(value, ",") {
		key, fieldValue, ok := strings.Cut(part, "=")
		if ok {
			fields[key] = fieldValue
		}
	}
	return fields
}

func parseRedisInfoInt(value string) int64 {
	number, _ := strconv.ParseInt(value, 10, 64)
	return number
}

func parseRedisInfoFloat(value string) float64 {
	number, _ := strconv.ParseFloat(value, 64)
	return number
}

func formatRedisResult(res interface{}) (QueryResult, error) {
	switch v := res.(type) {
	case string:
		return QueryResult{
			Columns: []string{"Result"},
			Rows:    []map[string]string{{"Result": v}},
		}, nil
	case int64:
		return QueryResult{
			Columns: []string{"Result"},
			Rows:    []map[string]string{{"Result": strconv.FormatInt(v, 10)}},
		}, nil
	case []interface{}:
		var rows []map[string]string
		for i, item := range v {
			rows = append(rows, map[string]string{
				"Index": strconv.Itoa(i + 1),
				"Value": fmt.Sprintf("%v", item),
			})
		}
		if len(rows) == 0 {
			return QueryResult{
				Message: "Empty array",
			}, nil
		}
		return QueryResult{
			Columns: []string{"Index", "Value"},
			Rows:    rows,
		}, nil
	case nil:
		return QueryResult{
			Message: "nil",
		}, nil
	default:
		return QueryResult{
			Columns: []string{"Result"},
			Rows:    []map[string]string{{"Result": fmt.Sprintf("%v", v)}},
		}, nil
	}
}
