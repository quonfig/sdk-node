// Code generated from integration-test-data/tests/eval/enabled_with_contexts.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

/**
 * Helper: evaluate a feature flag with the "enabled" semantics.
 * Returns true if the flag evaluates to a boolean true, false otherwise.
 */
function evaluateEnabled(flagKey: string, contexts: Contexts): boolean {
  const cfg = store.get(flagKey);
  if (!cfg) return false;
  const match = evaluator.evaluateConfig(cfg, envID, contexts);
  if (!match.isMatch || !match.value) return false;
  if (match.value.type === "bool") {
    return !!match.value.value;
  }
  return false;
}

describe("enabled_with_contexts", () => {
  describe("scope context with domain=prefab.cloud and user.key=michael", () => {
    it("returns true from global context", () => {
      const contexts: Contexts = mergeContexts(
        { "": { domain: "prefab.cloud" }, user: { key: "michael" } }
      );
      expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(true);
    });

    it("returns false due to local context override", () => {
      const contexts: Contexts = mergeContexts(
        { "": { domain: "prefab.cloud" }, user: { key: "michael" } },
        { user: { key: "james" } }
      );
      expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(false);
    });
  });

  describe("scope context with domain=prefab.cloud and user.key=nobody", () => {
    it("returns false for untouched scope context", () => {
      const contexts: Contexts = mergeContexts(
        { "": { domain: "example.com" }, user: { key: "nobody" } }
      );
      expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(false);
    });

    it("returns false due to partial scope context override of user.key", () => {
      const contexts: Contexts = mergeContexts(
        { "": { domain: "example.com" }, user: { key: "nobody" } },
        { user: { key: "michael" } }
      );
      expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(false);
    });

    it("returns false due to partial scope context override of domain", () => {
      const contexts: Contexts = mergeContexts(
        { "": { domain: "example.com" }, user: { key: "nobody" } },
        { "": { key: "prefab.cloud" } }
      );
      expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(false);
    });

    it("returns true due to full scope context override of user.key and domain", () => {
      const contexts: Contexts = mergeContexts(
        { "": { domain: "example.com" }, user: { key: "nobody" } },
        { user: { key: "michael" }, "": { domain: "prefab.cloud" } }
      );
      expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(true);
    });
  });

  describe("empty context", () => {
    it("returns false for rule with different case on context property name", () => {
      const contexts: Contexts = mergeContexts({
        user: { IsHuman: "verified" },
      });
      expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(false);
    });

    it("returns true for matching case on context property name", () => {
      const contexts: Contexts = mergeContexts({
        user: { isHuman: "verified" },
      });
      expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(true);
    });
  });
});
