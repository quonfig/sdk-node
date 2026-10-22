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
  /**
   * The probe's value for an SDK-side metric. `known` is false for a metric
   * name the probe does not implement, so the evaluator fails the expectation
   * loudly instead of comparing against a silent 0 (mirrors sdk-go's
   * `sdkMetric(name, labels) (value, known)`).
   */
  sdkMetric(name: string, labels: Record<string, string>): MetricReading;
  logMatches(level: string, re: RegExp): number;
  // Init-failure vocabulary (ITD chaos README, 00-boot-both-down-then-restore).
  /** 'pending' | 'returned' | 'raised'; '' when the test sets no on_init_failure. */
  initState?: string;
  /** onConfigUpdate callbacks fired after the init call returned or raised. */
  readyEvents?: number;
  /** The SDK's string getter with a caller default. May throw. */
  getString?: (key: string, dflt: string) => string;
  ready?(): boolean;
}

/**
 * A probe's reading of an SDK metric. `skip` set means the SDK does not have
 * the value: the leaf is SKIPPED with that reason (Decision 6), never compared.
 */
export interface MetricReading {
  value: number;
  known: boolean;
  skip?: string;
}

/**
 * Why `server_metric(...)` expressions are SKIPPED rather than evaluated: they
 * assert on api-delivery's own metrics, which the rig cannot read.
 */
export const SERVER_METRIC_SKIP_REASON =
  "server-side metric; api-delivery exports metrics only via OTLP push, so nothing is " +
  "scrapeable from the chaos rig. Server lag is covered by the staging drill " +
  "(qfg-47c2.19) and the QuonfigSubscriberLagHigh alert.";

/**
 * Result of evaluating an expectation expression.
 *
 * `skipped` lists every leaf that could not be evaluated, each with its reason.
 * `skippedOnly` is true when nothing in the expression was actually checked:
 * the runner reports such an expectation as SKIPPED, never as PASS.
 */
export interface EvalResult {
  ok: boolean;
  why: string;
  skipped: string[];
  skippedOnly: boolean;
}

function leafResult(ok: boolean, why: string): EvalResult {
  return { ok, why, skipped: [], skippedOnly: false };
}

function skippedResult(skipped: string[]): EvalResult {
  return { ok: true, why: `SKIPPED ${skipped.join("; ")}`, skipped, skippedOnly: true };
}

const RE_CONN_STATE_EQ = /^client\.connectionState\(\)\s*(==|!=)\s*'([^']+)'$/;
const RE_FALLBACK_EQ = /^client\.fallbackPollerActive\(\)\s*==\s*(true|false)$/;
const RE_PROC_ALIVE_EQ = /^client\.processStillAlive\(\)\s*==\s*(true|false)$/;
const RE_LAST_REFRESH =
  /^client\.lastSuccessfulRefresh\(\)\s*(>=|>|<=|<|==)\s*\(now\(\)\s*-\s*(\d+)\)$/;
const RE_SDK_METRIC =
  /^client\.sdkMetric\(\s*'([^']+)'\s*(?:,\s*layer=\s*'([^']+)'\s*)?\)\s*(>=|<=|==|!=|<|>)\s*(\d+)$/;
const RE_SERVER_METRIC = /^server_metric\(\s*'([^']+)'\s*\)\s*(>=|<=|==|!=|<|>)\s*(\d+)$/;
const RE_INIT_STATE = /^client\.initState\(\)\s*(==|!=)\s*'([^']+)'$/;
const RE_GET_STRING =
  /^client\.getString\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*(==|!=)\s*'([^']*)'$/;
const RE_READY_EVENTS = /^client\.readyEventCount\(\)\s*(>=|<=|==|!=|<|>)\s*(\d+)$/;
const RE_READY_EQ = /^client\.ready\(\)\s*==\s*(true|false)$/;
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

