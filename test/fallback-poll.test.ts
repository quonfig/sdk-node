import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope, SSEConnectionState } from "../src/types";

function envelopeWithFlag(version: string, value: boolean): ConfigEnvelope {
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
              value: { type: "bool", value },
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

describe("Quonfig — Layer 2 fallback poller", () => {
  it("starts polling immediately when the initial SSE connection fails", async () => {
    const initial = envelopeWithFlag("v1", false);
    const polled = envelopeWithFlag("v2", true);

    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockResolvedValueOnce({ result: { envelope: initial, notChanged: false }, sourceIndex: 0 })
      .mockResolvedValue({ result: { envelope: polled, notChanged: false }, sourceIndex: 0 });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const states: SSEConnectionState[] = [];
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      fallbackPollEnabled: true,
      fallbackPollIntervalMs: 1000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      onSSEConnectionStateChange: (s) => states.push(s),
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    expect(quonfig.isFeatureEnabled("build.dark-mode")).toBe(false);

    // Let the SSE factory resolve and produce an EventSource, then fail it
    // before any onopen — initial failure path.
    await vi.advanceTimersByTimeAsync(10);
    expect(fakeOut.value).not.toBeNull();
    fakeOut.value!.onerror?.({ type: "error" });

    // Layer 2 should kick in immediately on initial-connect failure (no
    // 120s wait — that grace only applies to a *connected → disconnected*
    // edge, where we trust the eventsource library to reconnect first).
    expect((quonfig as any).fallbackPollerActive()).toBe(true);

    // After the poll interval, the poller fetches and installs the new envelope.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(quonfig.isFeatureEnabled("build.dark-mode")).toBe(true);

    await quonfig.close();
  });

  it("starts polling 120s after a connected→disconnected edge if SSE doesn't recover", async () => {
    const initial = envelopeWithFlag("v1", false);
    const polled = envelopeWithFlag("v2", true);

    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockResolvedValueOnce({ result: { envelope: initial, notChanged: false }, sourceIndex: 0 })
      .mockResolvedValue({ result: { envelope: polled, notChanged: false }, sourceIndex: 0 });

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
    fakeOut.value!.onopen?.({}); // SSE successfully connected.

    expect((quonfig as any).fallbackPollerActive()).toBe(false);

    // Drop the connection. The eventsource library "auto-reconnects"; we should
    // NOT engage Layer 2 immediately — we wait 120s (2x default poll interval).
    fakeOut.value!.onerror?.({ type: "error" });
    expect((quonfig as any).fallbackPollerActive()).toBe(false);

    // After 60s of disconnect: still not engaged.
    await vi.advanceTimersByTimeAsync(60_000);
    expect((quonfig as any).fallbackPollerActive()).toBe(false);

    // After 120s of continuous disconnect: Layer 2 engages.
    await vi.advanceTimersByTimeAsync(60_000);
    expect((quonfig as any).fallbackPollerActive()).toBe(true);

    // Recover SSE — fallback poller stops.
    fakeOut.value!.onopen?.({});
    expect((quonfig as any).fallbackPollerActive()).toBe(false);

    await quonfig.close();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("does not start the fallback poller when SSE is healthy", async () => {
    const initial = envelopeWithFlag("v1", false);
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: initial,
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

    await vi.advanceTimersByTimeAsync(10_000);
    expect((quonfig as any).fallbackPollerActive()).toBe(false);

    await quonfig.close();
  });

  it("maps deprecated enablePolling/pollInterval to fallback options with a warning", async () => {
    const warnings: string[] = [];
    const initial = envelopeWithFlag("v1", false);
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: initial,
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const fakeOut: { value: FakeEventSource | null } = { value: null };
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: true,
      enablePolling: true,
      pollInterval: 1234,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      logger: {
        debug: () => {},
        info: () => {},
        warn: (msg: string) => warnings.push(String(msg)),
        error: () => {},
      },
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    await vi.advanceTimersByTimeAsync(10);

    expect(warnings.some((w) => /enablePolling/i.test(w))).toBe(true);
    expect(warnings.some((w) => /pollInterval/i.test(w))).toBe(true);

    expect((quonfig as any).fallbackPollIntervalMs).toBe(1234);
    expect((quonfig as any).fallbackPollEnabled).toBe(true);

    await quonfig.close();
  });

  it("emits a startup log line announcing the polling mode", async () => {
    const infos: string[] = [];
    const initial = envelopeWithFlag("v1", false);
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: initial,
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
      logger: {
        debug: () => {},
        info: (msg: string) => infos.push(String(msg)),
        warn: () => {},
        error: () => {},
      },
      __testEventSourceFactory: makeEventSourceFactory(fakeOut),
    } as any);

    await quonfig.init();
    await vi.advanceTimersByTimeAsync(10);

    // The boot log must mention SSE and the fallback polling mode + interval.
    const bootLog = infos.find((m) => /SSE/.test(m) && /fallback/i.test(m));
    expect(bootLog).toBeDefined();
    expect(bootLog).toMatch(/60000|60s/);

    await quonfig.close();
  });
});
