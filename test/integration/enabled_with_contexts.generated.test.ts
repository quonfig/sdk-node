// Code generated from integration-test-data/tests/eval/enabled_with_contexts.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient } from "./setup";

describe("enabled_with_contexts", () => {
  it("returns true from global context", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({
        "": { domain: "prefab.cloud" },
        user: { key: "michael" },
      });
      expect(scope.isEnabled("feature-flag.in-seg.segment-and")).toBe(true);
    });
  });

  it("returns false due to local context override", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({
        "": { domain: "prefab.cloud" },
        user: { key: "michael" },
      });
      expect(scope.isEnabled("feature-flag.in-seg.segment-and", { user: { key: "james" } })).toBe(
        false
      );
    });
  });

  it("returns false for untouched scope context", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { domain: "example.com" }, user: { key: "nobody" } });
      expect(scope.isEnabled("feature-flag.in-seg.segment-and")).toBe(false);
    });
  });

  it("returns false due to partial scope context override of user.key", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { domain: "example.com" }, user: { key: "nobody" } });
      expect(scope.isEnabled("feature-flag.in-seg.segment-and", { user: { key: "michael" } })).toBe(
        false
      );
    });
  });

  it("returns false due to partial scope context override of domain", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { domain: "example.com" }, user: { key: "nobody" } });
      expect(
        scope.isEnabled("feature-flag.in-seg.segment-and", { "": { domain: "prefab.cloud" } })
      ).toBe(false);
    });
  });

  it("returns true due to local override of domain when scope user.key already matches", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { domain: "example.com" }, user: { key: "michael" } });
      expect(
        scope.isEnabled("feature-flag.in-seg.segment-and", { "": { domain: "prefab.cloud" } })
      ).toBe(true);
    });
  });

  it("returns true due to full scope context override of user.key and domain", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "": { domain: "example.com" }, user: { key: "nobody" } });
      expect(
        scope.isEnabled("feature-flag.in-seg.segment-and", {
          user: { key: "michael" },
          "": { domain: "prefab.cloud" },
        })
      ).toBe(true);
    });
  });

  it("returns false for rule with different case on context property name", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("mixed.case.property.name", { user: { IsHuman: "verified" } })).toBe(
        false
      );
    });
  });

  it("returns true for matching case on context property name", async () => {
    await withClient({}, (client) => {
      expect(client.isEnabled("mixed.case.property.name", { user: { isHuman: "verified" } })).toBe(
        true
      );
    });
  });
});
