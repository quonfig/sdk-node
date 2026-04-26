// Code generated from integration-test-data/tests/eval/dev_overrides.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";

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

describe("dev_overrides", () => {

  it("override fires when quonfig-user.email matches", () => {
    const __actual = enabledCase("feature-flag.dev-override", mergeContexts({ "quonfig-user": { email: "bob@foo.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("override does not fire when attribute absent (prod simulation)", () => {
    const __actual = enabledCase("feature-flag.dev-override", mergeContexts({ user: { email: "bob@foo.com" } } as Contexts));
    expect(__actual).toBe(false);
  });

  it("override matches any email in IS_ONE_OF list", () => {
    const __actual = enabledCase("feature-flag.dev-override.multi-email", mergeContexts({ "quonfig-user": { email: "alice@foo.com" } } as Contexts));
    expect(__actual).toBe(true);
  });

  it("override beats customer rule by priority", () => {
    const __actual = enabledCase("feature-flag.dev-override.priority", mergeContexts({ "quonfig-user": { email: "bob@foo.com" }, user: { country: "DE" } } as Contexts));
    expect(__actual).toBe(true);
  });
});
