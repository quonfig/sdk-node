/**
 * qfg-9p4i.2: after a caught init() rejection the client must not be dead.
 *
 * Design: project/plans/2026-10-05-init-failure-design.md, Decisions 4 and
 * section 0 ("No permanently dead clients"). Before this fix, runInit threw
 * before SSE / the poller / telemetry started, `initialized` stayed false
 * forever, nothing retried, and every getter (even with a default) threw
 * "[quonfig] Not initialized. Call init() first." until the caller ran init()
 * again. Repro shape: project/sdk-quality-check/reports/sdk-node-2026-10-16-*.md H1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport, type LegResult } from "../src/transport";
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

const OK: LegResult = { result: { envelope: ENVELOPE, notChanged: false }, sourceIndex: 0 };
const DOWN: LegResult = {
  error: new Error("Unexpected status 503: down"),
  status: 503,
  sourceIndex: 0,
};

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeClient(opened: { count: number }, logger = silentLogger()): Quonfig {
  return new Quonfig({
    sdkKey: "test-sdk-key",
    apiUrls: ["https://primary.example.test"],
    enableSSE: true,
    fallbackPollEnabled: false,
    enableQuonfigUserContext: false,
    logger,
    // init() now retries until initTimeout before rejecting (qfg-9p4i.10).
    initTimeout: 100,
    // Shrink the background init-retry backoff so the test runs in ms.
    __testWaitHook: (kind: string, ms: number) => (kind === "init-retry" ? 5 : ms),
    __testEventSourceFactory: () => {
      opened.count++;
      return { onopen: null, onmessage: null, onerror: null, close: () => {} };
    },
  } as any);
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background retry after a caught init() failure (qfg-9p4i.2)", () => {
  it("keeps retrying, heals without a second init(), and starts SSE once", async () => {
    spyOnSendTelemetry();
    let down = true;
    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockImplementation(async () => (down ? DOWN : OK));
    const opened = { count: 0 };
    const logger = silentLogger();
    const quonfig = makeClient(opened, logger);

    await expect(quonfig.init()).rejects.toThrow("503");
    expect(quonfig.ready()).toBe(false);

    // Several background attempts while delivery is still down.
    await waitFor(() => fetchSpy.mock.calls.length >= 3);
    expect(quonfig.ready()).toBe(false);

    down = false;
    await waitFor(() => quonfig.ready());
    await new Promise((r) => setTimeout(r, 10));

    expect(quonfig.isEnabled("my.flag")).toBe(true);
    expect(opened.count).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[quonfig] init recovered"));

    // Healed: the retry loop stops.
    const calls = fetchSpy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy.mock.calls.length).toBe(calls);
    await quonfig.close();
  });

  it("getters return the caller default (not throw) while the retry loop runs", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue(DOWN);
    const quonfig = makeClient({ count: 0 });

    await expect(quonfig.init()).rejects.toThrow("503");

    expect(quonfig.get("my.flag", {}, "fallback")).toBe("fallback");
    expect(quonfig.isEnabled("my.flag")).toBe(false);
    expect(quonfig.getBoolDetails("my.flag").reason).toBe("ERROR");
    await quonfig.close();
  });

  it("close() stops the background retry loop", async () => {
    spyOnSendTelemetry();
    const fetchSpy = vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue(DOWN);
    const quonfig = makeClient({ count: 0 });

    await expect(quonfig.init()).rejects.toThrow("503");
    await waitFor(() => fetchSpy.mock.calls.length >= 2);
    await quonfig.close();
    const calls = fetchSpy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy.mock.calls.length).toBe(calls);
    expect(quonfig.ready()).toBe(false);
  });

  it("an explicit init() retry racing the background loop still opens one SSE", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async () =>
      down ? DOWN : OK
    );
    const opened = { count: 0 };
    const quonfig = makeClient(opened);

    await expect(quonfig.init()).rejects.toThrow("503");
    down = false;
    await quonfig.init();
    await new Promise((r) => setTimeout(r, 50));

    expect(quonfig.ready()).toBe(true);
    expect(opened.count).toBe(1);
    await quonfig.init();
    expect(opened.count).toBe(1);
    await quonfig.close();
  });

  it("getters before any init() still throw (programmer error, unchanged)", () => {
    const quonfig = makeClient({ count: 0 });
    expect(() => quonfig.get("my.flag", {}, "fallback")).toThrow("Not initialized");
  });
});
