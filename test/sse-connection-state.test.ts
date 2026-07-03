import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SSEConnection, type SSEConnectionState } from "../src/sse";
import { Transport } from "../src/transport";

interface FakeEventSource {
  onopen: ((evt: any) => void) | null;
  onmessage: ((evt: any) => void) | null;
  onerror: ((evt: any) => void) | null;
  close: () => void;
}

function makeTransport(): Transport {
  return new Transport(["https://primary.quonfig.com"], "test-key");
}

function makeSSE(states: SSEConnectionState[], factoryOut: { value: FakeEventSource | null }) {
  const factory = (_url: string, _init: { headers: Record<string, string> }) => {
    const es: FakeEventSource = {
      onopen: null,
      onmessage: null,
      onerror: null,
      close: () => {},
    };
    factoryOut.value = es;
    return es;
  };

  return new SSEConnection(makeTransport(), undefined, {
    onConnectionStateChange: (s) => states.push(s),
    eventSourceFactory: factory as any,
  });
}

describe("SSEConnection — connection-state callback", () => {
  it("emits 'connecting' immediately on start(), then 'connected' on onopen", async () => {
    const states: SSEConnectionState[] = [];
    const fake: { value: FakeEventSource | null } = { value: null };
    const sse = makeSSE(states, fake);

    sse.start(() => {});
    // 'connecting' is synchronous on start()
    expect(states).toEqual(["connecting"]);

    // dynamic import resolution + EventSource construction is async
    await new Promise((r) => setImmediate(r));
    expect(fake.value).not.toBeNull();

    fake.value!.onopen?.({});
    expect(states).toEqual(["connecting", "connected"]);

    sse.close();
  });

  it("emits 'error' on onerror, then 'connecting'/'connected' when the recreated EventSource opens", async () => {
    vi.useFakeTimers();
    try {
      const states: SSEConnectionState[] = [];
      const fake: { value: FakeEventSource | null } = { value: null };
      const sse = makeSSE(states, fake);

      sse.start(() => {});
      fake.value!.onopen?.({});
      fake.value!.onerror?.({ type: "error" });

      // The SDK owns reconnection (eventsource@4 never reconnects after a
      // non-200): a NEW EventSource is created after the backoff sleep.
      await vi.advanceTimersByTimeAsync(500);
      fake.value!.onopen?.({}); // the recreated EventSource connects

      expect(states).toEqual(["connecting", "connected", "error", "connecting", "connected"]);

      sse.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits 'disconnected' on close()", async () => {
    const states: SSEConnectionState[] = [];
    const fake: { value: FakeEventSource | null } = { value: null };
    const sse = makeSSE(states, fake);

    sse.start(() => {});
    await new Promise((r) => setImmediate(r));
    fake.value!.onopen?.({});

    sse.close();

    expect(states).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("does not emit duplicate 'connected' or 'error' states on consecutive identical events", async () => {
    const states: SSEConnectionState[] = [];
    const fake: { value: FakeEventSource | null } = { value: null };
    const sse = makeSSE(states, fake);

    sse.start(() => {});
    await new Promise((r) => setImmediate(r));

    fake.value!.onopen?.({});
    fake.value!.onopen?.({}); // duplicate
    fake.value!.onerror?.({});
    fake.value!.onerror?.({}); // duplicate

    expect(states).toEqual(["connecting", "connected", "error"]);

    sse.close();
  });
});

/**
 * Reconnect supervisor (qfg-41nh.9): eventsource@4 treats ANY non-200 response
 * as terminal — `failConnection` sets readyState=CLOSED and `scheduleReconnect`
 * early-returns when CLOSED — so a single 502 from the Fly edge during a deploy
 * would kill SSE for the process lifetime. The SDK must tear down and recreate
 * the EventSource itself, with jittered exponential backoff (sdk-go semantics:
 * 500ms → 30s cap, retry forever).
 */
describe("SSEConnection — reconnect supervisor (recreate on failure)", () => {
  interface RecordingFactory {
    created: FakeEventSource[];
    closedIndexes: number[];
    factory: (url: string, init: { headers: Record<string, string> }) => FakeEventSource;
  }

  function makeRecordingFactory(): RecordingFactory {
    const created: FakeEventSource[] = [];
    const closedIndexes: number[] = [];
    const factory = (_url: string, _init: { headers: Record<string, string> }) => {
      const idx = created.length;
      const es: FakeEventSource = {
        onopen: null,
        onmessage: null,
        onerror: null,
        close: () => closedIndexes.push(idx),
      };
      created.push(es);
      return es;
    };
    return { created, closedIndexes, factory };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tears down and recreates the EventSource after an error (terminal non-200)", async () => {
    const states: SSEConnectionState[] = [];
    const rec = makeRecordingFactory();
    const sse = new SSEConnection(
      new Transport(["https://primary.quonfig.com"], "test-key"),
      undefined,
      {
        onConnectionStateChange: (s) => states.push(s),
        eventSourceFactory: rec.factory as any,
      }
    );

    sse.start(() => {});
    expect(rec.created.length).toBe(1);

    // Simulate eventsource@4's terminal failure: it fires onerror once and
    // goes CLOSED; it will never reconnect on its own.
    rec.created[0].onerror?.({ type: "error", code: 502, message: "Non-200 status code (502)" });

    // The failed EventSource must be closed (torn down) immediately.
    expect(rec.closedIndexes).toContain(0);

    // A replacement is created after the backoff sleep (first sleep is in
    // [250ms, 500ms]; advancing by the full 500ms guarantees it fired).
    await vi.advanceTimersByTimeAsync(500);
    expect(rec.created.length).toBe(2);

    // The recreated EventSource is fully wired: onopen transitions to
    // connected and onmessage delivers updates.
    rec.created[1].onopen?.({});
    expect(states).toEqual(["connecting", "error", "connecting", "connected"]);

    sse.close();
  });

  it("delivers envelopes through the recreated EventSource's onmessage", async () => {
    const received: any[] = [];
    const rec = makeRecordingFactory();
    const sse = new SSEConnection(
      new Transport(["https://primary.quonfig.com"], "test-key"),
      undefined,
      { eventSourceFactory: rec.factory as any }
    );

    sse.start((env) => received.push(env));
    rec.created[0].onerror?.({ type: "error", code: 502 });
    await vi.advanceTimersByTimeAsync(500);
    expect(rec.created.length).toBe(2);

    rec.created[1].onopen?.({});
    rec.created[1].onmessage?.({
      data: JSON.stringify({ meta: { version: "v9", environment: "Production" }, configs: [] }),
    });

    expect(received.length).toBe(1);
    expect(received[0].meta.version).toBe("v9");

    sse.close();
  });

  it("backs off exponentially between failed attempts and resets after a successful connection", async () => {
    const rec = makeRecordingFactory();
    const sse = new SSEConnection(
      new Transport(["https://primary.quonfig.com"], "test-key"),
      undefined,
      { eventSourceFactory: rec.factory as any }
    );

    sse.start(() => {});
    expect(rec.created.length).toBe(1);

    // Attempt 1 fails: base delay 500ms, sleep in [250, 500].
    rec.created[0].onerror?.({ type: "error" });
    await vi.advanceTimersByTimeAsync(500);
    expect(rec.created.length).toBe(2);

    // Attempt 2 fails: base delay doubled to 1000ms, sleep in [500, 1000] —
    // strictly later than 499ms.
    rec.created[1].onerror?.({ type: "error" });
    await vi.advanceTimersByTimeAsync(499);
    expect(rec.created.length).toBe(2);
    await vi.advanceTimersByTimeAsync(501);
    expect(rec.created.length).toBe(3);

    // Attempt 3 fails: base delay 2000ms, sleep in [1000, 2000].
    rec.created[2].onerror?.({ type: "error" });
    await vi.advanceTimersByTimeAsync(999);
    expect(rec.created.length).toBe(3);
    await vi.advanceTimersByTimeAsync(1001);
    expect(rec.created.length).toBe(4);

    // Success resets the backoff: the next failure reconnects within 500ms.
    rec.created[3].onopen?.({});
    rec.created[3].onerror?.({ type: "error" });
    await vi.advanceTimersByTimeAsync(500);
    expect(rec.created.length).toBe(5);

    sse.close();
  });

  it("close() cancels a pending reconnect and stops the supervisor", async () => {
    const states: SSEConnectionState[] = [];
    const rec = makeRecordingFactory();
    const sse = new SSEConnection(
      new Transport(["https://primary.quonfig.com"], "test-key"),
      undefined,
      {
        onConnectionStateChange: (s) => states.push(s),
        eventSourceFactory: rec.factory as any,
      }
    );

    sse.start(() => {});
    rec.created[0].onerror?.({ type: "error" });

    sse.close();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rec.created.length).toBe(1); // no recreate after close
    expect(states[states.length - 1]).toBe("disconnected");
  });
});
