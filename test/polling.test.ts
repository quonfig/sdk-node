import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
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

describe("Quonfig polling", () => {
  it("updates the store when polling receives new configs", async () => {
    vi.useFakeTimers();

    const first = envelopeWithFlag("v1", false);
    const second = envelopeWithFlag("v2", true);

    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchConfigs")
      .mockResolvedValueOnce({ envelope: first, notChanged: false })
      .mockResolvedValueOnce({ envelope: second, notChanged: false });

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      enablePolling: true,
      pollInterval: 1000,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });

    await quonfig.init();
    expect(quonfig.isFeatureEnabled("build.dark-mode")).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(quonfig.isFeatureEnabled("build.dark-mode")).toBe(true);

    quonfig.close();
  });
});
