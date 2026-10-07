/**
 * qfg-goi1.2.5 (3): telemetry must never throw into evaluation, and one
 * unserializable value must not cost the whole telemetry window.
 *
 * A BigInt (Prisma and some DB drivers return them for BIGINT ids) used as a
 * context `key` made the example-contexts collector's JSON.stringify throw
 * inside get()/isEnabled(). The same value in another attribute made the
 * window's JSON.stringify throw after every collector had been drained, so
 * the evaluation summaries and context shapes were lost too.
 *
 * How BigInt is represented on the wire is a later telemetry decision; for
 * now only the failing example-contexts sample/event is dropped.
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

async function client(): Promise<Quonfig> {
  vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
    result: { envelope: ENVELOPE, notChanged: false },
    sourceIndex: 0,
  });
  const quonfig = new Quonfig({
    sdkKey: "test-sdk-key",
    enableSSE: false,
    fallbackPollEnabled: false,
    enableQuonfigUserContext: false,
    // defaults: collectEvaluationSummaries true, contextUploadMode "periodic_example"
  });
  await quonfig.init();
  return quonfig;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("telemetry never throws into evaluation (qfg-goi1.2.5)", () => {
  it("isEnabled/get with a BigInt context key returns the flag value", async () => {
    spyOnSendTelemetry();
    const quonfig = await client();

    expect(quonfig.isEnabled("my.flag", { user: { key: 1n } })).toBe(true);
    expect(quonfig.get("my.flag", { user: { key: 2n } })).toBe(true);
    expect(quonfig.getBoolDetails("my.flag", { user: { key: 3n } }).value).toBe(true);

    await quonfig.close();
  });

  it("a BigInt attribute drops only the example-contexts event, not the window", async () => {
    const { spy, payloads } = spyOnSendTelemetry();
    const quonfig = await client();

    expect(quonfig.isEnabled("my.flag", { user: { key: "u1", accountId: 42n } })).toBe(true);
    await quonfig.close();

    expect(spy).toHaveBeenCalledTimes(1);
    const events = payloads()[0]!.events as any[];
    const summaries = events.find((e) => e.summaries);
    expect(summaries?.summaries.summaries).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "my.flag" })])
    );
    expect(events.find((e) => e.contextShapes)).toBeDefined();
    expect(events.find((e) => e.exampleContexts)).toBeUndefined();
  });
});
