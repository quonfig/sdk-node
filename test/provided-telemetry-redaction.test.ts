// ENV_VAR-provided values must never reach evaluation-summary telemetry
// (qfg-goi1.2.47). The env var's contents are the secret the provided indirection
// exists to keep out of the config repo, so `selectedValue` carries a redaction
// over the stored (pre-resolution) descriptor, never the resolved env value.
// Matches sdk-go, which records the evaluator's pre-resolution Value and
// redacts confidential values (integration-test-data telemetry.yaml Category 7).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";

import { Quonfig } from "../src/quonfig";
import { spyOnSendTelemetry } from "./helpers/telemetrySpy";
import type { ConfigEnvelope } from "../src/types";

const VAR = "QUONFIG_TEST_PROVIDED_TELEMETRY_SECRET";
const SECRET = "hunter2-SECRET";

function envelopeWith(confidential: boolean): ConfigEnvelope {
  const value: any = { type: "provided", value: { source: "ENV_VAR", lookup: VAR } };
  if (confidential) value.confidential = true;
  return {
    meta: { version: "test-version", environment: "Production" },
    configs: [
      {
        id: "cfg-provided",
        key: "db.password",
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: { rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value }] },
      } as any,
    ],
  };
}

// Evaluate once, close() (which flushes telemetry through the spied POST
// seam) and return every POSTed body plus the summaries' selectedValues.
async function postedTelemetry(
  confidential: boolean
): Promise<{ bodies: string; selected: unknown[] }> {
  const { payloads } = spyOnSendTelemetry();
  const quonfig = new Quonfig({
    sdkKey: "test-sdk-key",
    datafile: envelopeWith(confidential),
    enableSSE: false,
  });
  await quonfig.init();
  // The caller still gets the env value.
  expect(quonfig.getString("db.password")).toBe(SECRET);
  await quonfig.close();
  vi.restoreAllMocks();

  const sent = payloads();
  const selected = sent.flatMap((p: any) =>
    p.events
      .filter((e: any) => e.summaries)
      .flatMap((e: any) =>
        e.summaries.summaries.flatMap((s: any) => s.counters.map((c: any) => c.selectedValue))
      )
  );
  return { bodies: JSON.stringify(sent), selected };
}

describe("ENV_VAR-provided values in evaluation-summary telemetry", () => {
  beforeAll(() => {
    process.env[VAR] = SECRET;
  });
  afterAll(() => {
    delete process.env[VAR];
  });

  const expectedRedaction =
    "*****" +
    createHash("md5")
      .update(JSON.stringify({ source: "ENV_VAR", lookup: VAR }))
      .digest("hex")
      .slice(0, 5);

  it.each([
    ["confidential", true],
    ["non-confidential", false],
  ])("%s provided value: selectedValue is redacted, never the env contents", async (_, conf) => {
    const { bodies, selected } = await postedTelemetry(conf as boolean);
    expect(selected).toEqual([{ string: expectedRedaction }]);
    expect(bodies).not.toContain(SECRET);
  });
});
