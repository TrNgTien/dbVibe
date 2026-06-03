package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfirmRedisKeyDeleteMessage(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		key      string
		database string
		want     string
	}{
		"default db": {key: "users:1", database: "", want: `Delete Redis key "users:1" from db0?`},
		"db 2":       {key: "cache", database: "2", want: `Delete Redis key "cache" from db2?`},
	}
	for name, tc := range cases {
		tc := tc
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if got := confirmRedisKeyDeleteMessage(tc.key, tc.database); got != tc.want {
				t.Fatalf("confirmRedisKeyDeleteMessage(%q, %q) = %q, want %q", tc.key, tc.database, got, tc.want)
			}
		})
	}
}

func TestFirstExecutable(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	nonExecutable := filepath.Join(dir, "non-executable")
	executable := filepath.Join(dir, "executable")
	if err := os.WriteFile(nonExecutable, []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, []byte(""), 0o755); err != nil {
		t.Fatal(err)
	}

	if got := firstExecutable([]string{nonExecutable, executable}); got != executable {
		t.Fatalf("firstExecutable() = %q, want %q", got, executable)
	}
}
