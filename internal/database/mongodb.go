package database

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"sql-gui/internal/store"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func TestMongoDB(ctx context.Context, conn store.Connection) error {
	client, err := newMongoClient(conn)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	if err := client.Ping(ctx, nil); err != nil {
		return fmt.Errorf("mongodb ping failed: %w", err)
	}
	return nil
}

func InspectMongoDB(ctx context.Context, conn store.Connection) (ConnectionDetail, error) {
	client, err := newMongoClient(conn)
	if err != nil {
		return ConnectionDetail{}, err
	}
	defer client.Disconnect(context.Background())
	if err := client.Ping(ctx, nil); err != nil {
		return ConnectionDetail{}, fmt.Errorf("mongodb ping failed: %w", err)
	}

	databaseName := mongoDatabase(conn.Database)
	names, err := client.ListDatabaseNames(ctx, bson.D{})
	if err != nil {
		names = []string{databaseName}
	}
	databases := make([]DatabaseInfo, 0, len(names))
	for _, name := range names {
		databases = append(databases, DatabaseInfo{Name: name})
	}
	if !containsDatabase(databases, databaseName) {
		databases = append(databases, DatabaseInfo{Name: databaseName})
	}
	sort.Slice(databases, func(i, j int) bool { return databases[i].Name < databases[j].Name })

	collections, err := client.Database(databaseName).ListCollectionNames(ctx, bson.D{})
	if err != nil {
		return ConnectionDetail{}, fmt.Errorf("list mongodb collections: %w", err)
	}
	tables := make([]TableInfo, 0, len(collections))
	for _, name := range collections {
		count, countErr := client.Database(databaseName).Collection(name).EstimatedDocumentCount(ctx)
		if countErr != nil {
			count = 0
		}
		tables = append(tables, TableInfo{
			Schema: databaseName,
			Name:   name,
			Type:   "collection",
			Rows:   count,
		})
	}
	sort.Slice(tables, func(i, j int) bool { return tables[i].Name < tables[j].Name })
	return ConnectionDetail{
		Driver:    conn.Driver,
		Database:  databaseName,
		Databases: databases,
		Tables:    tables,
	}, nil
}

func InspectMongoCollection(ctx context.Context, conn store.Connection, collectionName string, limit int) (TableDetail, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	client, err := newMongoClient(conn)
	if err != nil {
		return TableDetail{}, err
	}
	defer client.Disconnect(context.Background())

	databaseName := mongoDatabase(conn.Database)
	collection := client.Database(databaseName).Collection(collectionName)
	count, countErr := collection.EstimatedDocumentCount(ctx)
	if countErr != nil {
		count = 0
	}
	cursor, err := collection.Find(ctx, bson.D{}, options.Find().SetLimit(int64(limit)))
	if err != nil {
		return TableDetail{}, fmt.Errorf("find mongodb collection %q: %w", collectionName, err)
	}
	defer cursor.Close(ctx)

	documents := make([]bson.M, 0, limit)
	if err := cursor.All(ctx, &documents); err != nil {
		return TableDetail{}, fmt.Errorf("read mongodb collection %q: %w", collectionName, err)
	}
	sample, columns, err := mongoDocumentsResult(documents)
	if err != nil {
		return TableDetail{}, err
	}
	indexes, err := mongoIndexes(ctx, collection)
	if err != nil {
		return TableDetail{}, err
	}
	return TableDetail{
		Table: TableInfo{
			Schema:  databaseName,
			Name:    collectionName,
			Type:    "collection",
			Rows:    count,
			Columns: columns,
		},
		Columns:   columns,
		Indexes:   indexes,
		CreateSQL: fmt.Sprintf(`{"create":"%s"}`, collectionName),
		Sample:    sample,
	}, nil
}

