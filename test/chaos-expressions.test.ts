import { describe, expect, it } from "vitest";
import { evaluate, SERVER_METRIC_SKIP_REASON, type ExpressionProbe } from "../chaos/expressions";

// Unit tests for the chaos expectation-expression evaluator (qfg-goi1.1.2).
// server_metric(...) reads api-delivery's own metrics, which the rig cannot
// scrape (OTLP push only). It must evaluate to an explicit SKIPPED with a
// reason, never a silent 0 that makes `== 0` pass.

function probe(over: Partial<ExpressionProbe> = {}): ExpressionProbe {
  return {
    connState: "connected",
    fallbackActive: false,
    processCrashed: false,
    lastRefresh: 0,
    sdkMetric: () => ({ value: 0, known: true }),
    logMatches: () => 0,
    ...over,
  };
}

const LAG = "server_metric('quonfig_subscriber_lag_seconds') == 0";

describe("chaos expressions: server_metric is SKIPPED, not a silent 0", () => {
  it("a standalone server_metric leaf is skipped with the stated reason", () => {
    const r = evaluate(LAG, probe());
    expect(r.skippedOnly).toBe(true);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain("server_metric('quonfig_subscriber_lag_seconds') == 0");
    expect(r.skipped[0]).toContain(SERVER_METRIC_SKIP_REASON);
    expect(r.why).toMatch(/^SKIPPED/);
  });

  it("the skip reason names OTLP-only export and where server lag is covered", () => {
    expect(SERVER_METRIC_SKIP_REASON).toMatch(/OTLP/);
    expect(SERVER_METRIC_SKIP_REASON).toMatch(/qfg-47c2\.19/);
    expect(SERVER_METRIC_SKIP_REASON).toMatch(/QuonfigSubscriberLagHigh/);
  });

  it("is skipped whatever the comparison, so a server-side assertion never passes vacuously", () => {
    // Under the old stub `server_metric(...) > 60` evaluated 0 > 60 = false and
    // `== 0` evaluated true: the result depended on the stub, not the server.
    const r = evaluate("server_metric('quonfig_subscriber_lag_seconds') > 60", probe());
    expect(r.skippedOnly).toBe(true);
  });

  it("in an AND, the skipped leaf is neutral and the other leaves are still enforced", () => {
    const expr = `client.connectionState() == 'connected' AND ${LAG}`;

    const pass = evaluate(expr, probe({ connState: "connected" }));
    expect(pass.ok).toBe(true);
    expect(pass.skippedOnly).toBe(false);
    expect(pass.skipped).toHaveLength(1);

    const fail = evaluate(expr, probe({ connState: "reconnecting" }));
    expect(fail.ok).toBe(false);
    expect(fail.skippedOnly).toBe(false);
    expect(fail.why).toContain("connectionState=reconnecting");
  });

  it("in an OR, the skipped leaf is ignored rather than counted true", () => {
    const expr = `client.connectionState() == 'connected' OR ${LAG}`;
    const r = evaluate(expr, probe({ connState: "reconnecting" }));
    expect(r.ok).toBe(false);
    expect(r.skippedOnly).toBe(false);
  });

  it("non-server leaves report no skips", () => {
    const r = evaluate("client.connectionState() == 'connected'", probe());
    expect(r.ok).toBe(true);
    expect(r.skipped).toEqual([]);
    expect(r.skippedOnly).toBe(false);
  });

  it("an unrecognized expression still fails loudly", () => {
    const r = evaluate("client.somethingNew() == 1", probe());
    expect(r.ok).toBe(false);
    expect(r.skippedOnly).toBe(false);
    expect(r.why).toContain("unrecognized expression");
  });
});

// An sdkMetric name the probe does not implement must fail the expectation
// loudly (qfg-goi1.2.20). It used to read a silent 0, so a typo such as
// `client.sdkMetric('typo_total') == 0` passed without checking anything.
// Mirrors sdk-go chaos_helpers_test.go, where sdkMetric returns (value, known).
describe("chaos expressions: unknown sdkMetric fails loudly, not a silent 0", () => {
  const unknownProbe = probe({ sdkMetric: () => ({ value: 0, known: false }) });

  it("fails an expectation on an unknown metric name, even when `== 0` would hold", () => {
    const r = evaluate("client.sdkMetric('typo_total') == 0", unknownProbe);
    expect(r.ok).toBe(false);
    expect(r.skippedOnly).toBe(false);
    expect(r.why).toContain("unknown sdkMetric typo_total");
  });

  it("fails an AND that contains an unknown metric", () => {
    const r = evaluate(
      "client.connectionState() == 'connected' AND client.sdkMetric('typo_total') == 0",
      unknownProbe
    );
    expect(r.ok).toBe(false);
    expect(r.why).toContain("unknown sdkMetric typo_total");
  });

  it("still evaluates a known metric with its labels", () => {
    const seen: Array<[string, Record<string, string>]> = [];
    const p = probe({
      sdkMetric: (name, labels) => {
        seen.push([name, labels]);
        return { value: 3, known: true };
      },
    });
    const r = evaluate("client.sdkMetric('quonfig_sdk_worker_restart_total', layer='1') >= 3", p);
    expect(r.ok).toBe(true);
    expect(seen).toEqual([["quonfig_sdk_worker_restart_total", { layer: "1" }]]);
  });
});
