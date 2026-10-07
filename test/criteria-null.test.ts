/**
 * qfg-goi1.2.5 (1): api-delivery's Go `Rule.Criteria` has no `omitempty`, so a
 * nil slice serializes as `"criteria": null`. The store already tolerated
 * `rules: null`; a null `criteria` must normalize to `[]` (an always-match
 * rule) instead of throwing `TypeError: criteria is not iterable` into get().
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
        id: "cfg-default",
        key: "nullcrit.default",
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: { rules: [{ criteria: null, value: { type: "string", value: "from-default" } }] },
      } as any,
      {
        id: "cfg-env",
        key: "nullcrit.env",
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: { rules: [] },
        environment: {
          id: "Production",
          rules: [{ criteria: null, value: { type: "string", value: "from-env" } }],
        },
      } as any,
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rule with "criteria": null (qfg-goi1.2.5)', () => {
  it("evaluates as an always-match rule for default and environment rules", async () => {
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

    expect(quonfig.get("nullcrit.default")).toBe("from-default");
    expect(quonfig.get("nullcrit.default", {}, "d")).toBe("from-default");
    expect(quonfig.get("nullcrit.env")).toBe("from-env");
    const details = quonfig.getStringDetails("nullcrit.env");
    expect(details.value).toBe("from-env");
    expect(details.errorCode).toBeUndefined();

    await quonfig.close();
  });
});
