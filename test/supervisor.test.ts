/**
 * Supervisor contract Test 8 — auth-class response (qfg-goi1.10.24).
 *
 * Contract: integration-test-data chaos/supervisor-test-contract.md "Test 8"
 * at tag v2026.10.16 (rule R1-R6 of
 * project/plans/2026-10-07-sdk-auth-failure-rule.md). Shape follows the
 * sdk-go canary (supervisor_test.go / supervisor_auth_rig_test.go, 12e0e6c).
 *
 * Fixture rule: the SSE supervisor, the fallback-poller schedule and the
 * auth-failed state machine are real. Only these are faked:
 *   - the SSE worker: an EventSource factory whose every connect attempt fails
 *     with the scripted status (eventsource surfaces a non-200 as onerror);
 *   - the config fetch legs: a fake global `fetch` that answers each leg
 *     (primary / secondary) from a per-leg script;
 *   - the clock: vitest fake timers, plus the private `__testWaitHook` that
 *     records every background wait the SDK requests (sse / engage / poll /
 *     probe), so the assertions check the REQUESTED values (anti-vacuity rule).
 *
 * Everything lands in one ordered event log (waits, hits with the client's
 * state at that moment, log lines) that the assertions cut at the entry
 * ERROR and the exit INFO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";

const SDK_KEY = "t8-secret-sdk-key";
const PRIMARY = "https://primary.t8.test";
const SECONDARY = "https://secondary.t8.test";
const POLL_MS = 60_000;
const AUTH_STATUSES = [401, 403, 404, 410];
const PROBE_MIN = 150_000;
const PROBE_MAX = 300_000;
const SSE_BASE = 500;
const SSE_CAP = 30_000;

type Level = "debug" | "info" | "warn" | "error";

type Ev =
  | { kind: "wait"; wait: string; ms: number }
  | { kind: "hit"; target: "sse" | 0 | 1; state: string; active: boolean }
  | { kind: "log"; level: Level; msg: string };

/** One leg's scripted answer: 200 sends a valid envelope at `gen`; 304 is Not Modified. */
interface Resp {
  status: number;
  gen?: number;
}

interface FakeEventSource {
  onopen: ((evt: any) => void) | null;
  onmessage: ((evt: any) => void) | null;
  onerror: ((evt: any) => void) | null;
  close: () => void;
}

class Rig {
  events: Ev[] = [];
  q!: Quonfig;
  /** Status every SSE connect attempt fails with. */
  sseStatus: number;
  /** Per-leg answer for the next fetch cycle; tests reassign it between steps. */
  answer: (leg: number) => Resp = () => ({ status: 200, gen: 1 });

  constructor(sseStatus: number) {
    this.sseStatus = sseStatus;
  }

  private state(): { state: string; active: boolean } {
    if (!this.q) return { state: "", active: false };
    return {
      state: this.q.connectionState(),
      active: (this.q as any).fallbackPollerActive(),
    };
  }

  private log(level: Level) {
    return (message: string, ...args: unknown[]): void => {
      this.events.push({
        kind: "log",
        level,
        msg: [message, ...args.map((a) => (a instanceof Error ? a.message : String(a)))].join(" "),
      });
    };
  }

  start(opts: { enableSSE?: boolean; fallbackPollIntervalMs?: number } = {}): Quonfig {
    vi.stubGlobal("fetch", async (url: string) => {
      const leg = String(url).startsWith(PRIMARY) ? 0 : 1;
      this.events.push({ kind: "hit", target: leg as 0 | 1, ...this.state() });
      const r = this.answer(leg);
      const body =
        r.status === 200
          ? {
              configs: [],
              meta: { version: `gen-${r.gen}`, environment: "Production", generation: r.gen },
            }
          : { error: "nope" };
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        headers: { get: () => null },
        text: async () => (r.status === 200 ? JSON.stringify(body) : "rejected"),
        json: async () => body,
      };
    });

    const factory = (): FakeEventSource => {
      this.events.push({ kind: "hit", target: "sse", ...this.state() });
      const es: FakeEventSource = { onopen: null, onmessage: null, onerror: null, close: () => {} };
      const status = this.sseStatus;
      queueMicrotask(() =>
        es.onerror?.({ type: "error", code: status, message: `Non-200 status code (${status})` })
      );
      return es;
    };

