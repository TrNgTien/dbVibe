package database

import "testing"

func TestRedisDatabaseDefaultsToZero(t *testing.T) {
	t.Parallel()

	if got := redisDatabase(""); got != "0" {
		t.Fatalf("redisDatabase(\"\") = %q, want %q", got, "0")
	}
}

func TestRedisDatabaseStripsDbPrefix(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"db1":  "1",
		"DB 2": "2",
		"db 0": "0",
	}
	for input, want := range cases {
		if got := redisDatabase(input); got != want {
			t.Fatalf("redisDatabase(%q) = %q, want %q", input, got, want)
		}
	}
}
