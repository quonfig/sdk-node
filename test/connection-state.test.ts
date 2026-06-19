import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

function envelope(version: string): ConfigEnvelope {
  return {
    meta: { version, environment: "Production" },
    configs: [
      {
        id: "flag-1",
        key: "build.dark-mode",
        type: "feature_flag",
        valueType: "bool",
        sendToClientSdk: false,
        default: {
          rules: [
            {
              criteria: [{ operator: "ALWAYS_TRUE" }],
              value: { type: "bool", value: true },
            },
          ],
        },
      } as any,
    ],
  };
}

interface FakeEventSource {
  onopen: ((evt: any) => void) | null;
  onmessage: ((evt: any) => void) | null;
  onerror: ((evt: any) => void) | null;
  close: () => void;
}

function makeEventSourceFactory(out: { value: FakeEventSource | null }) {
  return (_url: string, _init: { headers: Record<string, string> }) => {
    const es: FakeEventSource = {
      onopen: null,
      onmessage: null,
      onerror: null,
      close: () => {},
    };
    out.value = es;
    return es;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Quonfig.connectionState()", () => {
  it("returns 'initializing' before init() completes", () => {
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    } as any);

    expect(quonfig.connectionState()).toBe("initializing");
  });

  it("transitions to 'connected' after successful SSE onopen", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: envelope("v1"),
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: 1000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    await vi.advanceTimersByTimeAsync(10);

    // Before onopen, SSE is connecting — connectionState reports 'disconnected'.
    expect(quonfig.connectionState()).toBe("disconnected");

    fakeOut.value!.onopen?.({});
    expect(quonfig.connectionState()).toBe("connected");

    await quonfig.close();
  });

  it("transitions 'connected' -> 'disconnected' -> 'falling_back' -> 'connected' through the supervisor lifecycle", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: envelope("v1"),
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: 60000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    await vi.advanceTimersByTimeAsync(10);
    fakeOut.value!.onopen?.({});
    expect(quonfig.connectionState()).toBe("connected");

    // SSE errors: connection dropped, fallback grace timer running.
    fakeOut.value!.onerror?.({ type: "error" });
    expect(quonfig.connectionState()).toBe("disconnected");

    // Grace window elapses, fallback engages.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(quonfig.connectionState()).toBe("falling_back");

    // SSE recovers, fallback disengages.
    fakeOut.value!.onopen?.({});
    expect(quonfig.connectionState()).toBe("connected");

    await quonfig.close();
  });

  it("reports 'falling_back' immediately when the initial SSE connection fails", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: envelope("v1"),
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: 1000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    await vi.advanceTimersByTimeAsync(10);

    fakeOut.value!.onerror?.({ type: "error" });
    expect(quonfig.connectionState()).toBe("falling_back");

    await quonfig.close();
  });

  it("returns 'disconnected' after close()", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: envelope("v1"),
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: 1000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    await vi.advanceTimersByTimeAsync(10);
    fakeOut.value!.onopen?.({});
    expect(quonfig.connectionState()).toBe("connected");

    await quonfig.close();
    expect(quonfig.connectionState()).toBe("disconnected");
  });
});

describe("Quonfig.lastSuccessfulRefresh()", () => {
  it("returns undefined before any envelope is installed", () => {
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    } as any);

    expect(quonfig.lastSuccessfulRefresh()).toBeUndefined();
  });

  it("returns a Date close to wall-clock time after init() installs the initial envelope", async () => {
    vi.useRealTimers();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: envelope("v1"),
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    const before = Date.now();
    await quonfig.init();
    const after = Date.now();

    const ts = quonfig.lastSuccessfulRefresh();
    expect(ts).toBeInstanceOf(Date);
    expect(ts!.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts!.getTime()).toBeLessThanOrEqual(after);

    await quonfig.close();
  });

  it("advances when the fallback poller installs a new envelope", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockResolvedValueOnce({
        result: { envelope: envelope("v1"), notChanged: false },
        sourceIndex: 0,
      })
      .mockResolvedValue({
        result: { envelope: envelope("v2"), notChanged: false },
        sourceIndex: 0,
      });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: 1000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    const initialRefresh = quonfig.lastSuccessfulRefresh()!;
    expect(initialRefresh).toBeInstanceOf(Date);

    await vi.advanceTimersByTimeAsync(10);
    // Trigger initial-connect failure so the fallback poller engages now.
    fakeOut.value!.onerror?.({ type: "error" });

    // Advance the fake clock past one fallback-poll tick.
    await vi.advanceTimersByTimeAsync(1100);
    const refreshed = quonfig.lastSuccessfulRefresh()!;
    expect(refreshed.getTime()).toBeGreaterThan(initialRefresh.getTime());

    await quonfig.close();
  });
});
