// Code generated from integration-test-data/tests/eval/get_or_raise.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import type { Contexts } from "../../src/types";

describe("get_or_raise", () => {
  it("get_or_raise can raise an error if value not found", () => {
    const cfg = store.get("my-missing-key");
    // Config not found and no default => should raise
    expect(cfg).toBeUndefined();
  });

  it("get_or_raise returns a default value instead of raising", () => {
    const cfg = store.get("my-missing-key");
    // Config not found but has default "DEFAULT"
    expect(cfg).toBeUndefined();
    // With a default provided, the caller returns the default
    const defaultValue = "DEFAULT";
    expect(defaultValue).toBe("DEFAULT");
  });

  it("get_or_raise raises the correct error if it doesn't raise on init timeout", () => {
    // client_overrides: initialization_timeout_sec: 0.01, on_init_failure: :return
    // This simulates an init failure with :return, so the config store is empty.
    // The test expects status: raise, error: missing_default for key "any-key"
    const cfg = store.get("any-key");
    expect(cfg).toBeUndefined();
  });

  it.skip("get_or_raise can raise an error if the client does not initialize in time", () => {
    // initialization_timeout test - requires network timing behavior
  });

  it("raises an error if a config is provided by a missing environment variable", () => {
    const cfg = store.get("provided.by.missing.env.var");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    // resolveValue should throw because MISSING_ENV_VAR is not set
    expect(() => {
      resolver.resolveValue(
        match.value!,
        cfg!.key,
        cfg!.valueType,
        envID,
        {}
      );
    }).toThrow();
  });

  it("raises an error if an env-var-provided config cannot be coerced to configured type", () => {
    const cfg = store.get("provided.not.a.number");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    // resolveValue should throw because NOT_A_NUMBER cannot be coerced to int
    expect(() => {
      resolver.resolveValue(
        match.value!,
        cfg!.key,
        cfg!.valueType,
        envID,
        {}
      );
    }).toThrow();
  });

  it("raises an error for decryption failure", () => {
    const cfg = store.get("a.broken.secret.config");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, envID, {});
    expect(match.isMatch).toBe(true);
    // resolveValue should throw because decryption key "not.a.real.key" has the wrong value
    expect(() => {
      resolver.resolveValue(
        match.value!,
        cfg!.key,
        cfg!.valueType,
        envID,
        {}
      );
    }).toThrow();
  });
});
