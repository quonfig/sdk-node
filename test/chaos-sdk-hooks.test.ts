/**
 * The values the chaos harness asserts on come from the SDK, not from the
 * probe's own bookkeeping (qfg-6vno.2).
 *
 * - `sseFailedOverToSecondary()` reads the stream leg the transport actually
 *   holds (it was a constant `false`, so f05 could never fail).
 * - `supervisorCounters()` is the internal, test-only counter pair the probe
 *   reads for `quonfig_sse_connect_attempts_total` and
 *   `quonfig_sdk_worker_restart_total{layer=1}` (they were synthesized from
 *   state-change edges and a log regex).
 * - The probe reports `client.connectionState()` and
 *   `client.fallbackPollerActive()` verbatim, so it can never report a state
 *   the supervisor contract forbids (e.g. `reconnecting`).
 * - Layer-2 restarts, which the SDK does not count, are SKIPPED with a reason
 *   (Decision 6), not a silent 0.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChaosProbe, type ProbeClient } from "../chaos/probe";
import { evaluate } from "../chaos/expressions";
import { Quonfig } from "../src/quonfig";
import { SSEConnection, type SupervisorCounters } from "../src/sse";
import { Transport } from "../src/transport";

const PRIMARY = "https://primary.hooks.test";
const SECONDARY = "https://secondary.hooks.test";

describe("sseFailedOverToSecondary()", () => {
  it("is false while the stream leg is the primary and true once it repoints", () => {
    const q = new Quonfig({ sdkKey: "k", apiUrls: [PRIMARY, SECONDARY], enableSSE: false });
    const transport = (q as any).transport as Transport;
    expect(q.sseFailedOverToSecondary()).toBe(false);

    // A hedged secondary install moves the base-url leg but not the stream.
    transport.markActiveLeg(1, false);
    expect(q.sseFailedOverToSecondary()).toBe(false);

    // A stream repoint (the regression f05 exists to catch) must show.
    transport.markActiveLeg(1, true);
    expect(q.sseFailedOverToSecondary()).toBe(true);

    transport.markActiveLeg(0, true);
    expect(q.sseFailedOverToSecondary()).toBe(false);
  });
});

interface FakeES {
  onopen: ((e: any) => void) | null;
  onmessage: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  keepalive: () => void;
  close: () => void;
}

describe("SSEConnection supervisor counters", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts every connect attempt and every restart after an abnormal exit", async () => {
    vi.useFakeTimers();
    const counters: SupervisorCounters = { sseConnectAttempts: 0, workerRestartsLayer1: 0 };
    let es: FakeES | null = null;
    const factory = (_url: string, init: { onCommentFrame?: () => void }) => {
      es = {
        onopen: null,
        onmessage: null,
        onerror: null,
        keepalive: () => init.onCommentFrame?.(),
        close: () => {},
      };
      return es;
    };
    const sse = new SSEConnection(new Transport([PRIMARY], "k"), undefined, {
      eventSourceFactory: factory as any,
      counters,
    });

    sse.start(() => {});
    await vi.advanceTimersByTimeAsync(0);
    es!.keepalive();
    expect(counters).toEqual({ sseConnectAttempts: 1, workerRestartsLayer1: 0 });

    // Abnormal exit -> supervisor restart -> second attempt.
    es!.onerror?.({ type: "error" });
    expect(counters.workerRestartsLayer1).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(counters.sseConnectAttempts).toBe(2);

    // A failed reconnect is another abnormal exit and another restart.
    es!.onerror?.({ type: "error" });
    expect(counters.workerRestartsLayer1).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(counters.sseConnectAttempts).toBe(3);

    // close() is not an abnormal exit.
    sse.close();
    expect(counters).toEqual({ sseConnectAttempts: 3, workerRestartsLayer1: 2 });
  });
});

describe("Quonfig.supervisorCounters()", () => {
  it("counts a throwing onConfigUpdate as a layer-1 restart (reason callback_panic)", () => {
    const q = new Quonfig({
      sdkKey: "k",
      apiUrls: [PRIMARY],
      enableSSE: false,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onConfigUpdate: () => {
        throw new Error("boom");
      },
    });
    expect(q.supervisorCounters()).toEqual({ sseConnectAttempts: 0, workerRestartsLayer1: 0 });
    (q as any).invokeOnConfigUpdate();
    (q as any).invokeOnConfigUpdate();
    expect(q.supervisorCounters().workerRestartsLayer1).toBe(2);
  });
});

function fakeClient(over: Partial<ProbeClient> = {}): ProbeClient {
  return {
    lastSuccessfulRefresh: () => undefined,
    connectionState: () => "connected",
    fallbackPollerActive: () => false,
    supervisorCounters: () => ({ sseConnectAttempts: 0, workerRestartsLayer1: 0 }),
    isReady: () => true,
    ...over,
  };
}

describe("ChaosProbe reads the SDK", () => {
  it("reports client.connectionState() verbatim, including auth-failed's 'disconnected'", () => {
    let state: ReturnType<ProbeClient["connectionState"]> = "initializing";
    const probe = new ChaosProbe(fakeClient({ connectionState: () => state }));
    expect(probe.connState).toBe("initializing");
    state = "disconnected";
    expect(probe.connState).toBe("disconnected");
    expect(evaluate("client.connectionState() == 'disconnected'", probe).ok).toBe(true);
    state = "falling_back";
    expect(evaluate("client.connectionState() == 'falling_back'", probe).ok).toBe(true);
  });

  it("reads fallbackPollerActive() from the client", () => {
    let active = false;
    const probe = new ChaosProbe(fakeClient({ fallbackPollerActive: () => active }));
    expect(probe.fallbackActive).toBe(false);
    active = true;
    expect(probe.fallbackActive).toBe(true);
  });

  it("reads restart and attempt counters from supervisorCounters()", () => {
    const c: SupervisorCounters = { sseConnectAttempts: 4, workerRestartsLayer1: 3 };
    const probe = new ChaosProbe(fakeClient({ supervisorCounters: () => ({ ...c }) }));
    expect(
      evaluate("client.sdkMetric('quonfig_sdk_worker_restart_total', layer='1') == 3", probe).ok
    ).toBe(true);
    expect(evaluate("client.sdkMetric('quonfig_sse_connect_attempts_total') == 4", probe).ok).toBe(
      true
    );
    // An SSE state edge or a log line no longer moves the counter on its own.
    probe.log("error", "[quonfig] onConfigUpdate callback threw: x");
    expect(
      evaluate("client.sdkMetric('quonfig_sdk_worker_restart_total', layer='1') == 3", probe).ok
    ).toBe(true);
  });

  it("reports layer-2 restarts SKIPPED with a reason, never a constant 0", () => {
    const probe = new ChaosProbe(fakeClient());
    const r = evaluate(
      "client.sdkMetric('quonfig_sdk_worker_restart_total', layer='2') == 0",
      probe
    );
    expect(r.skippedOnly).toBe(true);
    expect(r.skipped[0]).toMatch(/layer-2/);
    // A bare restart_total (no layer) would silently fold in layer 2: skipped too.
    const all = evaluate("client.sdkMetric('quonfig_sdk_worker_restart_total') == 0", probe);
    expect(all.skippedOnly).toBe(true);
  });
});

describe("init-failure vocabulary (ITD 00-boot-both-down-then-restore)", () => {
  it("evaluates initState, getString, readyEventCount and ready", () => {
    const probe = new ChaosProbe(fakeClient({ isReady: () => false }));
    probe.initState = "pending";
    probe.readyEvents = 0;
    probe.getString = (_k, d) => d;
    expect(evaluate("client.initState() == 'pending'", probe).ok).toBe(true);
    expect(evaluate("client.ready() == false", probe).ok).toBe(true);
    expect(
      evaluate(
        "client.initState() == 'pending' AND client.getString('a.b', 'CODE-DEFAULT') == 'CODE-DEFAULT'",
        probe
      ).ok
    ).toBe(true);
    expect(evaluate("client.readyEventCount() >= 1", probe).ok).toBe(false);
    probe.readyEvents = 1;
    expect(evaluate("client.readyEventCount() >= 1", probe).ok).toBe(true);
  });

  it("fails getString when the SDK getter throws instead of passing", () => {
    const probe = new ChaosProbe(fakeClient());
    probe.getString = () => {
      throw new Error("not initialized");
    };
    const r = evaluate("client.getString('a', 'D') == 'D'", probe);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/not initialized/);
  });
});
