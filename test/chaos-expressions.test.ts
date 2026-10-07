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
    sdkMetric: () => 0,
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
