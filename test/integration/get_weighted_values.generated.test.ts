// Code generated from integration-test-data/tests/eval/get_weighted_values.yaml. DO NOT EDIT.
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
  const { resolved } = resolver.resolveValue(match.value, cfg.key, cfg.valueType, envID, contexts);
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
  errClass: ErrorConstructor
): void {
  expect(() => {
    const cfg = store.get(key);
    if (!cfg) throw new Error(`config not found for key: ${key}`);
    const match = evaluator.evaluateConfig(cfg, envID, contexts);
    if (!match.isMatch || !match.value) throw new Error(`no match for key: ${key}`);
    const { resolved } = resolver.resolveValue(
      match.value,
      cfg.key,
      cfg.valueType,
      envID,
      contexts
    );
    return resolver.unwrapValue(resolved);
  }).toThrow(errClass);
}

describe("get_weighted_values", () => {
  it("weighted value is consistent 1", () => {
    const __actual = resolveCase(
      "feature-flag.weighted",
      mergeContexts({ user: { tracking_id: "a72c15f5" } } as Contexts)
    );
    expect(__actual).toBe(1);
  });

  it("weighted value is consistent 2", () => {
    const __actual = resolveCase(
      "feature-flag.weighted",
      mergeContexts({ user: { tracking_id: "92a202f2" } } as Contexts)
    );
    expect(__actual).toBe(2);
  });

  it("weighted value is consistent 3", () => {
    const __actual = resolveCase(
      "feature-flag.weighted",
      mergeContexts({ user: { tracking_id: "8f414100" } } as Contexts)
    );
    expect(__actual).toBe(3);
  });

  it("even split ones serves first variant at low hash fraction", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.even-split-ones",
      mergeContexts({ user: { tracking_id: "b7ff78c8" } } as Contexts)
    );
    expect(__actual).toBe("a");
  });

  it("even split ones serves first variant at low hash fraction 2", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.even-split-ones",
      mergeContexts({ user: { tracking_id: "289f4748" } } as Contexts)
    );
    expect(__actual).toBe("a");
  });

  it("even split ones serves second variant at high hash fraction", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.even-split-ones",
      mergeContexts({ user: { tracking_id: "d60b2cb6" } } as Contexts)
    );
    expect(__actual).toBe("b");
  });

  it("even split ones serves second variant at high hash fraction 2", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.even-split-ones",
      mergeContexts({ user: { tracking_id: "21bcfd13" } } as Contexts)
    );
    expect(__actual).toBe("b");
  });

  it("non-standard sum still serves normalized true bucket", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.non-standard",
      mergeContexts({ user: { tracking_id: "ff8adf17" } } as Contexts)
    );
    expect(__actual).toBe(true);
  });

  it("non-standard sum still serves normalized true bucket 2", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.non-standard",
      mergeContexts({ user: { tracking_id: "36ef1a7a" } } as Contexts)
    );
    expect(__actual).toBe(true);
  });

  it("non-standard sum still serves normalized false bucket", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.non-standard",
      mergeContexts({ user: { tracking_id: "f667c76a" } } as Contexts)
    );
    expect(__actual).toBe(false);
  });

  it("non-standard sum still serves normalized false bucket 2", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.non-standard",
      mergeContexts({ user: { tracking_id: "7467ca21" } } as Contexts)
    );
    expect(__actual).toBe(false);
  });

  it("weighted value with hash property missing from context hashes empty string", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.missing-hash",
      mergeContexts({ user: { key: "no-tracking-id-user" } } as Contexts)
    );
    expect(__actual).toBe(2);
  });

  it("weighted value with no context hashes empty string", () => {
    const __actual = resolveCase("feature-flag.weighted.missing-hash", {});
    expect(__actual).toBe(2);
  });

  it("weighted value with hash property empty string hashes empty string", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.missing-hash",
      mergeContexts({ user: { key: "empty-tracking-id-user", tracking_id: "" } } as Contexts)
    );
    expect(__actual).toBe(2);
  });

  it("weighted value with zero-weight first variant and hash property missing never serves zero-weight variant", () => {
    const __actual = resolveCase(
      "feature-flag.weighted.zero-first",
      mergeContexts({ user: { key: "no-tracking-id-user" } } as Contexts)
    );
    expect(__actual).toBe(2);
  });

  it("weighted value with no hash property is random on every evaluation", () => {
    const __seen = new Set<unknown>();
    for (let __i = 0; __i < 200; __i++) {
      __seen.add(resolveCase("feature-flag.weighted.no-hash", {}));
    }
    expect(__seen).toEqual(new Set([1, 2]));
  });

  it("weighted value with no hash property is random on every evaluation with context", () => {
    const __seen = new Set<unknown>();
    for (let __i = 0; __i < 200; __i++) {
      __seen.add(
        resolveCase(
          "feature-flag.weighted.no-hash",
          mergeContexts({
            user: { key: "same-user-every-time", tracking_id: "same-tracking-id" },
          } as Contexts)
        )
      );
    }
    expect(__seen).toEqual(new Set([1, 2]));
  });
});
