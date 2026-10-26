// The typed-getter contract (qfg-zvyy), shared by every Quonfig SDK and pinned
// by the integration-test-data matrix (`getter.contract.*`). Each typed getter
// converts a resolved Value with one of the functions below. A value of the
// getter's type converts; anything else throws, and the client turns the
// throw into "no value" (the caller's default, else the onNoDefault policy).
//
// - No string coercion: a stored "false" is a string, never a bool; "3" is
//   never a number; "PT1S" stored as a string is never a duration.
// - Numbers convert only when exact: a number read accepts int and double; an
//   int read accepts an int, or a double holding a whole number within
//   +/-(2^53-1). 3.9, 1e300 and 2^53 are type mismatches. Never truncate.
//
// Error messages name the key and types, never the value (it may be a secret).

import type { GetValue, Value } from "./types";
import { parseDurationMillis } from "./duration";

/**
 * Thrown (under `onNoDefault: "error"`, with no default) by a typed getter
 * whose config holds a value of another type, e.g. `getBool` on a string
 * config. Also the error the `*Details` getters report as `TYPE_MISMATCH`.
 */
export class QuonfigTypeMismatchError extends Error {
  readonly key: string;
  readonly actualType: string;
  readonly expectedType: string;

  constructor(key: string, actualType: string, expectedType: string) {
    super(`Config "${key}" has type ${actualType}, expected ${expectedType}`);
    this.name = "QuonfigTypeMismatchError";
    this.key = key;
    this.actualType = actualType;
    this.expectedType = expectedType;
  }
}

/**
 * A stored value that does not parse as its declared type (an int config
 * holding "twelve", a duration config holding "30s"). Same family as an
 * ENV_VAR coercion failure; reported as `TYPE_MISMATCH` by the details API.
 */
export class QuonfigMalformedValueError extends Error {
  constructor(key: string, valueType: string) {
    super(`[quonfig] Config "${key}" has a malformed ${valueType} value`);
    this.name = "QuonfigMalformedValueError";
  }
}

/** What a typed read asks for. `number` is int-or-double (`getNumber`). */
export type ReadType = "string" | "bool" | "number" | "int" | "string_list" | "json" | "duration";

const INT_PATTERN = /^[+-]?[0-9]+$/;
const DOUBLE_PATTERN = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/** The stored type of a resolved value, as named in error messages. */
function typeName(v: Value): string {
  return String(v.type);
}

/** Parse a stored int (a JS number or its decimal text); throws when malformed. */
function storedInt(key: string, v: Value): number {
  const raw = v.value;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && INT_PATTERN.test(raw.trim())) return parseInt(raw.trim(), 10);
  throw new QuonfigMalformedValueError(key, "int");
}

/** Parse a stored double (a JS number or its decimal text); throws when malformed. */
function storedDouble(key: string, v: Value): number {
  const raw = v.value;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && DOUBLE_PATTERN.test(raw.trim())) return parseFloat(raw.trim());
  throw new QuonfigMalformedValueError(key, "double");
}

/** Convert a resolved value for the typed read `want`; throws on a mismatch. */
export function convertTyped(key: string, v: Value, want: ReadType): GetValue {
  switch (want) {
    case "string":
      if (v.type === "string" && typeof v.value === "string") return v.value;
      if (v.type === "log_level" && (typeof v.value === "string" || typeof v.value === "number")) {
        return String(v.value);
      }
      break;
    case "bool":
      if (v.type === "bool" && typeof v.value === "boolean") return v.value;
      break;
    case "number":
      if (v.type === "int") return storedInt(key, v);
      if (v.type === "double") return storedDouble(key, v);
      break;
    case "int": {
      if (v.type === "int") return storedInt(key, v);
      if (v.type === "double") {
        const f = storedDouble(key, v);
        if (Number.isInteger(f) && Math.abs(f) <= Number.MAX_SAFE_INTEGER) return f;
      }
      break;
    }
    case "string_list":
      if (v.type === "string_list" && Array.isArray(v.value)) {
        return v.value.map((s: unknown) => String(s));
      }
      break;
    case "json":
      if (v.type === "json") return jsonOf(key, v);
      break;
    case "duration":
      if (v.type === "duration" && typeof v.value === "string") {
        const ms = parseDurationMillis(v.value);
        if (ms === undefined) throw new QuonfigMalformedValueError(key, "duration");
        return ms;
      }
      break;
  }
  throw new QuonfigTypeMismatchError(key, typeName(v), want);
}

/**
 * Convert a resolved value as its own stored type, for the untyped `get()`.
 * A malformed stored int/double/duration throws like it does for a typed read.
 */
export function convertNatural(key: string, v: Value): GetValue {
  switch (v.type) {
    case "string":
      return String(v.value ?? "");
    case "bool":
      // Never `!!value`: a bool config carrying "false" is malformed, not true.
      if (typeof v.value === "boolean") return v.value;
      throw new QuonfigMalformedValueError(key, "bool");
    case "int":
      return storedInt(key, v);
    case "double":
      return storedDouble(key, v);
    case "string_list":
      return Array.isArray(v.value) ? v.value.map((s: unknown) => String(s)) : [];
    case "json":
      return jsonOf(key, v);
    case "duration":
      return convertTyped(key, v, "duration");
    case "log_level":
      return typeof v.value === "number" ? v.value : String(v.value ?? "");
    default:
      return v.value;
  }
}

function jsonOf(_key: string, v: Value): GetValue {
  // `valueType: "json"` must carry native JS (object/array/number/boolean/
  // null). Stringified JSON is illegal on the wire: reject loudly to match
  // sdk-go and sdk-python.
  if (typeof v.value === "string") {
    throw new Error(
      "json value must be a native JSON type (object/array/number/boolean/null); stringified JSON is no longer allowed"
    );
  }
  // Copy-on-return: a caller mutating the result cannot rewrite the stored
  // config for every later read (qfg-goi1.10.1, sdk-go 543ee9c).
  return structuredClone(v.value);
}
