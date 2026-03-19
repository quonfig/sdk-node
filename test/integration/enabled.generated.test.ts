// Code generated from integration-test-data/tests/eval/enabled.yaml. DO NOT EDIT.

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
  // For enabled, the value must be boolean true
  if (match.value.type === "bool") {
    return !!match.value.value;
  }
  // Non-boolean flags always return false for "enabled"
  return false;
}

describe("enabled", () => {
  // ALWAYS_ON
  it("returns the correct value for a simple flag", () => {
    expect(evaluateEnabled("feature-flag.simple", {})).toBe(true);
  });

  it("always returns false for a non-boolean flag", () => {
    expect(evaluateEnabled("feature-flag.integer", {})).toBe(false);
  });

  // PROP_IS_ONE_OF
  it("returns true for a PROP_IS_ONE_OF rule when any prop matches", () => {
    const contexts: Contexts = mergeContexts({
      "": { name: "michael", domain: "something.com" },
    });
    expect(evaluateEnabled("feature-flag.properties.positive", contexts)).toBe(true);
  });

  it("returns false for a PROP_IS_ONE_OF rule when no prop matches", () => {
    const contexts: Contexts = mergeContexts({
      "": { name: "lauren", domain: "something.com" },
    });
    expect(evaluateEnabled("feature-flag.properties.positive", contexts)).toBe(false);
  });

  // PROP_IS_NOT_ONE_OF
  it("returns true for a PROP_IS_NOT_ONE_OF rule when any prop doesn't match", () => {
    const contexts: Contexts = mergeContexts({
      "": { name: "lauren", domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.properties.negative", contexts)).toBe(true);
  });

  it("returns false for a PROP_IS_NOT_ONE_OF rule when all props match", () => {
    const contexts: Contexts = mergeContexts({
      "": { name: "michael", domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.properties.negative", contexts)).toBe(false);
  });

  // PROP_ENDS_WITH_ONE_OF
  it("returns true for PROP_ENDS_WITH_ONE_OF rule when the given prop has a matching suffix", () => {
    const contexts: Contexts = mergeContexts({
      "": { email: "jeff@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.ends-with-one-of.positive", contexts)).toBe(true);
  });

  it("returns false for PROP_ENDS_WITH_ONE_OF rule when the given prop doesn't have a matching suffix", () => {
    const contexts: Contexts = mergeContexts({
      "": { email: "jeff@test.com" },
    });
    expect(evaluateEnabled("feature-flag.ends-with-one-of.positive", contexts)).toBe(false);
  });

  // PROP_DOES_NOT_END_WITH_ONE_OF
  it("returns true for PROP_DOES_NOT_END_WITH_ONE_OF rule when the given prop doesn't have a matching suffix", () => {
    const contexts: Contexts = mergeContexts({
      "": { email: "michael@test.com" },
    });
    expect(evaluateEnabled("feature-flag.ends-with-one-of.negative", contexts)).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_END_WITH_ONE_OF rule when the given prop has a matching suffix", () => {
    const contexts: Contexts = mergeContexts({
      "": { email: "michael@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.ends-with-one-of.negative", contexts)).toBe(false);
  });

  // PROP_STARTS_WITH_ONE_OF
  it("returns true for PROP_STARTS_WITH_ONE_OF rule when the given prop has a matching prefix", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "foo@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.starts-with-one-of.positive", contexts)).toBe(true);
  });

  it("returns false for PROP_STARTS_WITH_ONE_OF rule when the given prop doesn't have a matching prefix", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "notfoo@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.starts-with-one-of.positive", contexts)).toBe(false);
  });

  // PROP_DOES_NOT_START_WITH_ONE_OF
  it("returns true for PROP_DOES_NOT_START_WITH_ONE_OF rule when the given prop doesn't have a matching prefix", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "notfoo@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.starts-with-one-of.negative", contexts)).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_START_WITH_ONE_OF rule when the given prop has a matching prefix", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "foo@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.starts-with-one-of.negative", contexts)).toBe(false);
  });

  // PROP_CONTAINS_ONE_OF
  it("returns true for PROP_CONTAINS_ONE_OF rule when the given prop has a matching substring", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "somefoo@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.contains-one-of.positive", contexts)).toBe(true);
  });

  it("returns false for PROP_CONTAINS_ONE_OF rule when the given prop doesn't have a matching substring", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "info@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.contains-one-of.positive", contexts)).toBe(false);
  });

  // PROP_DOES_NOT_CONTAIN_ONE_OF
  it("returns true for PROP_DOES_NOT_CONTAIN_ONE_OF rule when the given prop doesn't have a matching substring", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "info@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.contains-one-of.negative", contexts)).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_CONTAIN_ONE_OF rule when the given prop has a matching substring", () => {
    const contexts: Contexts = mergeContexts({
      user: { email: "notfoo@prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.contains-one-of.negative", contexts)).toBe(false);
  });

  // IN_SEG
  it("returns true for IN_SEG when the segment rule matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "lauren" },
    });
    expect(evaluateEnabled("feature-flag.in-segment.positive", contexts)).toBe(true);
  });

  it("returns false for IN_SEG when the segment rule doesn't match", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
    });
    expect(evaluateEnabled("feature-flag.in-segment.positive", contexts)).toBe(false);
  });

  it("returns false for IN_SEG if any segment rule fails to match", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
      "": { domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(false);
  });

  it("returns true for IN_SEG (segment-and) if all rules matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "michael" },
      "": { domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(true);
  });

  it("returns true for IN_SEG (segment-or) if any segment rule matches (lookup)", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "michael" },
      "": { domain: "example.com" },
    });
    expect(evaluateEnabled("feature-flag.in-seg.segment-or", contexts)).toBe(true);
  });

  it("returns true for IN_SEG (segment-or) if any segment rule matches (prop)", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "nobody" },
      "": { domain: "gmail.com" },
    });
    expect(evaluateEnabled("feature-flag.in-seg.segment-or", contexts)).toBe(true);
  });

  // NOT_IN_SEG
  it("returns true for NOT_IN_SEG when the segment rule doesn't match", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
    });
    expect(evaluateEnabled("feature-flag.in-segment.negative", contexts)).toBe(true);
  });

  it("returns false for NOT_IN_SEG when the segment rule matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "michael" },
    });
    expect(evaluateEnabled("feature-flag.in-segment.negative", contexts)).toBe(false);
  });

  it("returns false for NOT_IN_SEG if any segment rule matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
      "": { domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.in-segment.multiple-criteria.negative", contexts)).toBe(true);
  });

  it("returns true for NOT_IN_SEG if no segment rule matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
      "": { domain: "something.com" },
    });
    expect(evaluateEnabled("feature-flag.in-segment.multiple-criteria.negative", contexts)).toBe(true);
  });

  it("returns true for NOT_IN_SEG (segment-and) if not segment rule fails to match", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
      "": { domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.not-in-seg.segment-and", contexts)).toBe(true);
  });

  it("returns true for IN_SEG (segment-and) if not segment rule fails to match", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "josh" },
      "": { domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.in-seg.segment-and", contexts)).toBe(false);
  });

  it("returns false for NOT_IN_SEG (segment-and) if segment rules matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "michael" },
      "": { domain: "prefab.cloud" },
    });
    expect(evaluateEnabled("feature-flag.not-in-seg.segment-and", contexts)).toBe(false);
  });

  it("returns true for NOT_IN_SEG (segment-or) if no segment rule matches", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "nobody" },
      "": { domain: "example.com" },
    });
    expect(evaluateEnabled("feature-flag.not-in-seg.segment-or", contexts)).toBe(true);
  });

  it("returns false for NOT_IN_SEG (segment-or) if one segment rule matches (prop)", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "nobody" },
      "": { domain: "gmail.com" },
    });
    expect(evaluateEnabled("feature-flag.not-in-seg.segment-or", contexts)).toBe(false);
  });

  it("returns false for NOT_IN_SEG (segment-or) if one segment rule matches (lookup)", () => {
    const contexts: Contexts = mergeContexts({
      user: { key: "michael" },
      "": { domain: "example.com" },
    });
    expect(evaluateEnabled("feature-flag.not-in-seg.segment-or", contexts)).toBe(false);
  });

  // PROP_BEFORE
  it("returns true for PROP_BEFORE rule when the given prop represents a date (string) before the rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: "2024-11-01T00:00:00Z" },
    });
    expect(evaluateEnabled("feature-flag.before", contexts)).toBe(true);
  });

  it("returns true for PROP_BEFORE rule when the given prop represents a date (number) before the rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: 1730419200000 as any },
    });
    expect(evaluateEnabled("feature-flag.before", contexts)).toBe(true);
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) exactly matching rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: 1733011200000 as any },
    });
    expect(evaluateEnabled("feature-flag.before", contexts)).toBe(false);
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) AFTER the rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: "2025-01-01T00:00:00Z" },
    });
    expect(evaluateEnabled("feature-flag.before", contexts)).toBe(false);
  });

  it("returns false for PROP_BEFORE rule when the given prop won't parse as a date", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: "not a date" },
    });
    expect(evaluateEnabled("feature-flag.before", contexts)).toBe(false);
  });

  it("returns false for PROP_BEFORE rule using current-time relative to 2050-01-01", () => {
    // current-time is now, which is before 2050-01-01
    expect(evaluateEnabled("feature-flag.before.current-time", {})).toBe(true);
  });

  // PROP_AFTER
  it("returns true for PROP_AFTER rule when the given prop represents a date (string) after the rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: "2025-01-01T00:00:00Z" },
    });
    expect(evaluateEnabled("feature-flag.after", contexts)).toBe(true);
  });

  it("returns true for PROP_AFTER rule when the given prop represents a date (number) after the rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: 1735689600000 as any },
    });
    expect(evaluateEnabled("feature-flag.after", contexts)).toBe(true);
  });

  it("returns false for PROP_AFTER rule when the given prop represents a date (number) exactly matching rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: 1733011200000 as any },
    });
    expect(evaluateEnabled("feature-flag.after", contexts)).toBe(false);
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) BEFORE the rule's time", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: "2024-01-01T00:00:00Z" },
    });
    expect(evaluateEnabled("feature-flag.after", contexts)).toBe(false);
  });

  it("returns false for PROP_AFTER rule when the given prop won't parse as a date", () => {
    const contexts: Contexts = mergeContexts({
      user: { creation_date: "not a date" },
    });
    expect(evaluateEnabled("feature-flag.after", contexts)).toBe(false);
  });

  it("returns false for PROP_AFTER rule using current-time relative to 2025-01-01", () => {
    // current-time is now (2026+), which is after 2025-01-01
    expect(evaluateEnabled("feature-flag.after.current-time", {})).toBe(true);
  });

  // PROP_LESS_THAN
  it("returns true for PROP_LESS_THAN rule when the given prop is less than the rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 20 as any },
    });
    expect(evaluateEnabled("feature-flag.less-than", contexts)).toBe(true);
  });

  it("returns true for PROP_LESS_THAN rule when the given prop is less than the rule's value (float)", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 20.5 as any },
    });
    expect(evaluateEnabled("feature-flag.less-than", contexts)).toBe(true);
  });

  it("returns false for PROP_LESS_THAN rule when the given prop is equal to rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30 as any },
    });
    expect(evaluateEnabled("feature-flag.less-than", contexts)).toBe(false);
  });

  it("returns false for PROP_LESS_THAN rule when the given prop a string", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: "20" },
    });
    expect(evaluateEnabled("feature-flag.less-than", contexts)).toBe(false);
  });

  // PROP_LESS_THAN_OR_EQUAL
  it("returns true for PROP_LESS_THAN_OR_EQUAL rule when the given prop is less than the rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 20 as any },
    });
    expect(evaluateEnabled("feature-flag.less-than-or-equal", contexts)).toBe(true);
  });

  it("returns true for PROP_LESS_THAN_OR_EQUAL rule when the given prop is less than the rule's value (float)", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 20.5 as any },
    });
    expect(evaluateEnabled("feature-flag.less-than-or-equal", contexts)).toBe(true);
  });

  it("returns false for PROP_LESS_THAN_OR_EQUAL rule when the given prop is equal to rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30 as any },
    });
    expect(evaluateEnabled("feature-flag.less-than-or-equal", contexts)).toBe(true);
  });

  it("returns false for PROP_LESS_THAN_OR_EQUAL rule when the given prop a string", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: "20" },
    });
    expect(evaluateEnabled("feature-flag.less-than-or-equal", contexts)).toBe(false);
  });

  // PROP_GREATER_THAN
  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 100 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than", contexts)).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's value (float)", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30.5 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than", contexts)).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's float value (float)", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 32.7 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than.double", contexts)).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's float value (integer)", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 32 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than.double", contexts)).toBe(true);
  });

  it("returns false for PROP_GREATER_THAN rule when the given prop is equal to rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than", contexts)).toBe(false);
  });

  it("returns false for PROP_GREATER_THAN rule when the given prop a string", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: "100" },
    });
    expect(evaluateEnabled("feature-flag.greater-than", contexts)).toBe(false);
  });

  // PROP_GREATER_THAN_OR_EQUAL
  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is greater than the rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than-or-equal", contexts)).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is greater than the rule's value (float)", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30.5 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than-or-equal", contexts)).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is equal to rule's value", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: 30 as any },
    });
    expect(evaluateEnabled("feature-flag.greater-than-or-equal", contexts)).toBe(true);
  });

  it("returns false for PROP_GREATER_THAN_OR_EQUAL rule when the given prop a string", () => {
    const contexts: Contexts = mergeContexts({
      user: { age: "100" },
    });
    expect(evaluateEnabled("feature-flag.greater-than-or-equal", contexts)).toBe(false);
  });

  // PROP_MATCHES
  it("returns true for PROP_MATCHES rule when the given prop matches the regex", () => {
    const contexts: Contexts = mergeContexts({
      user: { code: "aaaaaab" },
    });
    expect(evaluateEnabled("feature-flag.matches", contexts)).toBe(true);
  });

  it("returns false for PROP_MATCHES rule when the given prop does not match the regex", () => {
    const contexts: Contexts = mergeContexts({
      user: { code: "aa" },
    });
    expect(evaluateEnabled("feature-flag.matches", contexts)).toBe(false);
  });

  // PROP_DOES_NOT_MATCH
  it("returns true for PROP_DOES_NOT_MATCH rule when the given prop does not match the regex", () => {
    const contexts: Contexts = mergeContexts({
      user: { code: "b" },
    });
    expect(evaluateEnabled("feature-flag.does-not-match", contexts)).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_MATCH rule when the given prop matches the regex", () => {
    const contexts: Contexts = mergeContexts({
      user: { code: "aabb" },
    });
    expect(evaluateEnabled("feature-flag.does-not-match", contexts)).toBe(false);
  });

  // PROP_SEMVER_EQUAL
  it("returns true for PROP_SEMVER_EQUAL rule when the given prop equals the version", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.0.0" },
    });
    expect(evaluateEnabled("feature-flag.semver-equal", contexts)).toBe(true);
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop does not equal the version", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.0.1" },
    });
    expect(evaluateEnabled("feature-flag.semver-equal", contexts)).toBe(false);
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop is not a valid semver", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.0" },
    });
    expect(evaluateEnabled("feature-flag.semver-equal", contexts)).toBe(false);
  });

  // PROP_SEMVER_LESS_THAN
  it("returns true for PROP_SEMVER_LESS_THAN rule when the given prop is less than 2.0.0", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "1.5.1" },
    });
    expect(evaluateEnabled("feature-flag.semver-less-than", contexts)).toBe(true);
  });

  it("returns false for PROP_SEMVER_LESS_THAN rule when the given prop equals the version", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.0.0" },
    });
    expect(evaluateEnabled("feature-flag.semver-less-than", contexts)).toBe(false);
  });

  it("returns false for PROP_SEMVER_LESS_THAN rule when the given prop is greater than the version", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.2.1" },
    });
    expect(evaluateEnabled("feature-flag.semver-less-than", contexts)).toBe(false);
  });

  // PROP_SEMVER_GREATER_THAN
  it("returns true for PROP_SEMVER_GREATER_THAN rule when the given prop is greater than 2.0.0", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.5.1" },
    });
    expect(evaluateEnabled("feature-flag.semver-greater-than", contexts)).toBe(true);
  });

  it("returns false for PROP_SEMVER_GREATER_THAN rule when the given prop equals the version", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "2.0.0" },
    });
    expect(evaluateEnabled("feature-flag.semver-greater-than", contexts)).toBe(false);
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop is less than the version", () => {
    const contexts: Contexts = mergeContexts({
      app: { version: "0.0.5" },
    });
    expect(evaluateEnabled("feature-flag.semver-greater-than", contexts)).toBe(false);
  });
});
