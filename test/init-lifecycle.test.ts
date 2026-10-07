/**
 * qfg-goi1.2.5 (4): init() lifecycle.
 *
 * - A second init() (concurrent or after success) reuses the first one
 *   instead of opening a second SSE stream and telemetry reporter that close()
 *   never stops.
 * - close() while init() is still fetching wins: init() must not start SSE or
 *   the telemetry reporter after the fetch resolves.
 * - A rejected init() is not memoized, so a caught-and-retried init() still
 *   runs again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";
import { spyOnSendTelemetry } from "./helpers/telemetrySpy";

const ENVELOPE: ConfigEnvelope = {
  meta: { version: "v1", environment: "Production" },
  configs: [
    {
      id: "flag-1",
      key: "my.flag",
      type: "feature_flag",
      valueType: "bool",
      sendToClientSdk: false,
      default: {
        rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value: true } }],
      },
    } as any,
  ],
};

const OK = { result: { envelope: ENVELOPE, notChanged: false }, sourceIndex: 0 };

function makeClient(opened: { count: number }, extra: Record<string, unknown> = {}): Quonfig {
  return new Quonfig({
    sdkKey: "test-sdk-key",
    apiUrls: ["https://primary.example.test"],
    ...extra,
    enableSSE: true,
    fallbackPollEnabled: false,
    enableQuonfigUserContext: false,
    __testEventSourceFactory: () => {
      opened.count++;
      return { onopen: null, onmessage: null, onerror: null, close: () => {} };
    },
  } as any);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("init() lifecycle (qfg-goi1.2.5)", () => {
  it("init() called twice opens one SSE connection and fetches once", async () => {
    spyOnSendTelemetry();
    const fetchSpy = vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue(OK);
    const opened = { count: 0 };
    const quonfig = makeClient(opened);

    await Promise.all([quonfig.init(), quonfig.init()]);
    await quonfig.init();
    // Let the SSE factory (resolved asynchronously) run.
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(opened.count).toBe(1);
    await quonfig.close();
  });

  it("close() during a slow init() leaves no SSE connection and no running reporter", async () => {
    spyOnSendTelemetry();
    let release!: (v: typeof OK) => void;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );
    const opened = { count: 0 };
    const quonfig = makeClient(opened);

    const initP = quonfig.init();
    await new Promise((r) => setTimeout(r, 0));
    await quonfig.close();
    release(OK);
    await initP;
    await new Promise((r) => setTimeout(r, 10));

    expect(opened.count).toBe(0);
    expect((quonfig as any).sseConnection).toBeUndefined();
    expect((quonfig as any).telemetryReporter).toBeUndefined();
  });

  it("a rejected init() can be retried", async () => {
    spyOnSendTelemetry();
    // First fetch hangs, so the first init() rejects on its timeout.
    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(OK);
    const opened = { count: 0 };
    const quonfig = makeClient(opened, { initTimeout: 50 });

    await expect(quonfig.init()).rejects.toThrow("Initialization timed out");
    await quonfig.init();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(quonfig.isEnabled("my.flag")).toBe(true);
    await quonfig.close();
  });
});
