// Code generated from integration-test-data/tests/eval/get_feature_flag.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

describe("get_feature_flag", () => {
  it("get returns the underlying value for a feature flag", () => {
    const cfg = store.get("feature-flag.integer");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(3);
  });

  it("get returns the underlying value for a feature flag that matches the highest precedent rule", () => {
    const cfg = store.get("feature-flag.integer");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { key: "michael" },
    });
    const match = evaluator.evaluateConfig(cfg!, envID, contexts);
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      contexts
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(5);
  });
});
