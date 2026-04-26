// Code generated from integration-test-data/tests/eval/get.yaml. DO NOT EDIT.
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

describe("get", () => {

  it("get returns a found value for key", () => {
    const __actual = resolveCase("my-test-key", {});
    expect(__actual).toBe("my-test-value");
  });

  it("get returns nil if value not found", () => {
    const __actual = resolveCase("my-missing-key", {});
    expect(__actual).toBe(undefined);
  });

  it("get returns a default for a missing value if a default is given", () => {
    const __actual = resolveCase("my-missing-key", {});
    expect(__actual).toBe("DEFAULT");
  });

  it("get ignores a provided default if the key is found", () => {
    const __actual = resolveCase("my-test-key", {});
    expect(__actual).toBe("my-test-value");
  });

  it("get can return a double", () => {
    const __actual = resolveCase("my-double-key", {});
    expect(__actual).toBe(9.95);
  });

  it("get can return a string list", () => {
    const __actual = resolveCase("my-string-list-key", {});
    expect(__actual).toEqual(["a", "b", "c"]);
  });

  it("can return an override based on the default context", () => {
    const __actual = resolveCase("my-overridden-key", {});
    expect(__actual).toBe("overridden");
  });

  it("can return a value provided by an environment variable", () => {
    const __actual = resolveCase("prefab.secrets.encryption.key", {});
    expect(__actual).toBe("c87ba22d8662282abe8a0e4651327b579cb64a454ab0f4c170b45b15f049a221");
  });

  it("can return a value provided by an environment variable after type coercion", () => {
    const __actual = resolveCase("provided.a.number", {});
    expect(__actual).toBe(1234);
  });

  it("can decrypt and return a secret value (with decryption key in in env var)", () => {
    const __actual = resolveCase("a.secret.config", {});
    expect(__actual).toBe("hello.world");
  });

  it("duration 200 ms", () => {
    const __actual = resolveCase("test.duration.PT0.2S", {});
    expect(__actual).toBe(200);
  });

  it("duration 90S", () => {
    const __actual = resolveCase("test.duration.PT90S", {});
    expect(__actual).toBe(90000);
  });

  it("duration 1.5M", () => {
    const __actual = resolveCase("test.duration.PT1.5M", {});
    expect(__actual).toBe(90000);
  });

  it("duration 0.5H", () => {
    const __actual = resolveCase("test.duration.PT0.5H", {});
    expect(__actual).toBe(1800000);
  });

  it("duration test.duration.P1DT6H2M1.5S", () => {
    const __actual = resolveCase("test.duration.P1DT6H2M1.5S", {});
    expect(__actual).toBe(108121500);
  });

  it("json test", () => {
    const __actual = resolveCase("test.json", {});
    expect(__actual).toEqual({ a: 1, b: "c" });
  });

  it("get returns a native json object (not a stringified payload)", () => {
    const __actual = resolveCase("test.json", {});
    expect(__actual).toEqual({ a: 1, b: "c" });
  });

  it("list on left side test (1)", () => {
    const __actual = resolveCase("left.hand.list.test", mergeContexts({ user: { name: "james", aka: ["happy", "sleepy"] } } as Contexts));
    expect(__actual).toBe("correct");
  });

  it("list on left side test (2)", () => {
    const __actual = resolveCase("left.hand.list.test", mergeContexts({ user: { name: "james", aka: ["a", "b"] } } as Contexts));
    expect(__actual).toBe("default");
  });

  it("list on left side test opposite (1)", () => {
    const __actual = resolveCase("left.hand.test.opposite", mergeContexts({ user: { name: "james", aka: ["happy", "sleepy"] } } as Contexts));
    expect(__actual).toBe("default");
  });

  it("list on left side test (3)", () => {
    const __actual = resolveCase("left.hand.test.opposite", mergeContexts({ user: { name: "james", aka: ["a", "b"] } } as Contexts));
    expect(__actual).toBe("correct");
  });
});
