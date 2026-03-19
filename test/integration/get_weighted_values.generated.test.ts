// Code generated from integration-test-data/tests/eval/get_weighted_values.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

describe("get_weighted_values", () => {
  it("weighted value is consistent 1", () => {
    const cfg = store.get("feature-flag.weighted");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { tracking_id: "a72c15f5" },
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
    expect(value).toBe(1);
  });

  it("weighted value is consistent 2", () => {
    const cfg = store.get("feature-flag.weighted");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { tracking_id: "92a202f2" },
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
    expect(value).toBe(2);
  });

  it("weighted value is consistent 3", () => {
    const cfg = store.get("feature-flag.weighted");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { tracking_id: "8f414100" },
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
    expect(value).toBe(3);
  });
});
