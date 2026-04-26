// Code generated from integration-test-data/tests/eval/enabled.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

function resolveCase(key: string, contexts: any): unknown {
  const cfg = store.get(key);
  if (!cfg) return undefined;
  const match = evaluator.evaluateConfig(cfg, envID, contexts);
  if (!match.isMatch || !match.value) return undefined;
  const { resolved } = resolver.resolveValue(
    match.value,
    cfg.key,
    cfg.valueType,
    envID,
    contexts
  );
  return resolver.unwrapValue(resolved);
}

function getCase(key: string, contexts: any, defaultValue: unknown): unknown {
  const v = resolveCase(key, contexts);
  return v === undefined ? defaultValue : v;
}

function enabledCase(key: string, contexts: any): boolean {
  const v = resolveCase(key, contexts);
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return false;
}

function runRaiseCase(
  key: string,
  contexts: any,
  _errorKey: string,
  errClass: ErrorConstructor,
): void {
  expect(() => {
    const cfg = store.get(key);
    if (!cfg) throw new Error(`config not found for key: ${key}`);
    const match = evaluator.evaluateConfig(cfg, envID, contexts);
    if (!match.isMatch || !match.value) throw new Error(`no match for key: ${key}`);
    const { resolved } = resolver.resolveValue(
      match.value, cfg.key, cfg.valueType, envID, contexts
    );
    return resolver.unwrapValue(resolved);
  }).toThrow(errClass);
}

