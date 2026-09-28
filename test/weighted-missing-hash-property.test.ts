import { describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { ConfigResponse } from "../src/types";
import { captureLogger } from "./helpers/captureLogger";

// qfg-9dxb.8: a weighted rollout whose hashByPropertyName is missing from the
// evaluation context hashes configKey + "" exactly like a present empty-string
// value (Statsig-style), then walks the weights as normal. Missing and empty
// land in the same bucket, so a weight-0 variant is never served. flagMetadata
// carries `hashPropertyMissing: true` only when the property is missing, and
// the client warns once per config key. A rollout with NO hashByPropertyName
// still picks a random weighted variant on every evaluation (unchanged).

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

function abFlag(key = "ab.test", hashByPropertyName: string | null = "user.key"): ConfigResponse {
  return {
    id: key,
    key,
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
              ...(hashByPropertyName === null ? {} : { hashByPropertyName }),
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

// First variant has weight 0: it must never be served.
function zeroFirstFlag(key: string): ConfigResponse {
  return {
    id: key,
    key,
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
              hashByPropertyName: "user.id",
              weightedValues: [
                { weight: 0, value: { type: "string", value: "zero" } },
                { weight: 50, value: { type: "string", value: "b" } },
                { weight: 50, value: { type: "string", value: "c" } },
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

  // v1.3.0 (git archive v1.3.0) serves 2 for a present empty tracking_id.
  it("missing (all 4 shapes) and present empty string serve the same variant as v1.3.0 empty", async () => {
    const { q } = await client([weightedFlag()]);
    expect(q.get("feature-flag.weighted", { user: { tracking_id: "" } })).toBe(2);
    for (const [, ctx] of absentContexts) {
      for (let i = 0; i < 20; i++) {
        expect(q.get("feature-flag.weighted", ctx)).toBe(2);
        expect(q.getNumberDetails("feature-flag.weighted", ctx).value).toBe(2);
      }
    }
  });

  it("a weight-0 first variant is never served when the property is missing", async () => {
    // Expected values computed with v1.3.0 for a present empty user.id.
    const expected: [string, string][] = [
      ["zero.first.a", "b"],
      ["zero.first.b", "b"],
      ["zero.first.c", "c"],
      ["zero.first.d", "b"],
      ["zero.first.e", "c"],
    ];
    const { q } = await client(expected.map(([k]) => zeroFirstFlag(k)));
    for (const [key, want] of expected) {
      for (const ctx of [
        undefined,
        { user: { key: "u1" } },
        { user: { id: null } },
        { user: { id: "" } },
      ]) {
        const got = q.get(key, ctx);
        expect(got).not.toBe("zero");
        expect(got).toBe(want);
      }
    }
  });

  it("flagMetadata carries hashPropertyMissing: true only when the property is missing", async () => {
    const { q } = await client([weightedFlag()]);

    for (const [, ctx] of absentContexts) {
      const missing = q.getNumberDetails("feature-flag.weighted", ctx);
      expect(missing.value).toBe(2);
      expect(missing.flagMetadata?.hashPropertyMissing).toBe(true);
    }

    const empty = q.getNumberDetails("feature-flag.weighted", { user: { tracking_id: "" } });
    expect(empty.value).toBe(2);
    expect(empty.flagMetadata).not.toHaveProperty("hashPropertyMissing");

    const present = q.getNumberDetails("feature-flag.weighted", { user: { tracking_id: "t-28" } });
    expect(present.value).toBe(1);
    expect(present.flagMetadata).not.toHaveProperty("hashPropertyMissing");
  });

  it("warns exactly once per config key across many evaluations", async () => {
    const { q, logger } = await client([weightedFlag(), weightedFlag("other.weighted")]);
    for (let i = 0; i < 100; i++) {
      q.get("feature-flag.weighted");
      q.getNumberDetails("feature-flag.weighted", { user: { key: `u${i}` } });
    }
    expect(logger.logCount("warn", WARN_RE)).toBe(1);
    expect(logger.lines.find((l) => WARN_RE.test(l.msg))?.msg).toBe(
      'quonfig: weighted rollout for "feature-flag.weighted" hashes on "user.tracking_id" which is missing from context; hashing an empty value instead'
    );

    q.get("other.weighted");
    q.get("other.weighted");
    expect(logger.logCount("warn", /weighted rollout for "other\.weighted"/)).toBe(1);
  });

  it("does not warn when the hash property is present but empty", async () => {
    const { q, logger } = await client([weightedFlag()]);
    q.get("feature-flag.weighted", { user: { tracking_id: "" } });
    expect(logger.logCount("warn", /weighted rollout/)).toBe(0);
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

  it("no hashByPropertyName: random weighted variant on every evaluation, with and without context", async () => {
    const { q, logger } = await client([abFlag("ab.random", null), abFlag("ab.empty", "")]);
    for (const [key, ctx] of [
      ["ab.random", undefined],
      ["ab.random", { user: { key: "u1" } }],
      ["ab.empty", undefined],
      ["ab.empty", { user: { key: "u1" } }],
    ] as const) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        const v = q.get(key, ctx) as string;
        counts[v] = (counts[v] ?? 0) + 1;
      }
      expect(Object.keys(counts).sort()).toEqual(["a", "b"]);
      expect(counts.a).toBeGreaterThan(350);
      expect(counts.b).toBeGreaterThan(350);
      const d = q.getStringDetails(key, ctx);
      expect(d.flagMetadata).not.toHaveProperty("hashPropertyMissing");
    }
    expect(logger.logCount("warn", /weighted rollout/)).toBe(0);
  });
});
