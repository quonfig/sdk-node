import { describe, it, expect } from "vitest";
import { evaluateCriterion, OP_IS_PRESENT, OP_IS_NOT_PRESENT, getContextValue } from "../src";
import type { Contexts } from "../src/types";

function evalPresence(
  contexts: Contexts,
  propertyName: string,
  operator: typeof OP_IS_PRESENT | typeof OP_IS_NOT_PRESENT
): boolean {
  const { value, exists } = getContextValue(contexts, propertyName);
  return evaluateCriterion(value, exists, { operator, propertyName });
}

describe("IS_PRESENT / IS_NOT_PRESENT", () => {
  describe("IS_PRESENT", () => {
    it("returns true for a non-empty string", () => {
      expect(evalPresence({ user: { id: "abc" } }, "user.id", OP_IS_PRESENT)).toBe(true);
    });

    it("returns true for an empty string (the field IS set)", () => {
      expect(evalPresence({ user: { id: "" } }, "user.id", OP_IS_PRESENT)).toBe(true);
    });

    it("returns true for the integer zero", () => {
      expect(evalPresence({ user: { id: 0 } }, "user.id", OP_IS_PRESENT)).toBe(true);
    });

    it("returns true for boolean false", () => {
      expect(evalPresence({ user: { id: false } }, "user.id", OP_IS_PRESENT)).toBe(true);
    });

    it("returns false for null", () => {
      expect(evalPresence({ user: { id: null as any } }, "user.id", OP_IS_PRESENT)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(evalPresence({ user: { id: undefined } }, "user.id", OP_IS_PRESENT)).toBe(false);
    });

    it("returns false when the key is missing from the context", () => {
      expect(evalPresence({ user: { name: "bob" } }, "user.id", OP_IS_PRESENT)).toBe(false);
    });

    it("returns false when no contexts are provided at all", () => {
      expect(evalPresence({}, "user.id", OP_IS_PRESENT)).toBe(false);
    });

    it("returns true on a nested dotted path when the nested prop is set", () => {
      expect(
        evalPresence(
          { organization: { domain: "example.com" } },
          "organization.domain",
          OP_IS_PRESENT
        )
      ).toBe(true);
    });

    it("returns false on a nested path when the nested key is missing but parent exists", () => {
      expect(
        evalPresence({ organization: { name: "Acme" } }, "organization.domain", OP_IS_PRESENT)
      ).toBe(false);
    });

    it("returns false on a nested path when the parent context is entirely absent", () => {
      expect(evalPresence({ user: { id: "abc" } }, "organization.domain", OP_IS_PRESENT)).toBe(
        false
      );
    });
  });

  describe("IS_NOT_PRESENT", () => {
    it("returns false for a non-empty string", () => {
      expect(evalPresence({ user: { id: "abc" } }, "user.id", OP_IS_NOT_PRESENT)).toBe(false);
    });

    it("returns false for empty string (still present)", () => {
      expect(evalPresence({ user: { id: "" } }, "user.id", OP_IS_NOT_PRESENT)).toBe(false);
    });

    it("returns false for zero (still present)", () => {
      expect(evalPresence({ user: { id: 0 } }, "user.id", OP_IS_NOT_PRESENT)).toBe(false);
    });

    it("returns false for boolean false (still present)", () => {
      expect(evalPresence({ user: { id: false } }, "user.id", OP_IS_NOT_PRESENT)).toBe(false);
    });

    it("returns true for null", () => {
      expect(evalPresence({ user: { id: null as any } }, "user.id", OP_IS_NOT_PRESENT)).toBe(true);
    });

    it("returns true for undefined", () => {
      expect(evalPresence({ user: { id: undefined } }, "user.id", OP_IS_NOT_PRESENT)).toBe(true);
    });

    it("returns true when the key is missing from the context", () => {
      expect(evalPresence({ user: { name: "bob" } }, "user.id", OP_IS_NOT_PRESENT)).toBe(true);
    });

    it("returns true when the nested key is missing but parent exists", () => {
      expect(
        evalPresence({ organization: { name: "Acme" } }, "organization.domain", OP_IS_NOT_PRESENT)
      ).toBe(true);
    });

    it("returns true when the parent context is entirely absent", () => {
      expect(evalPresence({ user: { id: "abc" } }, "organization.domain", OP_IS_NOT_PRESENT)).toBe(
        true
      );
    });
  });
});
