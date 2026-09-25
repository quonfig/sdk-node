/**
 * Telemetry transport contract T1-T8 (qfg-mol-m3c.1), sdk-node reference
 * implementation of integration-test-data/chaos/telemetry-transport-contract.md.
 *
 * Fixture: a real Quonfig client (datafile mode, real reporter + queue + fetch)
 * pointed at a scriptable node:http stub; a manual clock (private
 * `__testTelemetryClock` option) drives the tick timer, the request timeout and
 * every telemetry time comparison; a capturing logger records every level.
 * Only the endpoint, the clock and the logger are mocked. Global timers stay
 * real: vitest fake timers stall undici's keep-alive reuse on Node 22.23.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { QuonfigOptions } from "../src/types";
import { captureLogger, type CaptureLogger } from "./helpers/captureLogger";
import { ManualClock } from "./helpers/manualClock";
import { startTelemetryStub, type TelemetryStub } from "./helpers/telemetryStub";

const MIN = 60_000;

function envelope() {
  const rule = (value: string) => ({
    criteria: [{ operator: "ALWAYS_TRUE" }],
    value: { type: "string", value },
  });
  const configs = Array.from({ length: 20 }, (_, i) => {
    const key = `cfg-${String(i).padStart(2, "0")}`;
    return {
      id: `id-${key}`,
      key,
      type: "config",
      valueType: "string",
      sendToClientSdk: false,
      default: { rules: [rule(`v-${key}`)] },
      environment: { id: "Production", rules: [rule(`v-${key}`)] },
    };
  });
  return { meta: { version: "test-version", environment: "Production" }, configs };
}

let stub: TelemetryStub;
let logger: CaptureLogger;
let q: Quonfig | undefined;
let clock: ManualClock;

beforeEach(async () => {
  stub = await startTelemetryStub();
  logger = captureLogger();
  clock = new ManualClock();
});

afterEach(async () => {
  await stub.close();
  if (q) await q.close();
  q = undefined;
});

async function client(overrides: Partial<QuonfigOptions> = {}): Promise<{ q: Quonfig; r: any }> {
  q = new Quonfig({
    sdkKey: "test-sdk-key",
    datafile: envelope(),
    telemetryUrl: stub.url,
    enableSSE: false,
    logger,
    __testTelemetryClock: clock,
    ...overrides,
  } as QuonfigOptions);
  await q.init();
  logger.clear();
  return { q, r: (q as any).telemetryReporter };
}

/**
 * Evaluation set `tag`: three evaluations over configs `cfgBase..cfgBase+2`,
 * each with a distinct context key `${tag}-i`, so a body identifies its set by
 * example-context key (and by config key where sets use distinct configs).
 */
function record(client: Quonfig, tag: string, cfgBase = 0): void {
  for (let i = 0; i < 3; i++) {
    const key = `cfg-${String((cfgBase + i) % 20).padStart(2, "0")}`;
    client.get(key, { user: { key: `${tag}-${i}` } });
  }
}

const has = (i: number, tag: string) => stub.body(i).toString("utf8").includes(`"${tag}-0"`);
const hasConfig = (i: number, key: string) =>
  stub.body(i).toString("utf8").includes(`"key":"${key}"`);

/** Advance the clock, then let any POSTs the tick started reach the stub and settle. */
async function advance(r: any, ms: number, expectPosts?: number): Promise<void> {
  await clock.advance(ms);
  if (expectPosts !== undefined) await stub.waitForPosts(expectPosts);
  await r.whenIdle();
}

