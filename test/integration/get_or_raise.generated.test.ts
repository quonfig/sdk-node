// Code generated from integration-test-data/tests/eval/get_or_raise.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";

function resolveCase(key: string, contexts: any): unknown {
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

function getCase(key: string, contexts: any, defaultValue: unknown): unknown {
  const v = resolveCase(key, contexts);
  return v === undefined ? defaultValue : v;
}

function enabledCase(key: string, contexts: any): boolean {
  const v = resolveCase(key, contexts);
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return false;
}

function runRaiseCase(
  key: string,
  contexts: any,
  _errorKey: string,
  errClass: ErrorConstructor,
): void {
  expect(() => {
    const cfg = store.get(key);
    if (!cfg) throw new Error(`config not found for key: ${key}`);
    const match = evaluator.evaluateConfig(cfg, envID, contexts);
    if (!match.isMatch || !match.value) throw new Error(`no match for key: ${key}`);
    const { resolved } = resolver.resolveValue(
      match.value, cfg.key, cfg.valueType, envID, contexts
    );
    return resolver.unwrapValue(resolved);
  }).toThrow(errClass);
}

async function assertInitializationTimeoutError(key: string, timeoutSec: number, apiURL: string, _onInitFailure: string): Promise<void> {
  const { Quonfig } = await import("../../src/quonfig");
  // Use 10.255.255.1 (RFC5737-style unreachable IP) so the fetch hangs and the init timer wins.
  const targetURL = "http://10.255.255.1:8080";
  const client = new Quonfig({ sdkKey: "test-unused", apiUrls: [targetURL], enableSSE: false, enablePolling: false, initTimeout: Math.max(1, Math.floor(timeoutSec * 1000)) });
  await expect(client.init()).rejects.toThrow(/initialization|timeout|timed out/i);
}

async function assertClientConstructionRaises(key: string, timeoutSec: number, apiURL: string, _onInitFailure: string, _fn: string, errClass: any): Promise<void> {
  const { Quonfig } = await import("../../src/quonfig");
  const targetURL = "http://10.255.255.1:8080";
  const client = new Quonfig({ sdkKey: "test-unused", apiUrls: [targetURL], enableSSE: false, enablePolling: false, initTimeout: Math.max(1, Math.floor(timeoutSec * 1000)), onNoDefault: "error" });
  try { await client.init(); } catch {}
  expect(() => client.get(key)).toThrow(errClass);
}

async function assertClientConstructionValue(key: string, timeoutSec: number, apiURL: string, _onInitFailure: string, _fn: string): Promise<unknown> {
  const { Quonfig } = await import("../../src/quonfig");
  const targetURL = "http://10.255.255.1:8080";
  const client = new Quonfig({ sdkKey: "test-unused", apiUrls: [targetURL], enableSSE: false, enablePolling: false, initTimeout: Math.max(1, Math.floor(timeoutSec * 1000)) });
  try { await client.init(); } catch {}
  return client.get(key);
}

describe("get_or_raise", () => {

  it("get_or_raise can raise an error if value not found", () => {
    runRaiseCase("my-missing-key", {}, "missing_default", Error);
  });

  it("get_or_raise returns a default value instead of raising", () => {
    const __actual = getCase("my-missing-key", {}, "DEFAULT");
    expect(__actual).toBe("DEFAULT");
  });

  it("get_or_raise raises the correct error if it doesn't raise on init timeout", async () => {
    await assertClientConstructionRaises("any-key", 0.01, "https://app.staging-prefab.cloud", "return", "get_or_raise", Error);
  });

  it("get_or_raise can raise an error if the client does not initialize in time", async () => {
    await assertInitializationTimeoutError("any-key", 0.01, "https://app.staging-prefab.cloud", "raise");
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
