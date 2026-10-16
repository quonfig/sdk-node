import type { Criterion, Value } from "./types";
import { parseSemverAllowAbbreviated, compareSemver } from "./semver";

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
export const OP_IS_PRESENT = "IS_PRESENT";
export const OP_IS_NOT_PRESENT = "IS_NOT_PRESENT";

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

// The ONE timestamp grammar for PROP_BEFORE / PROP_AFTER (qfg-goi1.5 R5),
// identical on the context and criterion sides: a finite JSON number (epoch
// ms, truncated), an all-digit string (epoch ms), or RFC3339 with an
// uppercase T and a Z or numeric offset (fractional seconds allowed).
// Date-only, offset-less and free-form strings are not timestamps.
const DIGITS_PATTERN = /^-?\d+$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

function rfc3339ToMillis(val: string): number | undefined {
  const m = RFC3339_PATTERN.exec(val);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59) {
    return undefined;
  }
  let offsetMinutes = 0;
  if (m[8] !== "Z") {
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return undefined;
    offsetMinutes = (m[9] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const fracMillis = m[7] ? Math.trunc(Number(`0${m[7]}`) * 1000) : 0;
  const utc = new Date(0);
  utc.setUTCFullYear(y, mo - 1, d);
  utc.setUTCHours(h, mi, s, fracMillis);
  return utc.getTime() - offsetMinutes * 60_000;
}

function dateToMillis(val: any): number | undefined {
  if (typeof val === "number") {
    return Number.isFinite(val) ? Math.trunc(val) : undefined;
  }
  if (typeof val === "string") {
    if (DIGITS_PATTERN.test(val)) return Number(val);
    return rfc3339ToMillis(val);
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
      if (
        contextExists &&
        matchValue !== undefined &&
        isString(contextValue) &&
        isString(matchValue.value)
      ) {
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
      if (
        contextExists &&
        matchValue !== undefined &&
        isNumber(contextValue) &&
        isNumericValue(matchValue.value)
      ) {
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
      if (
        contextExists &&
        matchValue !== undefined &&
        isString(contextValue) &&
        isString(matchValue.value)
      ) {
        const svContext = parseSemverAllowAbbreviated(contextValue);
        const svMatch = parseSemverAllowAbbreviated(matchValue.value);
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

    case OP_IS_PRESENT:
    case OP_IS_NOT_PRESENT: {
      // Presence-only operator: takes only propertyName, no valueToMatch.
      // contextExists is true iff the dotted path resolved AND the value is
      // not null AND not undefined. Empty string, 0, and false are present.
      return contextExists === (criterion.operator === OP_IS_PRESENT);
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
