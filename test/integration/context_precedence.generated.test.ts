// Code generated from integration-test-data/tests/eval/context_precedence.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

/**
 * Helper: evaluate a feature flag with the "enabled" semantics.
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

/**
 * Helper: evaluate a config key with the "get" semantics.
 */
function evaluateGet(
  key: string,
  contexts: Contexts
): string | number | boolean | string[] | undefined {
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

describe("context_precedence", () => {
  // enabled tests
  it("returns the correct `flag` value using the global context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { isHuman: "verified" } } // global
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(true);
  });

  it("returns the correct `flag` value using the global context (2)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { isHuman: "?" } } // global
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(false);
  });

  it("returns the correct `flag` value when local context clobbers global context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { isHuman: "?" } }, // global
      undefined, // block
      { user: { isHuman: "verified" } } // local
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(true);
  });

  it("returns the correct `flag` value when local context clobbers global context (2)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { isHuman: "verified" } }, // global
      undefined, // block
      { user: { isHuman: "?" } } // local
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(false);
  });

  it("returns the correct `flag` value when block context clobbers global context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { isHuman: "verified" } }, // global
      { user: { isHuman: "?" } } // block
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(false);
  });

  it("returns the correct `flag` value when block context clobbers global context (2)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { isHuman: "?" } }, // global
      { user: { isHuman: "verified" } } // block
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(true);
  });

  it("returns the correct `flag` value when local context clobbers block context (1)", () => {
    const contexts: Contexts = mergeContexts(
      undefined, // global
      { user: { isHuman: "verified" } }, // block
      { user: { isHuman: "?" } } // local
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(false);
  });

  it("returns the correct `flag` value when local context clobbers block context (2)", () => {
    const contexts: Contexts = mergeContexts(
      undefined, // global
      { user: { isHuman: "?" } }, // block
      { user: { isHuman: "verified" } } // local
    );
    expect(evaluateEnabled("mixed.case.property.name", contexts)).toBe(true);
  });

  // get tests
  it("returns the correct `get` value using the global context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@prefab.cloud" } } // global
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("override");
  });

  it("returns the correct `get` value using the global context (2)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@example.com" } } // global
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("default");
  });

  it("returns the correct `get` value using the global context and api context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@prefab.cloud" } } // global
    );
    expect(evaluateGet("basic.rule.config.with.api.conditional", contexts)).toBe("override");
  });

  it.skip("returns the correct `get` value using the global context and api context (2)", () => {
    // Skipping: this config has a prefab-api-key.user-id rule that matches "api-override"
    // which is API-injected and not available in local eval. Without API context,
    // the ALWAYS_TRUE fallback produces "default" but the test expects "api-override".
    // The Go SDK also skips this test for the same reason.
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@example.com" } } // global
    );
    const value = evaluateGet("basic.rule.config.with.api.conditional", contexts);
    expect(value).toBe("api-override");
  });

  it("returns the correct `get` value when local context clobbers global context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@example.com" } }, // global
      undefined, // block
      { user: { email: "test@prefab.cloud" } } // local
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("override");
  });

  it("returns the correct `get` value when local context clobbers global context (2)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@prefab.cloud" } }, // global
      undefined, // block
      { user: { email: "test@example.com" } } // local
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("default");
  });

  it("returns the correct `get` value when block context clobbers global context (1)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@prefab.cloud" } }, // global
      { user: { email: "test@example.com" } } // block
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("default");
  });

  it("returns the correct `get` value when block context clobbers global context (2)", () => {
    const contexts: Contexts = mergeContexts(
      { user: { email: "test@example.com" } }, // global
      { user: { email: "test@prefab.cloud" } } // block
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("override");
  });

  it("returns the correct `get` value when local context clobbers block context (1)", () => {
    const contexts: Contexts = mergeContexts(
      undefined, // global
      { user: { email: "test@prefab.cloud" } }, // block
      { user: { email: "test@example.com" } } // local
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("default");
  });

  it("returns the correct `get` value when local context clobbers block context (2)", () => {
    const contexts: Contexts = mergeContexts(
      undefined, // global
      { user: { email: "test@example.com" } }, // block
      { user: { email: "test@prefab.cloud" } } // local
    );
    expect(evaluateGet("basic.rule.config", contexts)).toBe("override");
  });
});
