import type {
  ConfigEnvelope,
  ConfigResponse,
  Value,
  WeightedValuesData,
  ProvidedData,
} from "./types";

/**
 * In-memory config store.
 *
 * Stores parsed ConfigResponse objects keyed by config key.
 * The store replaces all configs atomically on each update.
 */
export class ConfigStore {
  private configs: Map<string, ConfigResponse> = new Map();
  private version: string = "";
  private environmentId: string = "";
  private warn: (message: string, ...args: unknown[]) => void;

  /**
   * `warn` receives the WARN for a config entry that is skipped because it
   * failed to normalize (defaults to console.warn).
   */
  constructor(warn?: (message: string, ...args: unknown[]) => void) {
    this.warn = warn ?? ((message, ...args) => console.warn(message, ...args));
  }

  get(key: string): ConfigResponse | undefined {
    return this.configs.get(key);
  }

  keys(): string[] {
    return Array.from(this.configs.keys());
  }

  getEnvironmentId(): string {
    return this.environmentId;
  }

  getVersion(): string {
    return this.version;
  }

  /**
   * Replace all configs with those from the given envelope.
   * Also normalizes values that need special deserialization (weighted_values, provided).
   *
   * An entry that fails to normalize (for example a config with no `default`)
   * is skipped with a WARN naming its key, and the rest installs; the skipped
   * key reads as not found (qfg-goi1.10.1, sdk-go 2f6b98b). If every entry
   * fails, the envelope is rejected and the previous configs stay, so an
   * undecodable payload can never install as an empty workspace.
   */
  update(envelope: ConfigEnvelope): void {
    const next = new Map<string, ConfigResponse>();
    const configs = envelope.configs ?? [];
    let firstErr: unknown;

    for (const cfg of configs) {
      try {
        if (!cfg || typeof cfg.key !== "string") {
          throw new Error("config entry has no key");
        }
        // Normalize the config's values to ensure proper typing
        normalizeConfigResponse(cfg);
        next.set(cfg.key, cfg);
      } catch (err) {
        firstErr ??= err;
        const key = cfg && typeof cfg.key === "string" ? cfg.key : "";
        this.warn(
          `[quonfig] skipping config "${key}" that failed to load (version ${envelope.meta?.version ?? ""}); other configs are unaffected:`,
          err
        );
      }
    }
    if (next.size === 0 && firstErr !== undefined) {
      throw firstErr;
    }

    this.configs = next;
    this.version = envelope.meta.version;
    this.environmentId = envelope.meta.environment;
  }

  /**
   * Load from a raw datafile (JSON object).
   */
  loadFromDatafile(data: ConfigEnvelope): void {
    this.update(data);
  }
}

/**
 * Normalize a ConfigResponse to ensure all Value objects have proper typing.
 * JSON deserialization may leave weighted_values and provided values as plain objects.
 */
function normalizeConfigResponse(cfg: ConfigResponse): void {
  // The API may return null instead of an empty array for rules
  if (!cfg.default.rules) {
    cfg.default.rules = [];
  }
  for (const rule of cfg.default.rules) {
    normalizeValue(rule.value);
    // Same for criteria: api-delivery's Go nil slice serializes as null. An
    // empty criteria list is an always-match rule.
    rule.criteria ??= [];
    for (const criterion of rule.criteria) {
      if (criterion.valueToMatch) {
        normalizeValue(criterion.valueToMatch);
      }
    }
  }

  if (cfg.environment) {
    if (!cfg.environment.rules) {
      cfg.environment.rules = [];
    }
    for (const rule of cfg.environment.rules) {
      normalizeValue(rule.value);
      rule.criteria ??= [];
      for (const criterion of rule.criteria) {
        if (criterion.valueToMatch) {
          normalizeValue(criterion.valueToMatch);
        }
      }
    }
  }
}

/**
 * Normalize a Value - if it's type "weighted_values", ensure the value
 * is in the expected WeightedValuesData shape. Similarly for "provided".
 */
function normalizeValue(v: Value): void {
  if (v.type === "weighted_values" && v.value && typeof v.value === "object") {
    // Ensure it looks like WeightedValuesData
    const wvd = v.value as WeightedValuesData;
    if (wvd.weightedValues) {
      for (const wv of wvd.weightedValues) {
        if (wv.value) {
          normalizeValue(wv.value);
        }
      }
    }
  }
  if (v.type === "provided" && v.value && typeof v.value === "object") {
    // Ensure it's ProvidedData shape
    const pd = v.value as ProvidedData;
    if (!pd.source) {
      pd.source = "ENV_VAR";
    }
  }
}
