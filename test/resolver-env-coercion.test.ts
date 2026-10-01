// ENV_VAR coercion through the Resolver (qfg-2agi.22).
//
// An env var that is not a whole number must fail coercion for an int config,
// and one that is not a number must fail for a double config, instead of
// parseInt/parseFloat reading a numeric prefix ("30s" -> 30). A valid ENV_VAR
// duration unwraps to integer milliseconds, the same as a stored one.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Resolver } from "../src/resolver";
import { ConfigStore } from "../src/store";
import { Evaluator } from "../src/evaluator";
import type { Value, ValueType } from "../src/types";

const VAR = "QUONFIG_TEST_RESOLVER_ENV_COERCION";

describe("Resolver ENV_VAR coercion", () => {
  const store = new ConfigStore();
  const resolver = new Resolver(store, new Evaluator(store));
  const provided: Value = { type: "provided", value: { source: "ENV_VAR", lookup: VAR } } as Value;

  function resolveEnv(envValue: string, valueType: ValueType): unknown {
    process.env[VAR] = envValue;
    const { resolved } = resolver.resolveValue(provided, "some.key", valueType, "env", {});
    return resolver.unwrapValue(resolved);
  }

  beforeAll(() => {
    delete process.env[VAR];
  });
  afterAll(() => {
    delete process.env[VAR];
  });

  it.each([
    ["42", 42],
    ["-7", -7],
    [" 12 ", 12],
  ])("int: %j -> %d", (raw, expected) => {
    expect(resolveEnv(raw, "int")).toBe(expected);
  });

  it.each(["30s", "1.5", "12abc", "", "abc", "0x10"])("int: %j fails coercion", (raw) => {
    expect(() => resolveEnv(raw, "int")).toThrow(/Cannot convert/);
  });

  it.each([
    ["3.14", 3.14],
    ["-2", -2],
    [".5", 0.5],
    ["1e3", 1000],
  ])("double: %j -> %d", (raw, expected) => {
    expect(resolveEnv(raw, "double")).toBe(expected);
  });

  it.each(["30s", "1.5x", "", "abc", "0x10", "Infinity"])("double: %j fails coercion", (raw) => {
    expect(() => resolveEnv(raw, "double")).toThrow(/Cannot convert/);
  });

  it("duration: a valid ENV_VAR value unwraps to integer milliseconds", () => {
    expect(resolveEnv("PT1.5S", "duration")).toBe(1500);
    expect(resolveEnv("PT30M", "duration")).toBe(1_800_000);
  });
});
