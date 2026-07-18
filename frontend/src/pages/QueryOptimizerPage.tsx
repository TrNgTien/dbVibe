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

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
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
    const chosenCost =
      node.costTotal ?? node.actualTotal ?? Math.max(1, node.estRows || 1);
    const candidates = candidateSet.map(([name, reason], idx) => {
      if (idx === chosenIdx)
        return { name, reason, cost: chosenCost, chosen: true };
      const seed = hashString(`${node.label}:${name}`);
      const mult = 1.7 + (seed % 100) / 38; // deterministic 1.7x..4.3x
      return { name, reason, cost: chosenCost * mult, chosen: false };
    });
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

function PlanNodeCard({ node, active, speed }) {
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

function DecisionCard({ decision, settled, compact }) {
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
  return (
    <div className="decisionCard" key={decision.title + decision.node.label}>
      <div className="decisionTitle">
        {decision.title}
        <small>comparing estimated cost of each strategy</small>
      </div>
      {decision.candidates.map((candidate) => {
        const width = Math.max(7, (candidate.cost / maxCost) * 100);
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
              <div className="candidateBar" style={{ width: `${width}%` }} />
              <span className="candidateCost">
                {candidate.cost >= 100
                  ? Math.round(candidate.cost).toLocaleString()
                  : candidate.cost.toFixed(2)}
                {!candidate.chosen && <em> est.</em>}
              </span>
            </div>
            <div className="candidateReason">{candidate.reason}</div>
          </div>
        );
      })}
      {settled && (
        <div className="decisionVerdict">
          <Check size={12} /> lowest estimated cost wins
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
  const decisions = useMemo(
    () => (plan?.root ? deriveDecisions(plan.root, connection?.driver) : []),
    [plan, connection?.driver],
  );
  const layout = useMemo(
    () => (plan?.root ? layoutTree(plan.root) : null),
    [plan],
  );
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
                      <small>
                        A unique-key equality (like <code>WHERE id = …</code>)
                        pins down at most one row, so the row is fetched during
                        optimization itself — there are no alternative access
                        paths or join orders to compare.
                      </small>
                    </div>
                  </div>
                </div>
              )}

              {phase === "plan" && decisions[decisionStep] && (
                <div className="planStage">
                  <div className="stageHint">
                    Bottom-up, the optimizer prices every strategy for each
                    table and join, keeping the cheapest at each step.
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
                        <DecisionCard key={i} decision={d} compact settled />
                      ))}
                    </div>
                    <DecisionCard
                      decision={decisions[decisionStep]}
                      settled={decisionSettled}
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
                      {layout.nodes.map((node, i) => (
                        <PlanNodeCard
                          key={i}
                          node={node}
                          speed={speed}
                          active={phase === "done" || node.order < execStep}
                        />
                      ))}
                        </div>
                      </div>
                    </div>
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
