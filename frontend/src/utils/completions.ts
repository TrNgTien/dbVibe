import { snippetCompletion } from "@codemirror/autocomplete";
import { api } from "./api";

function keyword(label, detail, apply = `${label} `) {
  return { label, detail, apply, type: "keyword" };
}

export const sqlCompletions = [
  snippetCompletion("select ${columns} from ${table}", {
    label: "select",
    detail: "query rows",
    type: "keyword",
    boost: 30,
  }),
  snippetCompletion("select * from ${table} limit ${100}", {
    label: "select *",
    detail: "preview table",
    type: "keyword",
    boost: 28,
  }),
  snippetCompletion("select count(*) from ${table}", {
    label: "select count",
    detail: "count rows",
    type: "keyword",
  }),
  snippetCompletion("insert into ${table} (${columns}) values (${values})", {
    label: "insert into",
    detail: "add rows",
    type: "keyword",
  }),
  snippetCompletion(
    "update ${table} set ${column} = ${value} where ${condition}",
    {
      label: "update",
      detail: "modify rows",
      type: "keyword",
    },
  ),
  snippetCompletion("delete from ${table} where ${condition}", {
    label: "delete from",
    detail: "remove rows",
    type: "keyword",
  }),
  snippetCompletion(
    "case when ${condition} then ${value} else ${fallback} end",
    {
      label: "case when",
      detail: "conditional value",
      type: "keyword",
    },
  ),
  snippetCompletion(
    "with tmp as (\n  select ${columns} from ${table}\n)\nselect * from tmp",
    {
      label: "with",
      detail: "CTE subquery",
      type: "keyword",
    },
  ),
  keyword("from", "source table"),
  keyword("where", "filter rows"),
  snippetCompletion("join ${table} on ${condition}", {
    label: "join",
    detail: "join table",
    type: "keyword",
  }),
  snippetCompletion("left join ${table} on ${condition}", {
    label: "left join",
    detail: "optional join",
    type: "keyword",
  }),
  snippetCompletion("inner join ${table} on ${condition}", {
    label: "inner join",
    detail: "matching join",
    type: "keyword",
  }),
  keyword("group by", "aggregate groups"),
  keyword("order by", "sort rows"),
  keyword("having", "filter groups"),
  keyword("limit", "cap results"),
  keyword("distinct", "unique rows"),
  keyword("union", "combine queries"),
  keyword("union all", "combine, keep duplicates"),
  snippetCompletion("create table ${name} (\n  ${column} ${type}\n)", {
    label: "create table",
    detail: "define table",
    type: "keyword",
  }),
  keyword("alter table", "change table"),
  keyword("drop table", "remove table"),
  keyword("truncate table", "empty table"),
  keyword("explain analyze", "query plan"),
  keyword("show tables", "list tables"),
  keyword("describe", "table structure"),
  {
    label: "count(*)",
    detail: "aggregate count",
    apply: "count(*)",
    type: "function",
  },
];

const sqlFunctions = [
  "avg",
  "coalesce",
  "count",
  "current_date",
  "current_timestamp",
  "lower",
  "max",
  "min",
  "now",
  "nullif",
  "round",
  "sum",
  "upper",
].map((label) => ({
  label,
  detail: "function",
  apply: label.includes("_") ? label : `${label}()`,
  type: "function",
  boost: 20,
}));

const sqlOperators = [
  "and",
  "or",
  "not",
  "in",
  "like",
  "between",
  "is null",
  "is not null",
  "exists",
].map((label) => ({
  label,
  detail: "operator",
  apply: `${label} `,
  type: "keyword",
}));

const clauseKeywords = {
  table: ["join", "left join", "where", "group by", "order by", "limit"],
  select: ["distinct", "as", "from", "case", "when"],
  condition: ["and", "or", "group by", "order by", "having", "limit"],
  order: ["asc", "desc", "nulls first", "nulls last", "limit", "offset"],
  ddl: ["table", "index", "view", "database", "schema", "column"],
};

const reservedAliases = new Set([
  "and",
  "cross",
  "full",
  "group",
  "having",
  "inner",
  "join",
  "left",
  "limit",
  "on",
  "order",
  "outer",
  "right",
  "set",
  "union",
  "where",
]);

