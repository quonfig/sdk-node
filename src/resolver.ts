import type { ConfigTypeString, Contexts, GetValue, Value, ValueType } from "./types";
import type { ConfigStore } from "./store";
import type { Evaluator } from "./evaluator";
import { KeysetCache, Qf1Error, QuonfigDecryptionError, decryptQf1 } from "./qf1";
import { InvalidDurationError, parseDurationMillis } from "./duration";
import { createHash } from "crypto";

const TRUE_VALUES = new Set(["true", "1", "t", "yes"]);

const CONFIDENTIAL_PREFIX = "*****";

/**
 * Make a confidential hash for reporting (MD5 first 5 chars).
 *
 * Format: `*****<first-5-hex-chars-md5>` lowercase. 10 chars total.
 * Matches the canonical sdk-ruby ConfigValueUnwrapper#reportable_wrapped_value
 * pattern so all SDKs emit the same redaction on the wire.
 */
function makeConfidential(secret: string): string {
  const md5 = createHash("md5").update(secret).digest("hex");
  return `${CONFIDENTIAL_PREFIX}${md5.slice(0, 5)}`;
}

/** Parsed keysets, shared by every client in the process (spec 6.2, decision 33). */
const KEYSETS = new KeysetCache();

/**
 * Decrypted secrets, keyed by the STORED value object (`EvalMatch.storedValue`:
 * the evaluator hands the resolver a copy, so the copy is no key). An entry is
 * reused only while the stored ciphertext and the keyset env var's value are
 * both what it was decrypted from; installs replace stored values, so entries
 * die with their config.
 */
const DECRYPTED = new WeakMap<
  object,
  { ciphertext: string; keyset: string; raw: string | undefined; resolved: Value }
>();

/**
 * A value of a secret: a qf1 string, decrypted with the keyset its header
 * names (spec 8). Any failure is a Qf1Error for this value only; the stored
 * string is never returned. Telemetry gets a redaction over the STORED
 * string, never over the plaintext (spec 13.5).
 */
function resolveSecret(
  val: Value,
  configKey: string,
  cacheKey: object
): { resolved: Value; reportableValue: GetValue } {
  if (val.type !== "string" || typeof val.value !== "string") {
    throw new Qf1Error(
      "malformed",
      `a secret value is a string, this one has type "${String(val.type)}" (config "${configKey}")`
    );
  }
  const ciphertext = val.value;
  const reportableValue = makeConfidential(ciphertext);

  const cached = DECRYPTED.get(cacheKey);
  if (
    cached !== undefined &&
    cached.ciphertext === ciphertext &&
    process.env[cached.keyset] === cached.raw
  ) {
    return { resolved: cached.resolved, reportableValue };
  }

  let keyset: string | undefined;
  let raw: string | undefined;
  const plaintext = decryptQf1(
    ciphertext,
    (name) => {
      keyset = name;
      raw = process.env[name];
      return raw;
    },
    { configKey, cache: KEYSETS }
  );
  const resolved: Value = { type: "string", value: plaintext, confidential: true };
  DECRYPTED.set(cacheKey, { ciphertext, keyset: keyset!, raw, resolved });
  return { resolved, reportableValue };
}

/**
 * Resolver handles post-evaluation value resolution:
 * - ENV_VAR provided values
 * - Decryption of secrets (qf1)
 * - Type coercion
 * - Duration parsing
 * - JSON parsing
 */
export class Resolver {
  // Unused since the decryptWith key lookup was removed (qfg-8seuf.8); kept so
  // the exported constructor's signature does not change.
  private store: ConfigStore;
  private evaluator: Evaluator;

  constructor(store: ConfigStore, evaluator: Evaluator) {
    this.store = store;
    this.evaluator = evaluator;
  }

