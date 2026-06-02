package database

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/redis/go-redis/v9"
	"sql-gui/internal/store"
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

func ExecuteRedis(ctx context.Context, conn store.Connection, sqlText string) (QueryResult, error) {
	if strings.TrimSpace(sqlText) == "" {
		return QueryResult{}, fmt.Errorf("empty command")
	}

	opts := &redis.Options{
		Addr: fmt.Sprintf("%s:%d", conn.Host, conn.Port),
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

	client := redis.NewClient(opts)
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		return QueryResult{}, fmt.Errorf("redis ping failed: %w", err)
	}

	args := parseRedisCommand(sqlText)
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
