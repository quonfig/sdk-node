/**
 * qfg-vrfm: `close()` must drain in-memory telemetry before stopping the
 * reporter. Mirrors the sdk-javascript@0.0.12 contract (qfg-q3cx) and the
 * Go/Ruby/Python "close drains" behavior. Previously close() was sync and
 * only stopped timers, so any buffered eval summary that hadn't hit the
 * periodic flush window was silently dropped on clean shutdown.
 */
import { describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { spyOnSendTelemetry } from "./helpers/telemetrySpy";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

describe("close() drains telemetry (qfg-vrfm)", () => {
  it("posts pending telemetry before resolving", async () => {
    const rule = (value: string) => ({
      criteria: [{ operator: "ALWAYS_TRUE" }],
      value: { type: "string", value },
    });
    const envelope: ConfigEnvelope = {
      meta: { version: "test-version", environment: "Production" },
      configs: [
        {
          id: "cfg-1",
          key: "welcome-message",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: { rules: [rule("hello")] },
          environment: { id: "Production", rules: [rule("hola")] },
        } as any,
      ],
    };

    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope,
        notChanged: false,
      },
      sourceIndex: 0,
    });
    const { spy: postTelemetrySpy, payloads } = spyOnSendTelemetry();

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      enablePolling: false,
    });

    await quonfig.init();
    expect(quonfig.getString("welcome-message")).toBe("hola");

    // Pre-condition: nothing posted yet (periodic timer hasn't fired).
    expect(postTelemetrySpy).not.toHaveBeenCalled();

    // The contract under test: close() drains before stopping.
    await quonfig.close();

    expect(postTelemetrySpy).toHaveBeenCalledTimes(1);
    // arrayContaining (not an exact array): the same flush also carries the
    // additive failover event (resolvedFromPrimary=1 from the HTTP init install,
    // qfg-41nh.18). This test's contract is that the buffered eval summary is
    // drained on close, so assert its presence without pinning the array length.
    expect(payloads()[0]).toEqual(
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            summaries: expect.objectContaining({
              summaries: expect.arrayContaining([
                expect.objectContaining({ key: "welcome-message" }),
              ]),
            }),
          }),
        ]),
      })
    );

    vi.restoreAllMocks();
  });
});