describe("T1 timeout aborts and retains (P1, P5, P7)", () => {
  it("T1 timeout aborts and retains", async () => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ hang: true }, { status: 200 });

    await clock.advance(MIN); // tick 1: POST 0 hangs
    await stub.waitForPosts(1);
    await advance(r, 15_000); // the request is aborted
    expect(stub.postCount()).toBe(1);
    expect(r.debugState().retainedCount).toBe(1);
    expect(logger.logCount("warn")).toBe(0);
    expect(logger.logCount("error")).toBe(0);
    expect(logger.logCount("debug", /Telemetry POST failed \(timeout\)/)).toBe(1);

    await advance(r, 45_000, 2); // tick 2, 45s after the failure
    expect(stub.postCount()).toBe(2);
    expect(stub.sha(1)).toBe(stub.sha(0));
    expect(r.debugState().retainedCount).toBe(0);
    expect(logger.logCount("info", /recover/i)).toBe(1);
    expect(logger.logCount("warn")).toBe(0);
  });

  it("T1 defaults: timeout 15000, interval 60000 (fetch: no separate connect timeout)", async () => {
    const { r } = await client();
    expect(r.config.timeoutMs).toBe(15_000);
    expect(r.config.flushIntervalMs).toBe(60_000);
    expect(r.config).not.toHaveProperty("connectTimeoutMs");
  });
});

describe("T2 5xx retains verbatim and resends (P4, P5)", () => {
  it("T2 5xx retains verbatim and resends", async () => {
    const { q, r } = await client();
    record(q, "A", 0);
    stub.script({ status: 503 }, { status: 503 }, { status: 200 }, { status: 200 });

    await advance(r, MIN, 1);
    expect(r.debugState().retainedCount).toBe(1);

    record(q, "B", 3);
    await advance(r, MIN, 2);
    expect(r.debugState().retainedCount).toBe(2);

    await advance(r, MIN, 4);
    expect(stub.postCount()).toBe(4);
    expect(stub.sha(1)).toBe(stub.sha(0));
    expect(stub.sha(2)).toBe(stub.sha(0));
    expect(has(3, "B")).toBe(true);
    expect(hasConfig(3, "cfg-03")).toBe(true);
    expect(has(3, "A")).toBe(false);
    expect(hasConfig(3, "cfg-00")).toBe(false);
    expect(r.debugState().retainedCount).toBe(0);
  });
});

describe("T3 non-retryable 4xx (P3)", () => {
  it.each([401, 403, 404])("T3a %i disables telemetry for the process", async (status) => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ status: 503 }, { status });
    await advance(r, MIN, 1);
    expect(r.debugState().retainedCount).toBe(1);

    record(q, "B", 3);
    await advance(r, MIN, 2);
    expect(logger.logCount("error", new RegExp(String(status)))).toBe(1);
    expect(r.debugState().enabled).toBe(false);
    expect(r.debugState().retainedCount).toBe(0);
    expect(r.debugState().timerActive).toBe(false);
    expect(logger.logCount("warn")).toBe(0);

    for (let k = 0; k < 3; k++) {
      record(q, `C${k}`, 6);
      await advance(r, MIN);
    }
    await q.flush();
    expect(stub.postCount()).toBe(2);
    expect(logger.logCount("error")).toBe(1);
  });

  it.each([400, 413, 422])("T3b %i drops the batch and keeps ticking", async (status) => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ status, body: "bad payload" }, { status: 200 });
    await advance(r, MIN, 1);
    expect(r.debugState().retainedCount).toBe(0);
    expect(logger.logCount("error")).toBe(1);
    expect(logger.logCount("error", /bad payload/)).toBe(1);
    expect(logger.logCount("warn")).toBe(0);
    expect(r.debugState().enabled).toBe(true);

    record(q, "B", 3);
    await advance(r, MIN, 2);
    expect(stub.postCount()).toBe(2);
    expect(stub.sha(1)).not.toBe(stub.sha(0));
  });

  it("T3 408 is retryable (anti-vacuity)", async () => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ status: 408 });
    await advance(r, MIN, 1);
    expect(r.debugState().retainedCount).toBe(1);
    expect(r.debugState().enabled).toBe(true);
    expect(logger.logCount("error")).toBe(0);
  });
});