func ExecuteMongoDB(ctx context.Context, conn store.Connection, commandText string, limit int) (QueryResult, error) {
	if limit <= 0 || limit > 1000 {
		limit = 300
	}
	var command bson.D
	if err := bson.UnmarshalExtJSON([]byte(strings.TrimSpace(commandText)), false, &command); err != nil {
		return QueryResult{}, fmt.Errorf("parse mongodb command JSON: %w", err)
	}
	if len(command) == 0 {
		return QueryResult{}, fmt.Errorf("mongodb command is empty")
	}

	client, err := newMongoClient(conn)
	if err != nil {
		return QueryResult{}, err
	}
	defer client.Disconnect(context.Background())

	start := time.Now()
	var response bson.M
	if err := client.Database(mongoDatabase(conn.Database)).RunCommand(ctx, command).Decode(&response); err != nil {
		return QueryResult{}, fmt.Errorf("execute mongodb command: %w", err)
	}
	result, err := mongoCommandResult(response, limit)
	result.DurationMS = float64(time.Since(start).Microseconds()) / 1000.0
	return result, err
}

func mongoQueryInsights(ctx context.Context, conn store.Connection, limit int) (QueryInsights, error) {
	insights := newQueryInsights("mongodb_query_stats")
	client, err := newMongoClient(conn)
	if err != nil {
		return QueryInsights{}, err
	}
	defer client.Disconnect(context.Background())
	if err := client.Ping(ctx, nil); err != nil {
		return QueryInsights{}, fmt.Errorf("mongodb ping failed: %w", err)
	}

	insights.Resources = mongoResourceInsight(ctx, client)
	pipeline := mongo.Pipeline{
		bson.D{{Key: "$queryStats", Value: bson.D{}}},
		bson.D{{Key: "$addFields", Value: bson.D{{
			Key: "__dbvibeTotalTime",
			Value: bson.D{{Key: "$ifNull", Value: bson.A{
				"$metrics.totalExecMicros.sum",
				bson.D{{Key: "$multiply", Value: bson.A{"$metrics.workingTimeMillis", 1000}}},
			}}},
		}}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "__dbvibeTotalTime", Value: -1}}}},
		bson.D{{Key: "$limit", Value: limit}},
	}
	cursor, err := client.Database("admin").Aggregate(ctx, pipeline)
	if err != nil {
		insights.Message = "MongoDB query statistics are unavailable. $queryStats requires a supported MongoDB version, queryStats feature configuration, and sufficient privileges."
		return insights, nil
	}
	defer cursor.Close(ctx)

	var rows []bson.M
	if err := cursor.All(ctx, &rows); err != nil {
		return QueryInsights{}, fmt.Errorf("read mongodb query statistics: %w", err)
	}
	insights.Queries = parseMongoQueryStats(rows)
	finalizeQueryInsights(&insights)
	return insights, nil
}

func mongoResourceInsight(ctx context.Context, client *mongo.Client) ResourceInsight {
	resource := ResourceInsight{
		Source:           "mongodb",
		MemoryLimitLabel: "host memory",
		CPUMessage:       "MongoDB CPU telemetry is unavailable on this server.",
	}
	var status bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "serverStatus", Value: 1}}).Decode(&status); err == nil {
		if memory := bsonMap(status["mem"]); memory != nil {
			resource.MemoryUsedBytes = bsonInt64(memory["resident"]) * 1024 * 1024
			resource.MemoryAvailable = resource.MemoryUsedBytes > 0
		}
		if extra := bsonMap(status["extra_info"]); extra != nil {
			userMicros := bsonFloat64(extra["user_time_us"])
			systemMicros := bsonFloat64(extra["system_time_us"])
			if totalMicros := userMicros + systemMicros; totalMicros > 0 {
				resource.CPUAvailable = true
				resource.CPUTotalSeconds = totalMicros / 1_000_000
			}
		}
	}
	var hostInfo bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "hostInfo", Value: 1}}).Decode(&hostInfo); err == nil {
		if system := bsonMap(hostInfo["system"]); system != nil {
			memoryMB := bsonInt64(system["memLimitMB"])
			if memoryMB == 0 {
				memoryMB = bsonInt64(system["memSizeMB"])
			}
			resource.MemoryLimitBytes = memoryMB * 1024 * 1024
		}
	}
	return resource
}

