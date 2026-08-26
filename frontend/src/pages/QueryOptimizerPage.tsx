import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
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
import { Page, Panel, PanelHeader } from "../components/shared/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

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
    kind: "op",
    table: null,
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
  const patterns: [string, RegExp][] = [
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
      className={cn(
        "absolute min-h-[68px] rounded-lg border border-border bg-card px-2.5 py-2 opacity-40 transition-[opacity,border-color,box-shadow] duration-500",
        active &&
          "border-primary/50 opacity-100 shadow-[0_0_0_3px_oklch(0.922_0_0/0.09),0_8px_20px_oklch(0_0_0/0.3)]",
      )}
      style={{ left: node.cx - NODE_W / 2, top: node.top, width: NODE_W }}
      title={node.label}
    >
      <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "flex-none rounded border border-primary/30 bg-primary/10 px-1 py-px text-[9.5px] font-bold tracking-wider text-primary",
            node.kind === "scan" &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
          )}
        >
          {KIND_LABEL[node.kind]}
        </span>
        <span className="truncate text-xs font-semibold">{node.label}</span>
      </div>
      {resolution &&
        (() => {
          const { label, icon: Icon } = RESOLUTION_COPY[resolution];
          return (
            <button
              type="button"
              className={cn(
                "mb-1.5 flex w-fit items-center gap-1 rounded px-1 py-px text-[9px] font-bold tracking-wider hover:brightness-125",
                resolution === "cbo"
                  ? "border border-primary/30 bg-primary/10 text-primary"
                  : "border border-amber-400/30 bg-amber-400/10 text-amber-400",
                inspected && "shadow-[0_0_0_2px_oklch(0.922_0_0/0.5)]",
              )}
              title={reason}
              onClick={(e) => {
                e.stopPropagation();
                onInspect();
              }}
            >
              <Icon size={10} />
              {label}
              <span className="font-normal lowercase opacity-55">calc</span>
            </button>
          );
        })()}
      <div className="flex items-baseline gap-1.5 text-xs">
        {node.neverExecuted ? (
          <span className="text-[11px] text-muted-foreground/70">never executed</span>
        ) : target != null ? (
          <>
            <span className="font-bold tabular-nums text-primary">
              {active ? formatRows(rows) : "–"}
            </span>
            <span className="text-[11px] text-muted-foreground/70">rows</span>
            {node.loops > 1 && (
              <span className="text-[11px] text-muted-foreground/70">
                ×{node.loops} loops
              </span>
            )}
            {node.actualTotal != null && (
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {formatDuration(node.actualTotal)}
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">
            est {est != null ? formatRows(est) : "?"} rows
          </span>
        )}
      </div>
      {est != null && actual != null && (
        <div className="mt-1.5 grid gap-0.5">
          <i className="block h-[3px] rounded bg-muted" style={{ width: `${estBar}%` }} />
          <i
            className="block h-[3px] rounded bg-primary transition-[width] duration-700 ease-[cubic-bezier(0.2,0.7,0.3,1)]"
            style={{ width: active ? `${actBar}%` : 0 }}
          />
        </div>
      )}
      {misestimate && active && (
        <div className="mt-1.5 flex items-center gap-1 overflow-hidden text-[10px] whitespace-nowrap text-amber-400">
          <AlertTriangle size={11} /> est {formatRows(est)} vs actual{" "}
          {formatRows(actual)}
        </div>
      )}
      {!misestimate && node.details[0] && (
        <div className="mt-1.5 truncate text-[10px] text-muted-foreground/70">
          {node.details[0]}
        </div>
      )}
    </div>
  );
}