describe("T4 Retry-After and the 30s floor (P4)", () => {
  it("T4a 30s floor after a failure", async () => {
    const { q, r } = await client({ telemetryFlushIntervalMs: 8_000 });
    record(q, "A");
    stub.script({ status: 503 }, { status: 200 });
    await advance(r, 8_000, 1); // F = 8s
    for (let k = 0; k < 3; k++) {
      await advance(r, 8_000); // F+8, F+16, F+24
      expect(stub.postCount()).toBe(1);
    }
    await advance(r, 8_000, 2); // F+32: first tick at or after F+30
    expect(stub.postCount()).toBe(2);
    expect(stub.sha(1)).toBe(stub.sha(0));
  });

  it("T4b Retry-After delta-seconds honored", async () => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ status: 429, retryAfter: "120" }, { status: 200 });
    await advance(r, MIN, 1); // F = 60s
    await advance(r, MIN); // F+60
    await advance(r, 59_000); // F+119
    expect(stub.postCount()).toBe(1);
    await advance(r, 1_000); // F+120, the timer tick at 180s
    await advance(r, 0, 2);
    expect(stub.postCount()).toBe(2);
    expect(stub.sha(1)).toBe(stub.sha(0));
  });

  it("T4c Retry-After clamped to 600s, aged batch discarded with one WARN", async () => {
    const { q, r } = await client();
    record(q, "A", 0);
    stub.script({ status: 503, retryAfter: "3600" }, { status: 200 });
    await advance(r, MIN, 1); // F = 60s
    record(q, "B", 3);
    for (let k = 0; k < 9; k++) await advance(r, MIN); // up to F+540
    await advance(r, 59_000); // F+599
    expect(stub.postCount()).toBe(1);
    await advance(r, 1_000, 2); // F+600 (tick 11 at 660s)
    expect(stub.postCount()).toBe(2);
    expect(has(1, "B")).toBe(true);
    expect(has(1, "A")).toBe(false);
    expect(logger.logCount("warn")).toBe(1);
    expect(logger.logCount("warn", /older than 5 min/)).toBe(1);
  });

  it("T4d Retry-After HTTP-date honored", async () => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ status: 503, retryAfter: new Date(clock.now() + 3 * MIN).toUTCString() });
    await advance(r, MIN, 1); // F = 60s, Retry-After = 180s wall clock -> 120s after F
    await advance(r, MIN); // F+60
    expect(stub.postCount()).toBe(1);
    await advance(r, MIN, 2); // F+120
    expect(stub.sha(1)).toBe(stub.sha(0));
  });
});

