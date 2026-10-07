// Code generated from integration-test-data/tests/eval/enabled.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient } from "./setup";

describe("enabled", () => {
  it("returns the correct value for a simple flag", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("feature-flag.simple")).toBe(true);
    });
  });

  it("always returns false for a non-boolean flag", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("feature-flag.integer")).toBe(false);
    });
  });

  it("returns false for a flag key that does not exist", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("my-missing-key")).toBe(false);
    });
  });

  it("returns false for a flag key that does not exist with a context", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("my-missing-key", {
          user: { key: "michael", email: "michael@example.com" },
        })
      ).toBe(false);
    });
  });

  it("returns true for a PROP_IS_ONE_OF rule when any prop matches", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.properties.positive", {
          "": { name: "michael", domain: "something.com" },
        })
      ).toBe(true);
    });
  });

  it("returns false for a PROP_IS_ONE_OF rule when no prop matches", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.properties.positive", {
          "": { name: "lauren", domain: "something.com" },
        })
      ).toBe(false);
    });
  });

  it("returns true for a PROP_IS_NOT_ONE_OF rule when any prop doesn't match", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.properties.negative", {
          "": { name: "lauren", domain: "prefab.cloud" },
        })
      ).toBe(true);
    });
  });

  it("returns false for a PROP_IS_NOT_ONE_OF rule when all props match", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.properties.negative", {
          "": { name: "michael", domain: "prefab.cloud" },
        })
      ).toBe(false);
    });
  });

  it("returns true for PROP_ENDS_WITH_ONE_OF rule when the given prop has a matching suffix", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { email: "jeff@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.ends-with-one-of.positive")).toBe(true);
    });
  });

  it("returns false for PROP_ENDS_WITH_ONE_OF rule when the given prop doesn't have a matching suffix", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.ends-with-one-of.positive", {
          "": { email: "jeff@test.com" },
        })
      ).toBe(false);
    });
  });

  it("returns true for PROP_DOES_NOT_END_WITH_ONE_OF rule when the given prop doesn't have a matching suffix", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { email: "michael@test.com" } });
      expect(scope.isEnabled("feature-flag.ends-with-one-of.negative")).toBe(true);
    });
  });

  it("returns false for PROP_DOES_NOT_END_WITH_ONE_OF rule when the given prop has a matching suffix", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.ends-with-one-of.negative", {
          "": { email: "michael@prefab.cloud" },
        })
      ).toBe(false);
    });
  });

  it("returns true for PROP_STARTS_WITH_ONE_OF rule when the given prop has a matching prefix", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "foo@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.starts-with-one-of.positive")).toBe(true);
    });
  });

  it("returns false for PROP_STARTS_WITH_ONE_OF rule when the given prop doesn't have a matching prefix", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "notfoo@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.starts-with-one-of.positive")).toBe(false);
    });
  });

  it("returns true for PROP_DOES_NOT_START_WITH_ONE_OF rule when the given prop doesn't have a matching prefix", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "notfoo@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.starts-with-one-of.negative")).toBe(true);
    });
  });

  it("returns false for PROP_DOES_NOT_START_WITH_ONE_OF rule when the given prop has a matching prefix", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "foo@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.starts-with-one-of.negative")).toBe(false);
    });
  });

  it("returns true for PROP_CONTAINS_ONE_OF rule when the given prop has a matching substring", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "somefoo@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.contains-one-of.positive")).toBe(true);
    });
  });

  it("returns false for PROP_CONTAINS_ONE_OF rule when the given prop doesn't have a matching substring", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "info@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.contains-one-of.positive")).toBe(false);
    });
  });

  it("returns true for PROP_DOES_NOT_CONTAIN_ONE_OF rule when the given prop doesn't have a matching substring", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "info@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.contains-one-of.negative")).toBe(true);
    });
  });

  it("returns false for PROP_DOES_NOT_CONTAIN_ONE_OF rule when the given prop has a matching substring", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "notfoo@prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.contains-one-of.negative")).toBe(false);
    });
  });

  it("returns true for IN_SEG when the segment rule matches", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "lauren" } });
      expect(scope.isEnabled("feature-flag.in-segment.positive")).toBe(true);
    });
  });

  it("returns false for IN_SEG when the segment rule doesn't match", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("feature-flag.in-segment.positive", { user: { key: "josh" } })).toBe(
        false
      );
    });
  });

  it("returns false for IN_SEG if any segment rule fails to match", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "josh" }, "": { domain: "prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.in-seg.segment-and")).toBe(false);
    });
  });

  it("returns true for IN_SEG (segment-and) if all rules matches", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.in-seg.segment-and", {
          user: { key: "michael" },
          "": { domain: "prefab.cloud" },
        })
      ).toBe(true);
    });
  });

  it("returns true for IN_SEG (segment-or) if any segment rule matches (lookup)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "michael" }, "": { domain: "example.com" } });
      expect(scope.isEnabled("feature-flag.in-seg.segment-or")).toBe(true);
    });
  });

  it("returns true for IN_SEG (segment-or) if any segment rule matches (prop)", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.in-seg.segment-or", {
          user: { key: "nobody" },
          "": { domain: "gmail.com" },
        })
      ).toBe(true);
    });
  });

  it("returns true for NOT_IN_SEG when the segment rule doesn't match", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "josh" } });
      expect(scope.isEnabled("feature-flag.in-segment.negative")).toBe(true);
    });
  });

  it("returns false for NOT_IN_SEG when the segment rule matches", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.in-segment.negative", { user: { key: "michael" } })
      ).toBe(false);
    });
  });

  it("returns false for NOT_IN_SEG if any segment rule matches", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "josh" }, "": { domain: "prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.in-segment.multiple-criteria.negative")).toBe(true);
    });
  });

  it("returns true for NOT_IN_SEG if no segment rule matches", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.in-segment.multiple-criteria.negative", {
          user: { key: "josh" },
          "": { domain: "something.com" },
        })
      ).toBe(true);
    });
  });

  it("returns true for NOT_IN_SEG (segment-and) if not segment rule fails to match", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "josh" }, "": { domain: "prefab.cloud" } });
      expect(scope.isEnabled("feature-flag.not-in-seg.segment-and")).toBe(true);
    });
  });

  it("returns true for IN_SEG (segment-and) if not segment rule fails to match", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.in-seg.segment-and", {
          user: { key: "josh" },
          "": { domain: "prefab.cloud" },
        })
      ).toBe(false);
    });
  });

  it("returns false for NOT_IN_SEG (segment-and) if segment rules matches", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({
        user: { key: "michael" },
        "": { domain: "prefab.cloud" },
      });
      expect(scope.isEnabled("feature-flag.not-in-seg.segment-and")).toBe(false);
    });
  });

  it("returns true for NOT_IN_SEG (segment-or) if no segment rule matches", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.not-in-seg.segment-or", {
          user: { key: "nobody" },
          "": { domain: "example.com" },
        })
      ).toBe(true);
    });
  });

  it("returns false for NOT_IN_SEG (segment-or) if one segment rule matches (prop)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { key: "nobody" }, "": { domain: "gmail.com" } });
      expect(scope.isEnabled("feature-flag.not-in-seg.segment-or")).toBe(false);
    });
  });

  it("returns false for NOT_IN_SEG (segment-or) if one segment rule matches (lookup)", async () => {
    await withClient({}, (client) => {
      expect(
        client.isEnabled("feature-flag.not-in-seg.segment-or", {
          user: { key: "michael" },
          "": { domain: "example.com" },
        })
      ).toBe(false);
    });
  });

  it("returns true for PROP_BEFORE rule when the given prop represents a date (string) before the rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: "2024-11-01T00:00:00Z" } });
      expect(scope.isEnabled("feature-flag.before")).toBe(true);
    });
  });

  it("returns true for PROP_BEFORE rule when the given prop represents a date (number) before the rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: 1730419200000 } });
      expect(scope.isEnabled("feature-flag.before")).toBe(true);
    });
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) exactly matching rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: 1733011200000 } });
      expect(scope.isEnabled("feature-flag.before")).toBe(false);
    });
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) AFTER the rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: "2025-01-01T00:00:00Z" } });
      expect(scope.isEnabled("feature-flag.before")).toBe(false);
    });
  });

  it("returns false for PROP_BEFORE rule when the given prop won't parse as a date", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: "not a date" } });
      expect(scope.isEnabled("feature-flag.before")).toBe(false);
    });
  });

  it("returns false for PROP_BEFORE rule using current-time relative to 2050-01-01", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("feature-flag.before.current-time")).toBe(true);
    });
  });

  it("returns true for PROP_AFTER rule when the given prop represents a date (string) after the rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: "2025-01-01T00:00:00Z" } });
      expect(scope.isEnabled("feature-flag.after")).toBe(true);
    });
  });

  it("returns true for PROP_AFTER rule when the given prop represents a date (number) after the rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: 1735689600000 } });
      expect(scope.isEnabled("feature-flag.after")).toBe(true);
    });
  });

  it("returns false for PROP_AFTER rule when the given prop represents a date (number) exactly matching rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: 1733011200000 } });
      expect(scope.isEnabled("feature-flag.after")).toBe(false);
    });
  });

  it("returns false for PROP_BEFORE rule when the given prop represents a date (number) BEFORE the rule's time", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: "2024-01-01T00:00:00Z" } });
      expect(scope.isEnabled("feature-flag.after")).toBe(false);
    });
  });

  it("returns false for PROP_AFTER rule when the given prop won't parse as a date", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { creation_date: "not a date" } });
      expect(scope.isEnabled("feature-flag.after")).toBe(false);
    });
  });

  it("returns false for PROP_AFTER rule using current-time relative to 2025-01-01", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("feature-flag.after.current-time")).toBe(true);
    });
  });

  it("returns true for PROP_LESS_THAN rule when the given prop is less than the rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 20 } });
      expect(scope.isEnabled("feature-flag.less-than")).toBe(true);
    });
  });

  it("returns true for PROP_LESS_THAN rule when the given prop is less than the rule's value (float)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 20.5 } });
      expect(scope.isEnabled("feature-flag.less-than")).toBe(true);
    });
  });

  it("returns false for PROP_LESS_THAN rule when the given prop is equal to rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30 } });
      expect(scope.isEnabled("feature-flag.less-than")).toBe(false);
    });
  });

  it("returns false for PROP_LESS_THAN rule when the given prop a string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: "20" } });
      expect(scope.isEnabled("feature-flag.less-than")).toBe(false);
    });
  });

  it("returns true for PROP_LESS_THAN_OR_EQUAL rule when the given prop is less than the rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 20 } });
      expect(scope.isEnabled("feature-flag.less-than-or-equal")).toBe(true);
    });
  });

  it("returns true for PROP_LESS_THAN_OR_EQUAL rule when the given prop is less than the rule's value (float)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 20.5 } });
      expect(scope.isEnabled("feature-flag.less-than-or-equal")).toBe(true);
    });
  });

  it("returns false for PROP_LESS_THAN_OR_EQUAL rule when the given prop is equal to rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30 } });
      expect(scope.isEnabled("feature-flag.less-than-or-equal")).toBe(true);
    });
  });

  it("returns false for PROP_LESS_THAN_OR_EQUAL rule when the given prop a string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: "20" } });
      expect(scope.isEnabled("feature-flag.less-than-or-equal")).toBe(false);
    });
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 100 } });
      expect(scope.isEnabled("feature-flag.greater-than")).toBe(true);
    });
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's value (float)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30.5 } });
      expect(scope.isEnabled("feature-flag.greater-than")).toBe(true);
    });
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's float value (float)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 32.7 } });
      expect(scope.isEnabled("feature-flag.greater-than.double")).toBe(true);
    });
  });

  it("returns true for PROP_GREATER_THAN rule when the given prop is greater than the rule's float value (integer)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 32 } });
      expect(scope.isEnabled("feature-flag.greater-than.double")).toBe(true);
    });
  });

  it("returns false for PROP_GREATER_THAN rule when the given prop is equal to rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30 } });
      expect(scope.isEnabled("feature-flag.greater-than")).toBe(false);
    });
  });

  it("returns false for PROP_GREATER_THAN rule when the given prop a string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: "100" } });
      expect(scope.isEnabled("feature-flag.greater-than")).toBe(false);
    });
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is greater than the rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30 } });
      expect(scope.isEnabled("feature-flag.greater-than-or-equal")).toBe(true);
    });
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is greater than the rule's value (float)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30.5 } });
      expect(scope.isEnabled("feature-flag.greater-than-or-equal")).toBe(true);
    });
  });

  it("returns true for PROP_GREATER_THAN_OR_EQUAL rule when the given prop is equal to rule's value", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: 30 } });
      expect(scope.isEnabled("feature-flag.greater-than-or-equal")).toBe(true);
    });
  });

  it("returns false for PROP_GREATER_THAN_OR_EQUAL rule when the given prop a string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { age: "100" } });
      expect(scope.isEnabled("feature-flag.greater-than-or-equal")).toBe(false);
    });
  });

  it("returns true for PROP_MATCHES rule when the given prop matches the regex", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { code: "aaaaaab" } });
      expect(scope.isEnabled("feature-flag.matches")).toBe(true);
    });
  });

  it("returns false for PROP_MATCHES rule when the given prop does not match the regex", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { code: "aa" } });
      expect(scope.isEnabled("feature-flag.matches")).toBe(false);
    });
  });

  it("returns true for PROP_DOES_NOT_MATCH rule when the given prop does not match the regex", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { code: "b" } });
      expect(scope.isEnabled("feature-flag.does-not-match")).toBe(true);
    });
  });

  it("returns false for PROP_DOES_NOT_MATCH rule when the given prop matches the regex", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { code: "aabb" } });
      expect(scope.isEnabled("feature-flag.does-not-match")).toBe(false);
    });
  });

  it("returns true for IS_PRESENT rule when the given prop is a non-empty string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: "abc" } });
      expect(scope.isEnabled("feature-flag.is-present")).toBe(true);
    });
  });

  it("returns true for IS_PRESENT rule when the given prop is an empty string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: "" } });
      expect(scope.isEnabled("feature-flag.is-present")).toBe(true);
    });
  });

  it("returns true for IS_PRESENT rule when the given prop is the integer zero", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: 0 } });
      expect(scope.isEnabled("feature-flag.is-present")).toBe(true);
    });
  });

  it("returns true for IS_PRESENT rule when the given prop is boolean false", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: false } });
      expect(scope.isEnabled("feature-flag.is-present")).toBe(true);
    });
  });

  it("returns false for IS_PRESENT rule when the given prop is null", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: undefined } });
      expect(scope.isEnabled("feature-flag.is-present")).toBe(false);
    });
  });

  it("returns false for IS_PRESENT rule when the given prop key is missing from the context", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { name: "bob" } });
      expect(scope.isEnabled("feature-flag.is-present")).toBe(false);
    });
  });

  it("returns false for IS_PRESENT rule when no contexts are provided at all", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("feature-flag.is-present")).toBe(false);
    });
  });

  it("returns false for IS_NOT_PRESENT rule when the given prop is a non-empty string", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: "abc" } });
      expect(scope.isEnabled("feature-flag.is-not-present")).toBe(false);
    });
  });

  it("returns true for IS_NOT_PRESENT rule when the given prop is null", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: undefined } });
      expect(scope.isEnabled("feature-flag.is-not-present")).toBe(true);
    });
  });

  it("returns true for IS_NOT_PRESENT rule when the given prop key is missing from the context", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { name: "bob" } });
      expect(scope.isEnabled("feature-flag.is-not-present")).toBe(true);
    });
  });

  it("returns true for IS_PRESENT rule on a nested path when the nested prop is set", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ organization: { domain: "example.com" } });
      expect(scope.isEnabled("feature-flag.is-present-nested")).toBe(true);
    });
  });

  it("returns false for IS_PRESENT rule on a nested path when the nested key is missing but the parent context exists", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ organization: { name: "Acme Inc" } });
      expect(scope.isEnabled("feature-flag.is-present-nested")).toBe(false);
    });
  });

  it("returns false for IS_PRESENT rule on a nested path when the parent context is entirely absent", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { id: "abc" } });
      expect(scope.isEnabled("feature-flag.is-present-nested")).toBe(false);
    });
  });

  it("returns true for PROP_SEMVER_EQUAL rule when the given prop equals the version", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.0.0" } });
      expect(scope.isEnabled("feature-flag.semver-equal")).toBe(true);
    });
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop does not equal the version", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.0.1" } });
      expect(scope.isEnabled("feature-flag.semver-equal")).toBe(false);
    });
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop is not a valid semver", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.0" } });
      expect(scope.isEnabled("feature-flag.semver-equal")).toBe(false);
    });
  });

  it("returns true for PROP_SEMVER_LESS_THAN rule when the given prop is less than 2.0.0", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "1.5.1" } });
      expect(scope.isEnabled("feature-flag.semver-less-than")).toBe(true);
    });
  });

  it("returns false for PROP_SEMVER_LESS_THAN rule when the given prop equals the version", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.0.0" } });
      expect(scope.isEnabled("feature-flag.semver-less-than")).toBe(false);
    });
  });

  it("returns false for PROP_SEMVER_LESS_THAN rule when the given prop is greater than the version", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.2.1" } });
      expect(scope.isEnabled("feature-flag.semver-less-than")).toBe(false);
    });
  });

  it("returns true for PROP_SEMVER_GREATER_THAN rule when the given prop is greater than 2.0.0", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.5.1" } });
      expect(scope.isEnabled("feature-flag.semver-greater-than")).toBe(true);
    });
  });

  it("returns false for PROP_SEMVER_GREATER_THAN rule when the given prop equals the version", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "2.0.0" } });
      expect(scope.isEnabled("feature-flag.semver-greater-than")).toBe(false);
    });
  });

  it("returns false for PROP_SEMVER_EQUAL rule when the given prop is less than the version", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ app: { version: "0.0.5" } });
      expect(scope.isEnabled("feature-flag.semver-greater-than")).toBe(false);
    });
  });
});
