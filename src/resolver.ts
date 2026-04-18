import type { ConfigResponse, Contexts, GetValue, Value, ValueType } from "./types";
import type { ConfigStore } from "./store";
import type { Evaluator } from "./evaluator";
import { decrypt } from "./encryption";
import { durationToMilliseconds } from "./duration";
import { createHash } from "crypto";

const TRUE_VALUES = new Set(["true", "1", "t", "yes"]);

const CONFIDENTIAL_PREFIX = "*****";

/**
 * Make a confidential hash for reporting (MD5 last 5 chars).
 */
function makeConfidential(secret: string): string {
  const md5 = createHash("md5").update(secret).digest("hex");
  return `${CONFIDENTIAL_PREFIX}${md5.slice(-5)}`;
}

/**
 * Resolver handles post-evaluation value resolution:
 * - ENV_VAR provided values
 * - Decryption of confidential values
 * - Type coercion
 * - Duration parsing
 * - JSON parsing
 */
export class Resolver {
  private store: ConfigStore;
  private evaluator: Evaluator;

  constructor(store: ConfigStore, evaluator: Evaluator) {
    this.store = store;
    this.evaluator = evaluator;
  }

  /**
   * Resolve a matched value. Handles:
   * - provided values (ENV_VAR lookup)
   * - decryption of confidential values
   */
  resolveValue(
    val: Value,
    configKey: string,
    valueType: ValueType,
    envID: string,
    contexts: Contexts
  ): { resolved: Value; reportableValue?: GetValue } {
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

        const coerced = coerceValue(envValue, valueType);
        return {
          resolved: {
            type: valueTypeForCoerced(valueType),
            value: coerced,
          },
        };
      }
      return { resolved: val };
    }

    // Handle decryption
    if (val.confidential && val.decryptWith) {
      const keyCfg = this.store.get(val.decryptWith);
      if (keyCfg === undefined) {
        throw new Error(`Decryption key config "${val.decryptWith}" not found`);
      }

      const keyMatch = this.evaluator.evaluateConfig(keyCfg, envID, contexts);
      if (!keyMatch.isMatch || keyMatch.value === undefined) {
        throw new Error(`Decryption key config "${val.decryptWith}" did not match`);
      }

      // Resolve the key value recursively (it could itself be a provided ENV_VAR)
      const { resolved: resolvedKey } = this.resolveValue(
        keyMatch.value,
        keyCfg.key,
        keyCfg.valueType,
        envID,
        contexts
      );

      const secretKey = String(resolvedKey.value);
      if (!secretKey) {
        throw new Error(`Decryption key from "${val.decryptWith}" is empty`);
      }

      const decrypted = decrypt(String(val.value), secretKey);
      return {
        resolved: {
          type: "string",
          value: decrypted,
          confidential: true,
        },
        reportableValue: makeConfidential(String(val.value)),
      };
    }

    // Check if value is confidential (but not encrypted)
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
        return val.value;
      case "string_list":
        if (Array.isArray(val.value)) {
          return val.value.map((v: any) => String(v));
        }
        return [];
      case "log_level":
        return typeof val.value === "number" ? val.value : String(val.value ?? "");
      case "duration":
        return durationToMilliseconds(String(val.value ?? ""));
      default:
        return val.value;
    }
  }
}

function coerceValue(value: string, valueType: ValueType): any {
  switch (valueType) {
    case "string":
      return value;
    case "int": {
      const n = parseInt(value, 10);
      if (isNaN(n)) throw new Error(`Cannot convert "${value}" to int`);
      return n;
    }
    case "double": {
      const n = parseFloat(value);
      if (isNaN(n)) throw new Error(`Cannot convert "${value}" to double`);
      return n;
    }
    case "bool":
      return TRUE_VALUES.has(value.toLowerCase());
    case "string_list":
      return value.split(/\s*,\s*/);
    case "duration":
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
    default:
      return "string";
  }
}
