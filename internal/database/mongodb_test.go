package database

import (
	"strings"
	"testing"

	"sql-gui/internal/store"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestMongoDatabaseDefault(t *testing.T) {
	if got := mongoDatabase(" "); got != "test" {
		t.Fatalf("mongoDatabase() = %q, want test", got)
	}
}

func TestMongoURI(t *testing.T) {
	got := mongoURI(store.Connection{
		Host:     "localhost",
		Port:     27017,
		User:     "user@example.com",
		Password: "p@ss",
		UseTLS:   true,
	})
	for _, part := range []string{"mongodb://", "user%40example.com:p%40ss@", "localhost:27017", "tls=true"} {
		if !strings.Contains(got, part) {
			t.Fatalf("mongoURI() = %q, missing %q", got, part)
		}
	}
}

func TestMongoCommandResultFormatsCursorBatch(t *testing.T) {
	result, err := mongoCommandResult(bson.M{
		"cursor": bson.M{
			"firstBatch": bson.A{
				bson.M{"_id": 1, "name": "Ada"},
				bson.M{"_id": 2, "name": "Linus"},
			},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(result.Rows))
	}
	if result.Rows[0]["name"] != "Ada" {
		t.Fatalf("name = %q, want Ada", result.Rows[0]["name"])
	}
}
