// Code generated from integration-test-data/tests/eval/get_feature_flag.yaml. DO NOT EDIT.
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

describe("get_feature_flag", () => {

  it("get returns the underlying value for a feature flag", () => {
    const __actual = resolveCase("feature-flag.integer", {});
    expect(__actual).toBe(3);
  });

  it("get returns the underlying value for a feature flag that matches the highest precedent rule", () => {
    const __actual = resolveCase("feature-flag.integer", mergeContexts({ user: { key: "michael" } } as Contexts));
    expect(__actual).toBe(5);
  });
});
