/**
 * qfg-goi1.10.1 item 2 (WS8, sdk-go 543ee9c): getJSON() and get() return a
 * deep copy of a json value, so a caller mutating the result cannot rewrite
 * the config for every later read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

function envelope(): ConfigEnvelope {
  return {
    meta: { version: "v1", environment: "Production" },
    configs: [
      {
        id: "cfg-json",
        key: "json.key",
        type: "config",
        valueType: "json",
        sendToClientSdk: false,
        default: {
          rules: [
            { criteria: [], value: { type: "json", value: { limits: { max: 5 }, tags: ["a"] } } },
          ],
        },
      } as any,
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("json copy-on-return (qfg-goi1.10.1)", () => {
  it.each([
    ["getJSON", (q: Quonfig) => q.getJSON("json.key") as any],
    ["get", (q: Quonfig) => q.get("json.key") as any],
    ["getJSONDetails", (q: Quonfig) => q.getJSONDetails("json.key").value as any],
  ])("%s: mutating the returned value does not change later reads", async (_name, read) => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: { envelope: envelope(), notChanged: false },
      sourceIndex: 0,
    });
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      enableQuonfigUserContext: false,
    });
    await quonfig.init();

    const first = read(quonfig);
    first.limits.max = 999;
    first.tags.push("mutated");
    first.added = true;

    const second = read(quonfig);
    expect(second).toEqual({ limits: { max: 5 }, tags: ["a"] });
    expect(second).not.toBe(first);

    await quonfig.close();
  });
});
