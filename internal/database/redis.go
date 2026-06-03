package database

import (
	"context"
	"crypto/tls"
	"fmt"
	"slices"
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
