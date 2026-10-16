/**
 * qfg-23uf: the per-value eval-summary counter key (qfg-goi1.10.12) must not
 * serialize the selected value on every get(). 1.5.0 JSON.stringify'd the
 * whole selected value per read to build the counter key, so a large JSON
 * config paid a full serialization on every evaluation. The counter identity
 * is now computed once per installed value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

function bigJson(): Record<string, unknown> {
  const items = [];
  for (let i = 0; i < 600; i++) {
    items.push({ id: i, name: `item-${i}`, tags: ["alpha", "beta", "gamma"], weight: i * 1.5 });
  }
  return { items };
}

function envelope(): ConfigEnvelope {
  return {
    meta: { version: "v1", environment: "Production" },
    configs: [
      {
        id: "cfg-big",
        key: "big-config",
        type: "config",
        valueType: "json",
        sendToClientSdk: false,
        default: { rules: [{ criteria: [], value: { type: "json", value: bigJson() } }] },
      } as any,
      {
        id: "cfg-split",
        key: "split-flag",
        type: "feature_flag",
        valueType: "string",
        sendToClientSdk: false,
        default: {
          rules: [
            {
              criteria: [],
              value: {
                type: "weighted_values",
                value: {
                  hashByPropertyName: "user.key",
                  weightedValues: [
                    { weight: 1, value: { type: "string", value: "a" } },
                    { weight: 1, value: { type: "string", value: "b" } },
                  ],
                },
              },
            },
          ],
        },
      } as any,
    ],
  };
}

async function client(): Promise<Quonfig> {
  vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
    result: { envelope: envelope(), notChanged: false },
    sourceIndex: 0,
  });
  const quonfig = new Quonfig({
    sdkKey: "test-sdk-key",
    enableSSE: false,
    fallbackPollEnabled: false,
    collectEvaluationSummaries: true,
    contextUploadMode: "none",
    enableQuonfigUserContext: false,
  });
  await quonfig.init();
  return quonfig;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eval-summary hot path (qfg-23uf)", () => {
  it("does not serialize the selected value on every get()", async () => {
    expect(JSON.stringify(bigJson()).length).toBeGreaterThan(40000);
    const quonfig = await client();

    const spy = vi.spyOn(JSON, "stringify");
    for (let i = 0; i < 1000; i++) quonfig.get("big-config");
    // Count only serializations of the selected value; the small
    // (configKey, configType) group key built alongside it is not the cost.
    const calls = spy.mock.results.filter(
      (r) => typeof r.value === "string" && r.value.length > 40000
    ).length;
    spy.mockRestore();

    await quonfig.close();
    expect(calls).toBeLessThanOrEqual(1);
  });

  it("an equal value across a reinstall keeps counting under one counter", async () => {
    const quonfig = await client();
    quonfig.get("big-config");
    (quonfig as any).store.update(envelope());
    quonfig.get("big-config");
    quonfig.get("big-config");

    const event = (quonfig as any).evaluationSummaries.drain();
    await quonfig.close();

    const summaries = event.summaries.summaries;
    expect(summaries).toHaveLength(1);
    expect(summaries[0].counters).toHaveLength(1);
    expect(summaries[0].counters[0].count).toBe(3);
    expect(summaries[0].counters[0].selectedValue).toEqual({ string: bigJson() });
  });

  it("a read after drain starts a fresh counter in the next window", async () => {
    const quonfig = await client();
    quonfig.get("big-config");
    quonfig.get("big-config");
    const first = (quonfig as any).evaluationSummaries.drain();
    quonfig.get("big-config");
    const second = (quonfig as any).evaluationSummaries.drain();
    await quonfig.close();

    expect(first.summaries.summaries[0].counters[0].count).toBe(2);
    expect(second.summaries.summaries[0].counters).toHaveLength(1);
    expect(second.summaries.summaries[0].counters[0].count).toBe(1);
  });

  it("a weighted rollout keeps one counter per selected variant", async () => {
    const quonfig = await client();
    const seen: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const v = quonfig.get("split-flag", { user: { key: `u${i}` } }) as string;
      seen[v] = (seen[v] ?? 0) + 1;
    }
    const event = (quonfig as any).evaluationSummaries.drain();
    await quonfig.close();

    const summary = event.summaries.summaries.find((s: any) => s.key === "split-flag");
    const counted = Object.fromEntries(
      summary.counters.map((c: any) => [c.selectedValue.string, c.count])
    );
    expect(Object.keys(seen).sort()).toEqual(["a", "b"]);
    expect(counted).toEqual(seen);
    for (const c of summary.counters) {
      expect(c.weightedValueIndex).toBe(c.selectedValue.string === "a" ? 0 : 1);
    }
  });
});