function evalLeaf(expr: string, probe: ExpressionProbe): EvalResult {
  expr = expr.trim();
  let m: RegExpExecArray | null;
  if ((m = RE_CONN_STATE_EQ.exec(expr))) {
    const [, op, want] = m;
    const got = probe.connState;
    const ok = op === "==" ? got === want : got !== want;
    return leafResult(ok, `connectionState=${got} ${op} ${want}`);
  }
  if ((m = RE_FALLBACK_EQ.exec(expr))) {
    const want = m[1] === "true";
    return leafResult(
      probe.fallbackActive === want,
      `fallbackPollerActive=${probe.fallbackActive} want ${want}`
    );
  }
  if ((m = RE_PROC_ALIVE_EQ.exec(expr))) {
    const want = m[1] === "true";
    const alive = !probe.processCrashed;
    return leafResult(alive === want, `processStillAlive=${alive} want ${want}`);
  }
  if ((m = RE_LAST_REFRESH.exec(expr))) {
    const [, op, agoStr] = m;
    const ago = Number(agoStr);
    const threshold = Date.now() - ago;
    const ok = compareNum(op, probe.lastRefresh, threshold);
    return leafResult(
      ok,
      `lastSuccessfulRefresh=${probe.lastRefresh} ${op} (now()-${ago})=${threshold}`
    );
  }
  if ((m = RE_SDK_METRIC.exec(expr))) {
    const [, metric, layer, op, wantStr] = m;
    const labels: Record<string, string> = layer ? { layer } : {};
    const { value: got, known, skip } = probe.sdkMetric(metric, labels);
    if (skip) {
      const reason = `${expr}: ${skip}`;
      return { ok: true, why: `SKIPPED ${reason}`, skipped: [reason], skippedOnly: true };
    }
    if (!known) {
      return leafResult(
        false,
        `unknown sdkMetric ${metric}: the chaos probe does not implement it`
      );
    }
    const ok = compareNum(op, got, Number(wantStr));
    return leafResult(ok, `sdkMetric(${metric},layer=${layer ?? ""})=${got} ${op} ${wantStr}`);
  }
  if ((m = RE_SERVER_METRIC.exec(expr))) {
    const skip = `${expr}: ${SERVER_METRIC_SKIP_REASON}`;
    return { ok: true, why: `SKIPPED ${skip}`, skipped: [skip], skippedOnly: true };
  }
  if ((m = RE_SDK_LOG.exec(expr))) {
    const [, level, pattern, op, wantStr] = m;
    const re = new RegExp(pattern, "i");
    const got = probe.logMatches(level, re);
    const ok = compareNum(op, got, Number(wantStr));
    return leafResult(ok, `sdkLog(${level},/${pattern}/i)=${got} ${op} ${wantStr}`);
  }
  if ((m = RE_INIT_STATE.exec(expr))) {
    const [, op, want] = m;
    const got = probe.initState ?? "";
    const ok = op === "==" ? got === want : got !== want;
    return leafResult(ok, `initState='${got}' ${op} '${want}'`);
  }
  if ((m = RE_GET_STRING.exec(expr))) {
    const [, key, dflt, op, want] = m;
    if (!probe.getString) return leafResult(false, `getString: the runner did not wire it`);
    let got: string;
    try {
      got = probe.getString(key, dflt);
    } catch (err) {
      return leafResult(false, `getString('${key}') threw: ${(err as Error).message}`);
    }
    const ok = op === "==" ? got === want : got !== want;
    return leafResult(ok, `getString('${key}')='${got}' ${op} '${want}'`);
  }
  if ((m = RE_READY_EVENTS.exec(expr))) {
    const [, op, wantStr] = m;
    const got = probe.readyEvents ?? 0;
    return leafResult(
      compareNum(op, got, Number(wantStr)),
      `readyEventCount=${got} ${op} ${wantStr}`
    );
  }
  if ((m = RE_READY_EQ.exec(expr))) {
    const want = m[1] === "true";
    if (!probe.ready) return leafResult(false, `ready: the runner did not wire it`);
    const got = probe.ready();
    return leafResult(got === want, `ready=${got} want ${want}`);
  }
  return leafResult(false, `unrecognized expression: ${expr}`);
}

export function evaluate(expr: string, probe: ExpressionProbe): EvalResult {
  expr = expr.trim();
  if (!expr) return leafResult(true, "");
  if (expr.includes(" OR ")) {
    // A skipped leaf is ignored in an OR: counting it true would make the whole
    // OR pass on the strength of an assertion that was never checked.
    const parts = splitOutsideQuotesAndRegex(expr, " OR ").map((p) => evaluate(p, probe));
    const skipped = parts.flatMap((r) => r.skipped);
    const checked = parts.filter((r) => !r.skippedOnly);
    if (checked.length === 0) return skippedResult(skipped);
    if (checked.some((r) => r.ok)) return { ok: true, why: "", skipped, skippedOnly: false };
    return {
      ok: false,
      why: "OR: " + checked.map((r) => r.why).join(" | "),
      skipped,
      skippedOnly: false,
    };
  }
  if (expr.includes(" AND ")) {
    // A skipped leaf is neutral (true) in an AND; the other leaves are still
    // enforced.
    const parts = splitOutsideQuotesAndRegex(expr, " AND ").map((p) => evaluate(p, probe));
    const skipped = parts.flatMap((r) => r.skipped);
    const checked = parts.filter((r) => !r.skippedOnly);
    if (checked.length === 0) return skippedResult(skipped);
    const failed = checked.find((r) => !r.ok);
    if (failed) return { ok: false, why: "AND: " + failed.why, skipped, skippedOnly: false };
    return { ok: true, why: "", skipped, skippedOnly: false };
  }
  return evalLeaf(expr, probe);
}