describe("enabled", () => {

  it("returns the correct value for a simple flag", () => {
    const __actual = enabledCase("feature-flag.simple", {});
    expect(__actual).toBe(true);
  });

  it("always returns false for a non-boolean flag", () => {
    const __actual = enabledCase("feature-flag.integer", {});
    expect(__actual).toBe(false);
  });

  it("returns true for a PROP_IS_ONE_OF rule when any prop matches", () => {
    const __actual = enabledCase("feature-flag.properties.positive", mergeContexts({ "": { name: "michael", domain: "something.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for a PROP_IS_ONE_OF rule when no prop matches", () => {
    const __actual = enabledCase("feature-flag.properties.positive", mergeContexts({ "": { name: "lauren", domain: "something.com" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for a PROP_IS_NOT_ONE_OF rule when any prop doesn't match", () => {
    const __actual = enabledCase("feature-flag.properties.negative", mergeContexts({ "": { name: "lauren", domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for a PROP_IS_NOT_ONE_OF rule when all props match", () => {
    const __actual = enabledCase("feature-flag.properties.negative", mergeContexts({ "": { name: "michael", domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_ENDS_WITH_ONE_OF rule when the given prop has a matching suffix", () => {
    const __actual = enabledCase("feature-flag.ends-with-one-of.positive", mergeContexts({ "": { email: "jeff@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_ENDS_WITH_ONE_OF rule when the given prop doesn't have a matching suffix", () => {
    const __actual = enabledCase("feature-flag.ends-with-one-of.positive", mergeContexts({ "": { email: "jeff@test.com" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_DOES_NOT_END_WITH_ONE_OF rule when the given prop doesn't have a matching suffix", () => {
    const __actual = enabledCase("feature-flag.ends-with-one-of.negative", mergeContexts({ "": { email: "michael@test.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_END_WITH_ONE_OF rule when the given prop has a matching suffix", () => {
    const __actual = enabledCase("feature-flag.ends-with-one-of.negative", mergeContexts({ "": { email: "michael@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_STARTS_WITH_ONE_OF rule when the given prop has a matching prefix", () => {
    const __actual = enabledCase("feature-flag.starts-with-one-of.positive", mergeContexts({ user: { email: "foo@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_STARTS_WITH_ONE_OF rule when the given prop doesn't have a matching prefix", () => {
    const __actual = enabledCase("feature-flag.starts-with-one-of.positive", mergeContexts({ user: { email: "notfoo@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_DOES_NOT_START_WITH_ONE_OF rule when the given prop doesn't have a matching prefix", () => {
    const __actual = enabledCase("feature-flag.starts-with-one-of.negative", mergeContexts({ user: { email: "notfoo@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_START_WITH_ONE_OF rule when the given prop has a matching prefix", () => {
    const __actual = enabledCase("feature-flag.starts-with-one-of.negative", mergeContexts({ user: { email: "foo@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_CONTAINS_ONE_OF rule when the given prop has a matching substring", () => {
    const __actual = enabledCase("feature-flag.contains-one-of.positive", mergeContexts({ user: { email: "somefoo@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_CONTAINS_ONE_OF rule when the given prop doesn't have a matching substring", () => {
    const __actual = enabledCase("feature-flag.contains-one-of.positive", mergeContexts({ user: { email: "info@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_DOES_NOT_CONTAIN_ONE_OF rule when the given prop doesn't have a matching substring", () => {
    const __actual = enabledCase("feature-flag.contains-one-of.negative", mergeContexts({ user: { email: "info@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_CONTAIN_ONE_OF rule when the given prop has a matching substring", () => {
    const __actual = enabledCase("feature-flag.contains-one-of.negative", mergeContexts({ user: { email: "notfoo@prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for IN_SEG when the segment rule matches", () => {
    const __actual = enabledCase("feature-flag.in-segment.positive", mergeContexts({ user: { key: "lauren" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for IN_SEG when the segment rule doesn't match", () => {
    const __actual = enabledCase("feature-flag.in-segment.positive", mergeContexts({ user: { key: "josh" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for IN_SEG if any segment rule fails to match", () => {
    const __actual = enabledCase("feature-flag.in-seg.segment-and", mergeContexts({ user: { key: "josh" }, "": { domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for IN_SEG (segment-and) if all rules matches", () => {
    const __actual = enabledCase("feature-flag.in-seg.segment-and", mergeContexts({ user: { key: "michael" }, "": { domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for IN_SEG (segment-or) if any segment rule matches (lookup)", () => {
    const __actual = enabledCase("feature-flag.in-seg.segment-or", mergeContexts({ user: { key: "michael" }, "": { domain: "example.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for IN_SEG (segment-or) if any segment rule matches (prop)", () => {
    const __actual = enabledCase("feature-flag.in-seg.segment-or", mergeContexts({ user: { key: "nobody" }, "": { domain: "gmail.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for NOT_IN_SEG when the segment rule doesn't match", () => {
    const __actual = enabledCase("feature-flag.in-segment.negative", mergeContexts({ user: { key: "josh" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for NOT_IN_SEG when the segment rule matches", () => {
    const __actual = enabledCase("feature-flag.in-segment.negative", mergeContexts({ user: { key: "michael" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for NOT_IN_SEG if any segment rule matches", () => {
    const __actual = enabledCase("feature-flag.in-segment.multiple-criteria.negative", mergeContexts({ user: { key: "josh" }, "": { domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for NOT_IN_SEG if no segment rule matches", () => {
    const __actual = enabledCase("feature-flag.in-segment.multiple-criteria.negative", mergeContexts({ user: { key: "josh" }, "": { domain: "something.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for NOT_IN_SEG (segment-and) if not segment rule fails to match", () => {
    const __actual = enabledCase("feature-flag.not-in-seg.segment-and", mergeContexts({ user: { key: "josh" }, "": { domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for IN_SEG (segment-and) if not segment rule fails to match", () => {
    const __actual = enabledCase("feature-flag.in-seg.segment-and", mergeContexts({ user: { key: "josh" }, "": { domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for NOT_IN_SEG (segment-and) if segment rules matches", () => {
    const __actual = enabledCase("feature-flag.not-in-seg.segment-and", mergeContexts({ user: { key: "michael" }, "": { domain: "prefab.cloud" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for NOT_IN_SEG (segment-or) if no segment rule matches", () => {
    const __actual = enabledCase("feature-flag.not-in-seg.segment-or", mergeContexts({ user: { key: "nobody" }, "": { domain: "example.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for NOT_IN_SEG (segment-or) if one segment rule matches (prop)", () => {
    const __actual = enabledCase("feature-flag.not-in-seg.segment-or", mergeContexts({ user: { key: "nobody" }, "": { domain: "gmail.com" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for NOT_IN_SEG (segment-or) if one segment rule matches (lookup)", () => {
    const __actual = enabledCase("feature-flag.not-in-seg.segment-or", mergeContexts({ user: { key: "michael" }, "": { domain: "example.com" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_BEFORE rule when the given prop represents a date (string) before the rule's time", () => {
    const __actual = enabledCase("feature-flag.before", mergeContexts({ user: { creation_date: "2024-11-01T00:00:00Z" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_BEFORE rule when the given prop represents a date (number) before the rule's time", () => {
    const __actual = enabledCase("feature-flag.before", mergeContexts({ user: { creation_date: 1730419200000 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) exactly matching rule's time", () => {
    const __actual = enabledCase("feature-flag.before", mergeContexts({ user: { creation_date: 1733011200000 } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) AFTER the rule's time", () => {
    const __actual = enabledCase("feature-flag.before", mergeContexts({ user: { creation_date: "2025-01-01T00:00:00Z" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_BEFORE rule when the given prop won't parse as a date", () => {
    const __actual = enabledCase("feature-flag.before", mergeContexts({ user: { creation_date: "not a date" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_BEFORE rule using current-time relative to 2050-01-01", () => {
    const __actual = enabledCase("feature-flag.before.current-time", {});
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_AFTER rule when the given prop represents a date (string) after the rule's time", () => {
    const __actual = enabledCase("feature-flag.after", mergeContexts({ user: { creation_date: "2025-01-01T00:00:00Z" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_AFTER rule when the given prop represents a date (number) after the rule's time", () => {
    const __actual = enabledCase("feature-flag.after", mergeContexts({ user: { creation_date: 1735689600000 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_AFTER rule when the given prop represents a date (number) exactly matching rule's time", () => {
    const __actual = enabledCase("feature-flag.after", mergeContexts({ user: { creation_date: 1733011200000 } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) BEFORE the rule's time", () => {
    const __actual = enabledCase("feature-flag.after", mergeContexts({ user: { creation_date: "2024-01-01T00:00:00Z" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_AFTER rule when the given prop won't parse as a date", () => {
    const __actual = enabledCase("feature-flag.after", mergeContexts({ user: { creation_date: "not a date" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_AFTER rule using current-time relative to 2025-01-01", () => {
    const __actual = enabledCase("feature-flag.after.current-time", {});
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_LESS_THAN rule when the given prop is less than the rule's value", () => {
    const __actual = enabledCase("feature-flag.less-than", mergeContexts({ user: { age: 20 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_LESS_THAN rule when the given prop is less than the rule's value (float)", () => {
    const __actual = enabledCase("feature-flag.less-than", mergeContexts({ user: { age: 20.5 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_LESS_THAN rule when the given prop is equal to rule's value", () => {
    const __actual = enabledCase("feature-flag.less-than", mergeContexts({ user: { age: 30 } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_LESS_THAN rule when the given prop a string", () => {
    const __actual = enabledCase("feature-flag.less-than", mergeContexts({ user: { age: "20" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_LESS_THAN_OR_EQUAL rule when the given prop is less than the rule's value", () => {
    const __actual = enabledCase("feature-flag.less-than-or-equal", mergeContexts({ user: { age: 20 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_LESS_THAN_OR_EQUAL rule when the given prop is less than the rule's value (float)", () => {
    const __actual = enabledCase("feature-flag.less-than-or-equal", mergeContexts({ user: { age: 20.5 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_LESS_THAN_OR_EQUAL rule when the given prop is equal to rule's value", () => {
    const __actual = enabledCase("feature-flag.less-than-or-equal", mergeContexts({ user: { age: 30 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_LESS_THAN_OR_EQUAL rule when the given prop a string", () => {
    const __actual = enabledCase("feature-flag.less-than-or-equal", mergeContexts({ user: { age: "20" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's value", () => {
    const __actual = enabledCase("feature-flag.greater-than", mergeContexts({ user: { age: 100 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's value (float)", () => {
    const __actual = enabledCase("feature-flag.greater-than", mergeContexts({ user: { age: 30.5 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's float value (float)", () => {
    const __actual = enabledCase("feature-flag.greater-than.double", mergeContexts({ user: { age: 32.7 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's float value (integer)", () => {
    const __actual = enabledCase("feature-flag.greater-than.double", mergeContexts({ user: { age: 32 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_GREATER_THAN rule when the given prop is equal to rule's value", () => {
    const __actual = enabledCase("feature-flag.greater-than", mergeContexts({ user: { age: 30 } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_GREATER_THAN rule when the given prop a string", () => {
    const __actual = enabledCase("feature-flag.greater-than", mergeContexts({ user: { age: "100" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is greater than the rule's value", () => {
    const __actual = enabledCase("feature-flag.greater-than-or-equal", mergeContexts({ user: { age: 30 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is greater than the rule's value (float)", () => {
    const __actual = enabledCase("feature-flag.greater-than-or-equal", mergeContexts({ user: { age: 30.5 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is equal to rule's value", () => {
    const __actual = enabledCase("feature-flag.greater-than-or-equal", mergeContexts({ user: { age: 30 } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_GREATER_THAN_OR_EQUAL rule when the given prop a string", () => {
    const __actual = enabledCase("feature-flag.greater-than-or-equal", mergeContexts({ user: { age: "100" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_MATCHES rule when the given prop matches the regex", () => {
    const __actual = enabledCase("feature-flag.matches", mergeContexts({ user: { code: "aaaaaab" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_MATCHES rule when the given prop does not match the regex", () => {
    const __actual = enabledCase("feature-flag.matches", mergeContexts({ user: { code: "aa" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_DOES_NOT_MATCH rule when the given prop does not match the regex", () => {
    const __actual = enabledCase("feature-flag.does-not-match", mergeContexts({ user: { code: "b" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_DOES_NOT_MATCH rule when the given prop matches the regex", () => {
    const __actual = enabledCase("feature-flag.does-not-match", mergeContexts({ user: { code: "aabb" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_SEMVER_EQUAL rule when the given prop equals the version", () => {
    const __actual = enabledCase("feature-flag.semver-equal", mergeContexts({ app: { version: "2.0.0" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop does not equal the version", () => {
    const __actual = enabledCase("feature-flag.semver-equal", mergeContexts({ app: { version: "2.0.1" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop is not a valid semver", () => {
    const __actual = enabledCase("feature-flag.semver-equal", mergeContexts({ app: { version: "2.0" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_SEMVER_LESS_THAN rule when the given prop is less than 2.0.0", () => {
    const __actual = enabledCase("feature-flag.semver-less-than", mergeContexts({ app: { version: "1.5.1" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_SEMVER_LESS_THAN rule when the given prop equals the version", () => {
    const __actual = enabledCase("feature-flag.semver-less-than", mergeContexts({ app: { version: "2.0.0" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_SEMVER_LESS_THAN rule when the given prop is greater than the version", () => {
    const __actual = enabledCase("feature-flag.semver-less-than", mergeContexts({ app: { version: "2.2.1" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns true for PROP_SEMVER_GREATER_THAN rule when the given prop is greater than 2.0.0", () => {
    const __actual = enabledCase("feature-flag.semver-greater-than", mergeContexts({ app: { version: "2.5.1" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns false for PROP_SEMVER_GREATER_THAN rule when the given prop equals the version", () => {
    const __actual = enabledCase("feature-flag.semver-greater-than", mergeContexts({ app: { version: "2.0.0" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop is less than the version", () => {
    const __actual = enabledCase("feature-flag.semver-greater-than", mergeContexts({ app: { version: "0.0.5" } } as Contexts));
    expect(__actual).toBe(false);
  });
});
