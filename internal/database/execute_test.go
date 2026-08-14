package database

import "testing"

func TestIsQueryStatement(t *testing.T) {
	cases := []struct {
		sql  string
		want bool
	}{
		{"SELECT * FROM users", true},
		{"select 1", true},
		{"  SELECT name FROM users;", true},
		{"/* hint */ SELECT * FROM t", true},
		{"(SELECT 1) UNION (SELECT 2)", true},
		{"SHOW TABLES", true},
		{"DESCRIBE users", true},
		{"EXPLAIN SELECT * FROM t", true},
		{"WITH cte AS (SELECT 1) SELECT * FROM cte", true},
		{"UPDATE users SET name = 'x' WHERE id = 1", false},
		{"INSERT INTO users (name) VALUES ('x')", false},
		{"DELETE FROM users WHERE id = 1", false},
		{"CREATE TABLE t (id INT)", false},
		{"ALTER TABLE t ADD COLUMN c INT", false},
		{"DROP TABLE t", false},
		{"TRUNCATE TABLE t", false},
		{"SET @x = 1", false},
		{"USE mydb", false},
		{"BEGIN", false},
		{"COMMIT", false},
	}
	for _, c := range cases {
		if got := isQueryStatement(c.sql); got != c.want {
			t.Errorf("isQueryStatement(%q) = %v, want %v", c.sql, got, c.want)
		}
	}
}
