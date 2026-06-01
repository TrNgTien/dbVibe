package database

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"sql-gui/internal/store"
)

type CompletionItem struct {
	Label  string `json:"label"`
	Detail string `json:"detail"`
	Type   string `json:"type"`
	Apply  string `json:"apply"`
}

func GetCompletions(ctx context.Context, db *sql.DB, conn store.Connection, text string, position int) ([]CompletionItem, error) {
	if position > len(text) {
		position = len(text)
	}
	textBeforeCursor := text[:position]

	if conn.Driver == "redis" {
		return getRedisCompletions(ctx, conn, textBeforeCursor)
	}
	if conn.Driver == "elasticsearch" {
		return getElasticsearchCompletions(ctx, conn, textBeforeCursor)
	}
	return nil, nil
}

var redisCommands = []string{
	"APPEND", "AUTH", "BGREWRITEAOF", "BGSAVE", "BITCOUNT", "BITFIELD", "BITOP", "BITPOS", "BLPOP", "BRPOP", "BRPOPLPUSH", "BZMPOP", "BZPOPMAX", "BZPOPMIN", "CLIENT", "CLUSTER", "COMMAND", "CONFIG", "COPY", "DBSIZE", "DEBUG", "DECR", "DECRBY", "DEL", "DISCARD", "DUMP", "ECHO", "EVAL", "EVALSHA", "EXEC", "EXISTS", "EXPIRE", "EXPIREAT", "EXPIRETIME", "FAILOVER", "FLUSHALL", "FLUSHDB", "GEOADD", "GEODIST", "GEOHASH", "GEOPOS", "GEORADIUS", "GEORADIUSBYMEMBER", "GEOSEARCH", "GEOSEARCHSTORE", "GET", "GETBIT", "GETDEL", "GETEX", "GETRANGE", "GETSET", "HDEL", "HELLO", "HEXISTS", "HGET", "HGETALL", "HINCRBY", "HINCRBYFLOAT", "HKEYS", "HLEN", "HRANDFIELD", "HSCAN", "HSET", "HSETNX", "HSTRLEN", "HVALS", "INCR", "INCRBY", "INCRBYFLOAT", "INFO", "KEYS", "LASTSAVE", "LATENCY", "LCS", "LINDEX", "LINSERT", "LLEN", "LMOVE", "LMPOP", "LPOP", "LPOS", "LPUSH", "LPUSHX", "LRANGE", "LREM", "LSET", "LTRIM", "MEMORY", "MGET", "MIGRATE", "MODULE", "MONITOR", "MOVE", "MSET", "MSETNX", "MULTI", "OBJECT", "PERSIST", "PEXPIRE", "PEXPIREAT", "PEXPIRETIME", "PFADD", "PFCOUNT", "PFMERGE", "PING", "PSETEX", "PSUBSCRIBE", "PSYNC", "PTTL", "PUBLISH", "PUBSUB", "PUNSUBSCRIBE", "QUIT", "RANDOMKEY", "READONLY", "READWRITE", "RENAME", "RENAMENX", "REPLCONF", "REPLICAOF", "RESET", "RESTORE", "ROLE", "RPOP", "RPOPLPUSH", "RPUSH", "RPUSHX", "SADD", "SAVE", "SCAN", "SCARD", "SCRIPT", "SDIFF", "SDIFFSTORE", "SELECT", "SET", "SETBIT", "SETEX", "SETNX", "SETRANGE", "SHUTDOWN", "SINTER", "SINTERSTORE", "SISMEMBER", "SLAVEOF", "SLOWLOG", "SMEMBERS", "SMISMEMBER", "SMOVE", "SORT", "SORT_RO", "SPOP", "SRANDMEMBER", "SREM", "SSCAN", "STRLEN", "SUBSCRIBE", "SUBSTR", "SWAPDB", "SYNC", "TIME", "TOUCH", "TTL", "TYPE", "UNLINK", "UNSUBSCRIBE", "UNWATCH", "WAIT", "WATCH", "XACK", "XADD", "XAUTOCLAIM", "XCLAIM", "XDEL", "XGROUP", "XINFO", "XLEN", "XPENDING", "XRANGE", "XREAD", "XREADGROUP", "XREVRANGE", "XSETID", "XTRIM", "ZADD", "ZCARD", "ZCOUNT", "ZDIFF", "ZDIFFSTORE", "ZINCRBY", "ZINTER", "ZINTERSTORE", "ZLEXCOUNT", "ZMPOP", "ZMSCORE", "ZPOPMAX", "ZPOPMIN", "ZRANDMEMBER", "ZRANGE", "ZRANGEBYLEX", "ZRANGEBYSCORE", "ZRANGESTORE", "ZRANK", "ZREM", "ZREMRANGEBYLEX", "ZREMRANGEBYRANK", "ZREMRANGEBYSCORE", "ZREVRANGE", "ZREVRANGEBYLEX", "ZREVRANGEBYSCORE", "ZREVRANK", "ZSCAN", "ZSCORE", "ZUNION", "ZUNIONSTORE",
}