    this.q = new Quonfig({
      sdkKey: SDK_KEY,
      apiUrls: [PRIMARY, SECONDARY],
      enableSSE: opts.enableSSE ?? true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: opts.fallbackPollIntervalMs ?? POLL_MS,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      logger: {
        debug: this.log("debug"),
        info: this.log("info"),
        warn: this.log("warn"),
        error: this.log("error"),
      },
      __testEventSourceFactory: factory,
      __testWaitHook: (wait: string, ms: number) => {
        this.events.push({ kind: "wait", wait, ms });
        return ms;
      },
    } as any);
    return this.q;
  }

  // ---- event-log queries ----

  idx(pred: (e: Ev) => boolean, from = 0): number {
    for (let i = from; i < this.events.length; i++) if (pred(this.events[i])) return i;
    return -1;
  }
  waits(wait: string, from = 0, to = this.events.length): number[] {
    return this.events
      .slice(from, to)
      .filter((e): e is Extract<Ev, { kind: "wait" }> => e.kind === "wait" && e.wait === wait)
      .map((e) => e.ms);
  }
  hits(target: "sse" | 0 | 1, from = 0, to = this.events.length) {
    return this.events
      .slice(from, to)
      .filter((e): e is Extract<Ev, { kind: "hit" }> => e.kind === "hit" && e.target === target);
  }
  logs(level: Level, re: RegExp = /.*/, from = 0, to = this.events.length): string[] {
    return this.events
      .slice(from, to)
      .filter(
        (e): e is Extract<Ev, { kind: "log" }> =>
          e.kind === "log" && e.level === level && re.test(e.msg)
      )
      .map((e) => e.msg);
  }
  entryIdx(): number {
    return this.idx((e) => e.kind === "log" && e.level === "error");
  }
  lastProbeWait(): number {
    const w = this.waits("probe");
    return w[w.length - 1];
  }
}

/** Let fetch chains and zero-delay timers settle without moving the clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Advance the clock by `ms`, then settle. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

/**
 * The SSE sleeps requested in [from, to) are the SDK's normal ladder (its
 * Test 2 behavior): the nth sleep is uniform in [d/2, d], d = 500ms doubling
 * to a 30s cap, starting from the base.
 */
function expectSSELadder(sleeps: number[]): void {
  sleeps.forEach((s, n) => {
    const d = Math.min(SSE_BASE * 2 ** n, SSE_CAP);
    expect(s, `SSE sleep #${n + 1}`).toBeGreaterThanOrEqual(d / 2);
    expect(s, `SSE sleep #${n + 1}`).toBeLessThanOrEqual(d);
  });
}

/** Boot the rig: init on a 200, then every leg answers `status` from now on. */
async function bootThenAnswer(rig: Rig, answer: (leg: number) => Resp, opts = {}): Promise<void> {
  rig.answer = () => ({ status: 200, gen: 1 });
  rig.start(opts);
  await rig.q.init();
  rig.answer = answer;
  await flush();
}

