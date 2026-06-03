import { api } from "./api";

export const sqlCompletions = [
  {
    label: "select",
    detail: "query rows",
    apply: "select * from ",
    type: "keyword",
  },
  { label: "from", detail: "source table", apply: "from ", type: "keyword" },
  { label: "where", detail: "filter rows", apply: "where ", type: "keyword" },
  { label: "join", detail: "join table", apply: "join ", type: "keyword" },
  {
    label: "left join",
    detail: "optional join",
    apply: "left join ",
    type: "keyword",
  },
  {
    label: "inner join",
    detail: "matching join",
    apply: "inner join ",
    type: "keyword",
  },
  {
    label: "group by",
    detail: "aggregate groups",
    apply: "group by ",
    type: "keyword",
  },
  {
    label: "order by",
    detail: "sort rows",
    apply: "order by ",
    type: "keyword",
  },
  { label: "limit", detail: "cap results", apply: "limit ", type: "keyword" },
  {
    label: "insert into",
    detail: "add rows",
    apply: "insert into ",
    type: "keyword",
  },
  { label: "update", detail: "modify rows", apply: "update ", type: "keyword" },
  {
    label: "delete from",
    detail: "remove rows",
    apply: "delete from ",
    type: "keyword",
  },
  {
    label: "create table",
    detail: "define table",
    apply: "create table ",
    type: "keyword",
  },
  {
    label: "alter table",
    detail: "change table",
    apply: "alter table ",
    type: "keyword",
  },
  {
    label: "drop table",
    detail: "remove table",
    apply: "drop table ",
    type: "keyword",
  },
  {
    label: "explain analyze",
    detail: "query plan",
    apply: "explain analyze ",
    type: "keyword",
  },
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
  if (/\b(from|join|update|into|table)\s+[\w.$"`]*$/.test(normalized)) {
    return "table";
  }
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
  const tables = detail?.tables || [];
  const scopedTables = references.length
    ? references
        .map((reference) =>
          tables.find(
            (table) =>
              table.name.toLowerCase() === reference.table.toLowerCase() &&
              (!reference.schema ||
                table.schema.toLowerCase() === reference.schema.toLowerCase()),
          ),
        )
        .filter(Boolean)
    : tables;
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
      detail: `${table.name} ${column.type}`,
      apply: qualify ? `${qualifier}.${column.name}` : column.name,
      type: "property",
      boost: references.length ? 40 : 10,
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
    if (option.type !== "keyword") return option;
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