export function createBackendCompletionSource(detail) {
  return async (context) => {
    const word = context.matchBefore(/[\w_$-]*/);
    if (!context.explicit && !word) return null;

    const pos = context.pos;
    const text = context.state.sliceDoc(0, pos);

    let items;
    try {
      items = await api.call(
        "GetCompletions",
        detail?.id || "",
        detail?.database || "",
        text,
        pos,
      );
    } catch (err) {
      console.error("Autocomplete error:", err);
      return null;
    }

    if (!items || !items.length) return null;

    return {
      from: word ? word.from : context.pos,
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: item.type,
        apply: item.apply,
      })),
      validFor: /^[\w_$-]*$/,
    };
  };
}

export function createSqlCompletionSource(detail, options = {}) {
  const uppercaseKeywords = options.uppercaseKeywords ?? false;

  return (context) => {
    const doc = context.state.doc;
    const windowStart = Math.max(0, context.pos - 5000);
    const windowEnd = Math.min(doc.length, context.pos + 5000);
    const textWindow = doc.sliceString(windowStart, windowEnd);
    const localCursor = context.pos - windowStart;
    const statement = currentStatement(textWindow, localCursor);
    const cursorOffset = localCursor - statement.from;
    const beforeCursor = statement.text.slice(0, cursorOffset);
    const scan = scanSql(beforeCursor);
    if (scan.insideString || scan.insideComment) return null;

    const word = context.matchBefore(/[A-Za-z_][\w$]*/);
    const dotMatch = scan.text.match(/([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)?$/);
    const sqlContext = getSqlContext(scan.text);
    const tableReferences = extractTableReferences(scanSql(statement.text).text);
    const dotPrefix = dotMatch?.[1];
    const options = completionOptions(
      detail,
      sqlContext,
      tableReferences,
      dotPrefix,
    );

    if (
      !context.explicit &&
      !word &&
      !dotPrefix &&
      sqlContext !== "table" &&
      sqlContext !== "select"
    ) {
      return null;
    }

    return {
      from: word ? word.from : context.pos,
      options: applyKeywordCase(options, uppercaseKeywords),
      validFor: /^[\w$]*$/,
    };
  };
}

function quoteName(driver, schema, table) {
  if (driver === "mysql") return `\`${table}\``;
  return `"${schema}"."${table}"`;
}

function currentStatement(doc, position) {
  const start = doc.lastIndexOf(";", position - 1) + 1;
  const nextSemicolon = doc.indexOf(";", position);
  const end = nextSemicolon === -1 ? doc.length : nextSemicolon;
  return { from: start, text: doc.slice(start, end) };
}

function scanSql(text) {
  let state = "normal";
  let output = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === "lineComment") {
      if (char === "\n") {
        state = "normal";
        output += char;
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "normal";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "singleQuote") {
      output += " ";
      if (char === "'" && next === "'") {
        output += " ";
        index += 1;
      } else if (char === "'") {
        state = "normal";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      output += "  ";
      index += 1;
      state = "lineComment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "blockComment";
    } else if (char === "'") {
      output += " ";
      state = "singleQuote";
    } else {
      output += char;
    }
  }

  return {
    text: output,
    insideString: state === "singleQuote",
    insideComment: state === "lineComment" || state === "blockComment",
  };
}

function getSqlContext(beforeCursor) {
  const normalized = beforeCursor.toLowerCase();
  if (/\b(from|join|update|into|table|truncate)\s+[\w.$"`]*$/.test(normalized)) {
    return "table";
  }
  if (/\b(drop|alter)\s+[\w]*$/.test(normalized)) return "ddl";
  if (/\bcreate\s+(or\s+replace\s+)?[\w]*$/.test(normalized)) return "ddl";
  if (/\border\s+by\b[^;]*$/.test(normalized)) return "order";
  if (/\b(group\s+by|where|having|on|set)\b[^;]*$/.test(normalized)) {
    return "condition";
  }
  if (/\bselect\b[^;]*$/.test(normalized)) return "select";
  return "syntax";
}

function extractTableReferences(statement) {
  const references = [];
  const regex =
    /\b(?:from|join|update|insert\s+into)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  let match;
  while ((match = regex.exec(statement)) !== null) {
    const qualifiedName = match[1];
    const parts = qualifiedName.split(".");
    const alias = match[2]?.toLowerCase();
    references.push({
      schema: parts.length > 1 ? parts[0] : "",
      table: parts[parts.length - 1],
      alias: alias && !reservedAliases.has(alias) ? match[2] : "",
    });
  }
  return references;
}

function completionOptions(detail, context, references, dotPrefix) {
  if (dotPrefix) {
    const reference = references.find(
      (item) =>
        item.alias.toLowerCase() === dotPrefix.toLowerCase() ||
        item.table.toLowerCase() === dotPrefix.toLowerCase(),
    );
    if (reference) return columnCompletionOptions(detail, [reference], false);
    if (context === "table") return tableCompletionOptions(detail, dotPrefix);
  }

  if (context === "table") {
    return dedupeOptions([
      ...tableCompletionOptions(detail),
      ...keywordOptions(clauseKeywords.table),
    ]);
  }

  if (context === "ddl") {
    return keywordOptions(clauseKeywords.ddl);
  }

  const columns = columnCompletionOptions(detail, references, true);
  if (context === "select") {
    return dedupeOptions([
      { label: "*", detail: "all columns", type: "keyword", boost: 30 },
      ...columns,
      ...sqlFunctions,
      ...keywordOptions(clauseKeywords.select),
    ]);
  }
  if (context === "condition") {
    return dedupeOptions([
      ...columns,
      ...sqlOperators,
      ...sqlFunctions,
      ...keywordOptions(clauseKeywords.condition),
    ]);
  }
  if (context === "order") {
    return dedupeOptions([
      ...columns,
      ...keywordOptions(clauseKeywords.order),
    ]);
  }
  return sqlCompletions;
}

function keywordOptions(labels) {
  return labels.map((label) => ({
    label,
    detail: "keyword",
    apply: `${label} `,
    type: "keyword",
  }));
}

function tableCompletionOptions(detail, schema = "") {
  const tables = detail?.tables || [];
  return tables
    .filter(
      (table) =>
        !schema || table.schema.toLowerCase() === schema.toLowerCase(),
    )
    .map((table) => ({
      label: table.name,
      detail: `${table.schema} ${table.type || "table"}`,
      apply:
        schema && detail?.driver !== "mysql"
          ? `"${table.name}"`
          : quoteName(detail?.driver, table.schema, table.name),
      type: "class",
      boost: 25,
    }));
}

function columnCompletionOptions(detail, references, qualifyMultiple) {
  // Like DBeaver: only propose columns for tables actually referenced in the
  // statement — never flood the list with every column of every table.
  if (!references.length) return [];
  const tables = detail?.tables || [];
  const scopedTables = references
    .map((reference) =>
      tables.find(
        (table) =>
          table.name.toLowerCase() === reference.table.toLowerCase() &&
          (!reference.schema ||
            table.schema.toLowerCase() === reference.schema.toLowerCase()),
      ),
    )
    .filter(Boolean);
  const qualify = qualifyMultiple && scopedTables.length > 1;

  return scopedTables.flatMap((table) => {
    const reference = references.find(
      (item) =>
        item.table.toLowerCase() === table.name.toLowerCase() &&
        (!item.schema ||
          item.schema.toLowerCase() === table.schema.toLowerCase()),
    );
    const qualifier = reference?.alias || reference?.table || table.name;
    return (table.columns || []).map((column) => ({
      label: qualify ? `${qualifier}.${column.name}` : column.name,
      detail: qualify ? column.type : `${column.type} · ${table.name}`,
      apply: qualify ? `${qualifier}.${column.name}` : column.name,
      type: "property",
      boost: 40,
    }));
  });
}

function dedupeOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    const key = `${option.label}\x00${option.apply || option.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyKeywordCase(options, uppercaseKeywords) {
  if (!uppercaseKeywords) return options;
  return options.map((option) => {
    if (option.type !== "keyword" || typeof option.apply === "function") {
      return option;
    }
    return {
      ...option,
      label: option.label.toUpperCase(),
      apply:
        typeof option.apply === "string"
          ? option.apply.toUpperCase()
          : option.apply,
    };
  });
}