func parseMongoQueryStats(rows []bson.M) []QueryInsight {
	items := make([]QueryInsight, 0, len(rows))
	for _, row := range rows {
		key := bsonMap(row["key"])
		metrics := bsonMap(row["metrics"])
		if key == nil || metrics == nil {
			continue
		}
		queryShape := key["queryShape"]
		queryJSON, err := bson.MarshalExtJSON(queryShape, false, false)
		if err != nil {
			continue
		}
		calls := bsonInt64(metrics["execCount"])
		totalMicros := float64(mongoMetricSum(metrics["totalExecMicros"]))
		if totalMicros == 0 {
			totalMicros = bsonFloat64(metrics["workingTimeMillis"]) * 1000
		}
		item := QueryInsight{
			Query:        string(queryJSON),
			Calls:        calls,
			TotalTimeMS:  totalMicros / 1000,
			Rows:         mongoMetricSum(metrics["docsReturned"]),
			RowsExamined: mongoMetricSum(metrics["docsExamined"]),
		}
		if calls > 0 {
			item.AverageTimeMS = item.TotalTimeMS / float64(calls)
		}
		items = append(items, item)
	}
	return items
}

func mongoMetricSum(value any) int64 {
	metric := bsonMap(value)
	if metric == nil {
		return bsonInt64(value)
	}
	return bsonInt64(metric["sum"])
}

func bsonMap(value any) bson.M {
	switch value := value.(type) {
	case bson.M:
		return value
	case bson.D:
		result := make(bson.M, len(value))
		for _, element := range value {
			result[element.Key] = element.Value
		}
		return result
	default:
		return nil
	}
}

func bsonInt64(value any) int64 {
	switch value := value.(type) {
	case int:
		return int64(value)
	case int32:
		return int64(value)
	case int64:
		return value
	case float32:
		return int64(value)
	case float64:
		return int64(value)
	default:
		return 0
	}
}

func bsonFloat64(value any) float64 {
	switch value := value.(type) {
	case int:
		return float64(value)
	case int32:
		return float64(value)
	case int64:
		return float64(value)
	case float32:
		return float64(value)
	case float64:
		return value
	default:
		return 0
	}
}

func newMongoClient(conn store.Connection) (*mongo.Client, error) {
	clientOptions := options.Client().ApplyURI(mongoURI(conn))
	if conn.UseTLS {
		clientOptions.SetTLSConfig(&tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: conn.Host,
		})
	}
	client, err := mongo.Connect(clientOptions)
	if err != nil {
		return nil, fmt.Errorf("connect mongodb: %w", err)
	}
	return client, nil
}

func mongoURI(conn store.Connection) string {
	u := url.URL{
		Scheme: "mongodb",
		Host:   net.JoinHostPort(conn.Host, strconv.Itoa(conn.Port)),
	}
	if database := strings.TrimSpace(conn.Database); database != "" {
		u.Path = "/" + database
	}
	if conn.User != "" || conn.Password != "" {
		u.User = url.UserPassword(conn.User, conn.Password)
	}
	values := url.Values{}
	if conn.UseTLS {
		values.Set("tls", "true")
	}
	u.RawQuery = values.Encode()
	return u.String()
}

func mongoDatabase(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "test"
}

