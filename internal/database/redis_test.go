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