describe("T5 caps under outage (P5, P6)", () => {
  it("T5 queue caps: 5 batches, oldest evicted, resent oldest-first", async () => {
    const { q, r } = await client();
    stub.setDefault({ status: 503 });
    const firstPost = new Map<string, string>();
    for (let k = 1; k <= 8; k++) {
      record(q, `E${k}`, k);
      const before = stub.postCount();
      await advance(r, MIN, before + 1);
      const i = stub.postCount() - 1;
      for (let s = 1; s <= k; s++)
        if (has(i, `E${s}`) && !firstPost.has(`E${s}`)) firstPost.set(`E${s}`, stub.sha(i));
      expect(r.debugState().retainedCount).toBeLessThanOrEqual(5);
      expect(r.debugState().retainedBytes).toBeLessThanOrEqual(r.config.maxRetainedBytes);
    }
    expect(r.debugState().retainedCount).toBe(5);

    stub.setDefault({ status: 200 });
    const start = stub.postCount();
    await advance(r, MIN, start + 5);
    expect(stub.postCount()).toBe(start + 5);
    const order = ["E4", "E5", "E6", "E7", "E8"];
    order.forEach((tag, j) => {
      expect(has(start + j, tag)).toBe(true);
      if (firstPost.has(tag)) expect(stub.sha(start + j)).toBe(firstPost.get(tag));
    });
    for (let i = start; i < start + 5; i++) expect(has(i, "E1")).toBe(false);
    expect(r.debugState().retainedCount).toBe(0);
  });

  it("T5 max age discards batches older than 5 min", async () => {
    const { q, r } = await client();
    stub.setDefault({ status: 503 });
    for (let k = 1; k <= 3; k++) {
      record(q, `E${k}`, k);
      await advance(r, MIN, stub.postCount() + 1);
    }
    for (let k = 0; k < 6; k++) await advance(r, MIN);
    expect(r.debugState().retainedCount).toBe(0);

    stub.setDefault({ status: 200 });
    const before = stub.postCount();
    await advance(r, MIN);
    for (let i = before; i < stub.postCount(); i++) {
      for (const tag of ["E1", "E2", "E3"]) expect(has(i, tag)).toBe(false);
    }
  });

  it("T5 oversize batch is dropped, not retained", async () => {
    const { q, r } = await client({ telemetryMaxRetainedBytes: 4096 });
    for (let k = 0; k < 20; k++) record(q, `X${k}`, k);
    stub.script({ status: 503 });
    await advance(r, MIN, 1);
    expect(stub.body(0).length).toBeGreaterThan(4096);
    expect(r.debugState().retainedCount).toBe(0);
    expect(r.debugState().retainedBytes).toBe(0);
    expect(logger.logCount("warn")).toBe(1);
    expect(logger.logCount("warn", /byte cap/)).toBe(1);
  });

  it("T5 shipped queue defaults: 5 / 2097152 / 300000", async () => {
    const { r } = await client();
    expect(r.config.maxRetainedBatches).toBe(5);
    expect(r.config.maxRetainedBytes).toBe(2_097_152);
    expect(r.config.maxRetainedAgeMs).toBe(300_000);
  });

  it("T5 aggregator defaults: 10000 each", async () => {
    const { q } = await client();
    expect((q as any).evaluationSummaries.maxDataSize).toBe(10_000);
    expect((q as any).contextShapes.maxDataSize).toBe(10_000);
    expect((q as any).exampleContexts.maxDataSize).toBe(10_000);
  });

  it("T5 aggregator caps: evaluation summaries (existing key keeps counting)", async () => {
    const { q, r } = await client({ telemetryMaxEvaluationSummaries: 3 });
    for (let i = 0; i < 6; i++) q.get(`cfg-0${i}`, { user: { key: "u" } });
    q.get("cfg-00", { user: { key: "u" } });
    await advance(r, MIN, 1);
    const ev = stub.json(0).events.find((e: any) => e.summaries).summaries;
    expect(ev.summaries.map((s: any) => s.key).sort()).toEqual(["cfg-00", "cfg-01", "cfg-02"]);
    const c0 = ev.summaries.find((s: any) => s.key === "cfg-00");
    expect(c0.counters[0].count).toBe(2);
  });

  it("T5 aggregator caps: context shape fields", async () => {
    const { q, r } = await client({ telemetryMaxContextShapeFields: 3 });
    q.get("cfg-00", { user: { key: "u", a: 1, b: 2 }, team: { c: 3, d: 4 } });
    await advance(r, MIN, 1);
    const shapes = stub.json(0).events.find((e: any) => e.contextShapes).contextShapes.shapes;
    const fields = shapes.flatMap((s: any) => Object.keys(s.fieldTypes));
    expect(fields).toHaveLength(3);
  });

  it("T5 aggregator caps: example contexts", async () => {
    const { q, r } = await client({ telemetryMaxExampleContexts: 3 });
    for (let i = 0; i < 6; i++) q.get("cfg-00", { user: { key: `u${i}` } });
    await advance(r, MIN, 1);
    const ex = stub.json(0).events.find((e: any) => e.exampleContexts).exampleContexts.examples;
    expect(ex).toHaveLength(3);
  });
});

