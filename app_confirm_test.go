package main

import "testing"

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
