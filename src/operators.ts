import type { Criterion, Value } from "./types";
import { parseSemver, compareSemver } from "./semver";

// ---- Operator Constants ----

export const OP_NOT_SET = "NOT_SET";
export const OP_ALWAYS_TRUE = "ALWAYS_TRUE";
export const OP_PROP_IS_ONE_OF = "PROP_IS_ONE_OF";
export const OP_PROP_IS_NOT_ONE_OF = "PROP_IS_NOT_ONE_OF";
export const OP_PROP_STARTS_WITH_ONE_OF = "PROP_STARTS_WITH_ONE_OF";
export const OP_PROP_DOES_NOT_START_WITH_ONE_OF = "PROP_DOES_NOT_START_WITH_ONE_OF";
export const OP_PROP_ENDS_WITH_ONE_OF = "PROP_ENDS_WITH_ONE_OF";
export const OP_PROP_DOES_NOT_END_WITH_ONE_OF = "PROP_DOES_NOT_END_WITH_ONE_OF";
export const OP_PROP_CONTAINS_ONE_OF = "PROP_CONTAINS_ONE_OF";
export const OP_PROP_DOES_NOT_CONTAIN_ONE_OF = "PROP_DOES_NOT_CONTAIN_ONE_OF";
export const OP_PROP_MATCHES = "PROP_MATCHES";
export const OP_PROP_DOES_NOT_MATCH = "PROP_DOES_NOT_MATCH";
export const OP_HIERARCHICAL_MATCH = "HIERARCHICAL_MATCH";
export const OP_IN_INT_RANGE = "IN_INT_RANGE";
export const OP_PROP_GREATER_THAN = "PROP_GREATER_THAN";
export const OP_PROP_GREATER_THAN_OR_EQUAL = "PROP_GREATER_THAN_OR_EQUAL";
export const OP_PROP_LESS_THAN = "PROP_LESS_THAN";
export const OP_PROP_LESS_THAN_OR_EQUAL = "PROP_LESS_THAN_OR_EQUAL";
export const OP_PROP_BEFORE = "PROP_BEFORE";
export const OP_PROP_AFTER = "PROP_AFTER";
export const OP_PROP_SEMVER_LESS_THAN = "PROP_SEMVER_LESS_THAN";
export const OP_PROP_SEMVER_EQUAL = "PROP_SEMVER_EQUAL";
export const OP_PROP_SEMVER_GREATER_THAN = "PROP_SEMVER_GREATER_THAN";
export const OP_IN_SEG = "IN_SEG";
export const OP_NOT_IN_SEG = "NOT_IN_SEG";

// ---- Segment resolver type ----

export type SegmentResolver = (segmentKey: string) => { result: boolean; found: boolean };

// ---- Helper functions ----

function toString(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function toStringSlice(v: any): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v.map((item) => toString(item));
  }
  return [toString(v)];
}

function getStringList(v: Value | undefined): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v.value)) {
    return v.value.map((item: any) => toString(item));
  }
  return undefined;
}

function isString(v: any): v is string {
  return typeof v === "string";
}

function isNumber(v: any): boolean {
  return typeof v === "number";
}

function isNumericValue(v: any): boolean {
  if (typeof v === "number") return true;
  if (typeof v === "string") return !isNaN(Number(v)) && v.trim() !== "";
  return false;
}

function toFloat64(v: any): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

function compareNumbers(a: any, b: any): number | undefined {
  const af = toFloat64(a);
  const bf = toFloat64(b);
  if (af === undefined || bf === undefined) return undefined;
  if (af < bf) return -1;
  if (af > bf) return 1;
  return 0;
}

