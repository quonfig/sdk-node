import { describe, it, expect } from "vitest";
import { computeReason, ReasonSplit, ReasonStatic, ReasonTargetingMatch } from "../src/reason";
import type { ConfigResponse, EvalMatch } from "../src/types";

const staticCfg = {
  id: "1",
  key: "flag",
  type: "feature_flag",
  valueType: "int",
  sendToClientSdk: false,
  default: { rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value: {} }] },
} as unknown as ConfigResponse;

function match(weightedValueIndex: number, ruleIndex = 0): EvalMatch {
  return { isMatch: true, ruleIndex, weightedValueIndex };
}

describe("computeReason", () => {
  it("returns SPLIT for a weighted value landing in bucket 0 (qfg-stbb)", () => {
    expect(computeReason(match(0), staticCfg)).toBe(ReasonSplit);
  });

  it("returns SPLIT for a weighted value landing in a later bucket", () => {
    expect(computeReason(match(2), staticCfg)).toBe(ReasonSplit);
  });

  it("returns STATIC for a non-weighted match (-1 sentinel) with no targeting rules", () => {
    expect(computeReason(match(-1), staticCfg)).toBe(ReasonStatic);
  });

  it("returns TARGETING_MATCH for a non-weighted match on a later rule", () => {
    expect(computeReason(match(-1, 1), staticCfg)).toBe(ReasonTargetingMatch);
  });
});
