// Code generated from integration-test-data/tests/eval/dev_overrides.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient } from "./setup";

describe("dev_overrides", () => {
  it("override fires when quonfig-user.email matches", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "quonfig-user": { email: "bob@foo.com" } });
      expect(scope.isEnabled("feature-flag.dev-override")).toBe(true);
    });
  });

  it("override does not fire when attribute absent (prod simulation)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "bob@foo.com" } });
      expect(scope.isEnabled("feature-flag.dev-override")).toBe(false);
    });
  });

  it("override matches any email in IS_ONE_OF list", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ "quonfig-user": { email: "alice@foo.com" } });
      expect(scope.isEnabled("feature-flag.dev-override.multi-email")).toBe(true);
    });
  });

  it("override beats customer rule by priority", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({
        "quonfig-user": { email: "bob@foo.com" },
        user: { country: "DE" },
      });
      expect(scope.isEnabled("feature-flag.dev-override.priority")).toBe(true);
    });
  });
});
