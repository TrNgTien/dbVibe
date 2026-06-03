package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sql-gui/internal/store"
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

func TestMySQLBinlogErrorProxySQL(t *testing.T) {
	t.Parallel()

	output := `# The proper term is pseudo_replica_mode, but we use this compatibility alias
# to make the statement usable on server versions 8.0.24 and older.
/*!50530 SET @@SESSION.PSEUDO_SLAVE_MODE=1*/;
/*!50003 SET @OLD_COMPLETION_TYPE=@@COMPLETION_TYPE,COMPLETION_TYPE=0*/;
DELIMITER /*!*/;
mysqlbinlog: Got error reading packet from server: Lost connection to MySQL server during query`

	got := mysqlbinlogError(errors.New("exit status 1"), output, "proxysql.example.internal").Error()
	if !strings.Contains(got, "closed the binary log stream") {
		t.Fatalf("mysqlbinlogError() = %q", got)
	}
	if strings.Contains(got, "PSEUDO_SLAVE_MODE") {
		t.Fatalf("mysqlbinlogError() included generated mysqlbinlog header: %q", got)
	}
}

func TestMySQLBinlogErrorKeepsDiagnostic(t *testing.T) {
	t.Parallel()

	got := mysqlbinlogError(errors.New("exit status 1"), "ERROR: Access denied", "mysql.example.internal").Error()
	if !strings.Contains(got, "ERROR: Access denied") {
		t.Fatalf("mysqlbinlogError() = %q", got)
	}
}

func TestBinlogConnection(t *testing.T) {
	t.Parallel()

	conn := store.Connection{
		Host:       "proxysql.example.internal",
		Port:       3306,
		BinlogHost: "mysql-primary.example.internal",
		BinlogPort: 3307,
	}
	got := binlogConnection(conn)
	if got.Host != conn.BinlogHost || got.Port != conn.BinlogPort {
		t.Fatalf("binlogConnection() = %s:%d", got.Host, got.Port)
	}
}
