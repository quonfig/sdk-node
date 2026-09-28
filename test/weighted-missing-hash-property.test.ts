import { describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { ConfigResponse } from "../src/types";
import { captureLogger } from "./helpers/captureLogger";

// qfg-9dxb.8: a weighted rollout whose hashByPropertyName is missing from the
// evaluation context serves the FIRST weighted variant (fraction 0.0, same as
// sdk-net / sdk-java), flags `hashPropertyMissing: true` in flagMetadata, and
// warns once per config key. Before, it picked a random variant on every call.

// Same shape as integration-test-data feature-flag.weighted: hashes on
// user.tracking_id; value 1 @ 1000, 3 @ 2000, 2 @ 97000. First variant is 1.
function weightedFlag(key = "feature-flag.weighted"): ConfigResponse {
  return {
    id: key,
    key,
    type: "feature_flag",
    valueType: "int",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: {
            type: "weighted_values",
            value: {
              hashByPropertyName: "user.tracking_id",
              weightedValues: [
                { weight: 1000, value: { type: "int", value: 1 } },
                { weight: 2000, value: { type: "int", value: 3 } },
                { weight: 97000, value: { type: "int", value: 2 } },
              ],
            },
          },
        },
      ],
    },
  };
}

function abFlag(): ConfigResponse {
  return {
    id: "ab.test",
    key: "ab.test",
    type: "feature_flag",
    valueType: "string",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: {
            type: "weighted_values",
            value: {
              hashByPropertyName: "user.key",
              weightedValues: [
                { weight: 50, value: { type: "string", value: "a" } },
                { weight: 50, value: { type: "string", value: "b" } },
              ],
            },
          },
        },
      ],
    },
  };
}

async function client(configs: ConfigResponse[]) {
  const logger = captureLogger();
  const q = new Quonfig({
    sdkKey: "test",
    environment: "Production",
    logger,
    datafile: { meta: { version: "test", environment: "Production" }, configs },
  });
  await q.init();
  return { q, logger };
}

const WARN_RE = /weighted rollout for "feature-flag\.weighted" hashes on "user\.tracking_id"/;

describe("weighted rollout with missing hash property (qfg-9dxb.8)", () => {
  const absentContexts: [string, Parameters<Quonfig["get"]>[1]][] = [
    ["no context at all", undefined],
    ["named context missing", { team: { id: "t1" } }],
    ["property missing", { user: { key: "u1" } }],
    ["property null", { user: { tracking_id: null } }],
  ];

  for (const [label, ctx] of absentContexts) {
    it(`${label}: always serves the first variant (50 evaluations)`, async () => {
      const { q } = await client([weightedFlag()]);
      for (let i = 0; i < 50; i++) {
        expect(q.get("feature-flag.weighted", ctx)).toBe(1);
        expect(q.getNumberDetails("feature-flag.weighted", ctx).value).toBe(1);
      }
    });
  }

  it("flagMetadata carries hashPropertyMissing: true only when the fallback fires", async () => {
    const { q } = await client([weightedFlag()]);

    const missing = q.getNumberDetails("feature-flag.weighted", { user: { key: "u1" } });
    expect(missing.value).toBe(1);
    expect(missing.flagMetadata?.hashPropertyMissing).toBe(true);

    const present = q.getNumberDetails("feature-flag.weighted", { user: { tracking_id: "t-0" } });
    expect(present.value).toBe(2);
    expect(present.flagMetadata).not.toHaveProperty("hashPropertyMissing");

    // Present and landing on the first variant: still not flagged.
    const firstBucket = q.getNumberDetails("feature-flag.weighted", {
      user: { tracking_id: "t-28" },
    });
    expect(firstBucket.value).toBe(1);
    expect(firstBucket.flagMetadata).not.toHaveProperty("hashPropertyMissing");
  });

  it("warns exactly once per config key across many evaluations", async () => {
    const { q, logger } = await client([weightedFlag(), weightedFlag("other.weighted")]);
    for (let i = 0; i < 100; i++) {
      q.get("feature-flag.weighted");
      q.getNumberDetails("feature-flag.weighted", { user: { key: `u${i}` } });
    }
    expect(logger.logCount("warn", WARN_RE)).toBe(1);
    expect(logger.lines.find((l) => WARN_RE.test(l.msg))?.msg).toBe(
      'quonfig: weighted rollout for "feature-flag.weighted" hashes on "user.tracking_id" which is missing from context; using first variant'
    );

    q.get("other.weighted");
    q.get("other.weighted");
    expect(logger.logCount("warn", /weighted rollout for "other\.weighted"/)).toBe(1);
  });

  it("does not warn when the hash property is present", async () => {
    const { q, logger } = await client([weightedFlag()]);
    q.get("feature-flag.weighted", { user: { tracking_id: "t-0" } });
    expect(logger.logCount("warn", /weighted rollout/)).toBe(0);
  });

  // Bucket stability: every pin below was computed with the released v1.3.0
  // code (git archive v1.3.0). Present hash values must land exactly where
  // they did before. Empty string is a present value and is hashed.
  it("present hash property: same buckets as v1.3.0", async () => {
    const { q, logger } = await client([weightedFlag(), abFlag()]);
    const pins: [unknown, number][] = [
      ["t-0", 2],
      ["t-28", 1],
      ["t-188", 1],
      ["t-446", 1],
      ["t-37", 3],
      ["t-71", 3],
      ["t-83", 3],
      ["92a202f2", 2],
      ["", 2],
      [42, 2],
      [true, 2],
    ];
    for (const [trackingId, expected] of pins) {
      expect(q.get("feature-flag.weighted", { user: { tracking_id: trackingId } })).toBe(expected);
    }
    const abPins: [string, string][] = [
      ["user-0", "a"],
      ["user-1", "a"],
      ["user-2", "b"],
      ["user-3", "a"],
      ["user-4", "a"],
      ["user-5", "b"],
      ["user-6", "a"],
      ["user-7", "b"],
    ];
    for (const [userKey, expected] of abPins) {
      expect(q.get("ab.test", { user: { key: userKey } })).toBe(expected);
    }
    expect(logger.logCount("warn", /weighted rollout/)).toBe(0);
  });
});