  /**
   * Resolve a matched value. Handles:
   * - values of a secret (`configType` "secret"): decrypted as qf1
   * - provided values (ENV_VAR lookup)
   * - redaction of confidential values for telemetry
   *
   * A value that still carries `decryptWith` (the old secrets format) is an
   * error: this SDK no longer reads it (spec 13.3 R1).
   *
   * `storedValue` is the installed value object `val` was copied from; it keys
   * the decrypted-secret cache (without it, `val` itself is the key).
   */
  resolveValue(
    val: Value,
    configKey: string,
    valueType: ValueType,
    envID: string,
    contexts: Contexts,
    configType?: ConfigTypeString,
    storedValue?: object
  ): { resolved: Value; reportableValue?: GetValue } {
    // Any decryptWith other than undefined, null or "" is the old format,
    // whatever its JSON type (spec 13.3 R1). No key config is read.
    const decryptWith: unknown = val.decryptWith;
    if (decryptWith !== undefined && decryptWith !== null && decryptWith !== "") {
      throw new QuonfigDecryptionError(
        "decrypt_with_not_supported",
        `config "${configKey}" has a value that carries decryptWith, the old secrets format, which this SDK no longer reads; store it as a qf1 secret in secrets/`
      );
    }

    if (configType === "secret") {
      return resolveSecret(val, configKey, storedValue ?? val);
    }

    // Handle provided values (ENV_VAR)
    if (val.type === "provided") {
      const provided = val.value;
      if (provided && provided.source === "ENV_VAR" && provided.lookup) {
        const envValue = process.env[provided.lookup];
        if (envValue === undefined) {
          throw new Error(
            `Environment variable "${provided.lookup}" not set for config "${configKey}"`
          );
        }

        const coerced = coerceValue(envValue, valueType, provided.lookup, configKey);
        const resolved: Value = { type: valueTypeForCoerced(valueType), value: coerced };
        // A confidential provided value must never put the env var's contents
        // in telemetry: report a redaction over the stored (pre-resolution)
        // descriptor, the raw value as it appears in the config JSON
        // (qfg-goi1.2.47; sdk-go records the pre-resolution Value and redacts
        // confidential ones). A non-confidential provided value reports its
        // resolved value like any ordinary value (decision 2026-10-09).
        if (val.confidential) {
          return { resolved, reportableValue: makeConfidential(JSON.stringify(provided)) };
        }
        return { resolved };
      }
      return { resolved: val };
    }

    // A confidential value is returned as stored and redacted in telemetry.
    if (val.confidential) {
      return {
        resolved: val,
        reportableValue: makeConfidential(String(val.value)),
      };
    }

    return { resolved: val };
  }

  /**
   * Unwrap a resolved value to a plain JS value.
   */
  unwrapValue(val: Value): GetValue {
    switch (val.type) {
      case "bool":
        return !!val.value;
      case "int":
        return typeof val.value === "number" ? val.value : parseInt(String(val.value), 10);
      case "double":
        return typeof val.value === "number" ? val.value : parseFloat(String(val.value));
      case "string":
        return String(val.value ?? "");
      case "json":
        // `valueType: "json"` must carry native JS (object/array/number/
        // boolean/null). Stringified JSON is illegal on the wire —
        // reject loudly to match sdk-go and sdk-python.
        if (typeof val.value === "string") {
          throw new Error(
            "json value must be a native JSON type (object/array/number/boolean/null); stringified JSON is no longer allowed"
          );
        }
        // Copy-on-return: hand out a deep copy so a caller mutating the result
        // cannot rewrite the stored config for every later read
        // (qfg-goi1.10.1, sdk-go 543ee9c).
        return structuredClone(val.value);
      case "string_list":
        if (Array.isArray(val.value)) {
          return val.value.map((v: any) => String(v));
        }
        return [];
      case "log_level":
        return typeof val.value === "number" ? val.value : String(val.value ?? "");
      case "duration": {
        const ms = parseDurationMillis(String(val.value ?? ""));
        if (ms === undefined) {
          throw new InvalidDurationError("malformed duration value");
        }
        return ms;
      }
      default:
        return val.value;
    }
  }
}

const INT_PATTERN = /^[+-]?[0-9]+$/;
const DOUBLE_PATTERN = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

// The coercion error names the env var, the target type and the config key,
// never the env var's contents (which may be a secret such as a connection
// string): qfg-goi1.2.31, template pinned across SDKs (sdk-go 4178377).
function coercionError(lookup: string, valueType: ValueType, configKey: string): string {
  return `environment variable "${lookup}" cannot be converted to ${valueType} for config "${configKey}"`;
}

function coerceValue(value: string, valueType: ValueType, lookup: string, configKey: string): any {
  switch (valueType) {
    case "string":
      return value;
    // The whole (trimmed) string must be the number: parseInt/parseFloat would
    // read the numeric prefix of "30s" as 30 (qfg-2agi.22).
    case "int": {
      const t = value.trim();
      if (!INT_PATTERN.test(t)) throw new Error(coercionError(lookup, valueType, configKey));
      return parseInt(t, 10);
    }
    case "double": {
      const t = value.trim();
      if (!DOUBLE_PATTERN.test(t)) throw new Error(coercionError(lookup, valueType, configKey));
      return parseFloat(t);
    }
    case "bool":
      return TRUE_VALUES.has(value.toLowerCase());
    case "string_list":
      return value.split(/\s*,\s*/);
    case "duration":
      // Validated here so a malformed env var fails like a stored one. The ISO
      // string is kept as a "duration" Value, so unwrapValue turns it into
      // integer ms exactly like a stored duration (qfg-2agi.22).
      if (parseDurationMillis(value) === undefined) {
        throw new InvalidDurationError(coercionError(lookup, valueType, configKey));
      }
      return value;
    default:
      return value;
  }
}

function valueTypeForCoerced(valueType: ValueType): ValueType {
  switch (valueType) {
    case "int":
      return "int";
    case "double":
      return "double";
    case "bool":
      return "bool";
    case "string_list":
      return "string_list";
    case "duration":
      return "duration";
    default:
      return "string";
  }
}