/** Run probes one at a time, each after exactly the wait the SDK requested. */
async function runProbe(rig: Rig): Promise<void> {
  await advance(rig.lastProbeWait());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(AUTH_STATUSES)("supervisor Test 8 — auth-class response (%i)", (status) => {
  it("(a)-(c) enters auth-failed after one rejected poller cycle and probes every 150-300s", async () => {
    const rig = new Rig(status);
    await bootThenAnswer(rig, () => ({ status }));

    // SSE never connected, so node engages the poller at once and runs its
    // first cycle one interval later. That cycle is rejected on every leg.
    await advance(POLL_MS);

    const entry = rig.entryIdx();
    // (c) exactly one ERROR: the entering cycle's line, naming status + host.
    expect(rig.logs("error")).toHaveLength(1);
    expect(entry).toBeGreaterThan(-1);
    expect(rig.logs("error")[0]).toMatch(new RegExp(`${status}`));
    expect(rig.logs("error")[0]).toContain("primary.t8.test");

    // (a) before the entering cycle: SSE on its normal ladder, no fetch cycle
    // beyond init (hit 1) and the entering cycle (hit 2).
    expect(rig.hits(0, 0, entry)).toHaveLength(2);
    const preSSE = rig.waits("sse", 0, entry);
    expect(preSSE.length).toBeGreaterThan(3);
    expectSSELadder(preSSE);
    expect(rig.waits("poll", 0, entry)).toEqual([POLL_MS]);

    // (b) the client is auth-failed: disconnected, poller off.
    expect(rig.q.connectionState()).toBe("disconnected");
    expect((rig.q as any).fallbackPollerActive()).toBe(false);

    // (a) the next 6 probes, each requested at a wait in [150s, 300s].
    const sseHitsAtEntry = rig.hits("sse").length;
    for (let p = 1; p <= 6; p++) {
      const before = rig.events.length;
      const w = rig.lastProbeWait();
      expect(w, `probe #${p} wait`).toBeGreaterThanOrEqual(PROBE_MIN);
      expect(w, `probe #${p} wait`).toBeLessThanOrEqual(PROBE_MAX);
      await runProbe(rig);
      // (b) one fetch cycle across both legs, seen as disconnected, poller off.
      const h0 = rig.hits(0, before);
      const h1 = rig.hits(1, before);
      expect(h0, `probe #${p} primary hits`).toHaveLength(1);
      expect(h1, `probe #${p} secondary hits`).toHaveLength(1);
      for (const h of [...h0, ...h1]) {
        expect(h.state).toBe("disconnected");
        expect(h.active).toBe(false);
      }
      expect(rig.q.connectionState()).toBe("disconnected");
    }
    // 1 probe armed on entry + 1 re-armed after each of the 6 rejected probes.
    const probes = rig.waits("probe");
    expect(probes).toHaveLength(7);
    for (const w of probes) {
      expect(w).toBeGreaterThanOrEqual(PROBE_MIN);
      expect(w).toBeLessThanOrEqual(PROBE_MAX);
    }

    // (b) no SSE attempt and no poller schedule while auth-failed.
    expect(rig.hits("sse")).toHaveLength(sseHitsAtEntry);
    expect(rig.waits("sse", entry)).toEqual([]);
    expect(rig.waits("poll", entry)).toEqual([]);
    expect(rig.waits("engage", entry)).toEqual([]);

    // (c) from entry through the 6 probes: one ERROR, no WARN, never the key.
    expect(rig.logs("error", /401|403|404|410/, entry)).toHaveLength(1);
    expect(rig.logs("error", /.*/, entry)).toHaveLength(1);
    expect(rig.logs("warn", /.*/, entry)).toEqual([]);
    for (const e of rig.events) {
      if (e.kind === "log") expect(e.msg).not.toContain(SDK_KEY);
    }

    await rig.q.close();
  });

  for (const variant of ["secondary-only 200", "304"] as const) {
    it(`(d) exits on the first probe with a ${variant}, restarts SSE at its base backoff, no latch`, async () => {
      const rig = new Rig(status);
      await bootThenAnswer(rig, () => ({ status }));
      await advance(POLL_MS);
      expect(rig.logs("error")).toHaveLength(1);

      await runProbe(rig); // one rejected probe
      expect(rig.logs("info", /accepted/)).toEqual([]);

      rig.answer =
        variant === "304"
          ? (leg) => (leg === 0 ? { status: 304 } : { status })
          : (leg) => (leg === 0 ? { status } : { status: 200, gen: 2 });
      const sseHitsBefore = rig.hits("sse").length;
      await runProbe(rig);

      const exit = rig.idx((e) => e.kind === "log" && e.level === "info" && /accepted/.test(e.msg));
      expect(exit).toBeGreaterThan(-1);
      expect(rig.logs("info", /accepted/)).toHaveLength(1);
      if (variant === "304") {
        expect(rig.q.heldGeneration()).toBe(1);
      } else {
        expect(rig.q.heldGeneration()).toBe(2); // installed off the secondary
      }
      // SSE restarted, and its next ordinary failure requests the FIRST backoff.
      expect(rig.hits("sse").length).toBeGreaterThan(sseHitsBefore);
      const afterExit = rig.waits("sse", exit);
      expect(afterExit.length).toBeGreaterThan(0);
      expect(afterExit[0]).toBeGreaterThanOrEqual(SSE_BASE / 2);
      expect(afterExit[0]).toBeLessThanOrEqual(SSE_BASE);
      expect(rig.logs("error")).toHaveLength(1);

      // No latch: a later rejected poller cycle enters again.
      rig.answer = () => ({ status });
      await advance(POLL_MS);
      expect(rig.logs("error")).toHaveLength(2);
      expect(rig.q.connectionState()).toBe("disconnected");

      await rig.q.close();
    });
  }

  it("(e) a transient primary rejection with a 200 on a leg stays on the normal regime", async () => {
    const rig = new Rig(status);
    await bootThenAnswer(rig, (leg) => (leg === 0 ? { status } : { status: 200, gen: 2 }));

    await advance(POLL_MS);
    expect(rig.q.heldGeneration()).toBe(2);
    expect(rig.logs("error")).toEqual([]);
    expect(rig.q.connectionState()).toBe("falling_back");
    expect((rig.q as any).fallbackPollerActive()).toBe(true);
    // The poller keeps its normal interval...
    expect(rig.waits("poll")).toEqual([POLL_MS, POLL_MS]);
    // ...and SSE keeps the normal ladder through and after the cycle.
    const cycleEnd = rig.events.length;
    await advance(SSE_CAP);
    expect(rig.waits("sse", cycleEnd).length).toBeGreaterThan(0);
    expectSSELadder(rig.waits("sse"));
    expect(rig.waits("probe")).toEqual([]);

    await rig.q.close();
  });

  it("(f) primary auth-class + secondary 503 enters; primary 503 + secondary auth-class does not", async () => {
    const enters = new Rig(status);
    await bootThenAnswer(enters, (leg) => (leg === 0 ? { status } : { status: 503 }));
    await advance(POLL_MS);
    expect(enters.logs("error")).toHaveLength(1);
    expect(enters.q.connectionState()).toBe("disconnected");
    expect(enters.lastProbeWait()).toBeGreaterThanOrEqual(PROBE_MIN);
    expect(enters.lastProbeWait()).toBeLessThanOrEqual(PROBE_MAX);
    await enters.q.close();
    vi.unstubAllGlobals();

    const stays = new Rig(status);
    await bootThenAnswer(stays, (leg) => (leg === 0 ? { status: 503 } : { status }));
    await advance(POLL_MS);
    await advance(POLL_MS);
    expect(stays.logs("error")).toEqual([]);
    expect(stays.q.connectionState()).toBe("falling_back");
    expect(stays.waits("poll")).toEqual([POLL_MS, POLL_MS, POLL_MS]);
    expect(stays.hits(0)).toHaveLength(3); // init + two ordinary poller cycles
    expect(stays.waits("probe")).toEqual([]);
    expectSSELadder(stays.waits("sse"));
    await stays.q.close();
  });
});

describe("supervisor Test 8 — non-auth status and polling mode", () => {
  it("(g) a 503 on every leg follows the normal ladder and never enters auth-failed", async () => {
    const rig = new Rig(503);
    await bootThenAnswer(rig, () => ({ status: 503 }));
    for (let i = 0; i < 4; i++) await advance(POLL_MS);
    expect(rig.logs("error")).toEqual([]);
    expect(rig.logs("warn", /Fallback poll error/)).toHaveLength(4);
    expect(rig.q.connectionState()).toBe("falling_back");
    expect(rig.hits(0)).toHaveLength(5); // init + 4 poller cycles
    expect(rig.waits("poll")).toEqual([POLL_MS, POLL_MS, POLL_MS, POLL_MS, POLL_MS]);
    expect(rig.waits("probe")).toEqual([]);
    expectSSELadder(rig.waits("sse"));
    await rig.q.close();
  });

  it.each(AUTH_STATUSES)(
    "polling mode (%i): first rejected poll enters; probe wait = max(T, interval); exit resumes polling",
    async (status) => {
      const rig = new Rig(status);
      await bootThenAnswer(rig, () => ({ status }), { enableSSE: false });
      expect(rig.q.connectionState()).toBe("falling_back");
      await advance(POLL_MS);
      expect(rig.logs("error")).toHaveLength(1);
      expect(rig.q.connectionState()).toBe("disconnected");
      expect(rig.lastProbeWait()).toBeGreaterThanOrEqual(PROBE_MIN);
      expect(rig.lastProbeWait()).toBeLessThanOrEqual(PROBE_MAX);
      expect(rig.hits("sse")).toEqual([]);

      rig.answer = () => ({ status: 200, gen: 2 });
      const before = rig.events.length;
      await runProbe(rig);
      expect(rig.logs("info", /accepted/)).toHaveLength(1);
      expect(rig.q.connectionState()).toBe("falling_back");
      expect(rig.hits(0, before)).toHaveLength(1); // the probe only, no immediate poll
      expect(rig.waits("poll", before)).toEqual([POLL_MS]);
      expect(rig.hits("sse")).toEqual([]);
      await rig.q.close();
    }
  );

  it("polling mode with an interval above 300s probes at the poll interval", async () => {
    const interval = 400_000;
    const rig = new Rig(401);
    await bootThenAnswer(rig, () => ({ status: 401 }), {
      enableSSE: false,
      fallbackPollIntervalMs: interval,
    });
    await advance(interval);
    expect(rig.logs("error")).toHaveLength(1);
    for (let p = 0; p < 3; p++) {
      expect(rig.lastProbeWait()).toBe(interval);
      await runProbe(rig);
    }
    expect(rig.waits("probe")).toEqual([interval, interval, interval, interval]);
    await rig.q.close();
  });
});