describe("T6 logging episodes (P7)", () => {
  it("T6a blip: no WARN, one recovery INFO", async () => {
    const { q, r } = await client();
    record(q, "A");
    stub.script({ status: 503 }, { status: 200 });
    await advance(r, MIN, 1);
    await advance(r, MIN, 2);
    expect(logger.logCount("warn")).toBe(0);
    expect(logger.logCount("info", /recover/i)).toBe(1);
    expect(logger.logCount("debug")).toBeGreaterThanOrEqual(1);
    expect(logger.logCount("error")).toBe(0);
  });

  it("T6b sustained 503: one WARN at first drop, INFO on recovery", async () => {
    const { q, r } = await client();
    stub.setDefault({ status: 503 });
    for (let k = 1; k <= 5; k++) {
      record(q, `E${k}`, k);
      await advance(r, MIN, stub.postCount() + 1);
    }
    expect(logger.logCount("warn")).toBe(0);
    record(q, "E6", 6);
    await advance(r, MIN, stub.postCount() + 1); // tick 6 evicts E1
    expect(logger.logCount("warn")).toBe(1);
    const warn = logger.lines.find((l) => l.level === "warn")!.msg;
    expect(warn).toMatch(/last POST result: 503/);
    expect(warn).toMatch(/retained queue 5\/5 batches/);
    expect(warn).toMatch(/1 batch\(es\) dropped so far/);
    for (let k = 7; k <= 9; k++) {
      record(q, `E${k}`, k);
      await advance(r, MIN, stub.postCount() + 1);
    }
    expect(logger.logCount("warn")).toBe(1);
    stub.setDefault({ status: 200 });
    await advance(r, MIN, stub.postCount() + 1);
    expect(logger.logCount("info", /recover/i)).toBe(1);
    expect(logger.logCount("error")).toBe(0);
  });

  it("T6c WARN summary at most once per 10 min", async () => {
    const { q, r } = await client();
    stub.setDefault({ status: 503 });
    // Tick 6 (360s) is the first drop; the next WARN is due at >= 960s (tick 16).
    for (let k = 1; k <= 15; k++) {
      record(q, `E${k}`, k);
      await advance(r, MIN, stub.postCount() + 1);
    }
    expect(logger.logCount("warn")).toBe(1);
    record(q, "E16", 16);
    await advance(r, MIN, stub.postCount() + 1);
    expect(logger.logCount("warn")).toBe(2);
    expect(
      logger.logCount("warn", /still dropping data: \d+ batch\(es\) dropped in the last 10 min/)
    ).toBe(1);
    for (let k = 17; k <= 25; k++) {
      record(q, `E${k}`, k);
      await advance(r, MIN, stub.postCount() + 1);
    }
    expect(logger.logCount("warn")).toBe(2);
    expect(logger.logCount("error")).toBe(0);
  });
});

describe("T7 one POST in flight (P2)", () => {
  it("T7 one POST in flight; skipped windows aggregate", async () => {
    const { q, r } = await client();
    record(q, "A", 0);
    stub.script({ hang: true });
    void r.tick();
    await stub.waitForPosts(1);
    expect(r.debugState().inFlight).toBe(true);

    record(q, "B", 3);
    await r.tick();
    record(q, "C", 6);
    await r.tick();
    expect(stub.postCount()).toBe(1);

    stub.release(0, { status: 200 });
    await r.whenIdle();
    await r.tick();
    await stub.waitForPosts(2);
    await r.whenIdle();
    expect(stub.postCount()).toBe(2);
    expect(has(1, "B")).toBe(true);
    expect(has(1, "C")).toBe(true);
    expect(has(1, "A")).toBe(false);
  });
});

describe("T8 shutdown (P8)", () => {
  it("T8 close(): 5s final flush, retained queue not drained, no handles left", async () => {
    const { q: client1, r } = await client();
    stub.script({ status: 503 }, { status: 503 });
    record(client1, "A", 0);
    await advance(r, MIN, 1);
    record(client1, "B", 3);
    await advance(r, MIN, 2);
    expect(r.debugState().retainedCount).toBe(2);
    record(client1, "C", 6);
    stub.setDefault({ hang: true });

    let closed = false;
    const closing = client1.close().then(() => {
      closed = true;
    });
    await stub.waitForPosts(3);
    expect(closed).toBe(false);
    await clock.advance(5_000);
    await closing;
    expect(closed).toBe(true);
    q = undefined;

    expect(stub.postCount()).toBe(3);
    expect(has(2, "C")).toBe(true);
    expect(has(2, "A")).toBe(false);
    expect(has(2, "B")).toBe(false);
    expect(stub.sha(2)).not.toBe(stub.sha(0));

    await clock.advance(10 * MIN);
    expect(stub.postCount()).toBe(3);
    expect(r.debugState().inFlight).toBe(false);
    expect(r.debugState().timerActive).toBe(false);
    expect(clock.pending()).toBe(0);
    await expect(client1.close()).resolves.toBeUndefined();
  });
});
