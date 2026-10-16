import { describe, expect, it } from "vitest";
import {
  loadExpectations,
  newTimelineState,
  stepExpectation,
  type ChaosExpectation,
  type SampleResult,
} from "../chaos/timeline";

// Unit tests for the chaos expectation timeline (qfg-goi1.10.33), per the ITD
// chaos/README.md "Timeline rules (every harness)" (qfg-goi1.7).

const TRUE: SampleResult = { ok: true, why: "" };
const FALSE: SampleResult = { ok: false, why: "nope" };
const SKIP: SampleResult = { ok: true, why: "SKIPPED server_metric", skippedOnly: true };

/** Drive one expectation through ticks of `tick` ms from t=0 up to `until`. */
function run(
  exp: ChaosExpectation,
  sample: (elapsed: number) => SampleResult,
  until: number,
  tick = 250
) {
  const s = newTimelineState(exp);
  let evaluatedAt: number[] = [];
  for (let t = 0; t <= until; t += tick) {
    stepExpectation(
      s,
      () => {
        evaluatedAt.push(t);
        return sample(t);
      },
      t,
      t
    );
    if (s.passed || s.failed || s.skipped) break;
  }
  return { s, evaluatedAt };
}

describe("chaos timeline: after_ms (rule 1)", () => {
  it("does not evaluate, hold or PASS before after_ms", () => {
    const exp = { within_ms: 5000, after_ms: 1000, assert: "x" } as ChaosExpectation;
    const { s, evaluatedAt } = run(exp, () => TRUE, 5000);
    expect(evaluatedAt[0]).toBe(1000);
    expect(s.passed).toBe(true);
    expect(s.hitAt).toBe(1000);
  });

  it("is not terminal before after_ms even if the expression is true at t=0", () => {
    const exp = { within_ms: 5000, after_ms: 1000, assert: "x" } as ChaosExpectation;
    const s = newTimelineState(exp);
    const r = stepExpectation(s, () => TRUE, 0, 0);
    expect(r).toBeUndefined();
    expect(s.passed).toBe(false);
    expect(s.heldSince).toBeUndefined();
  });

  it("starts the hold at or after after_ms and PASSes when it completes", () => {
    const exp = {
      within_ms: 5000,
      after_ms: 1000,
      must_hold_for_ms: 2000,
      assert: "x",
    } as ChaosExpectation;
    const { s } = run(exp, () => TRUE, 5000);
    expect(s.hitAt).toBe(1000);
    expect(s.passed).toBe(true);
  });

  it("FAILs when after_ms leaves no time for the hold before within_ms", () => {
    const exp = {
      within_ms: 2500,
      after_ms: 1000,
      must_hold_for_ms: 2000,
      assert: "x",
    } as ChaosExpectation;
    const { s } = run(exp, () => TRUE, 5000);
    expect(s.passed).toBe(false);
    expect(s.failed).toBe(true);
  });

  it("a server_metric row with after_ms still reports SKIPPED", () => {
    const exp = { within_ms: 5000, after_ms: 1000, assert: "server_metric" } as ChaosExpectation;
    const { s } = run(exp, () => SKIP, 5000);
    expect(s.skipped).toBe(true);
    expect(s.passed).toBe(false);
  });
});

describe("chaos timeline: hold to window end (rule 3)", () => {
  it("a false sample resets the hold", () => {
    const exp = { within_ms: 10000, must_hold_for_ms: 2000, assert: "x" } as ChaosExpectation;
    const { s } = run(exp, (t) => (t === 1500 ? FALSE : TRUE), 10000);
    expect(s.passed).toBe(true);
    expect(s.hitAt).toBe(1750);
  });

  it("FAILs past within_ms when the hold has not completed", () => {
    const exp = { within_ms: 3000, must_hold_for_ms: 2000, assert: "x" } as ChaosExpectation;
    const { s } = run(exp, (t) => (t < 1500 ? FALSE : TRUE), 10000);
    expect(s.passed).toBe(false);
    expect(s.failed).toBe(true);
  });
});

describe("chaos timeline: loader rejects unknown expectation keys (rule 4)", () => {
  it("loads the four known keys", () => {
    const exps = loadExpectations(
      [{ within_ms: 5000, after_ms: 1000, must_hold_for_ms: 2000, assert: "x" }],
      "05 / run"
    );
    expect(exps).toHaveLength(1);
    expect(exps[0].after_ms).toBe(1000);
  });

  it("throws naming the unknown key", () => {
    expect(() =>
      loadExpectations([{ within_ms: 5000, not_before_ms: 1000, assert: "x" }], "05 / run")
    ).toThrow(/not_before_ms/);
  });
});
