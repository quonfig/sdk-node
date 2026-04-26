// Code generated from integration-test-data/tests/eval/context_precedence.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

function resolveCase(key: string, contexts: any): unknown {
  const cfg = store.get(key);
  if (!cfg) throw new Error(`config not found for key: ${key}`);
  const match = evaluator.evaluateConfig(cfg, envID, contexts);
  if (!match.isMatch || !match.value) {
    throw new Error(`no match for key: ${key}`);
  }
  const { resolved } = resolver.resolveValue(
    match.value,
    cfg.key,
    cfg.valueType,
    envID,
    contexts
  );
  return resolver.unwrapValue(resolved);
}

function runRaiseCase(
  key: string,
  contexts: any,
  _errorKey: string,
  errClass: ErrorConstructor,
): void {
  expect(() => resolveCase(key, contexts)).toThrow(errClass);
}

describe("context_precedence", () => {

  it("returns the correct `flag` value using the global context (1)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "verified" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns the correct `flag` value using the global context (2)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "?" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns the correct `flag` value when local context clobbers global context (1)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "verified" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns the correct `flag` value when local context clobbers global context (2)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "?" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns the correct `flag` value when block context clobbers global context (1)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "?" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns the correct `flag` value when block context clobbers global context (2)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "verified" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns the correct `flag` value when local context clobbers block context (1)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "?" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("returns the correct `flag` value when local context clobbers block context (2)", () => {
    const __actual = resolveCase("mixed.case.property.name", mergeContexts({ user: { isHuman: "verified" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("returns the correct `get` value using the global context (1)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@prefab.cloud" } } as Contexts));
    expect(__actual).toBe("override");
  });

  it("returns the correct `get` value using the global context (2)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@example.com" } } as Contexts));
    expect(__actual).toBe("default");
  });

  it("returns the correct `get` value when local context clobbers global context (1)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@prefab.cloud" } } as Contexts));
    expect(__actual).toBe("override");
  });

  it("returns the correct `get` value when local context clobbers global context (2)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@example.com" } } as Contexts));
    expect(__actual).toBe("default");
  });

  it("returns the correct `get` value when block context clobbers global context (1)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@example.com" } } as Contexts));
    expect(__actual).toBe("default");
  });

  it("returns the correct `get` value when block context clobbers global context (2)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@prefab.cloud" } } as Contexts));
    expect(__actual).toBe("override");
  });

  it("returns the correct `get` value when local context clobbers block context (1)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@example.com" } } as Contexts));
    expect(__actual).toBe("default");
  });

  it("returns the correct `get` value when local context clobbers block context (2)", () => {
    const __actual = resolveCase("basic.rule.config", mergeContexts({ user: { email: "test@prefab.cloud" } } as Contexts));
    expect(__actual).toBe("override");
  });
});
