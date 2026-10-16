/**
 * Chaos expectation timeline, shared by both sdk-node chaos runners
 * (`run-chaos.test.ts` and `run-failover-chaos.test.ts`). Pure: no toxiproxy,
 * no SDK, so it is unit-tested in `test/chaos-timeline.test.ts`.
 *
 * Spec: integration-test-data `chaos/README.md` "Timeline rules (every
 * harness)" (qfg-goi1.7).
 */

/** One expectation row as it appears in a scenario YAML. */
export interface ChaosExpectation {
  within_ms: number;
  must_hold_for_ms?: number;
  /**
   * ms from t=0 (absolute, like `at_ms`; default 0). Before it the expectation
   * is not evaluated at all: no PASS, no hold start, not terminal (rule 1).
   */
  after_ms?: number;
  assert: string;
}

/** Every key the ITD schema allows on an expectation (additionalProperties: false). */
export const EXPECTATION_KEYS: readonly string[] = [
  "within_ms",
  "assert",
  "must_hold_for_ms",
  "after_ms",
];

/**
 * Load a scenario's expectations, rejecting any key outside
 * {@link EXPECTATION_KEYS} (rule 4). A harness pinned to a newer ITD than it
 * implements must fail loudly, not silently drop a timing field.
 */
export function loadExpectations(raw: unknown, where: string): ChaosExpectation[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${where}: expectations must be a list`);
  return raw.map((e, i) => {
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      throw new Error(`${where}: expectation[${i}] must be a mapping`);
    }
    for (const key of Object.keys(e)) {
      if (!EXPECTATION_KEYS.includes(key)) {
        throw new Error(
          `${where}: expectation[${i}] has unknown key '${key}' (allowed: ${EXPECTATION_KEYS.join(", ")})`
        );
      }
    }
    return e as ChaosExpectation;
  });
}

/** Per-expectation timeline state, mutated by {@link stepExpectation}. */
export interface TimelineState {
  exp: ChaosExpectation;
  hitAt?: number;
  heldSince?: number;
  passed: boolean;
  failed: boolean;
  /** Every leaf is unevaluable (server_metric): reported SKIPPED, never PASS. */
  skipped: boolean;
  lastReason: string;
}

/** What an evaluator reports for one sample. */
export interface SampleResult {
  ok: boolean;
  why: string;
  skippedOnly?: boolean;
}

export function newTimelineState(exp: ChaosExpectation): TimelineState {
  return { exp, passed: false, failed: false, skipped: false, lastReason: "" };
}

export function isTerminal(s: TimelineState): boolean {
  return s.passed || s.failed || s.skipped;
}

/**
 * Advance one expectation by one tick. `elapsed` is ms since t=0, `now` the
 * wall clock (ms). `sample` evaluates the expression. Returns the sample, or
 * undefined when the expectation was not evaluated this tick (terminal, or
 * still before its `after_ms`).
 */
export function stepExpectation<R extends SampleResult>(
  s: TimelineState,
  sample: () => R,
  elapsed: number,
  now: number
): R | undefined {
  if (isTerminal(s)) return undefined;
  if (elapsed < (s.exp.after_ms ?? 0)) return undefined;
  const r = sample();
  s.lastReason = r.why;
  if (r.skippedOnly) {
    s.skipped = true;
    return r;
  }
  if (r.ok) {
    if (s.heldSince === undefined) {
      s.heldSince = now;
      s.hitAt = elapsed;
    }
    const holdFor = s.exp.must_hold_for_ms ?? 0;
    if (holdFor <= 0 || now - s.heldSince >= holdFor) s.passed = true;
  } else {
    s.heldSince = undefined;
  }
  if (!s.passed && elapsed > s.exp.within_ms) s.failed = true;
  return r;
}
