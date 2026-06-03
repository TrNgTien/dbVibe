package database

import (
	"reflect"
	"testing"
)

func TestFirstRedisCommand(t *testing.T) {
	t.Parallel()

	got := firstRedisCommand("\n  \n  SET mykey \"hello\"  \nGET mykey\n")
	if got != `SET mykey "hello"` {
		t.Fatalf("firstRedisCommand() = %q", got)
	}
}

func TestParseRedisCommandTrimsWhitespace(t *testing.T) {
	t.Parallel()

	got := parseRedisCommand(`  SET   mykey   "hello world"  `)
	want := []interface{}{"SET", "mykey", "hello world"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseRedisCommand() = %#v, want %#v", got, want)
	}
}

func TestParseRedisQueryInsights(t *testing.T) {
	t.Parallel()

	commandStats := `# Commandstats
cmdstat_get:calls=100,usec=5000,usec_per_call=50.00,rejected_calls=2,failed_calls=3
cmdstat_set:calls=20,usec=10000,usec_per_call=500.00,rejected_calls=0,failed_calls=1
`
	stats := `# Stats
instantaneous_ops_per_sec:42
keyspace_hits:90
keyspace_misses:10
`

	resources := `# Memory
used_memory:1048576
maxmemory:4194304
# CPU
used_cpu_sys:2.5
used_cpu_user:7.5
`

	insights := parseRedisQueryInsights(commandStats, stats, resources, 25)

	if !insights.Available {
		t.Fatal("parseRedisQueryInsights() Available = false, want true")
	}
	if insights.Summary.StatementCount != 2 {
		t.Fatalf("StatementCount = %d, want 2", insights.Summary.StatementCount)
	}
	if insights.Summary.OperationsPerSecond != 42 {
		t.Fatalf("OperationsPerSecond = %d, want 42", insights.Summary.OperationsPerSecond)
	}
	if insights.Summary.CacheHitRatio != 90 {
		t.Fatalf("CacheHitRatio = %f, want 90", insights.Summary.CacheHitRatio)
	}
	if insights.Summary.FailedCalls != 4 || insights.Summary.RejectedCalls != 2 {
		t.Fatalf(
			"failures = %d/%d, want 4/2",
			insights.Summary.FailedCalls,
			insights.Summary.RejectedCalls,
		)
	}
	if insights.Resources.MemoryUsedBytes != 1048576 || insights.Resources.MemoryLimitBytes != 4194304 {
		t.Fatalf(
			"memory = %d/%d, want 1048576/4194304",
			insights.Resources.MemoryUsedBytes,
			insights.Resources.MemoryLimitBytes,
		)
	}
	if insights.Resources.CPUTotalSeconds != 10 {
		t.Fatalf("CPUTotalSeconds = %f, want 10", insights.Resources.CPUTotalSeconds)
	}
	if insights.Queries[0].Query != "SET" {
		t.Fatalf("first command = %q, want SET", insights.Queries[0].Query)
	}
	if insights.Queries[0].TotalTimeMS != 10 {
		t.Fatalf("SET TotalTimeMS = %f, want 10", insights.Queries[0].TotalTimeMS)
	}
}

func TestParseRedisQueryInsightsLimit(t *testing.T) {
	t.Parallel()

	insights := parseRedisQueryInsights(`
cmdstat_get:calls=100,usec=5000,usec_per_call=50.00
cmdstat_set:calls=20,usec=10000,usec_per_call=500.00
`, "", "", 1)

	if len(insights.Queries) != 1 {
		t.Fatalf("len(Queries) = %d, want 1", len(insights.Queries))
	}
	if insights.Queries[0].Query != "SET" {
		t.Fatalf("first command = %q, want SET", insights.Queries[0].Query)
	}
}
