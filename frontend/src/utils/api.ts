export function databaseKey(name) {
  return `database:${name}`;
}

export function defaultPort(driver) {
  if (driver === "postgres") return 5432;
  if (driver === "redis") return 6379;
  if (driver === "elasticsearch") return 9200;
  return 3306;
}

export function driverLabel(driver) {
  if (driver === "postgres") return "PostgreSQL";
  if (driver === "redis") return "Redis";
  if (driver === "elasticsearch") return "Elasticsearch";
  return "MySQL";
}

export function isLocalConnection(conn) {
  return ["localhost", "127.0.0.1", "::1"].includes(
    String(conn.host || "").toLowerCase(),
  );
}

export function connectionLabel(status) {
  if (status === "connecting") return "connecting";
  if (status === "connected") return "connected";
  if (status === "error") return "error";
  return "not connected";
}

export function eventCombo(event) {
  const parts = [];
  if (event.metaKey) parts.push("Meta");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key =
    event.key === " "
      ? "Space"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key;
  parts.push(key);
  return parts.join("+");
}

export function normalizeObjectType(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("view")) return "view";
  return "table";
}

export function quoteName(driver, schema, table) {
  if (driver === "mysql") return `\`${table}\``;
  return `"${schema}"."${table}"`;
}

export function parseExplainPlan(text) {
  return String(text || "")
    .split(/\n|->/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const depth = Math.max(0, (line.match(/^\s*/)?.[0]?.length || 0) / 2);
      const clean = line.replace(/^[-|> ]+/, "").trim();
      const costIndex = clean.search(/\b\(cost=|\(actual time=|\(cost:/i);
      const label = costIndex > 0 ? clean.slice(0, costIndex).trim() : clean;
      const detail = costIndex > 0 ? clean.slice(costIndex).trim() : "";
      return { depth, label, detail };
    })
    .filter(
      (node) => node.label && !/^(explain|query plan)$/i.test(node.label),
    );
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

export function formatCompactCount(value) {
  const number = Number(value || 0);
  if (!number) return "";
  if (number >= 1_000_000) return `${stripTrailingZero(number / 1_000_000)}M`;
  if (number >= 1_000) return `${stripTrailingZero(number / 1_000)}K`;
  return String(number);
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${stripTrailingZero(bytes / 1024 ** 3)}G`;
  if (bytes >= 1024 ** 2) return `${stripTrailingZero(bytes / 1024 ** 2)}M`;
  if (bytes >= 1024) return `${stripTrailingZero(bytes / 1024)}K`;
  return `${bytes}B`;
}

export function stripTrailingZero(value) {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
}

export function totalRows(tables) {
  return tables.reduce((sum, table) => sum + Number(table.rows || 0), 0);
}

import React from "react";

export function useLocalStorage(key, initialValue) {
  const [value, setValue] = React.useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });
  React.useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

const sampleConnections = [
  {
    id: "demo-pg",
    name: "Local Postgres",
    driver: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "postgres",
    sslMode: "disable",
  },
  {
    id: "demo-my",
    name: "Local MySQL",
    driver: "mysql",
    host: "localhost",
    port: 3306,
    database: "app",
    user: "root",
    useTLS: false,
  },
];

const demoTables = [
  {
    schema: "public",
    name: "users",
    type: "table",
    rows: 1248,
    columns: [
      { name: "id", type: "uuid" },
      { name: "email", type: "varchar(255)" },
      { name: "created_at", type: "timestamp" },
    ],
  },
  {
    schema: "public",
    name: "orders",
    type: "table",
    rows: 44819,
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "total", type: "numeric" },
    ],
  },
  {
    schema: "public",
    name: "billing_sessions",
    type: "table",
    rows: 76,
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "status", type: "varchar(32)" },
    ],
  },
];

let demoSavedQueries = [
  {
    id: "q1",
    connectionId: "demo-pg",
    name: "Slow users lookup",
    sql: "select * from users where created_at < now() - interval '1 year'\norder by created_at desc\nlimit 100;",
    updatedAt: new Date().toISOString(),
  },
];

export const api = {
  async call(name, ...args) {
    const app = (window as any)?.go?.main?.App;
    if (app?.[name]) return app[name](...args);
    return demoCall(name, ...args);
  },
};

async function demoCall(name, ...args) {
  await new Promise((resolve) => setTimeout(resolve, 160));
  if (name === "ListConnections") return sampleConnections;
  if (name === "SaveConnection")
    return { ...args[0], id: args[0].id || `demo-${Date.now()}` };
  if (name === "DeleteConnection") return null;
  if (name === "AutoDeleteQueries") return null;
  if (name === "ConfirmDeleteQuery") return true;
  if (name === "DeleteQuery") {
    demoSavedQueries = demoSavedQueries.filter((query) => query.id !== args[0]);
    return null;
  }
  if (name === "ExportQueryResult") return `/tmp/${args[1] || "export.csv"}`;
  if (name === "OpenExportedFile" || name === "RevealExportedFile") return null;
  if (name === "TestConnection") return null;
  if (name === "Connect" || name === "ConnectDatabase")
    return {
      driver: "postgres",
      database: args[1] || "app",
      databases: [
        { name: "app", size: 3_560_000_000 },
        { name: "analytics", size: 1_170_000 },
        { name: "mysql", size: 0 },
      ],
      tables: demoTables,
      routines: [
        {
          schema: "public",
          name: "refresh_billing_sessions",
          type: "function",
        },
      ],
    };
  if (name === "GetCompletions") {
    return [
      { label: "SET", detail: "command", type: "keyword", apply: "SET " },
      { label: "GET", detail: "command", type: "keyword", apply: "GET " },
    ];
  }
  if (name === "ListSavedQueries")
    return demoSavedQueries.filter((query) => query.connectionId === args[0]);
  if (name === "SaveQuery") {
    const saved = {
      ...args[0],
      id: args[0].id || `q-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
    demoSavedQueries = [
      saved,
      ...demoSavedQueries.filter((query) => query.id !== saved.id),
    ];
    return saved;
  }
  if (name === "GetDatabaseTableDetail")
    return {
      name: args[3],
      schema: args[2],
      columns: [
        {
          name: "id",
          type: "uuid",
          nullable: false,
          default: "gen_random_uuid()",
        },
        { name: "email", type: "varchar(255)", nullable: false },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
          default: "now()",
        },
      ],
      indexes: [
        {
          name: "users_pkey",
          unique: true,
          columns: "id",
          sql: "CREATE UNIQUE INDEX users_pkey ON users(id)",
        },
        {
          name: "users_email_key",
          unique: true,
          columns: "email",
          sql: "CREATE UNIQUE INDEX users_email_key ON users(email)",
        },
      ],
      createSql: `CREATE TABLE users (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  email varchar(255) NOT NULL UNIQUE,\n  created_at timestamp NOT NULL DEFAULT now()\n);`,
    };
  if (name === "Execute" || name === "ExecuteDatabase")
    return {
      columns: ["id", "email", "created_at"],
      rows: [
        ["1", "alice@example.com", "2023-01-01 12:00:00"],
        ["2", "bob@example.com", "2023-01-02 12:00:00"],
      ],
      durationMs: 42,
    };
  if (name === "ExplainAnalyze" || name === "ExplainAnalyzeDatabase")
    return {
      columns: ["QUERY PLAN"],
      rows: [
        [
          "Limit  (cost=0.00..1.00 rows=100 width=10) (actual time=0.01..0.02 rows=2 loops=1)",
        ],
        [
          "  ->  Seq Scan on users  (cost=0.00..1.00 rows=100 width=10) (actual time=0.01..0.02 rows=2 loops=1)",
        ],
      ],
      durationMs: 12,
    };
  if (name === "ListBinlogs") {
    return ["binlog.000001", "binlog.000002", "binlog.000003"];
  }
  if (name === "ReadBinlog") {
    return `# at 4
#231012 10:00:00 server id 1  end_log_pos 123 CRC32 0x12345678 	Start: binlog v 4, server v 8.0.34-0ubuntu0.22.04.1 created 231012 10:00:00
# Warning: this binlog is either in use or was not closed properly.
# at 123
#231012 10:05:00 server id 1  end_log_pos 154 CRC32 0xabcdef12 	Anonymous_GTID	last_committed=0	sequence_number=1	rbr_only=yes	original_committed_timestamp=1697105100000000	immediate_commit_timestamp=1697105100000000	transaction_length=250
/*!50718 SET TRANSACTION ISOLATION LEVEL READ COMMITTED*/*!*;
# original_commit_timestamp=1697105100000000 (2023-10-12 10:05:00.000000 UTC)
# immediate_commit_timestamp=1697105100000000 (2023-10-12 10:05:00.000000 UTC)
/*!80001 SET @@session.original_commit_timestamp=1697105100000000*/*!*;
/*!80014 SET @@session.original_server_version=80034*/*!*;
/*!80014 SET @@session.immediate_server_version=80034*/*!*;
SET @@SESSION.GTID_NEXT= 'ANONYMOUS'/*!*;
# at 154
#231012 10:05:00 server id 1  end_log_pos 220 CRC32 0x87654321 	Query	thread_id=10	exec_time=0	error_code=0
SET TIMESTAMP=1697105100/*!*;
SET @@session.pseudo_thread_id=10/*!*;
SET @@session.foreign_key_checks=1, @@session.sql_auto_is_null=0, @@session.unique_checks=1, @@session.autocommit=1/*!*;
SET @@session.sql_mode=1168113696/*!*;
SET @@session.auto_increment_increment=1, @@session.auto_increment_offset=1/*!*;
/*!\\C utf8mb4 *//*!*;
SET @@session.character_set_client=255,@@session.collation_connection=255,@@session.collation_server=255/*!*;
SET @@session.lc_time_names=0/*!*;
SET @@session.collation_database=DEFAULT/*!*;
/*!80011 SET @@session.default_collation_for_utf8mb4=255*/*!*;
BEGIN
/*!*;
# at 220
#231012 10:05:00 server id 1  end_log_pos 270 CRC32 0x11223344 	Table_map: \`app\`.\`users\` mapped to number 100
# at 270
#231012 10:05:00 server id 1  end_log_pos 320 CRC32 0x55667788 	Write_rows: table id 100 flags: STMT_END_F
### INSERT INTO \`app\`.\`users\`
### SET
###   @1=1
###   @2='alice@example.com'
###   @3='2023-01-01 12:00:00'
# at 320
#231012 10:05:00 server id 1  end_log_pos 351 CRC32 0x99aabbcc 	Xid = 12345
COMMIT/*!*;`;
  }
  throw new Error(`Unknown demo call: ${name}`);
}
