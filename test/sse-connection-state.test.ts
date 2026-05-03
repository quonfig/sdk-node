import { describe, expect, it } from "vitest";

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

function makeSSE(
  states: SSEConnectionState[],
  factoryOut: { value: FakeEventSource | null }
) {
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

  it("emits 'error' on onerror, and 'connected' again on subsequent onopen (reconnect)", async () => {
    const states: SSEConnectionState[] = [];
    const fake: { value: FakeEventSource | null } = { value: null };
    const sse = makeSSE(states, fake);

    sse.start(() => {});
    await new Promise((r) => setImmediate(r));

    fake.value!.onopen?.({});
    fake.value!.onerror?.({ type: "error" });
    fake.value!.onopen?.({}); // simulate library auto-reconnect succeeding

    expect(states).toEqual(["connecting", "connected", "error", "connected"]);

    sse.close();
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