func getRedisCompletions(ctx context.Context, conn store.Connection, textBeforeCursor string) ([]CompletionItem, error) {
	parts := strings.Fields(textBeforeCursor)
	// If empty or one word without trailing space, suggest commands
	if len(parts) == 0 || (len(parts) == 1 && !strings.HasSuffix(textBeforeCursor, " ")) {
		var items []CompletionItem
		prefix := ""
		if len(parts) == 1 {
			prefix = strings.ToUpper(parts[0])
		}
		for _, cmd := range redisCommands {
			if strings.HasPrefix(cmd, prefix) {
				items = append(items, CompletionItem{
					Label:  cmd,
					Detail: "command",
					Type:   "keyword",
					Apply:  cmd + " ",
				})
			}
		}
		return items, nil
	}

	// Suggest keys
	prefix := ""
	if !strings.HasSuffix(textBeforeCursor, " ") {
		prefix = parts[len(parts)-1]
	}

	keys, err := fetchRedisKeys(ctx, conn, prefix+"*")
	if err != nil {
		return nil, err
	}

	var items []CompletionItem
	for _, key := range keys {
		items = append(items, CompletionItem{
			Label:  key,
			Detail: "key",
			Type:   "variable",
			Apply:  key + " ",
		})
	}
	return items, nil
}

func fetchRedisKeys(ctx context.Context, conn store.Connection, pattern string) ([]string, error) {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)))
	if err != nil {
		return nil, err
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(raw)

	if conn.Password != "" {
		if conn.User != "" {
			if err := redisCommand(raw, reader, "AUTH", conn.User, conn.Password); err != nil {
				return nil, err
			}
		} else if err := redisCommand(raw, reader, "AUTH", conn.Password); err != nil {
			return nil, err
		}
	}
	if db := redisDatabase(conn.Database); db != "0" {
		if err := redisCommand(raw, reader, "SELECT", db); err != nil {
			return nil, err
		}
	}

	// Send KEYS command
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("*2\r\n$4\r\nKEYS\r\n$%d\r\n%s\r\n", len(pattern), pattern))
	if _, err := io.WriteString(raw, builder.String()); err != nil {
		return nil, err
	}

	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(line, "-") {
		return nil, fmt.Errorf(strings.TrimSpace(strings.TrimPrefix(line, "-")))
	}
	if !strings.HasPrefix(line, "*") {
		return nil, fmt.Errorf("unexpected response from KEYS: %s", line)
	}

	countStr := strings.TrimSpace(strings.TrimPrefix(line, "*"))
	count, err := strconv.Atoi(countStr)
	if err != nil || count < 0 {
		return nil, nil // empty or error
	}

	var keys []string
	for i := 0; i < count; i++ {
		// read string length
		lenLine, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		if !strings.HasPrefix(lenLine, "$") {
			continue
		}
		strLen, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(lenLine, "$")))
		if strLen < 0 {
			continue
		}
		
		buf := make([]byte, strLen+2) // +2 for \r\n
		io.ReadFull(reader, buf)
		keys = append(keys, string(buf[:strLen]))
	}

	// Limit to 100 to avoid overwhelming UI
	if len(keys) > 100 {
		keys = keys[:100]
	}

	return keys, nil
}

var esMethods = []string{"GET", "POST", "PUT", "DELETE", "HEAD"}
var esEndpoints = []string{"_search", "_count", "_mapping", "_doc", "_alias", "_update", "_bulk"}

func getElasticsearchCompletions(ctx context.Context, conn store.Connection, textBeforeCursor string) ([]CompletionItem, error) {
	// We only provide completions for the first line (the HTTP line) in Kibana syntax.
	// If there's a newline, we're likely in the JSON body.
	if strings.Contains(textBeforeCursor, "\n") {
		return nil, nil
	}

	parts := strings.Fields(textBeforeCursor)
	
	// If empty or no spaces yet, suggest HTTP methods
	if len(parts) == 0 || (len(parts) == 1 && !strings.HasSuffix(textBeforeCursor, " ")) {
		var items []CompletionItem
		prefix := ""
		if len(parts) == 1 {
			prefix = strings.ToUpper(parts[0])
		}
		for _, method := range esMethods {
			if strings.HasPrefix(method, prefix) {
				items = append(items, CompletionItem{
					Label:  method,
					Detail: "method",
					Type:   "keyword",
					Apply:  method + " ",
				})
			}
		}
		return items, nil
	}

	// If we are on the second part (path), suggest indices and endpoints
	pathPrefix := ""
	if !strings.HasSuffix(textBeforeCursor, " ") {
		pathPrefix = parts[len(parts)-1]
	}

	// Remove leading slash for matching, but keep it in mind
	searchPrefix := strings.TrimPrefix(pathPrefix, "/")

	var items []CompletionItem
	
	// Suggest endpoints if we are typing one (starts with _)
	if strings.HasPrefix(searchPrefix, "_") || searchPrefix == "" {
		for _, ep := range esEndpoints {
			if strings.HasPrefix(ep, searchPrefix) {
				// We usually want a slash before it if it's the root, but let's just supply it
				applyStr := ep
				if !strings.HasPrefix(pathPrefix, "/") && pathPrefix != "" {
					// if user typed "_se", apply "_search"
					applyStr = ep
				} else if pathPrefix == "" {
					applyStr = "/" + ep
				} else if strings.HasPrefix(pathPrefix, "/") {
					applyStr = "/" + ep
				}
				items = append(items, CompletionItem{
					Label:  ep,
					Detail: "endpoint",
					Type:   "keyword",
					Apply:  applyStr,
				})
			}
		}
	}

	// Fetch indices dynamically
	indices, err := elasticsearchIndices(ctx, conn)
	if err == nil {
		for _, idx := range indices {
			if strings.HasPrefix(idx.Name, searchPrefix) {
				applyStr := idx.Name
				if strings.HasPrefix(pathPrefix, "/") {
					applyStr = "/" + idx.Name
				} else if pathPrefix == "" {
					applyStr = "/" + idx.Name
				}
				items = append(items, CompletionItem{
					Label:  idx.Name,
					Detail: "index",
					Type:   "variable",
					Apply:  applyStr,
				})
			}
		}
	}

	return items, nil
}
