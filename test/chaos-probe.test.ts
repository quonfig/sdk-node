import { describe, expect, it } from "vitest";
import { ChaosProbe } from "../chaos/probe";

// The chaos probe's lastRefresh must track client.lastSuccessfulRefresh(),
// which a 304 or same-generation fallback poll advances without installing
// (and so without firing onConfigUpdate) — qfg-goi1.10.33.

describe("ChaosProbe.lastRefresh", () => {
  it("tracks client.lastSuccessfulRefresh() across a 304-only refresh", () => {
    let stamp: Date | undefined;
    const client = {
      lastSuccessfulRefresh: () => stamp,
      connectionState: () => "connected" as const,
      fallbackPollerActive: () => false,
      supervisorCounters: () => ({
        sseConnectAttempts: 0,
        workerRestartsLayer1: 0,
        callbackErrorsOnConfigUpdate: 0,
        callbackErrorsOnConnectionStateChange: 0,
      }),
      isReady: () => true,
    };
    const probe = new ChaosProbe(client);
    expect(probe.lastRefresh).toBe(0);

    // A 304 poll: the client stamps, no install, no onConfigUpdate.
    stamp = new Date(1_700_000_000_000);
    expect(probe.lastRefresh).toBe(1_700_000_000_000);

    stamp = new Date(1_700_000_060_000);
    expect(probe.lastRefresh).toBe(1_700_000_060_000);
  });
});
