// Code generated from integration-test-data/tests/eval/get_or_raise.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";

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

describe("get_or_raise", () => {

  it("get_or_raise can raise an error if value not found", () => {
    runRaiseCase("my-missing-key", {}, "missing_default", Error);
  });

  it("get_or_raise returns a default value instead of raising", () => {
    const __actual = resolveCase("my-missing-key", {});
    expect(__actual).toBe("DEFAULT");
  });

  it("get_or_raise raises the correct error if it doesn't raise on init timeout", () => {
    runRaiseCase("any-key", {}, "missing_default", Error);
  });

  it("get_or_raise can raise an error if the client does not initialize in time", () => {
    runRaiseCase("any-key", {}, "initialization_timeout", Error);
  });

  it("raises an error if a config is provided by a missing environment variable", () => {
    runRaiseCase("provided.by.missing.env.var", {}, "missing_env_var", Error);
  });

  it("raises an error if an env-var-provided config cannot be coerced to configured type", () => {
    runRaiseCase("provided.not.a.number", {}, "unable_to_coerce_env_var", Error);
  });

  it("raises an error for decryption failure", () => {
    runRaiseCase("a.broken.secret.config", {}, "unable_to_decrypt", Error);
  });
});
