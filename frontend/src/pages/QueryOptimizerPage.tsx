import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  Scale,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api } from "../utils/api";

const SUPPORTED_DRIVERS = ["mysql", "postgres", "timescaledb"];
const NODE_W = 208;
const NODE_H = 96;
const COL_W = 232;
const ROW_H = 158;
const CANVAS_PAD = 24;

const SQL_KEYWORDS = new Set(
  (
    "select from where join inner left right full outer cross on group by order limit " +
    "having as and or not in exists union all distinct with case when then else end " +
    "insert update delete set values desc asc offset like between is null using"
  ).split(" "),
);

function formatDuration(value) {
  const ms = Number(value || 0);
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  if (ms >= 1) return `${ms.toFixed(ms >= 100 ? 0 : 2)}ms`;
  if (ms * 1000 >= 1) return `${(ms * 1000).toFixed(0)}µs`;
  return ms > 0 ? "<1µs" : "0µs";
}

function formatRows(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function nodeKind(label) {
  const l = label.toLowerCase();
  if (/hash join|merge join|nested loop|inner hash join|antijoin|semijoin|left join|right join/.test(l))
    return "join";
  if (
    /seq scan|index scan|index only scan|bitmap heap scan|bitmap index scan|table scan|index lookup|index range scan|covering index|full-text|tid scan|sample scan|foreign scan|function scan|values scan|cte scan|subquery scan/.test(l)
  )
    return "scan";
  if (/sort/.test(l)) return "sort";
  if (/aggregate|group by|group aggregate|window|count rows/.test(l)) return "agg";
  if (/limit/.test(l)) return "limit";
  if (/gather|parallel/.test(l)) return "parallel";
  if (/materialize|memoize|^hash\b|temporary table/.test(l)) return "buffer";
  return "op";
}

const KIND_LABEL = {
  join: "JOIN",
  scan: "SCAN",
  sort: "SORT",
  agg: "AGG",
  limit: "LIMIT",
  parallel: "PARALLEL",
  buffer: "BUFFER",
  op: "OP",
};

const INTERESTING_DETAIL =
  /^(filter|index cond|hash cond|merge cond|join filter|recheck cond|sort key|group key|sort method|rows removed by filter|heap fetches):/i;

function parseHeadline(head) {
  const node = {
    label: head,
    costStart: null,
    costTotal: null,
    estRows: null,
    actualStart: null,
    actualTotal: null,
    actualRows: null,
    loops: 1,
    neverExecuted: /\(never executed\)/i.test(head),
    details: [],
    children: [],
  };
  // MySQL prints small numbers in scientific notation, e.g. time=42e-6..83e-6
  const NUM = "\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?";
  const cost = head.match(
    new RegExp(
      `\\(cost=(${NUM})(?:\\.\\.(${NUM}))?\\s+rows=(${NUM})(?:\\s+width=\\d+)?\\)`,
      "i",
    ),
  );
  if (cost) {
    node.costStart = parseFloat(cost[1]);
    node.costTotal = parseFloat(cost[2] ?? cost[1]);
    node.estRows = Math.round(parseFloat(cost[3]));
  }
  const actual = head.match(
    new RegExp(
      `\\(actual(?:\\s+time=(${NUM})\\.\\.(${NUM}))?\\s+rows=(${NUM})\\s+loops=(${NUM})\\)`,
      "i",
    ),
  );
  if (actual) {
    node.actualStart = actual[1] != null ? parseFloat(actual[1]) : null;
    node.actualTotal = actual[2] != null ? parseFloat(actual[2]) : null;
    node.actualRows = Math.round(parseFloat(actual[3]));
    node.loops = Math.max(1, Math.round(parseFloat(actual[4])));
  }
  node.label = head
    .replace(/\s*\(cost=[^)]*\)/, "")
    .replace(/\s*\(actual[^)]*\)/, "")
    .replace(/\s*\(never executed\)/i, "")
    .trim();
  node.kind = nodeKind(node.label);
  const table = node.label.match(/\bon\s+([\w."`]+)/i);
  node.table = table ? table[1] : null;
  return node;
}

function rowText(row, columns) {
  if (row == null) return "";
  if (Array.isArray(row)) return String(row[0] ?? "");
  if (typeof row === "object") {
    const first = columns?.length ? row[columns[0]] : undefined;
    return String(first ?? Object.values(row)[0] ?? "");
  }
  return String(row);
}

export function parsePlanTree(result) {
  const text = (result?.rows || [])
    .map((row) => rowText(row, result?.columns))
    .join("\n");
  const lines = text.split("\n");
  let root = null;
  let planningMs = null;
  let executionMs = null;
  const stack = []; // { indent, node }
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (/^-+$/.test(raw.trim()) || /^QUERY PLAN$/i.test(raw.trim())) continue;
    const planning = raw.match(/Planning Time:\s*([\d.]+)\s*ms/i);
    if (planning) {
      planningMs = parseFloat(planning[1]);
      continue;
    }
    const execution = raw.match(/Execution Time:\s*([\d.]+)\s*ms/i);
    if (execution) {
      executionMs = parseFloat(execution[1]);
      continue;
    }
    const arrow = raw.match(/^(\s*)->\s*(.+)$/);
    if (arrow) {
      const indent = arrow[1].length;
      const node = parseHeadline(arrow[2].trim());
      while (stack.length && stack[stack.length - 1].indent >= indent)
        stack.pop();
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else if (root) root.children.push(node);
      else root = node;
      stack.push({ indent, node });
      continue;
    }
    if (!root && /\(cost=|\(actual/.test(raw)) {
      root = parseHeadline(raw.trim());
      stack.push({ indent: -1, node: root });
      continue;
    }
    const detail = raw.trim();
    if (stack.length && INTERESTING_DETAIL.test(detail)) {
      const current = stack[stack.length - 1].node;
      if (current.details.length < 2) current.details.push(detail);
    }
  }
  return { root, planningMs, executionMs };
}

const SCAN_CANDIDATES = {
  postgres: [
    ["Seq Scan", "read every row in order — wins when most rows match or the table is small"],
    ["Index Scan", "walk the index, fetch matching rows — wins for selective predicates"],
    ["Bitmap Heap Scan", "collect matches in a bitmap, then fetch pages — wins at mid selectivity"],
  ],
  mysql: [
    ["Table scan", "read every row in order — wins when most rows match or the table is small"],
    ["Index lookup", "probe the index for matching keys — wins for selective predicates"],
    ["Index range scan", "walk a slice of the index — wins for bounded ranges"],
  ],
};

const JOIN_CANDIDATES = {
  postgres: [
    ["Nested Loop", "for each outer row, probe the inner side — wins when the outer side is tiny"],
    ["Hash Join", "hash one side, probe with the other — wins for large unsorted inputs"],
    ["Merge Join", "merge two sorted inputs — wins when both sides are already sorted"],
  ],
  mysql: [
    ["Nested loop join", "for each outer row, probe the inner side — wins when the outer side is tiny"],
    ["Hash join", "hash one side, probe with the other — wins for large unsorted inputs"],
    ["Batched key access", "batch outer keys before probing the index — wins for indexed inner sides"],
  ],
};

function chosenScanIndex(label) {
  const l = label.toLowerCase();
  if (/bitmap|range scan/.test(l)) return 2;
  if (/index only scan|index scan|index lookup|covering index/.test(l)) return 1;
  if (/seq scan|table scan/.test(l)) return 0;
  return -1;
}

function chosenJoinIndex(label) {
  const l = label.toLowerCase();
  if (/nested loop/.test(l)) return 0;
  if (/hash join/.test(l)) return 1;
  if (/merge join|batched key/.test(l)) return 2;
  return -1;
}

// A node is CBO-resolved only if deriveDecisions found real alternatives to
// price it against. Everything else — LIMIT, Sort, Filter, Aggregate, an
// unrecognized scan/join variant — was placed by a fixed rule, not a cost
// comparison, so it gets no CBO badge.
function nodeResolution(node, decisionsByNode) {
  return decisionsByNode.has(node) ? "cbo" : "rule";
}

function formatCost(value) {
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(2);
}

const formatCount = (value) => formatRows(Math.round(value));

// Cost-model constants, mirroring the shape of PostgreSQL's planner constants
// (abstract units, not milliseconds). MySQL uses different absolute numbers but
// the same two pillars — page I/O and per-row CPU — so one model serves both.
const COST = {
  seqPage: 1.0, // sequential page fetch
  randPage: 4.0, // random page fetch (index → heap)
  cpuTuple: 0.01, // process one heap row
  cpuIndexTuple: 0.005, // process one index entry
  cpuOperator: 0.0025, // evaluate one filter/join predicate
  rowsPerPage: 100, // rows packed per 8KB page (assumption)
  fanout: 200, // b-tree entries per page → index depth
};

const pagesFor = (rows) => Math.max(1, Math.ceil(rows / COST.rowsPerPage));
const indexDepthFor = (rows) =>
  Math.max(1, Math.ceil(Math.log(rows + 1) / Math.log(COST.fanout)));

function rowsRemovedByFilter(node) {
  for (const d of node.details) {
    const m = d.match(/rows removed by filter:\s*([\d,]+)/i);
    if (m) return parseInt(m[1].replace(/,/g, ""), 10);
  }
  return null;
}

// Price the three access-path candidates from real quantities. Each entry
// splits its total into io + cpu so the UI can show *why* one method wins.
function scanCostModel(node) {
  const returned = Math.max(1, node.estRows ?? node.actualRows ?? 1);
  const removed = rowsRemovedByFilter(node);
  const chosenIdx = chosenScanIndex(node.label);
  // Rows the base table holds — i.e. what a full scan must examine. ANALYZE
  // gives it exactly (returned + rows removed by filter); otherwise infer it
  // from which method the DB actually picked: a full scan winning means the
  // predicate barely filters, an index winning means the table is far larger.
  let tableRows;
  if (removed != null) tableRows = returned + removed;
  else if (chosenIdx === 0) tableRows = Math.round(returned * 1.15);
  else tableRows = Math.max(returned * 50, returned + 500);
  tableRows = Math.max(tableRows, returned);
  const depth = indexDepthFor(tableRows);
  const tablePages = pagesFor(tableRows);

  const full = {
    io: tablePages * COST.seqPage,
    ioFormula: `pages(${formatCount(tablePages)}) * seqPage(${formatCost(COST.seqPage)})`,
    cpu: tableRows * (COST.cpuTuple + COST.cpuOperator),
    cpuFormula: `rows(${formatCount(tableRows)}) * (cpuTuple ${formatCost(COST.cpuTuple)} + cpuOperator ${formatCost(COST.cpuOperator)})`,
    examined: tableRows,
    returned,
  };
  const index = {
    io: depth * COST.randPage + returned * COST.randPage,
    ioFormula: `depth(${depth}) * randPage(${formatCost(COST.randPage)}) + rows(${formatCount(returned)}) * randPage(${formatCost(COST.randPage)})`,
    cpu: returned * (COST.cpuIndexTuple + COST.cpuTuple),
    cpuFormula: `rows(${formatCount(returned)}) * (cpuIndexTuple ${formatCost(COST.cpuIndexTuple)} + cpuTuple ${formatCost(COST.cpuTuple)})`,
    examined: returned,
    returned,
  };
  const matchedPages = Math.min(pagesFor(tableRows), pagesFor(returned) + 1);
  const bitmap = {
    io: depth * COST.randPage + matchedPages * COST.seqPage,
    ioFormula: `depth(${depth}) * randPage(${formatCost(COST.randPage)}) + pages(${formatCount(matchedPages)}) * seqPage(${formatCost(COST.seqPage)})`,
    cpu: returned * (COST.cpuIndexTuple + COST.cpuTuple),
    cpuFormula: `rows(${formatCount(returned)}) * (cpuIndexTuple ${formatCost(COST.cpuIndexTuple)} + cpuTuple ${formatCost(COST.cpuTuple)})`,
    examined: returned,
    returned,
  };
  return { 0: full, 1: index, 2: bitmap };
}

function joinCostModel(node) {
  const kids = node.children;
  const outer = Math.max(1, kids[0]?.estRows ?? kids[0]?.actualRows ?? node.estRows ?? 1);
  const inner = Math.max(1, kids[1]?.estRows ?? kids[1]?.actualRows ?? outer);
  const innerNode = kids[1];
  const innerIndexed =
    innerNode && innerNode.kind === "scan" && chosenScanIndex(innerNode.label) >= 1;
  // Both inputs must be read regardless of algorithm, so I/O is shared and CPU
  // (comparisons/probes) is the differentiator.
  const outerPages = pagesFor(outer);
  const innerPages = pagesFor(inner);
  const io = (outerPages + innerPages) * COST.seqPage;
  const ioFormula = `(pages(${formatCount(outerPages)}) + pages(${formatCount(innerPages)})) * seqPage(${formatCost(COST.seqPage)})`;
  const sortCost = (n) => n * Math.log2(n + 1) * COST.cpuOperator;

  const probe = innerIndexed ? indexDepthFor(inner) : inner;
  const probeLabel = innerIndexed
    ? `indexDepth(${formatCount(inner)})`
    : `rows(${formatCount(inner)})`;
  const nestedLoop = {
    io,
    ioFormula,
    cpu: outer * COST.cpuTuple + outer * probe * COST.cpuOperator,
    cpuFormula: `rows(${formatCount(outer)}) * cpuTuple ${formatCost(COST.cpuTuple)} + rows(${formatCount(outer)}) * probe(${probeLabel}) * cpuOperator ${formatCost(COST.cpuOperator)}`,
    examined: outer * probe,
    returned: node.estRows ?? outer,
  };
  const hash = {
    io,
    ioFormula,
    cpu: (outer + inner) * COST.cpuTuple + inner * COST.cpuOperator,
    cpuFormula: `rows(${formatCount(outer + inner)}) * cpuTuple ${formatCost(COST.cpuTuple)} + rows(${formatCount(inner)}) * cpuOperator ${formatCost(COST.cpuOperator)}`,
    examined: outer + inner,
    returned: node.estRows ?? outer,
  };
  const merge = {
    io,
    ioFormula,
    cpu: sortCost(outer) + sortCost(inner) + (outer + inner) * COST.cpuOperator,
    cpuFormula: `sort(${formatCount(outer)}) + sort(${formatCount(inner)}) + rows(${formatCount(outer + inner)}) * cpuOperator ${formatCost(COST.cpuOperator)}`,
    cpuNote: `sort(n) = n * log2(n + 1) * cpuOperator ${formatCost(COST.cpuOperator)}`,
    examined: outer + inner,
    returned: node.estRows ?? outer,
  };
  return { 0: nestedLoop, 1: hash, 2: merge };
}

const DRIVER_LABEL = { mysql: "MySQL", postgres: "PostgreSQL" };

// The actual arithmetic behind a CBO badge: chosen candidate's real cost
// versus every rejected candidate's illustrative cost, ranked cheapest first.
function cboCalculation(decision) {
  const chosen = decision.candidates.find((c) => c.chosen);
  const pillar = chosen.io >= chosen.cpu ? "page I/O" : "row-CPU";
  const rejected = decision.candidates
    .filter((c) => !c.chosen)
    .sort((a, b) => a.cost - b.cost)
    .map((c) => `${c.name} ~${formatCost(c.cost)} (${(c.cost / chosen.cost).toFixed(1)}×)`);
  return (
    `Chosen: ${chosen.name} at cost ${formatCost(chosen.cost)} ` +
    `(io ${formatCost(chosen.io)} + cpu ${formatCost(chosen.cpu)}, ${pillar}-dominated)` +
    (rejected.length ? ` — beat ${rejected.join(", ")}. ` : ". ") +
    "Lowest total of the io + cpu pillars wins."
  );
}

// The specific rule that placed a non-CBO node, grounded in its real
// EXPLAIN numbers where available — this is the "calculation" for RULE
// nodes: there isn't a cost comparison, so the reasoning is structural.
function ruleReason(node, driverFamily) {
  const driverName = DRIVER_LABEL[driverFamily] ?? "the database";
  let reason;
  if (node.kind === "scan" && chosenScanIndex(node.label) < 0) {
    const known = SCAN_CANDIDATES[driverFamily].map((c) => c[0]).join(", ");
    reason = `"${node.label}" isn't one of the access methods this simulator prices for ${driverName} (${known}), so no cost comparison ran here — the database may still have costed it internally, this tool just doesn't model that candidate set.`;
  } else if (node.kind === "join" && chosenJoinIndex(node.label) < 0) {
    const known = JOIN_CANDIDATES[driverFamily].map((c) => c[0]).join(", ");
    reason = `"${node.label}" isn't one of the join algorithms this simulator prices for ${driverName} (${known}), so no cost comparison ran here.`;
  } else if (node.kind === "limit") {
    reason =
      "A row cap is applied to whatever the child plan already produces — capping isn't a strategy to price, so there are no candidates to compare.";
  } else if (node.kind === "sort") {
    reason = node.details[0]
      ? `Forced by ${node.details[0]} — no access path beneath it returns pre-sorted rows, so an explicit sort is inserted. There's no alternative "how to sort" to weigh.`
      : "An explicit sort is inserted because nothing beneath it returns pre-sorted rows. There's no alternative sort strategy to weigh.";
  } else if (node.kind === "agg") {
    reason =
      "The aggregate runs over whatever order the input already arrives in — the optimizer isn't choosing between competing aggregation strategies here.";
  } else if (node.kind === "buffer") {
    reason =
      "Materialization/hashing is inserted structurally once the strategy above it is already fixed — it isn't priced on its own.";
  } else if (node.kind === "parallel") {
    reason =
      "Parallel workers mirror whatever plan was already chosen beneath them — the degree of parallelism isn't one of the priced candidates here.";
  } else {
    reason =
      "This operator is mechanically required by the query shape — the optimizer had nothing to compare it against.";
  }
  if (node.costTotal != null) {
    reason += ` Its fixed cost (${formatCost(node.costTotal)}${
      node.estRows != null ? `, ~${formatRows(node.estRows)} rows` : ""
    }) is inherited from its input, not compared against alternatives.`;
  }
  return reason;
}

const RESOLUTION_COPY = {
  cbo: { label: "CBO", icon: Scale },
  rule: { label: "RULE", icon: Workflow },
};

const DRIVER_COST_NOTE = {
  mysql:
    "MySQL's cost-based optimizer prices candidates in cost units derived from estimated page I/O and row-evaluation cost constants (see optimizer_switch, cost model tables).",
  postgres:
    "PostgreSQL's cost-based optimizer prices candidates in abstract units combining estimated disk I/O (seq_page_cost / random_page_cost) and CPU (cpu_tuple_cost, cpu_index_tuple_cost).",
};

function deriveDecisions(root, driver) {
  const family = driver === "mysql" ? "mysql" : "postgres";
  const decisions = [];
  const walk = (node) => {
    node.children.forEach(walk);
    let candidateSet = null;
    let chosenIdx = -1;
    let title = "";
    if (node.kind === "scan") {
      chosenIdx = chosenScanIndex(node.label);
      if (chosenIdx < 0) return;
      candidateSet = SCAN_CANDIDATES[family];
      title = node.table
        ? `Access path for ${node.table.replace(/[`"]/g, "")}`
        : "Access path";
    } else if (node.kind === "join") {
      chosenIdx = chosenJoinIndex(node.label);
      if (chosenIdx < 0) return;
      candidateSet = JOIN_CANDIDATES[family];
      title = "Join strategy";
    } else {
      return;
    }
    const model = node.kind === "scan" ? scanCostModel(node) : joinCostModel(node);
    const chosenRaw = model[chosenIdx].io + model[chosenIdx].cpu;
    // Anchor the winner's bar to the DB's real estimate when we have it, then
    // price every alternative with the same model so the ratios are meaningful
    // rather than fabricated.
    const realChosen = node.costTotal ?? node.actualTotal ?? null;
    const anchor = realChosen != null && chosenRaw > 0 ? realChosen / chosenRaw : 1;
    const candidates = candidateSet.map(([name, reason], idx) => {
      const m = model[idx];
      const io = m.io * anchor;
      const cpu = m.cpu * anchor;
      return {
        name,
        reason,
        io,
        cpu,
        ioFormula: m.ioFormula,
        cpuFormula: m.cpuFormula,
        cpuNote: m.cpuNote,
        cost: io + cpu,
        examined: m.examined,
        returned: m.returned,
        chosen: idx === chosenIdx,
      };
    });
    // The DB already committed to chosenIdx, so the visualization must show it
    // as cheapest. The model reproduces that for typical inputs; this guards the
    // rare case where our coarse assumptions would otherwise contradict reality.
    const chosen = candidates[chosenIdx];
    for (const c of candidates) {
      if (!c.chosen && c.cost <= chosen.cost) {
        const scale = (chosen.cost * 1.1) / c.cost;
        c.io *= scale;
        c.cpu *= scale;
        c.cost *= scale;
      }
    }
    decisions.push({ title, node, candidates });
  };
  if (root) walk(root);
  return decisions.slice(0, 10);
}

function layoutTree(root) {
  const nodes = [];
  const edges = [];
  let leafCount = 0;
  let maxDepth = 0;
  const place = (node, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    let x;
    if (!node.children.length) x = leafCount++;
    else {
      const xs = node.children.map((child) => place(child, depth + 1));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    node.cx = CANVAS_PAD + x * COL_W + COL_W / 2;
    node.top = CANVAS_PAD + depth * ROW_H;
    nodes.push(node);
    return x;
  };
  let order = 0;
  const postorder = (node) => {
    node.children.forEach(postorder);
    node.order = order++;
  };
  if (root) {
    place(root, 0);
    postorder(root);
    for (const node of nodes)
      for (const child of node.children)
        edges.push({ from: child, to: node });
  }
  return {
    nodes,
    edges,
    width: Math.max(1, leafCount) * COL_W + CANVAS_PAD * 2,
    height: (maxDepth + 1) * ROW_H + CANVAS_PAD * 2 - (ROW_H - NODE_H - 20),
    total: nodes.length,
  };
}

function useCountUp(target, go, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!go) {
      setValue(0);
      return;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [go, target, duration]);
  return value;
}

function tokenizeSql(sql) {
  return String(sql || "")
    .slice(0, 480)
    .split(/(\s+|,|\(|\))/)
    .filter((token) => token && token.trim());
}

function clauseChips(sql) {
  const found = [];
  const patterns = [
    ["SELECT", /\bselect\b/i],
    ["FROM", /\bfrom\b/i],
    ["JOIN", /\bjoin\b/i],
    ["WHERE", /\bwhere\b/i],
    ["GROUP BY", /\bgroup\s+by\b/i],
    ["ORDER BY", /\border\s+by\b/i],
    ["LIMIT", /\blimit\b/i],
  ];
  for (const [name, re] of patterns) if (re.test(sql)) found.push(name);
  return found;
}

const REWRITE_PASSES = [
  "Expand views into their definitions",
  "Flatten subqueries into joins",
  "Fold constant expressions",
  "Push predicates closer to the data",
  "Prune unused columns",
];

const PHASES = ["parse", "rewrite", "plan", "execute", "done"];
const PHASE_LABEL = {
  parse: "Parse",
  rewrite: "Rewrite",
  plan: "Optimize",
  execute: "Execute",
  done: "Summary",
};

function PlanNodeCard({ node, active, speed, resolution, reason, inspected, onInspect }) {
  const target = node.actualRows != null ? node.actualRows * node.loops : null;
  const rows = useCountUp(target ?? 0, active && target != null, 900 / speed);
  const est = node.estRows;
  const actual = target;
  const misestimate =
    est != null &&
    actual != null &&
    Math.max(est, actual) >= 100 &&
    (actual >= est * 10 || actual <= est / 10);
  let estBar = 0;
  let actBar = 0;
  if (est != null && actual != null) {
    const logEst = Math.log10(est + 1);
    const logAct = Math.log10(actual + 1);
    const top = Math.max(logEst, logAct, 0.01);
    estBar = (logEst / top) * 100;
    actBar = (logAct / top) * 100;
  }
  return (
    <div
      className={`planNode ${active ? "active" : ""} kind-${node.kind}`}
      style={{ left: node.cx - NODE_W / 2, top: node.top, width: NODE_W }}
      title={node.label}
    >
      <div className="planNodeHead">
        <span className="planNodeKind">{KIND_LABEL[node.kind]}</span>
        <span className="planNodeLabel">{node.label}</span>
      </div>
      {resolution &&
        (() => {
          const { label, icon: Icon } = RESOLUTION_COPY[resolution];
          return (
            <button
              type="button"
              className={`planNodeOpt ${resolution} ${inspected ? "inspected" : ""}`}
              title={reason}
              onClick={(e) => {
                e.stopPropagation();
                onInspect();
              }}
            >
              <Icon size={10} />
              {label}
              <span className="planNodeOptHint">calc</span>
            </button>
          );
        })()}
      <div className="planNodeStats">
        {node.neverExecuted ? (
          <span className="planNodeMuted">never executed</span>
        ) : target != null ? (
          <>
            <span className="planNodeRows">{active ? formatRows(rows) : "–"}</span>
            <span className="planNodeMuted">rows</span>
            {node.loops > 1 && (
              <span className="planNodeMuted">×{node.loops} loops</span>
            )}
            {node.actualTotal != null && (
              <span className="planNodeTime">
                {formatDuration(node.actualTotal)}
              </span>
            )}
          </>
        ) : (
          <span className="planNodeMuted">
            est {est != null ? formatRows(est) : "?"} rows
          </span>
        )}
      </div>
      {est != null && actual != null && (
        <div className="planNodeEstBars">
          <i style={{ width: `${estBar}%` }} />
          <i className="actual" style={{ width: active ? `${actBar}%` : 0 }} />
        </div>
      )}
      {misestimate && active && (
        <div className="planNodeWarn">
          <AlertTriangle size={11} /> est {formatRows(est)} vs actual{" "}
          {formatRows(actual)}
        </div>
      )}
      {!misestimate && node.details[0] && (
        <div className="planNodeDetail">{node.details[0]}</div>
      )}
    </div>
  );
}

function DecisionCard({ decision, settled, compact, driverFamily }) {
  const maxCost = Math.max(...decision.candidates.map((c) => c.cost));
  if (compact) {
    const chosen = decision.candidates.find((c) => c.chosen);
    return (
      <div className="decisionLogItem">
        <Check size={12} />
        <span>{decision.title}</span>
        <b>{chosen?.name}</b>
      </div>
    );
  }
  const { node } = decision;
  return (
    <div className="decisionCard" key={decision.title + decision.node.label}>
      <div className="decisionTitle">
        {decision.title}
        <span className="decisionOptBadge">
          <Scale size={10} /> Cost-Based Optimizer
        </span>
        <small>
          {DRIVER_COST_NOTE[driverFamily] ?? DRIVER_COST_NOTE.postgres}
        </small>
      </div>
      {decision.candidates.map((candidate) => {
        const ioW = (candidate.io / maxCost) * 100;
        const cpuW = (candidate.cpu / maxCost) * 100;
        return (
          <div
            key={candidate.name}
            className={`candidateRow ${settled ? (candidate.chosen ? "won" : "lost") : ""}`}
          >
            <div className="candidateName">
              {settled &&
                (candidate.chosen ? <Check size={13} /> : <X size={13} />)}
              <span>{candidate.name}</span>
            </div>
            <div className="candidateTrack">
              <div
                className="candidateBar io"
                style={{ width: `${Math.max(1, ioW)}%` }}
                title={`page I/O ${formatCost(candidate.io)}`}
              />
              <div
                className="candidateBar cpu"
                style={{ width: `${Math.max(1, cpuW)}%` }}
                title={`row CPU ${formatCost(candidate.cpu)}`}
              />
              <span className="candidateCost">
                {formatCost(candidate.cost)}
                {!candidate.chosen && <em> est.</em>}
              </span>
            </div>
            <div className="candidateBreakdown">
              <span className="pillar io">
                <i /> I/O {formatCost(candidate.io)}
              </span>
              <span className="pillar cpu">
                <i /> CPU {formatCost(candidate.cpu)}
              </span>
              <span className="pillarRows">
                examines {formatRows(candidate.examined)} → returns{" "}
                {formatRows(candidate.returned)} rows
              </span>
            </div>
            <div className="candidateFormula">
              <span>I/O = {candidate.ioFormula}</span>
              <span>CPU = {candidate.cpuFormula}</span>
              {candidate.cpuNote && (
                <span className="formulaNote">{candidate.cpuNote}</span>
              )}
            </div>
            <div className="candidateReason">{candidate.reason}</div>
            {candidate.chosen ? (
              <div className="candidateMeta">
                {node.costStart != null && (
                  <span>
                    DB estimate: startup {node.costStart.toFixed(2)} → total{" "}
                    {node.costTotal.toFixed(2)}
                  </span>
                )}
                {node.estRows != null && (
                  <span>~{formatRows(node.estRows)} rows estimated</span>
                )}
              </div>
            ) : (
              <div className="candidateMeta muted">
                modeled from the same rows — EXPLAIN only reports the winner, so
                this is priced with the io + cpu cost model, not measured
              </div>
            )}
          </div>
        );
      })}
      {settled && (
        <div className="decisionVerdict">
          <Check size={12} /> lowest total of the two pillars (page I/O + row
          CPU) wins — this is what distinguishes a cost-based optimizer from a
          rule-based one, which would apply a fixed heuristic (e.g. "always
          prefer an index") with no cost comparison at all
        </div>
      )}
    </div>
  );
}

export function QueryOptimizerPage({ connection, database, sqlText }) {
  const [sql, setSql] = useState(sqlText || "");
  const dirtyRef = useRef(false);
  const [phase, setPhase] = useState("idle");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null); // { root, planningMs, executionMs }
  const [decisionStep, setDecisionStep] = useState(0);
  const [decisionSettled, setDecisionSettled] = useState(false);
  const [rewriteStep, setRewriteStep] = useState(0);
  const [execStep, setExecStep] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [inspectedNode, setInspectedNode] = useState(null);
  const treeScrollRef = useRef(null);

  const clampZoom = (z) => Math.min(2, Math.max(0.35, z));

  function fitZoom() {
    const el = treeScrollRef.current;
    if (!el || !layout) return;
    setZoom(
      clampZoom(
        Math.min(
          (el.clientWidth - 16) / layout.width,
          (el.clientHeight - 16) / layout.height,
          1,
        ),
      ),
    );
  }

  useEffect(() => {
    if (!dirtyRef.current && sqlText) setSql(sqlText);
  }, [sqlText]);

  const supported = SUPPORTED_DRIVERS.includes(connection?.driver);
  const driverFamily = connection?.driver === "mysql" ? "mysql" : "postgres";
  const decisions = useMemo(
    () => (plan?.root ? deriveDecisions(plan.root, connection?.driver) : []),
    [plan, connection?.driver],
  );
  const decisionsByNode = useMemo(
    () => new Map(decisions.map((d) => [d.node, d])),
    [decisions],
  );
  const layout = useMemo(
    () => (plan?.root ? layoutTree(plan.root) : null),
    [plan],
  );
  useEffect(() => {
    setInspectedNode(null);
  }, [plan]);
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
  const clauses = useMemo(() => clauseChips(sql), [sql]);
  const firstWord = (sql.trim().match(/^[a-z]+/i)?.[0] || "").toLowerCase();
  const mutating =
    firstWord && !["select", "with", "explain", "show", "table"].includes(firstWord);

  // Phase timeline driver.
  useEffect(() => {
    if (!running || paused || phase === "idle" || phase === "done") return;
    let delay;
    let advance;
    if (phase === "parse") {
      delay = 2400;
      advance = () => setPhase("rewrite");
    } else if (phase === "rewrite") {
      if (rewriteStep < REWRITE_PASSES.length) {
        delay = 340;
        advance = () => setRewriteStep((s) => s + 1);
      } else {
        delay = 700;
        advance = () => setPhase("plan");
      }
    } else if (phase === "plan") {
      if (!decisions.length) {
        delay = 2600;
        advance = () => setPhase("execute");
      } else if (!decisionSettled) {
        delay = 1300;
        advance = () => setDecisionSettled(true);
      } else if (decisionStep < decisions.length - 1) {
        delay = 1400;
        advance = () => {
          setDecisionStep((s) => s + 1);
          setDecisionSettled(false);
        };
      } else {
        delay = 1600;
        advance = () => setPhase("execute");
      }
    } else if (phase === "execute") {
      if (layout && execStep <= layout.total) {
        delay = 480;
        advance = () => setExecStep((s) => s + 1);
      } else {
        delay = 900;
        advance = () => setPhase("done");
      }
    }
    if (!advance) return;
    const timer = setTimeout(advance, delay / speed);
    return () => clearTimeout(timer);
  }, [
    running,
    paused,
    phase,
    speed,
    rewriteStep,
    decisionStep,
    decisionSettled,
    execStep,
    decisions.length,
    layout,
  ]);

  // autoplay=false (chip clicks) lands on the phase paused and fully
  // rendered so it can be inspected; ‹ › then step through it manually.
  function jumpTo(target, autoplay = false) {
    if (!plan) return;
    setPaused(!autoplay);
    setRunning(true);
    if (target === "parse") {
      setPhase("parse");
    } else if (target === "rewrite") {
      setRewriteStep(autoplay ? 0 : REWRITE_PASSES.length);
      setPhase("rewrite");
    } else if (target === "plan") {
      setDecisionStep(0);
      setDecisionSettled(!autoplay);
      setPhase("plan");
    } else if (target === "execute") {
      setExecStep(autoplay ? 0 : (layout ? layout.total + 1 : 0));
      setPhase("execute");
    } else if (target === "done") {
      setExecStep(layout ? layout.total + 1 : 0);
      setPhase("done");
    }
  }

  function stepForward() {
    if (!plan) return;
    setPaused(true);
    if (phase === "parse") {
      setRewriteStep(REWRITE_PASSES.length);
      setPhase("rewrite");
    } else if (phase === "rewrite") {
      setDecisionStep(0);
      setDecisionSettled(true);
      setPhase("plan");
    } else if (phase === "plan") {
      if (decisionStep < decisions.length - 1) {
        setDecisionStep((s) => s + 1);
        setDecisionSettled(true);
      } else {
        setExecStep(1);
        setPhase("execute");
      }
    } else if (phase === "execute") {
      if (layout && execStep <= layout.total) setExecStep((s) => s + 1);
      else setPhase("done");
    }
  }

  function stepBack() {
    if (!plan) return;
    setPaused(true);
    if (phase === "done") {
      setExecStep(layout ? layout.total : 0);
      setPhase("execute");
    } else if (phase === "execute") {
      if (execStep > 1) setExecStep((s) => s - 1);
      else {
        setDecisionStep(Math.max(0, decisions.length - 1));
        setDecisionSettled(true);
        setPhase("plan");
      }
    } else if (phase === "plan") {
      if (decisionStep > 0) {
        setDecisionStep((s) => s - 1);
        setDecisionSettled(true);
      } else {
        setRewriteStep(REWRITE_PASSES.length);
        setPhase("rewrite");
      }
    } else if (phase === "rewrite") {
      setPhase("parse");
    }
  }

  async function visualize() {
    if (!connection?.id || !sql.trim() || loading) return;
    setError("");
    setLoading(true);
    try {
      const result = await api.call(
        "ExplainAnalyzeDatabase",
        connection.id,
        database || "",
        sql,
      );
      const parsed = parsePlanTree(result);
      if (!parsed.root) {
        setError("Could not parse a plan tree from the EXPLAIN output.");
        setPlan(null);
        setRunning(false);
        setPhase("idle");
        return;
      }
      setPlan(parsed);
      setRewriteStep(0);
      setDecisionStep(0);
      setDecisionSettled(false);
      setExecStep(0);
      setPaused(false);
      setRunning(true);
      setPhase("parse");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  const phaseIndex = PHASES.indexOf(phase);
  const executing = phase === "execute" || phase === "done";

  // Pinch / Ctrl(⌘)+wheel zoom on the plan-tree canvas.
  useEffect(() => {
    const el = treeScrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.08 : 0.93)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [executing, layout]);
  const summary = plan
    ? {
        planning: plan.planningMs,
        execution: plan.executionMs ?? plan.root?.actualTotal,
        slowest: layout
          ? [...layout.nodes]
              .filter((n) => n.actualTotal != null)
              .sort((a, b) => b.actualTotal - a.actualTotal)[0]
          : null,
        rows:
          plan.root?.actualRows != null
            ? plan.root.actualRows * plan.root.loops
            : null,
      }
    : null;

  return (
    <section className="optimizerPage">
      <section className="panel optimizerPanel">
        <div className="panelHead">
          <div>
            <span>Query Optimizer Lab</span>
            <small>
              Watch how {connection?.driver === "mysql" ? "MySQL" : "PostgreSQL"}{" "}
              parses, plans, and executes your query — powered by a real{" "}
              <code>EXPLAIN ANALYZE</code> run.
            </small>
          </div>
          <div className="optimizerControls">
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="Animation speed"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
            <button
              onClick={stepBack}
              disabled={!plan || phase === "idle" || phase === "parse"}
              title="Step back"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPaused((p) => !p)}
              disabled={!running || phase === "done" || phase === "idle"}
              title={paused ? "Resume auto-play" : "Pause"}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              onClick={stepForward}
              disabled={!plan || phase === "idle" || phase === "done"}
              title="Step forward"
            >
              <ChevronRight size={14} />
            </button>
            <button
              onClick={() => jumpTo("parse", true)}
              disabled={!plan}
              title="Replay animation"
            >
              <RotateCcw size={14} /> Replay
            </button>
          </div>
        </div>

        {!supported ? (
          <div className="optimizerEmpty">
            Plan visualization needs <code>EXPLAIN ANALYZE</code>, which is
            available for MySQL, PostgreSQL, and TimescaleDB connections.
          </div>
        ) : (
          <>
            <div className="optimizerInput">
              <textarea
                value={sql}
                spellCheck={false}
                rows={3}
                placeholder="SELECT ... — the statement to explain and animate"
                onChange={(e) => {
                  dirtyRef.current = true;
                  setSql(e.target.value);
                }}
              />
              <div className="optimizerInputSide">
                <button
                  className="primary"
                  onClick={visualize}
                  disabled={loading || !sql.trim()}
                >
                  <Play size={14} />
                  {loading ? "Explaining…" : "Run & Visualize"}
                </button>
                {mutating && (
                  <span className="optimizerCaution">
                    <AlertTriangle size={12} /> EXPLAIN ANALYZE really executes
                    this statement
                  </span>
                )}
              </div>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="optimizerStages">
              {PHASES.map((p, idx) => (
                <button
                  key={p}
                  className={`stageChip ${phase === p ? "current" : ""} ${
                    phaseIndex > idx || phase === "done" ? "passed" : ""
                  }`}
                  disabled={!plan}
                  onClick={() => jumpTo(p)}
                >
                  <i>{idx + 1}</i>
                  {PHASE_LABEL[p]}
                </button>
              ))}
              {paused && running && phase !== "idle" && phase !== "done" && (
                <span className="pausedHint">
                  <Pause size={11} /> paused — step with ‹ › or press play
                </span>
              )}
            </div>

            <div className="optimizerCanvas">
              {phase === "idle" && (
                <div className="optimizerEmpty">
                  Run a query to see the whole journey: SQL → parse tree →
                  optimizer decisions → executing plan with rows flowing
                  through it.
                </div>
              )}

              {phase === "parse" && (
                <div className="parseStage">
                  <div className="stageHint">
                    The parser tokenizes your SQL and builds a syntax tree — no
                    data is touched yet.
                  </div>
                  <div className="tokenStream">
                    {tokens.map((token, i) => (
                      <span
                        key={`${token}-${i}`}
                        className={
                          SQL_KEYWORDS.has(token.toLowerCase())
                            ? "token keyword"
                            : "token"
                        }
                        style={{ animationDelay: `${(i * 45) / speed}ms` }}
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                  <div className="parseArrow">↓</div>
                  <div className="clauseTree">
                    <span className="clauseRoot">Query</span>
                    <div className="clauseChildren">
                      {clauses.map((clause, i) => (
                        <span
                          key={clause}
                          className="clauseChip"
                          style={{
                            animationDelay: `${(600 + i * 160) / speed}ms`,
                          }}
                        >
                          {clause}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {phase === "rewrite" && (
                <div className="rewriteStage">
                  <div className="stageHint">
                    The rewriter applies standard transformations before any
                    plan is considered.
                  </div>
                  {REWRITE_PASSES.map((pass, i) => (
                    <div
                      key={pass}
                      className={`rewritePass ${i < rewriteStep ? "doneP" : i === rewriteStep ? "activeP" : ""}`}
                    >
                      {i < rewriteStep ? (
                        <Check size={13} />
                      ) : (
                        <span className="rewriteDot" />
                      )}
                      {pass}
                    </div>
                  ))}
                </div>
              )}

              {phase === "plan" && !decisions.length && (
                <div className="planStage">
                  <div className="stageHint">
                    Nothing to weigh here: the optimizer resolved this query
                    without cost-based choices.
                  </div>
                  <div className="decisionCard">
                    <div className="decisionTitle">
                      Constant lookup
                      <span className="decisionOptBadge rule">
                        <Workflow size={10} /> Rule-Based Shortcut
                      </span>
                      <small>
                        A unique-key equality (like <code>WHERE id = …</code>)
                        pins down at most one row, so the row is fetched during
                        optimization itself — there are no alternative access
                        paths or join orders to compare. This is a fixed rule
                        (RBO-style), not a cost comparison: no CBO pricing runs
                        at all here.
                      </small>
                    </div>
                  </div>
                </div>
              )}

              {phase === "plan" && decisions[decisionStep] && (
                <div className="planStage">
                  <div className="stageHint">
                    Bottom-up, the optimizer prices every strategy for each
                    table and join, keeping the cheapest at each step — this
                    is cost-based optimization (CBO). Steps with only one
                    possible shape (a <code>LIMIT</code>, a filter, a
                    unique-key lookup) skip pricing entirely and are marked{" "}
                    <b>RULE</b> instead.
                    <em>
                      {" "}
                      Rejected costs are illustrative — the database only
                      reports the winner.
                    </em>
                  </div>
                  <div className="planStageBody">
                    <div className="decisionLog">
                      <div className="decisionLogTitle">
                        Decision {decisionStep + 1} of {decisions.length}
                      </div>
                      {decisions.slice(0, decisionStep).map((d, i) => (
                        <DecisionCard
                          key={i}
                          decision={d}
                          compact
                          settled
                          driverFamily={driverFamily}
                        />
                      ))}
                    </div>
                    <DecisionCard
                      decision={decisions[decisionStep]}
                      settled={decisionSettled}
                      driverFamily={driverFamily}
                    />
                  </div>
                </div>
              )}

              {executing && layout && (
                <div className="executeStage">
                  <div className="stageHint">
                    {phase === "execute"
                      ? "Executors pull rows demand-driven: each node asks its children for the next row — leaves feed data upward."
                      : "Execution finished — pulses show the measured row flow."}
                  </div>
                  <div className="planTreeWrap">
                    <div className="planTreeTools">
                      <button
                        title="Zoom out"
                        onClick={() => setZoom((z) => clampZoom(z / 1.2))}
                      >
                        <ZoomOut size={13} />
                      </button>
                      <span className="planTreeZoomLabel">
                        {Math.round(zoom * 100)}%
                      </span>
                      <button
                        title="Zoom in"
                        onClick={() => setZoom((z) => clampZoom(z * 1.2))}
                      >
                        <ZoomIn size={13} />
                      </button>
                      <button title="Fit to view" onClick={fitZoom}>
                        <Maximize size={13} />
                      </button>
                    </div>
                    <div className="planTreeScroll" ref={treeScrollRef}>
                      <div
                        className="planTreeZoom"
                        style={{
                          width: layout.width * zoom,
                          height: layout.height * zoom,
                        }}
                      >
                        <div
                          className="planTree"
                          style={{
                            width: layout.width,
                            height: layout.height,
                            transform: `scale(${zoom})`,
                            transformOrigin: "0 0",
                          }}
                        >
                      <svg
                        width={layout.width}
                        height={layout.height}
                        className="planEdges"
                      >
                        {layout.edges.map((edge, i) => {
                          const x1 = edge.from.cx;
                          const y1 = edge.from.top;
                          const x2 = edge.to.cx;
                          const y2 = edge.to.top + NODE_H;
                          const my = (y1 + y2) / 2;
                          const path = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
                          const active =
                            phase === "done" ||
                            edge.from.order < execStep;
                          const dots = active
                            ? Math.min(
                                4,
                                1 +
                                  Math.floor(
                                    Math.log10(
                                      (edge.from.actualRows ?? 0) * edge.from.loops + 1,
                                    ) / 2,
                                  ),
                              )
                            : 0;
                          const dur = `${(1.5 / speed).toFixed(2)}s`;
                          return (
                            <g key={i}>
                              <path
                                d={path}
                                className={`planEdge ${active ? "active" : ""}`}
                              />
                              {Array.from({ length: dots }).map((_, d) => (
                                <circle
                                  key={d}
                                  r="3.4"
                                  className="rowDot"
                                >
                                  <animateMotion
                                    dur={dur}
                                    repeatCount="indefinite"
                                    begin={`${(d * 1.5) / dots / speed}s`}
                                    path={path}
                                  />
                                </circle>
                              ))}
                            </g>
                          );
                        })}
                      </svg>
                      {layout.nodes.map((node, i) => {
                        const resolution = nodeResolution(node, decisionsByNode);
                        return (
                          <PlanNodeCard
                            key={i}
                            node={node}
                            speed={speed}
                            active={phase === "done" || node.order < execStep}
                            resolution={resolution}
                            reason={
                              resolution === "cbo"
                                ? cboCalculation(decisionsByNode.get(node))
                                : ruleReason(node, driverFamily)
                            }
                            inspected={inspectedNode === node}
                            onInspect={() =>
                              setInspectedNode((cur) => (cur === node ? null : node))
                            }
                          />
                        );
                      })}
                        </div>
                      </div>
                    </div>
                    {inspectedNode && (
                      <div className="nodeCalcPanel">
                        <div className="nodeCalcPanelHead">
                          <b>{inspectedNode.label}</b>
                          <button
                            type="button"
                            className="nodeCalcClose"
                            onClick={() => setInspectedNode(null)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                        {decisionsByNode.has(inspectedNode) ? (
                          <DecisionCard
                            decision={decisionsByNode.get(inspectedNode)}
                            settled
                            driverFamily={driverFamily}
                          />
                        ) : (
                          <div className="decisionCard">
                            <div className="decisionTitle">
                              How this step was placed
                              <span className="decisionOptBadge rule">
                                <Workflow size={10} /> Rule-Applied — no CBO
                                pricing
                              </span>
                            </div>
                            <p className="nodeCalcRuleText">
                              {ruleReason(inspectedNode, driverFamily)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {phase === "done" && summary && (
                    <div className="executeSummary">
                      <div>
                        <small>Planning</small>
                        <b>
                          {summary.planning != null
                            ? formatDuration(summary.planning)
                            : "—"}
                        </b>
                      </div>
                      <div>
                        <small>Execution</small>
                        <b>
                          {summary.execution != null
                            ? formatDuration(summary.execution)
                            : "—"}
                        </b>
                      </div>
                      <div>
                        <small>Rows out</small>
                        <b>
                          {summary.rows != null ? formatRows(summary.rows) : "—"}
                        </b>
                      </div>
                      {summary.slowest && (
                        <div className="wide">
                          <small>Slowest node</small>
                          <b>
                            {summary.slowest.label} ·{" "}
                            {formatDuration(summary.slowest.actualTotal)}
                          </b>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </section>
  );
}
