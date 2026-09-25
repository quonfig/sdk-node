import { vi } from "vitest";

import { Transport, type TelemetryHttpResult } from "../../src/transport";
import type { TelemetryPayload } from "../../src/types";

/**
 * Spy on `Transport.prototype.sendTelemetry` (the telemetry POST seam). By
 * default every POST answers 200. `payloads()` returns the parsed bodies.
 */
export function spyOnSendTelemetry(impl?: (body: Buffer) => Promise<TelemetryHttpResult>): {
  spy: ReturnType<typeof vi.spyOn>;
  payloads: () => TelemetryPayload[];
} {
  const spy = vi
    .spyOn(Transport.prototype, "sendTelemetry")
    .mockImplementation(async (body: Buffer) =>
      impl ? impl(body) : { status: 200, bodySnippet: "" }
    );
  return {
    spy,
    payloads: () =>
      spy.mock.calls.map((c: unknown[]) => JSON.parse((c[0] as Buffer).toString("utf8"))),
  };
}
