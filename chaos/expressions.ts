/**
 * Chaos expectation-expression evaluator, shared by the sdk-node chaos runner
 * (`run-chaos.test.ts`). Pure: no toxiproxy, no SDK, so it is unit-tested in
 * `test/chaos-expressions.test.ts`.
 *
 * The vocabulary mirrors sdk-go's chaos_test.go (qfg-47c2.4).
 */

/** The probe state an expression can read. Implemented by the runner's ChaosProbe. */
export interface ExpressionProbe {
  connState: string;
  fallbackActive: boolean;
  processCrashed: boolean;
  lastRefresh: number;
  sdkMetric(name: string, labels: Record<string, string>): number;
  logMatches(level: string, re: RegExp): number;
}

const RE_CONN_STATE_EQ = /^client\.connectionState\(\)\s*(==|!=)\s*'([^']+)'$/;
const RE_FALLBACK_EQ = /^client\.fallbackPollerActive\(\)\s*==\s*(true|false)$/;
const RE_PROC_ALIVE_EQ = /^client\.processStillAlive\(\)\s*==\s*(true|false)$/;
const RE_LAST_REFRESH =
  /^client\.lastSuccessfulRefresh\(\)\s*(>=|>|<=|<|==)\s*\(now\(\)\s*-\s*(\d+)\)$/;
const RE_SDK_METRIC =
  /^client\.sdkMetric\(\s*'([^']+)'\s*(?:,\s*layer=\s*'([^']+)'\s*)?\)\s*(>=|<=|==|!=|<|>)\s*(\d+)$/;
const RE_SERVER_METRIC = /^server_metric\(\s*'([^']+)'\s*\)\s*(>=|<=|==|!=|<|>)\s*(\d+)$/;
const RE_SDK_LOG =
  /^client\.sdkLog\(\s*'([^']+)'\s*,\s*\/(.+)\/i\s*\)\s*(>=|<=|==|!=|<|>)\s*(\d+)$/;

function splitOutsideQuotesAndRegex(expr: string, sep: string): string[] {
  const out: string[] = [];
  let inSQ = false;
  let inRE = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'" && !inRE) inSQ = !inSQ;
    else if (c === "/" && !inSQ) inRE = !inRE;
    if (!inSQ && !inRE && expr.substring(i, i + sep.length) === sep) {
      out.push(expr.substring(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(expr.substring(start));
  return out;
}

function compareNum(op: string, a: number, b: number): boolean {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
  }
  return false;
}

function evalLeaf(
  expr: string,
  probe: ExpressionProbe,
  serverMetric: (n: string) => number
): { ok: boolean; why: string } {
  expr = expr.trim();
  let m: RegExpExecArray | null;
  if ((m = RE_CONN_STATE_EQ.exec(expr))) {
    const [, op, want] = m;
    const got = probe.connState;
    const ok = op === "==" ? got === want : got !== want;
    return { ok, why: `connectionState=${got} ${op} ${want}` };
  }
  if ((m = RE_FALLBACK_EQ.exec(expr))) {
    const want = m[1] === "true";
    return {
      ok: probe.fallbackActive === want,
      why: `fallbackPollerActive=${probe.fallbackActive} want ${want}`,
    };
  }
  if ((m = RE_PROC_ALIVE_EQ.exec(expr))) {
    const want = m[1] === "true";
    const alive = !probe.processCrashed;
    return { ok: alive === want, why: `processStillAlive=${alive} want ${want}` };
  }
  if ((m = RE_LAST_REFRESH.exec(expr))) {
    const [, op, agoStr] = m;
    const ago = Number(agoStr);
    const threshold = Date.now() - ago;
    const ok = compareNum(op, probe.lastRefresh, threshold);
    return {
      ok,
      why: `lastSuccessfulRefresh=${probe.lastRefresh} ${op} (now()-${ago})=${threshold}`,
    };
  }
  if ((m = RE_SDK_METRIC.exec(expr))) {
    const [, metric, layer, op, wantStr] = m;
    const labels: Record<string, string> = layer ? { layer } : {};
    const got = probe.sdkMetric(metric, labels);
    const ok = compareNum(op, got, Number(wantStr));
    return { ok, why: `sdkMetric(${metric},layer=${layer ?? ""})=${got} ${op} ${wantStr}` };
  }
  if ((m = RE_SERVER_METRIC.exec(expr))) {
    const [, name, op, wantStr] = m;
    const got = serverMetric(name);
    const ok = compareNum(op, got, Number(wantStr));
    return { ok, why: `server_metric(${name})=${got} ${op} ${wantStr}` };
  }
  if ((m = RE_SDK_LOG.exec(expr))) {
    const [, level, pattern, op, wantStr] = m;
    const re = new RegExp(pattern, "i");
    const got = probe.logMatches(level, re);
    const ok = compareNum(op, got, Number(wantStr));
    return { ok, why: `sdkLog(${level},/${pattern}/i)=${got} ${op} ${wantStr}` };
  }
  return { ok: false, why: `unrecognized expression: ${expr}` };
}

export function evaluate(
  expr: string,
  probe: ExpressionProbe,
  serverMetric: (n: string) => number
): { ok: boolean; why: string } {
  expr = expr.trim();
  if (!expr) return { ok: true, why: "" };
  if (expr.includes(" OR ")) {
    const parts = splitOutsideQuotesAndRegex(expr, " OR ");
    const reasons: string[] = [];
    for (const p of parts) {
      const r = evaluate(p, probe, serverMetric);
      if (r.ok) return { ok: true, why: "" };
      reasons.push(r.why);
    }
    return { ok: false, why: "OR: " + reasons.join(" | ") };
  }
  if (expr.includes(" AND ")) {
    const parts = splitOutsideQuotesAndRegex(expr, " AND ");
    for (const p of parts) {
      const r = evaluate(p, probe, serverMetric);
      if (!r.ok) return { ok: false, why: "AND: " + r.why };
    }
    return { ok: true, why: "" };
  }
  return evalLeaf(expr, probe, serverMetric);
}
