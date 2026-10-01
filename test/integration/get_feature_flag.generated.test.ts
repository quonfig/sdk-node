// Code generated from integration-test-data/tests/eval/get_feature_flag.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient } from "./setup";

describe("get_feature_flag", () => {
  it("get returns the underlying value for a feature flag", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("feature-flag.integer")).toBe(3);
    });
  });

  it("get returns the underlying value for a feature flag that matches the highest precedent rule", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("feature-flag.integer", { user: { key: "michael" } })).toBe(5);
    });
  });
});
