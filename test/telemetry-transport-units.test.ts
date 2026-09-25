/**
 * Unit tests for the telemetry transport pieces (qfg-mol-m3c.1). The end-to-end
 * contract tests T1-T8 live in telemetry-transport.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyStatus,
  parseRetryAfterMs,
  TelemetryTransportQueue,
  TELEMETRY_DEFAULTS,
  RESEND_FLOOR_MS,
  RETRY_AFTER_CAP_MS,
  DROP_WARN_INTERVAL_MS,
  SHUTDOWN_FLUSH_DEADLINE_MS,
  EXAMPLE_CONTEXT_SEEN_CAP,
} from "../src/telemetry/transportQueue";
import { Transport, TelemetryRequestError, type TelemetryHttpResult } from "../src/transport";
import { normalizeLogger } from "../src/sdkLogger";
import { EvaluationSummaryCollector } from "../src/telemetry/evaluationSummaries";
import { ContextShapeCollector } from "../src/telemetry/contextShapes";
import { ExampleContextCollector } from "../src/telemetry/exampleContexts";
import { captureLogger } from "./helpers/captureLogger";
import { startTelemetryStub, type TelemetryStub } from "./helpers/telemetryStub";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("constants", () => {
  it("match the policy (P1, P4, P5, P6, P7, P8)", () => {
    expect(TELEMETRY_DEFAULTS).toEqual({
      flushIntervalMs: 60_000,
      timeoutMs: 15_000,
      maxRetainedBatches: 5,
      maxRetainedBytes: 2_097_152,
      maxRetainedAgeMs: 300_000,
      maxEvaluationSummaries: 10_000,
      maxContextShapeFields: 10_000,
      maxExampleContexts: 10_000,
    });
    expect(RESEND_FLOOR_MS).toBe(30_000);
    expect(RETRY_AFTER_CAP_MS).toBe(600_000);
    expect(DROP_WARN_INTERVAL_MS).toBe(600_000);
    expect(SHUTDOWN_FLUSH_DEADLINE_MS).toBe(5_000);
    expect(EXAMPLE_CONTEXT_SEEN_CAP).toBe(100_000);
  });
});

describe("classifyStatus", () => {
  it.each([
    [200, "ok"],
    [204, "ok"],
    [301, "rejected"],
    [400, "rejected"],
    [401, "auth"],
    [403, "auth"],
    [404, "auth"],
    [408, "retryable"],
    [413, "rejected"],
    [422, "rejected"],
    [429, "retryable"],
    [500, "retryable"],
    [503, "retryable"],
  ])("%i -> %s", (status, cls) => {
    expect(classifyStatus(status)).toBe(cls);
  });
});

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("delta-seconds", () => {
    expect(parseRetryAfterMs("120", now)).toBe(120_000);
    expect(parseRetryAfterMs(" 5 ", now)).toBe(5_000);
  });
  it("clamps to 600s", () => {
    expect(parseRetryAfterMs("3600", now)).toBe(600_000);
  });
  it("HTTP-date in the future", () => {
    expect(parseRetryAfterMs(new Date(now + 120_000).toUTCString(), now)).toBe(120_000);
  });
  it("HTTP-date in the past -> 0", () => {
    expect(parseRetryAfterMs(new Date(now - 60_000).toUTCString(), now)).toBe(0);
  });
  it("missing or garbage -> undefined", () => {
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined();
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
    expect(parseRetryAfterMs("", now)).toBeUndefined();
  });
});

describe("TelemetryTransportQueue", () => {
  const make = (
    results: Array<TelemetryHttpResult | Error>,
    over: Partial<{ maxRetainedBatches: number; maxRetainedBytes: number }> = {}
  ) => {
    const logger = captureLogger();
    const sent: Buffer[] = [];
    const q = new TelemetryTransportQueue({
      send: async (body) => {
        sent.push(body);
        const r = results.length > 0 ? results.shift()! : { status: 200, bodySnippet: "" };
        if (r instanceof Error) throw r;
        return r;
      },
      telemetryUrl: "http://t.example/api/v1/telemetry/",
      logger: normalizeLogger(logger),
      timeoutMs: 15_000,
      maxRetainedBatches: over.maxRetainedBatches ?? 5,
      maxRetainedBytes: over.maxRetainedBytes ?? 2_097_152,
      maxRetainedAgeMs: 300_000,
      onDisabled: () => {},
    });
    return { q, sent, logger };
  };
  const b = (s: string) => Buffer.from(s, "utf8");

  it("evicts oldest on the count cap and each eviction is a drop", () => {
    const { q, logger } = make([]);
    for (let i = 0; i < 7; i++) q.append(b(`batch-${i}`));
    expect(q.retainedCount).toBe(5);
    expect(logger.logCount("warn")).toBe(1);
    expect(logger.logCount("debug", /dropped a batch/)).toBe(1);
  });

  it("evicts oldest on the byte cap", () => {
    const { q } = make([], { maxRetainedBytes: 10 });
    q.append(b("aaaa"));
    q.append(b("bbbb"));
    q.append(b("cccc"));
    expect(q.retainedCount).toBe(2);
    expect(q.retainedBytes).toBe(8);
  });

  it("an oversize batch is not counted against the caps and is dropped after a failed send", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { q, sent, logger } = make([{ status: 503, bodySnippet: "" }], { maxRetainedBytes: 10 });
    q.append(b("small"));
    q.append(b("x".repeat(50)));
    expect(q.retainedCount).toBe(2);
    await q.drain();
    // Stopped at the first failure (the small, older batch); the oversize one is
    // never carried across ticks.
    expect(sent.length).toBe(1);
    expect(q.retainedCount).toBe(1);
    expect(logger.logCount("warn", /byte cap/)).toBe(1);
  });

  it("age boundary is strict: exactly maxRetainedAgeMs survives, one ms more is discarded", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { q } = make([]);
    q.append(b("old"));
    vi.advanceTimersByTime(300_000);
    q.expire();
    expect(q.retainedCount).toBe(1);
    vi.advanceTimersByTime(1);
    q.expire();
    expect(q.retainedCount).toBe(0);
  });

  it("a Retry-After shorter than the floor does not shorten it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { q } = make([{ status: 429, retryAfter: "5", bodySnippet: "" }]);
    q.append(b("a"));
    await q.drain();
    vi.advanceTimersByTime(29_999);
    expect(q.sendAllowed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(q.sendAllowed()).toBe(true);
  });

  it("network errors are retryable and logged at debug with the error code", async () => {
    const err = new TelemetryRequestError(
      "network",
      Object.assign(new Error("x"), { code: "ECONNREFUSED" })
    );
    const { q, logger } = make([err]);
    q.append(b("a"));
    await q.drain();
    expect(q.retainedCount).toBe(1);
    expect(logger.logCount("debug", /network error: ECONNREFUSED/)).toBe(1);
    expect(logger.logCount("warn")).toBe(0);
  });
});

describe("aggregator caps (P6)", () => {
  const evalFor = (key: string, value = "v") =>
    ({
      configId: `id-${key}`,
      configKey: key,
      configType: "config",
      unwrappedValue: value,
      ruleIndex: 0,
      reason: 1,
    }) as any;

  it("existing eval-summary keys keep incrementing at the cap", () => {
    const c = new EvaluationSummaryCollector(true, 2);
    c.push(evalFor("a"));
    c.push(evalFor("b"));
    c.push(evalFor("c")); // new key beyond the cap: dropped
    c.push(evalFor("a")); // existing key: counts
    const ev = c.drain()!;
    const keys = ev.summaries!.summaries.map((s) => s.key).sort();
    expect(keys).toEqual(["a", "b"]);
    const a = ev.summaries!.summaries.find((s) => s.key === "a")!;
    expect(a.counters[0].count).toBe(2);
  });

  it("context-shape cap counts (context, field) pairs, not context names", () => {
    const c = new ContextShapeCollector("periodic_example", 3);
    c.push({ user: { a: 1, b: 2, c: 3, d: 4 } });
    c.push({ user: { e: 5 }, team: { f: 6 } });
    const ev = c.drain()!;
    const fields = ev.contextShapes!.shapes.flatMap((s) => Object.keys(s.fieldTypes));
    expect(fields.sort()).toEqual(["a", "b", "c"]);
  });

  it("example-context rate-limit map is bounded", () => {
    const c = new ExampleContextCollector("periodic_example", 10, 60 * 60 * 1000, 3);
    for (let i = 0; i < 5; i++) c.push({ user: { key: `u${i}` } });
    expect((c as any).seen.size).toBe(3);
    expect(c.drain()!.exampleContexts!.examples.length).toBe(3);
  });

  it("disable() stops recording and clears data", () => {
    const c = new EvaluationSummaryCollector(true);
    c.push(evalFor("a"));
    c.disable();
    c.push(evalFor("b"));
    expect(c.drain()).toBeUndefined();
    expect(c.isEnabled()).toBe(false);
  });
});

describe("Transport.sendTelemetry", () => {
  let stub: TelemetryStub | undefined;
  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it("POSTs the exact bytes with auth + version headers and returns status and Retry-After", async () => {
    stub = await startTelemetryStub();
    stub.script({ status: 429, retryAfter: "120", body: "slow down" });
    const t = new Transport(["https://api.example.com"], "KEY", stub.url);
    const body = Buffer.from('{"instanceHash":"h","events":[]}', "utf8");
    const r = await t.sendTelemetry(body, { timeoutMs: 15_000 });
    expect(r).toEqual({ status: 429, retryAfter: "120", bodySnippet: "slow down" });
    expect(stub.body(0).equals(body)).toBe(true);
    expect(stub.header(0, "authorization")).toBe(
      `Basic ${Buffer.from("1:KEY").toString("base64")}`
    );
    expect(stub.header(0, "content-type")).toBe("application/json");
    expect(stub.header(0, "x-quonfig-sdk-version")).toMatch(/^node-/);
    expect(t.getTelemetryUrl()).toBe(`${stub.url}/api/v1/telemetry/`);
  });

  it("rejects with reason 'timeout' when the overall timeout fires (fake clock)", async () => {
    stub = await startTelemetryStub();
    stub.setDefault({ hang: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const t = new Transport(["https://api.example.com"], "KEY", stub.url);
    const p = t.sendTelemetry(Buffer.from("{}"), { timeoutMs: 15_000 }).catch((e) => e);
    await stub.waitForPosts(1);
    await vi.advanceTimersByTimeAsync(14_999);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(err).toBeInstanceOf(TelemetryRequestError);
    expect(err.reason).toBe("timeout");
  });

  it("rejects with reason 'aborted' when the caller's signal aborts", async () => {
    stub = await startTelemetryStub();
    stub.setDefault({ hang: true });
    const t = new Transport(["https://api.example.com"], "KEY", stub.url);
    const ac = new AbortController();
    const p = t
      .sendTelemetry(Buffer.from("{}"), { timeoutMs: 15_000, signal: ac.signal })
      .catch((e) => e);
    await stub.waitForPosts(1);
    ac.abort();
    const err = await p;
    expect(err.reason).toBe("aborted");
  });

  it("rejects with reason 'network' on a refused connection", async () => {
    stub = await startTelemetryStub();
    const url = stub.url;
    await stub.close();
    stub = undefined;
    const t = new Transport(["https://api.example.com"], "KEY", url);
    const err = await t.sendTelemetry(Buffer.from("{}"), { timeoutMs: 15_000 }).catch((e) => e);
    expect(err.reason).toBe("network");
    expect(err.message).toMatch(/ECONNREFUSED/);
  });
});

describe("default logger", () => {
  it("debug is a no-op (does not call console.debug)", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    normalizeLogger(undefined).debug("hidden");
    expect(spy).not.toHaveBeenCalled();
  });
});
