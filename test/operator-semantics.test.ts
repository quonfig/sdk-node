import { describe, it, expect } from "vitest";
import { evaluateCriterion } from "../src";

// qfg-goi1.5 R5 (strict timestamp grammar, both sides) and Q5 (abbreviated
// semver), plus runtime-float inputs the ITD generators cannot carry.

function evalOp(operator: string, contextValue: unknown, type: string, value: unknown): boolean {
  return evaluateCriterion(contextValue, true, {
    operator,
    propertyName: "user.p",
    valueToMatch: { type, value } as any,
  });
}

const before = (ctx: unknown, crit: unknown, type = "string") =>
  evalOp("PROP_BEFORE", ctx, type, crit);
const after = (ctx: unknown, crit: unknown, type = "string") =>
  evalOp("PROP_AFTER", ctx, type, crit);

describe("R5 timestamp grammar", () => {
  const NOV_1_2024 = 1730419200000;

  it("accepts epoch-ms numbers, all-digit strings and RFC3339 with Z/offset", () => {
    expect(before(NOV_1_2024 - 1, NOV_1_2024, "int")).toBe(true);
    expect(before(String(NOV_1_2024 - 1), String(NOV_1_2024))).toBe(true);
    expect(before("2024-10-31T23:59:59Z", NOV_1_2024, "int")).toBe(true);
    expect(before("2024-11-01T01:59:59.999+02:00", NOV_1_2024, "int")).toBe(true);
    expect(before(NOV_1_2024 - 1, "2024-11-01T00:00:00Z")).toBe(true);
    expect(after("-5", "-10")).toBe(true);
  });

  it("rejects date-only, offset-less and free-form strings on the context side", () => {
    for (const ctx of ["2020-01-01", "2020-01-01T00:00:00", "Jan 1 2020", "2020-01-01 00:00:00Z"]) {
      expect(before(ctx, NOV_1_2024, "int")).toBe(false);
      expect(after(ctx, 0, "int")).toBe(false);
    }
  });

  it("rejects date-only, offset-less and free-form strings on the criterion side", () => {
    for (const crit of ["2050-01-01", "2050-01-01T00:00:00", "Jan 1 2050"]) {
      expect(before(1000, crit)).toBe(false);
      expect(after(1000, crit)).toBe(false);
    }
  });

  it('reads an all-digit criterion "999" as epoch ms, not the year 999', () => {
    expect(after(500, "999")).toBe(false);
    expect(after(1000, "999")).toBe(true);
  });

  it("rejects out-of-range RFC3339 fields and lowercase t/z", () => {
    expect(before("2024-02-30T00:00:00Z", NOV_1_2024, "int")).toBe(false);
    expect(before("2024-01-01T24:00:00Z", NOV_1_2024, "int")).toBe(false);
    expect(before("2024-01-01t00:00:00z", NOV_1_2024, "int")).toBe(false);
  });

  it("rejects mixed digit strings and non-finite numbers", () => {
    expect(before("123abc", NOV_1_2024, "int")).toBe(false);
    expect(before(NaN, NOV_1_2024, "int")).toBe(false);
    expect(before(-Infinity, NOV_1_2024, "int")).toBe(false);
  });

  it("truncates fractional epoch ms (runtime floats)", () => {
    expect(before(1000.9, 1000, "int")).toBe(false);
    expect(after(5e9, 1e9, "int")).toBe(true);
  });
});

describe("Q5 abbreviated semver", () => {
  const eq = (ctx: string, crit: string) => evalOp("PROP_SEMVER_EQUAL", ctx, "string", crit);
  const lt = (ctx: string, crit: string) => evalOp("PROP_SEMVER_LESS_THAN", ctx, "string", crit);
  const gt = (ctx: string, crit: string) => evalOp("PROP_SEMVER_GREATER_THAN", ctx, "string", crit);

  it('reads "2" and "2.0" as 2.0.0 on both sides', () => {
    expect(eq("2", "2.0.0")).toBe(true);
    expect(eq("2.0", "2.0.0")).toBe(true);
    expect(eq("2.0.0", "2")).toBe(true);
    expect(lt("4.1", "4.1.1")).toBe(true);
    expect(gt("4.2", "4.1.9")).toBe(true);
    expect(lt("2.0.0-beta", "2")).toBe(true);
  });

  it("still rejects v prefixes, leading zeros and abbreviated prerelease", () => {
    expect(eq("v2.0.0", "2.0.0")).toBe(false);
    expect(eq("02", "2.0.0")).toBe(false);
    expect(eq("2-beta", "2.0.0-beta")).toBe(false);
    expect(eq("2.", "2.0.0")).toBe(false);
  });
});

describe("runtime float inputs to string operators", () => {
  it("stringifies whole-number floats as plain digits", () => {
    expect(evalOp("PROP_IS_ONE_OF", 1.0, "string_list", ["1"])).toBe(true);
    expect(evalOp("PROP_IS_ONE_OF", 1234567.0, "string_list", ["1234567"])).toBe(true);
    expect(evalOp("PROP_IS_ONE_OF", 5e9, "string_list", ["5000000000"])).toBe(true);
  });
});