function DecisionCard({ decision, settled, compact = false, driverFamily }) {
  const maxCost = Math.max(...decision.candidates.map((c) => c.cost));
  if (compact) {
    const chosen = decision.candidates.find((c) => c.chosen);
    return (
      <div className="flex animate-[token-in_0.3s_ease] items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
        <Check size={12} className="flex-none text-emerald-400" />
        <span className="min-w-0 truncate">{decision.title}</span>
        <b className="ml-auto font-semibold whitespace-nowrap text-foreground">
          {chosen?.name}
        </b>
      </div>
    );
  }
  const { node } = decision;
  return (
    <div
      className="max-w-[640px] animate-[token-in_0.35s_ease] rounded-lg border border-primary/30 bg-background px-4 py-3.5"
      key={decision.title + decision.node.label}
    >
      <div className="mb-3 font-semibold">
        {decision.title}
        <span className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide border border-primary/30 bg-primary/10 text-primary">
          <Scale size={10} /> Cost-Based Optimizer
        </span>
        <small className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {DRIVER_COST_NOTE[driverFamily] ?? DRIVER_COST_NOTE.postgres}
        </small>
      </div>
      {decision.candidates.map((candidate) => {
        const ioW = (candidate.io / maxCost) * 100;
        const cpuW = (candidate.cpu / maxCost) * 100;
        return (
          <div
            key={candidate.name}
            className={cn(
              "grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border/60 py-2 transition-opacity duration-500",
              settled && !candidate.chosen && "opacity-40 [&_.candidate-name>span]:line-through",
            )}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              {settled &&
                (candidate.chosen ? (
                  <Check size={13} className="flex-none text-emerald-400" />
                ) : (
                  <X size={13} className="flex-none text-muted-foreground" />
                ))}
              <span className="candidate-name">{candidate.name}</span>
            </div>
            <div className="flex h-[18px] items-center">
              <div
                className={cn(
                  "h-2 animate-[bar-grow_1.1s_cubic-bezier(0.2,0.7,0.3,1)_backwards]",
                  "rounded-l bg-muted-foreground/25",
                  settled && candidate.chosen && "bg-primary",
                )}
                style={{ width: `${Math.max(1, ioW)}%` }}
                title={`page I/O ${formatCost(candidate.io)}`}
              />
              <div
                className={cn(
                  "h-2 animate-[bar-grow_1.1s_cubic-bezier(0.2,0.7,0.3,1)_backwards]",
                  "rounded-r bg-muted-foreground/15",
                  settled && candidate.chosen && "bg-violet-400",
                )}
                style={{ width: `${Math.max(1, cpuW)}%` }}
                title={`row CPU ${formatCost(candidate.cpu)}`}
              />
              <span className="ml-2 text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">
                {formatCost(candidate.cost)}
                {!candidate.chosen && <em className="not-italic text-muted-foreground/60"> est.</em>}
              </span>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-sm bg-primary" /> I/O {formatCost(candidate.io)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-sm bg-violet-400" /> CPU {formatCost(candidate.cpu)}
              </span>
              <span className="text-muted-foreground/70">
                examines {formatRows(candidate.examined)} → returns{" "}
                {formatRows(candidate.returned)} rows
              </span>
            </div>
            <div className="col-start-2 mt-0.5 flex flex-col gap-0.5 text-[10px] text-muted-foreground/70 tabular-nums">
              <span>I/O = {candidate.ioFormula}</span>
              <span>CPU = {candidate.cpuFormula}</span>
              {candidate.cpuNote && (
                <span className="text-indigo-400">{candidate.cpuNote}</span>
              )}
            </div>
            <div className="col-start-2 text-[11.5px] leading-snug text-muted-foreground/70">
              {candidate.reason}
            </div>
            {candidate.chosen ? (
              <div className="col-start-2 mt-0.5 flex gap-3 text-[10.5px] text-primary tabular-nums">
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
              <div className="col-start-2 mt-0.5 text-[10.5px] text-muted-foreground/70 italic">
                modeled from the same rows — EXPLAIN only reports the winner, so
                this is priced with the io + cpu cost model, not measured
              </div>
            )}
          </div>
        );
      })}
      {settled && (
        <div className="mt-2.5 flex animate-[token-in_0.3s_ease] items-center gap-1.5 text-xs text-emerald-400">
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
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    setError("");
  }, [error]);
  const [plan, setPlan] = useState(null); // { root, planningMs, executionMs }
  const [decisionStep, setDecisionStep] = useState(0);
  const [decisionSettled, setDecisionSettled] = useState(false);
  const [rewriteStep, setRewriteStep] = useState(0);
  const [execStep, setExecStep] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspectedNode, setInspectedNode] = useState(null);
  const treeScrollRef = useRef(null);
  const nodeCalcPanelRef = useRef(null);
  const panRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });

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
    setPan({ x: 0, y: 0 });
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

  // Fit the plan to the visible pane as soon as it's ready, instead of
  // defaulting to 100% (which overflows the container for anything but a
  // tiny plan and forces the canvas to feel like it's blown out to fullscreen).
  useEffect(() => {
    if (!executing || !layout) return;
    const id = requestAnimationFrame(() => fitZoom());
    return () => cancelAnimationFrame(id);
  }, [executing, layout]);

  // Click-and-drag panning on the plan-tree canvas.
  useEffect(() => {
    const el = treeScrollRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      panRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      el.classList.add("panning");
    };
    const onMouseMove = (e) => {
      if (!panRef.current.active) return;
      setPan({
        x: panRef.current.panX + (e.clientX - panRef.current.startX),
        y: panRef.current.panY + (e.clientY - panRef.current.startY),
      });
    };
    const onMouseUp = () => {
      if (!panRef.current.active) return;
      panRef.current.active = false;
      el.classList.remove("panning");
    };
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [executing, layout, pan]);

  // Close the cost-breakdown popup on any click outside it (badge clicks
  // already stopPropagation, so this only fires for genuine outside clicks).
  useEffect(() => {
    if (!inspectedNode) return;
    const onDocMouseDown = (e) => {
      if (nodeCalcPanelRef.current && !nodeCalcPanelRef.current.contains(e.target)) {
        setInspectedNode(null);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [inspectedNode]);
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

  const inlineCode = "rounded bg-muted px-1 py-px font-mono text-[11px] text-primary";

  return (
    <Page>
      <Panel>
        <PanelHeader
          className="flex-wrap"
          title={
            <span>
              Query Optimizer Lab
              <span className="block text-xs font-normal text-muted-foreground">
                Watch how{" "}
                {connection?.driver === "mysql" ? "MySQL" : "PostgreSQL"}{" "}
                parses, plans, and executes your query — powered by a real{" "}
                <code className={inlineCode}>EXPLAIN ANALYZE</code> run.
              </span>
            </span>
          }
          actions={
            <div className="flex flex-none items-center gap-1.5">
              <NativeSelect
                size="sm"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                title="Animation speed"
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </NativeSelect>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={stepBack}
                disabled={!plan || phase === "idle" || phase === "parse"}
                title="Step back"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPaused((p) => !p)}
                disabled={!running || phase === "done" || phase === "idle"}
                title={paused ? "Resume auto-play" : "Pause"}
              >
                {paused ? <Play /> : <Pause />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={stepForward}
                disabled={!plan || phase === "idle" || phase === "done"}
                title="Step forward"
              >
                <ChevronRight />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => jumpTo("parse", true)}
                disabled={!plan}
                title="Replay animation"
              >
                <RotateCcw data-icon="inline-start" /> Replay
              </Button>
            </div>
          }
        />

        {!supported ? (
          <div className="m-auto max-w-[460px] p-12 text-center leading-relaxed text-muted-foreground">
            Plan visualization needs <code className={inlineCode}>EXPLAIN ANALYZE</code>, which is
            available for MySQL, PostgreSQL, and TimescaleDB connections.
          </div>
        ) : (
          <>
            <div className="flex gap-2.5 px-3.5 pt-3">
              <Textarea
                value={sql}
                spellCheck={false}
                rows={3}
                placeholder="SELECT ... — the statement to explain and animate"
                className="min-h-[58px] flex-1 resize-y font-mono text-xs"
                onChange={(e) => {
                  dirtyRef.current = true;
                  setSql(e.target.value);
                }}
              />
              <div className="flex w-[190px] flex-col gap-1.5">
                <Button onClick={visualize} disabled={loading || !sql.trim()}>
                  <Play data-icon="inline-start" />
                  {loading ? "Explaining…" : "Run & Visualize"}
                </Button>
                {mutating && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] leading-snug text-amber-400">
                    <AlertTriangle size={12} /> EXPLAIN ANALYZE really executes
                    this statement
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 px-3.5 pt-3">
              {PHASES.map((p, idx) => (
                <Button
                  key={p}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "gap-2 rounded-full pr-3.5 pl-2 text-xs",
                    phase === p && "border-primary text-foreground animate-[stage-pulse_1.6s_ease-in-out_infinite]",
                    phaseIndex > idx || phase === "done"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                  disabled={!plan}
                  onClick={() => jumpTo(p)}
                >
                  <i
                    className={cn(
                      "flex size-[18px] flex-none items-center justify-center rounded-full text-[11px] not-italic",
                      phase === p
                        ? "bg-primary text-primary-foreground"
                        : phaseIndex > idx || phase === "done"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {idx + 1}
                  </i>
                  {PHASE_LABEL[p]}
                </Button>
              ))}
              {paused && running && phase !== "idle" && phase !== "done" && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <Pause size={11} className="text-amber-400" /> paused — step
                  with ‹ › or press play
                </span>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3.5 pb-4">
              {phase === "idle" && (
                <div className="m-auto max-w-[460px] p-12 text-center leading-relaxed text-muted-foreground">
                  Run a query to see the whole journey: SQL → parse tree →
                  optimizer decisions → executing plan with rows flowing
                  through it.
                </div>
              )}

              {phase === "parse" && (
                <div className="flex flex-col">
                  <div className="mb-3.5 text-xs leading-relaxed text-muted-foreground">
                    The parser tokenizes your SQL and builds a syntax tree — no
                    data is touched yet.
                  </div>
                  <div className="flex max-w-[760px] flex-wrap gap-1.5">
                    {tokens.map((token, i) => (
                      <span
                        key={`${token}-${i}`}
                        className={cn(
                          "animate-[token-in_0.35s_ease_forwards] rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs opacity-0",
                          SQL_KEYWORDS.has(token.toLowerCase()) &&
                            "border-primary/30 bg-primary/10 text-primary",
                        )}
                        style={{ animationDelay: `${(i * 45) / speed}ms` }}
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                  <div className="mx-6 my-3 animate-[token-in_0.4s_ease_0.5s_backwards] text-xl text-primary">
                    ↓
                  </div>
                  <div className="flex items-start gap-3.5">
                    <span className="animate-[token-in_0.4s_ease_0.55s_backwards] rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground">
                      Query
                    </span>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {clauses.map((clause, i) => (
                        <span
                          key={clause}
                          className="animate-[token-in_0.4s_ease_forwards] rounded-md border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary opacity-0"
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
                <div className="max-w-[460px]">
                  <div className="mb-3.5 text-xs leading-relaxed text-muted-foreground">
                    The rewriter applies standard transformations before any
                    plan is considered.
                  </div>
                  {REWRITE_PASSES.map((pass, i) => (
                    <div
                      key={pass}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-[13px] transition-colors duration-300",
                        i < rewriteStep
                          ? "text-foreground"
                          : i === rewriteStep
                            ? "border-primary/30 bg-primary/10 text-foreground"
                            : "text-muted-foreground/70",
                      )}
                    >
                      {i < rewriteStep ? (
                        <Check size={13} className="flex-none text-emerald-400" />
                      ) : (
                        <span
                          className={cn(
                            "size-[13px] flex-none rounded-full border-2 border-border",
                            i === rewriteStep &&
                              "border-primary animate-[stage-pulse_1s_ease-in-out_infinite]",
                          )}
                        />
                      )}
                      {pass}
                    </div>
                  ))}
                </div>
              )}

              {phase === "plan" && !decisions.length && (
                <div className="flex flex-col">
                  <div className="mb-3.5 text-xs leading-relaxed text-muted-foreground">
                    Nothing to weigh here: the optimizer resolved this query
                    without cost-based choices.
                  </div>
                  <div className="max-w-[640px] rounded-lg border border-primary/30 bg-background px-4 py-3.5">
                    <div className="mb-3 font-semibold">
                      Constant lookup
                      <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide text-amber-400">
                        <Workflow size={10} /> Rule-Based Shortcut
                      </span>
                      <small className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        A unique-key equality (like <code className={inlineCode}>WHERE id = …</code>)
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
                <div className="flex flex-col">
                  <div className="mb-3.5 text-xs leading-relaxed text-muted-foreground">
                    Bottom-up, the optimizer prices every strategy for each
                    table and join, keeping the cheapest at each step — this
                    is cost-based optimization (CBO). Steps with only one
                    possible shape (a <code className={inlineCode}>LIMIT</code>, a filter, a
                    unique-key lookup) skip pricing entirely and are marked{" "}
                    <b className="font-semibold text-foreground">RULE</b> instead.
                    <em className="not-italic text-muted-foreground/70">
                      {" "}
                      Rejected costs are illustrative — the database only
                      reports the winner.
                    </em>
                  </div>
                  <div className="grid grid-cols-[250px_minmax(0,1fr)] items-start gap-3.5">
                    <div className="flex flex-col gap-1.5">
                      <div className="mb-1 text-xs text-muted-foreground">
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
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-3.5 text-xs leading-relaxed text-muted-foreground">
                    {phase === "execute"
                      ? "Executors pull rows demand-driven: each node asks its children for the next row — leaves feed data upward."
                      : "Execution finished — pulses show the measured row flow."}
                  </div>
                  <div className="relative flex min-h-0 flex-1 flex-col">
                    <div className="absolute top-2 right-2 z-[5] flex items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 backdrop-blur-sm">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Zoom out"
                        onClick={() => setZoom((z) => clampZoom(z / 1.2))}
                      >
                        <ZoomOut className="size-3.5" />
                      </Button>
                      <span className="min-w-9 text-center text-[11px] tabular-nums text-muted-foreground">
                        {Math.round(zoom * 100)}%
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Zoom in"
                        onClick={() => setZoom((z) => clampZoom(z * 1.2))}
                      >
                        <ZoomIn className="size-3.5" />
                      </Button>
                    </div>
                    <div
                      className="flex min-h-0 flex-1 cursor-grab overflow-auto rounded-lg border border-border bg-[radial-gradient(circle_at_1px_1px,oklch(1_0_0/0.06)_1px,transparent_0)] bg-[size:22px_22px]"
                      ref={treeScrollRef}
                    >
                      <div
                        className="m-auto flex-none"
                        style={{
                          width: layout.width * zoom,
                          height: layout.height * zoom,
                          transform: `translate(${pan.x}px, ${pan.y}px)`,
                        }}
                      >
                        <div
                          className="relative"
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
                            className="absolute inset-0 overflow-visible"
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
                                    className={cn(
                                      "fill-none stroke-border stroke-[1.6] transition-[stroke] duration-500",
                                      active && "stroke-primary/50",
                                    )}
                                  />
                                  {Array.from({ length: dots }).map((_, d) => (
                                    <circle
                                      key={d}
                                      r="3.4"
                                      className="fill-primary"
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
                      <div
                        className="absolute bottom-3 left-3 z-[6] max-h-[min(70%,480px)] w-[min(420px,calc(100%-24px))] animate-[token-in_0.2s_ease] overflow-y-auto rounded-lg border border-primary/30 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
                        ref={nodeCalcPanelRef}
                      >
                        <div className="mb-2.5 flex items-center gap-2 border-b border-border pb-2 text-[13px]">
                          <b className="min-w-0 flex-1 truncate">{inspectedNode.label}</b>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setInspectedNode(null)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                        {decisionsByNode.has(inspectedNode) ? (
                          <DecisionCard
                            decision={decisionsByNode.get(inspectedNode)}
                            settled
                            driverFamily={driverFamily}
                          />
                        ) : (
                          <div className="rounded-lg border border-primary/30 bg-background px-4 py-3.5">
                            <div className="mb-3 font-semibold">
                              How this step was placed
                              <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide text-amber-400">
                                <Workflow size={10} /> Rule-Applied — no CBO
                                pricing
                              </span>
                            </div>
                            <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                              {ruleReason(inspectedNode, driverFamily)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {phase === "done" && summary && (
                    <div className="mt-3 flex animate-[token-in_0.4s_ease] gap-2.5">
                      <div className="min-w-[110px] rounded-lg border border-border bg-card px-3.5 py-2">
                        <small className="mb-0.5 block text-[11px] text-muted-foreground">
                          Planning
                        </small>
                        <b className="block truncate text-sm font-semibold">
                          {summary.planning != null
                            ? formatDuration(summary.planning)
                            : "—"}
                        </b>
                      </div>
                      <div className="min-w-[110px] rounded-lg border border-border bg-card px-3.5 py-2">
                        <small className="mb-0.5 block text-[11px] text-muted-foreground">
                          Execution
                        </small>
                        <b className="block truncate text-sm font-semibold">
                          {summary.execution != null
                            ? formatDuration(summary.execution)
                            : "—"}
                        </b>
                      </div>
                      <div className="min-w-[110px] rounded-lg border border-border bg-card px-3.5 py-2">
                        <small className="mb-0.5 block text-[11px] text-muted-foreground">
                          Rows out
                        </small>
                        <b className="block truncate text-sm font-semibold">
                          {summary.rows != null ? formatRows(summary.rows) : "—"}
                        </b>
                      </div>
                      {summary.slowest && (
                        <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3.5 py-2">
                          <small className="mb-0.5 block text-[11px] text-muted-foreground">
                            Slowest node
                          </small>
                          <b className="block truncate text-sm font-semibold">
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
      </Panel>
    </Page>
  );
}