function dateToMillis(val: any): number | undefined {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // Try RFC3339 / ISO 8601
    const d = Date.parse(val);
    if (!isNaN(d)) return d;
    // Try as a plain number string
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

function stringInSlice(s: string, list: string[]): boolean {
  return list.includes(s);
}

function startsWithAny(prefixes: string[], target: string): boolean {
  return prefixes.some((p) => target.startsWith(p));
}

function endsWithAny(suffixes: string[], target: string): boolean {
  return suffixes.some((s) => target.endsWith(s));
}

function containsAny(substrings: string[], target: string): boolean {
  return substrings.some((s) => target.includes(s));
}

function extractIntRange(v: Value | undefined): { start: number; end: number } {
  let start = Number.MIN_SAFE_INTEGER;
  let end = Number.MAX_SAFE_INTEGER;

  if (v === undefined || v === null) return { start, end };

  // The value should be a map with "start" and "end" from JSON
  if (typeof v.value === "object" && v.value !== null && !Array.isArray(v.value)) {
    if ("start" in v.value) {
      const s = toFloat64(v.value.start);
      if (s !== undefined) start = s;
    }
    if ("end" in v.value) {
      const e = toFloat64(v.value.end);
      if (e !== undefined) end = e;
    }
  }

  return { start, end };
}

// ---- Main evaluation function ----

/**
 * Evaluate a single criterion against a context value.
 *
 * This is a faithful port of the Go SDK's EvaluateCriterion function.
 */
export function evaluateCriterion(
  contextValue: any,
  contextExists: boolean,
  criterion: Criterion,
  segmentResolver?: SegmentResolver
): boolean {
  const matchValue = criterion.valueToMatch;

  switch (criterion.operator) {
    case OP_NOT_SET:
      return false;

    case OP_ALWAYS_TRUE:
      return true;

    case OP_PROP_IS_ONE_OF:
    case OP_PROP_IS_NOT_ONE_OF: {
      if (contextExists && matchValue !== undefined) {
        const matchStrings = getStringList(matchValue);
        if (matchStrings !== undefined) {
          const contextStrings = toStringSlice(contextValue);
          let matchFound = false;
          for (const cv of contextStrings) {
            if (stringInSlice(cv, matchStrings)) {
              matchFound = true;
              break;
            }
          }
          return matchFound === (criterion.operator === OP_PROP_IS_ONE_OF);
        }
      }
      return criterion.operator === OP_PROP_IS_NOT_ONE_OF;
    }

    case OP_PROP_STARTS_WITH_ONE_OF:
    case OP_PROP_DOES_NOT_START_WITH_ONE_OF: {
      if (contextExists && matchValue !== undefined) {
        const matchStrings = getStringList(matchValue);
        if (matchStrings !== undefined) {
          const cv = toString(contextValue);
          const matchFound = startsWithAny(matchStrings, cv);
          return matchFound === (criterion.operator === OP_PROP_STARTS_WITH_ONE_OF);
        }
      }
      return criterion.operator === OP_PROP_DOES_NOT_START_WITH_ONE_OF;
    }

    case OP_PROP_ENDS_WITH_ONE_OF:
    case OP_PROP_DOES_NOT_END_WITH_ONE_OF: {
      if (contextExists && matchValue !== undefined) {
        const matchStrings = getStringList(matchValue);
        if (matchStrings !== undefined) {
          const cv = toString(contextValue);
          const matchFound = endsWithAny(matchStrings, cv);
          return matchFound === (criterion.operator === OP_PROP_ENDS_WITH_ONE_OF);
        }
      }
      return criterion.operator === OP_PROP_DOES_NOT_END_WITH_ONE_OF;
    }

    case OP_PROP_CONTAINS_ONE_OF:
    case OP_PROP_DOES_NOT_CONTAIN_ONE_OF: {
      if (contextExists && matchValue !== undefined) {
        const matchStrings = getStringList(matchValue);
        if (matchStrings !== undefined) {
          const cv = toString(contextValue);
          const matchFound = containsAny(matchStrings, cv);
          return matchFound === (criterion.operator === OP_PROP_CONTAINS_ONE_OF);
        }
      }
      return criterion.operator === OP_PROP_DOES_NOT_CONTAIN_ONE_OF;
    }

    case OP_PROP_MATCHES:
    case OP_PROP_DOES_NOT_MATCH: {
      if (contextExists && matchValue !== undefined && isString(contextValue) && isString(matchValue.value)) {
        try {
          const re = new RegExp(matchValue.value);
          const matched = re.test(contextValue);
          return matched === (criterion.operator === OP_PROP_MATCHES);
        } catch {
          // Invalid regex
        }
      }
      return false;
    }

    case OP_HIERARCHICAL_MATCH: {
      if (contextExists && matchValue !== undefined) {
        const cv = toString(contextValue);
        const mv = toString(matchValue.value);
        return cv.startsWith(mv);
      }
      return false;
    }

    case OP_IN_INT_RANGE: {
      if (contextExists && matchValue !== undefined) {
        const { start, end } = extractIntRange(matchValue);
        const numVal = toFloat64(contextValue);
        if (numVal !== undefined) {
          return numVal >= start && numVal < end;
        }
      }
      return false;
    }

    case OP_PROP_GREATER_THAN:
    case OP_PROP_GREATER_THAN_OR_EQUAL:
    case OP_PROP_LESS_THAN:
    case OP_PROP_LESS_THAN_OR_EQUAL: {
      if (contextExists && matchValue !== undefined && isNumber(contextValue) && isNumericValue(matchValue.value)) {
        const cmp = compareNumbers(contextValue, matchValue.value);
        if (cmp !== undefined) {
          switch (criterion.operator) {
            case OP_PROP_GREATER_THAN:
              return cmp > 0;
            case OP_PROP_GREATER_THAN_OR_EQUAL:
              return cmp >= 0;
            case OP_PROP_LESS_THAN:
              return cmp < 0;
            case OP_PROP_LESS_THAN_OR_EQUAL:
              return cmp <= 0;
          }
        }
      }
      return false;
    }

    case OP_PROP_BEFORE:
    case OP_PROP_AFTER: {
      if (contextExists && matchValue !== undefined) {
        const contextMillis = dateToMillis(contextValue);
        const matchMillis = dateToMillis(matchValue.value);
        if (contextMillis !== undefined && matchMillis !== undefined) {
          if (criterion.operator === OP_PROP_BEFORE) {
            return contextMillis < matchMillis;
          }
          return contextMillis > matchMillis;
        }
      }
      return false;
    }

    case OP_PROP_SEMVER_LESS_THAN:
    case OP_PROP_SEMVER_EQUAL:
    case OP_PROP_SEMVER_GREATER_THAN: {
      if (contextExists && matchValue !== undefined && isString(contextValue) && isString(matchValue.value)) {
        const svContext = parseSemver(contextValue);
        const svMatch = parseSemver(matchValue.value);
        if (svContext !== undefined && svMatch !== undefined) {
          const cmp = compareSemver(svContext, svMatch);
          switch (criterion.operator) {
            case OP_PROP_SEMVER_LESS_THAN:
              return cmp < 0;
            case OP_PROP_SEMVER_EQUAL:
              return cmp === 0;
            case OP_PROP_SEMVER_GREATER_THAN:
              return cmp > 0;
          }
        }
      }
      return false;
    }

    case OP_IN_SEG:
    case OP_NOT_IN_SEG: {
      if (matchValue !== undefined && segmentResolver !== undefined) {
        const segmentKey = toString(matchValue.value);
        const { result, found } = segmentResolver(segmentKey);
        if (!found) {
          return criterion.operator === OP_NOT_IN_SEG;
        }
        return result === (criterion.operator === OP_IN_SEG);
      }
      return criterion.operator === OP_NOT_IN_SEG;
    }

    default:
      return false;
  }
}
