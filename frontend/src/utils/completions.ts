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

export function createSqlCompletionSource(detail) {
  return (context) => {
    const beforeCursor = context.state.sliceDoc(0, context.pos);
    const word = context.matchBefore(/[A-Za-z_][\w$]*/);
    const tableContext = getSqlContext(beforeCursor);

    if (!context.explicit && !word && tableContext !== "table") {
      return null;
    }

    return {
      from: word ? word.from : context.pos,
      options:
        tableContext === "table"
          ? tableCompletionOptions(detail)
          : sqlCompletions,
      validFor: /^[\w$]*$/,
    };
  };
}

function quoteName(driver, schema, table) {
  if (driver === "mysql") return `\`${table}\``;
  return `"${schema}"."${table}"`;
}
function getSqlContext(beforeCursor) {
  const normalized = beforeCursor.toLowerCase();
  if (
    /\b(from|join|update|into|table)\s+(?:"[^"]*"?|`[^`]*`?|[\w.$]*)$/.test(
      normalized,
    )
  ) {
    return "table";
  }
  return "syntax";
}

function tableCompletionOptions(detail) {
  const tables = detail?.tables || [];
  return tables.map((table) => ({
    label: table.name,
    detail: `${table.schema} ${table.type || "table"}`,
    apply: quoteName(detail?.driver, table.schema, table.name),
    type: "class",
  }));
}
