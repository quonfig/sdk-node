import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport, type LegResult } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

function envelopeWithFlag(version: string, value: boolean): ConfigEnvelope {
  return {
    meta: {
      version,
      environment: "Production",
    },
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Quonfig#updateIfStalerThan", () => {
  it("returns undefined when the envelope is still fresh", async () => {
    const first = envelopeWithFlag("v1", false);
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: { envelope: first, notChanged: false },
      sourceIndex: 0,
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      // Single leg: the hedge has no secondary to fire, so the per-leg fetch
      // spy count maps 1:1 to refresh cycles (qfg-7h5d.1.14).
      apiUrls: ["https://primary.quonfig.com"],
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await quonfig.init();

    expect(quonfig.updateIfStalerThan(60_000)).toBeUndefined();
    quonfig.close();
  });

  it("fetches and installs a new envelope when stale", async () => {
    const first = envelopeWithFlag("v1", false);
    const second = envelopeWithFlag("v2", true);
    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockResolvedValueOnce({ result: { envelope: first, notChanged: false }, sourceIndex: 0 })
      .mockResolvedValueOnce({ result: { envelope: second, notChanged: false }, sourceIndex: 0 });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      apiUrls: ["https://primary.quonfig.com"],
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await quonfig.init();
    expect(quonfig.isFeatureEnabled("build.dark-mode")).toBe(false);

    // Force the last-refresh stamp into the past so any positive duration is "stale".
    (quonfig as any).lastSuccessfulRefreshAt = new Date(Date.now() - 120_000);

    const p = quonfig.updateIfStalerThan(60_000);
    expect(p).toBeInstanceOf(Promise);
    await p;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(quonfig.isFeatureEnabled("build.dark-mode")).toBe(true);
    quonfig.close();
  });

  it("coalesces concurrent calls onto a single in-flight fetch", async () => {
    const first = envelopeWithFlag("v1", false);
    const second = envelopeWithFlag("v2", true);
    let resolveSecond!: (v: LegResult) => void;
    const pending = new Promise<LegResult>((r) => {
      resolveSecond = r;
    });

    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockResolvedValueOnce({ result: { envelope: first, notChanged: false }, sourceIndex: 0 })
      .mockReturnValueOnce(pending);

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      // Single leg so the hung second fetch can't trigger a hedged secondary
      // (which would bump the spy count past 2). (qfg-7h5d.1.14)
      apiUrls: ["https://primary.quonfig.com"],
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await quonfig.init();
    (quonfig as any).lastSuccessfulRefreshAt = new Date(Date.now() - 120_000);

    const a = quonfig.updateIfStalerThan(60_000);
    const b = quonfig.updateIfStalerThan(60_000);
    expect(a).toBeInstanceOf(Promise);
    expect(b).toBe(a);

    resolveSecond({ result: { envelope: second, notChanged: false }, sourceIndex: 0 });
    await a;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    quonfig.close();
  });

  it("returns undefined in local-file mode (no remote source to refresh)", async () => {
    const fetchSpy = vi.spyOn(Transport.prototype, "fetchFromUrlAt");

    const quonfig = new Quonfig({
      datafile: envelopeWithFlag("v1", true),
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await quonfig.init();

    (quonfig as any).lastSuccessfulRefreshAt = new Date(Date.now() - 120_000);
    expect(quonfig.updateIfStalerThan(60_000)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    quonfig.close();
  });

  it("returns undefined after close()", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: { envelope: envelopeWithFlag("v1", false), notChanged: false },
      sourceIndex: 0,
    });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      apiUrls: ["https://primary.quonfig.com"],
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await quonfig.init();
    await quonfig.close();

    (quonfig as any).lastSuccessfulRefreshAt = new Date(Date.now() - 120_000);
    expect(quonfig.updateIfStalerThan(60_000)).toBeUndefined();
  });
});
