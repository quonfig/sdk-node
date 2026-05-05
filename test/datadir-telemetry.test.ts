/**
 * Datadir/datafile mode must still start the telemetry reporter. Earlier
 * versions short-circuited init() in datadir mode and skipped startTelemetry(),
 * so dogfood services (app-quonfig, api-telemetry) running in datadir mode
 * silently dropped every eval summary even with a valid sdk key.
 */
import { describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

describe("telemetry reporter starts in datadir mode", () => {
  it("posts pending eval summaries on close() when initialized from a datafile", async () => {
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

    const postTelemetrySpy = vi
      .spyOn(Transport.prototype, "postTelemetry")
      .mockResolvedValue(undefined);

    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datafile: envelope,
      enableSSE: false,
      enablePolling: false,
    });

    await quonfig.init();
    expect(quonfig.getString("welcome-message")).toBe("hola");

    expect(postTelemetrySpy).not.toHaveBeenCalled();

    await quonfig.close();

    expect(postTelemetrySpy).toHaveBeenCalledTimes(1);
    expect(postTelemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            summaries: expect.objectContaining({
              summaries: expect.arrayContaining([
                expect.objectContaining({ key: "welcome-message" }),
              ]),
            }),
          }),
        ],
      })
    );

    vi.restoreAllMocks();
  });
});
