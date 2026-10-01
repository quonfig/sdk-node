// Code generated from integration-test-data/tests/eval/context_precedence.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient } from "./setup";

describe("context_precedence", () => {
  it("returns the correct `flag` value using the global context (1)", async () => {
    await withClient({ globalContext: { user: { isHuman: "verified" } } }, (client) => {
      expect(client.isEnabled("mixed.case.property.name")).toBe(true);
    });
  });

  it("returns the correct `flag` value using the global context (2)", async () => {
    await withClient({ globalContext: { user: { isHuman: "?" } } }, (client) => {
      expect(client.isEnabled("mixed.case.property.name")).toBe(false);
    });
  });

  it("returns the correct `flag` value when local context clobbers global context (1)", async () => {
    await withClient({ globalContext: { user: { isHuman: "?" } } }, (client) => {
      expect(client.isEnabled("mixed.case.property.name", { user: { isHuman: "verified" } })).toBe(
        true
      );
    });
  });

  it("returns the correct `flag` value when local context clobbers global context (2)", async () => {
    await withClient({ globalContext: { user: { isHuman: "verified" } } }, (client) => {
      expect(client.isEnabled("mixed.case.property.name", { user: { isHuman: "?" } })).toBe(false);
    });
  });

  it("returns the correct `flag` value when block context clobbers global context (1)", async () => {
    await withClient({ globalContext: { user: { isHuman: "verified" } } }, (client) => {
      const scope = client.withContext({ user: { isHuman: "?" } });
      expect(scope.isEnabled("mixed.case.property.name")).toBe(false);
    });
  });

  it("returns the correct `flag` value when block context clobbers global context (2)", async () => {
    await withClient({ globalContext: { user: { isHuman: "?" } } }, (client) => {
      const scope = client.withContext({ user: { isHuman: "verified" } });
      expect(scope.isEnabled("mixed.case.property.name")).toBe(true);
    });
  });

  it("returns the correct `flag` value when local context clobbers block context (1)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { isHuman: "verified" } });
      expect(scope.isEnabled("mixed.case.property.name", { user: { isHuman: "?" } })).toBe(false);
    });
  });

  it("returns the correct `flag` value when local context clobbers block context (2)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { isHuman: "?" } });
      expect(scope.isEnabled("mixed.case.property.name", { user: { isHuman: "verified" } })).toBe(
        true
      );
    });
  });

  it("returns the correct `get` value using the global context (1)", async () => {
    await withClient({ globalContext: { user: { email: "test@prefab.cloud" } } }, (client) => {
      expect(client.getString("basic.rule.config")).toBe("override");
    });
  });

  it("returns the correct `get` value using the global context (2)", async () => {
    await withClient({ globalContext: { user: { email: "test@example.com" } } }, (client) => {
      expect(client.getString("basic.rule.config")).toBe("default");
    });
  });

  it("returns the correct `get` value when local context clobbers global context (1)", async () => {
    await withClient({ globalContext: { user: { email: "test@example.com" } } }, (client) => {
      expect(client.getString("basic.rule.config", { user: { email: "test@prefab.cloud" } })).toBe(
        "override"
      );
    });
  });

  it("returns the correct `get` value when local context clobbers global context (2)", async () => {
    await withClient({ globalContext: { user: { email: "test@prefab.cloud" } } }, (client) => {
      expect(client.getString("basic.rule.config", { user: { email: "test@example.com" } })).toBe(
        "default"
      );
    });
  });

  it("returns the correct `get` value when block context clobbers global context (1)", async () => {
    await withClient({ globalContext: { user: { email: "test@prefab.cloud" } } }, (client) => {
      const scope = client.withContext({ user: { email: "test@example.com" } });
      expect(scope.getString("basic.rule.config")).toBe("default");
    });
  });

  it("returns the correct `get` value when block context clobbers global context (2)", async () => {
    await withClient({ globalContext: { user: { email: "test@example.com" } } }, (client) => {
      const scope = client.withContext({ user: { email: "test@prefab.cloud" } });
      expect(scope.getString("basic.rule.config")).toBe("override");
    });
  });

  it("returns the correct `get` value when local context clobbers block context (1)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "test@prefab.cloud" } });
      expect(scope.getString("basic.rule.config", { user: { email: "test@example.com" } })).toBe(
        "default"
      );
    });
  });

  it("returns the correct `get` value when local context clobbers block context (2)", async () => {
    await withClient({}, (client) => {
      const scope = client.withContext({ user: { email: "test@example.com" } });
      expect(scope.getString("basic.rule.config", { user: { email: "test@prefab.cloud" } })).toBe(
        "override"
      );
    });
  });

  it("returns the correct `get` value when local context replaces the whole global named context (disjoint attributes)", async () => {
    await withClient({ globalContext: { user: { email: "test@prefab.cloud" } } }, (client) => {
      expect(client.getString("basic.rule.config", { user: { plan: "pro" } })).toBe("default");
    });
  });

  it("returns the correct `get` value when a named context the local context does not mention survives", async () => {
    await withClient({ globalContext: { user: { email: "test@prefab.cloud" } } }, (client) => {
      expect(client.getString("basic.rule.config", { team: { plan: "pro" } })).toBe("override");
    });
  });
});
