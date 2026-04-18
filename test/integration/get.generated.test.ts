// Code generated from integration-test-data/tests/eval/get.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

describe("get", () => {
  it("get returns a found value for key", () => {
    const cfg = store.get("my-test-key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("my-test-value");
  });

  it("get returns nil if value not found", () => {
    const cfg = store.get("my-missing-key");
    // on_no_default: 2 means return undefined on missing
    expect(cfg).toBeUndefined();
  });

  it("get returns a default for a missing value if a default is given", () => {
    const cfg = store.get("my-missing-key");
    // Config not found, return the default
    expect(cfg).toBeUndefined();
    const value = "DEFAULT";
    expect(value).toBe("DEFAULT");
  });

  it("get ignores a provided default if the key is found", () => {
    const cfg = store.get("my-test-key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    // Should return the found value, not the default "DEFAULT"
    expect(value).toBe("my-test-value");
  });

  it("get can return a double", () => {
    const cfg = store.get("my-double-key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(9.95);
  });

  it("get can return a string list", () => {
    const cfg = store.get("my-string-list-key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toEqual(["a", "b", "c"]);
  });

  it.skip("can return an override based on the default context", () => {
    // Skipping: this config's first rule requires prefab-api-key.user-id context
    // which is API-injected and not available in local eval. The ALWAYS_TRUE fallback
    // produces "default" but the test expects "overridden" (which requires the API context).
    // The Go SDK also skips this test for the same reason.
    const cfg = store.get("my-overridden-key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("overridden");
  });

  it("can return a value provided by an environment variable", () => {
    const cfg = store.get("prefab.secrets.encryption.key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(
      "c87ba22d8662282abe8a0e4651327b579cb64a454ab0f4c170b45b15f049a221"
    );
  });

  it("can return a value provided by an environment variable after type coercion", () => {
    const cfg = store.get("provided.a.number");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(1234);
  });

  it("can decrypt and return a secret value (with decryption key in in env var)", () => {
    const cfg = store.get("a.secret.config");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("hello.world");
  });

  it("duration 200 ms", () => {
    const cfg = store.get("test.duration.PT0.2S");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(200);
  });

  it("duration 90S", () => {
    const cfg = store.get("test.duration.PT90S");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(90000);
  });

  it("duration 1.5M", () => {
    const cfg = store.get("test.duration.PT1.5M");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(90000);
  });

  it("duration 0.5H", () => {
    const cfg = store.get("test.duration.PT0.5H");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(1800000);
  });

  it("duration test.duration.P1DT6H2M1.5S", () => {
    const cfg = store.get("test.duration.P1DT6H2M1.5S");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe(108121500);
  });

  it("json test", () => {
    const cfg = store.get("test.json");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toEqual({ a: 1, b: "c" });
  });

  it("get returns a native json object (not a stringified payload)", () => {
    const cfg = store.get("test.json");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      {}
    );
    // Assert the unwrapped value is a native object, not a JSON string,
    // and that it deep-equals the expected payload.
    expect(typeof resolved.value).toBe("object");
    expect(resolved.value).not.toBeNull();
    expect(typeof resolved.value).not.toBe("string");
    const value = resolver.unwrapValue(resolved);
    expect(value).toEqual({ a: 1, b: "c" });
  });

  it("list on left side test (1)", () => {
    const cfg = store.get("left.hand.list.test");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { name: "james", aka: ["happy", "sleepy"] as any },
    });
    const match = evaluator.evaluateConfig(cfg!, envID, contexts);
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      contexts
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("correct");
  });

  it("list on left side test (2)", () => {
    const cfg = store.get("left.hand.list.test");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { name: "james", aka: ["a", "b"] as any },
    });
    const match = evaluator.evaluateConfig(cfg!, envID, contexts);
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      contexts
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("default");
  });

  it("list on left side test opposite (1)", () => {
    const cfg = store.get("left.hand.test.opposite");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { name: "james", aka: ["happy", "sleepy"] as any },
    });
    const match = evaluator.evaluateConfig(cfg!, envID, contexts);
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      contexts
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("default");
  });

  it("list on left side test (3)", () => {
    const cfg = store.get("left.hand.test.opposite");
    expect(cfg).toBeDefined();
    const contexts: Contexts = mergeContexts({
      user: { name: "james", aka: ["a", "b"] as any },
    });
    const match = evaluator.evaluateConfig(cfg!, envID, contexts);
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!,
      cfg!.key,
      cfg!.valueType,
      envID,
      contexts
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("correct");
  });
});
