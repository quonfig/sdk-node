import type { ConfigEnvelope, ConfigResponse, Value, WeightedValuesData, ProvidedData } from "./types";

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
   */
  update(envelope: ConfigEnvelope): void {
    const next = new Map<string, ConfigResponse>();

    for (const cfg of envelope.configs) {
      // Normalize the config's values to ensure proper typing
      normalizeConfigResponse(cfg);
      next.set(cfg.key, cfg);
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
    for (const criterion of rule.criteria ?? []) {
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
      for (const criterion of rule.criteria ?? []) {
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
