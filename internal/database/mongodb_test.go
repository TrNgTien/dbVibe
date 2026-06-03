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

func TestParseMongoQueryStats(t *testing.T) {
	items := parseMongoQueryStats([]bson.M{
		{
			"key": bson.M{
				"queryShape": bson.M{
					"command": "find",
					"cmdNs":   bson.M{"db": "shop", "coll": "orders"},
				},
			},
			"metrics": bson.M{
				"execCount":       int64(4),
				"totalExecMicros": bson.M{"sum": int64(12_000)},
				"docsReturned":    bson.M{"sum": int64(8)},
				"docsExamined":    bson.M{"sum": int64(40)},
			},
		},
	})
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	item := items[0]
	if item.Calls != 4 || item.TotalTimeMS != 12 || item.AverageTimeMS != 3 {
		t.Fatalf("timing = calls:%d total:%f average:%f", item.Calls, item.TotalTimeMS, item.AverageTimeMS)
	}
	if item.Rows != 8 || item.RowsExamined != 40 {
		t.Fatalf("documents = returned:%d examined:%d", item.Rows, item.RowsExamined)
	}
	if !strings.Contains(item.Query, `"find"`) || !strings.Contains(item.Query, `"orders"`) {
		t.Fatalf("query shape = %q", item.Query)
	}
}

func TestParseMongoQueryStatsWorkingTimeMillis(t *testing.T) {
	items := parseMongoQueryStats([]bson.M{
		{
			"key":     bson.M{"queryShape": bson.M{"command": "aggregate"}},
			"metrics": bson.M{"execCount": int64(2), "workingTimeMillis": int64(9)},
		},
	})
	if len(items) != 1 || items[0].TotalTimeMS != 9 || items[0].AverageTimeMS != 4.5 {
		t.Fatalf("items = %#v", items)
	}
}
