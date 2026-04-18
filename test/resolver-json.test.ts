import { describe, it, expect } from "vitest";
import { Resolver } from "../src/resolver";
import { ConfigStore } from "../src/store";
import { Evaluator } from "../src/evaluator";
import type { Value } from "../src/types";

// These tests lock in the post-migration contract:
// `valueType: "json"` values carry native JS structures on Value.value.
// unwrapValue() must be a pass-through — never JSON.parse() the payload.

describe("Resolver unwrapValue json", () => {
  const store = new ConfigStore();
  const evaluator = new Evaluator(store);
  const resolver = new Resolver(store, evaluator);

  it("returns the native object for valueType=json (object)", () => {
    const val: Value = { type: "json", value: { a: 1, b: "c" } };
    expect(resolver.unwrapValue(val)).toEqual({ a: 1, b: "c" });
  });

  it("returns the native array for valueType=json (array)", () => {
    const val: Value = { type: "json", value: [1, 2, 3] };
    expect(resolver.unwrapValue(val)).toEqual([1, 2, 3]);
  });

  it("returns native primitives for valueType=json (number / null / boolean)", () => {
    expect(resolver.unwrapValue({ type: "json", value: 42 })).toBe(42);
    expect(resolver.unwrapValue({ type: "json", value: null })).toBeNull();
    expect(resolver.unwrapValue({ type: "json", value: true })).toBe(true);
  });

  it("throws on stringified JSON — strict wire contract, matches sdk-go / sdk-python", () => {
    // Post-migration: stringified JSON is illegal wire format. The SDK
    // must reject it loudly rather than silently JSON.parse-ing or passing
    // through — matches sdk-go (unmarshal reject) and sdk-python
    // (QuonfigValueTypeError).
    const stringified = '{"a":1,"b":"c"}';
    const val: Value = { type: "json", value: stringified };
    expect(() => resolver.unwrapValue(val)).toThrow(
      /json value must be a native JSON type/
    );
  });
});