func mongoCommandResult(response bson.M, limit int) (QueryResult, error) {
	if cursor, ok := response["cursor"].(bson.M); ok {
		for _, key := range []string{"firstBatch", "nextBatch"} {
			if documents, ok := mongoDocumentSlice(cursor[key]); ok {
				if len(documents) > limit {
					documents = documents[:limit]
				}
				result, _, err := mongoDocumentsResult(documents)
				return result, err
			}
		}
	}
	if documents, ok := mongoDocumentSlice(response["documents"]); ok {
		if len(documents) > limit {
			documents = documents[:limit]
		}
		result, _, err := mongoDocumentsResult(documents)
		return result, err
	}
	row, err := mongoDocumentRow(response)
	if err != nil {
		return QueryResult{}, err
	}
	columns := sortedKeys(row)
	return QueryResult{Columns: columns, Rows: []map[string]string{row}, Message: "Command executed"}, nil
}

func mongoDocumentsResult(documents []bson.M) (QueryResult, []Column, error) {
	rows := make([]map[string]string, 0, len(documents))
	columnSet := make(map[string]struct{})
	for _, document := range documents {
		row, err := mongoDocumentRow(document)
		if err != nil {
			return QueryResult{}, nil, err
		}
		for key := range row {
			columnSet[key] = struct{}{}
		}
		rows = append(rows, row)
	}
	columnNames := make([]string, 0, len(columnSet))
	for name := range columnSet {
		columnNames = append(columnNames, name)
	}
	sort.Strings(columnNames)
	columns := make([]Column, 0, len(columnNames))
	for index, name := range columnNames {
		columns = append(columns, Column{Name: name, Type: "bson", Nullable: true, Ordinal: index + 1})
	}
	return QueryResult{Columns: columnNames, Rows: rows}, columns, nil
}

func mongoDocumentRow(document bson.M) (map[string]string, error) {
	row := make(map[string]string, len(document))
	for key, value := range document {
		data, err := bson.MarshalExtJSON(bson.M{"value": value}, false, false)
		if err != nil {
			return nil, fmt.Errorf("format mongodb field %q: %w", key, err)
		}
		var wrapper map[string]json.RawMessage
		if err := json.Unmarshal(data, &wrapper); err != nil {
			return nil, fmt.Errorf("decode mongodb field %q: %w", key, err)
		}
		valueJSON := wrapper["value"]
		var scalar any
		if json.Unmarshal(valueJSON, &scalar) == nil {
			switch value := scalar.(type) {
			case string:
				row[key] = value
			case nil:
				row[key] = "null"
			default:
				row[key] = string(valueJSON)
			}
		} else {
			row[key] = string(valueJSON)
		}
	}
	return row, nil
}

func mongoDocumentSlice(value any) ([]bson.M, bool) {
	switch documents := value.(type) {
	case bson.A:
		result := make([]bson.M, 0, len(documents))
		for _, document := range documents {
			item, ok := document.(bson.M)
			if !ok {
				return nil, false
			}
			result = append(result, item)
		}
		return result, true
	case []bson.M:
		return documents, true
	default:
		return nil, false
	}
}

func mongoIndexes(ctx context.Context, collection *mongo.Collection) ([]Index, error) {
	cursor, err := collection.Indexes().List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list mongodb indexes: %w", err)
	}
	defer cursor.Close(ctx)
	var specs []bson.M
	if err := cursor.All(ctx, &specs); err != nil {
		return nil, fmt.Errorf("read mongodb indexes: %w", err)
	}
	indexes := make([]Index, 0, len(specs))
	for _, spec := range specs {
		name, _ := spec["name"].(string)
		keyJSON, _ := bson.MarshalExtJSON(spec["key"], false, false)
		unique, _ := spec["unique"].(bool)
		indexes = append(indexes, Index{Name: name, Columns: string(keyJSON), Unique: unique, SQL: string(keyJSON)})
	}
	return indexes, nil
}

func containsDatabase(databases []DatabaseInfo, name string) bool {
	for _, database := range databases {
		if database.Name == name {
			return true
		}
	}
	return false
}

func sortedKeys(row map[string]string) []string {
	keys := make([]string, 0, len(row))
	for key := range row {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
