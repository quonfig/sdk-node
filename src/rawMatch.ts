import type {
  Contexts,
  ProvidedData,
  RawConfigWithDependencies,
  RawDependency,
  RawMatch,
  Value,
} from "./types";
import type { ConfigStore } from "./store";
import type { Evaluator } from "./evaluator";

/**
 * Server-safe dependency resolver.
 *
 * Returns the matched Value for a key WITHOUT reading process.env and WITHOUT
 * decrypting. Instead, it records dependencies (decryptWith keys and providedBy
 * ENV_VAR pointers) so a downstream client (customer SDK running in customer
 * runtime) can resolve them.
 *
 * Mirrors api-prefab Core/src/main/java/cloud/prefab/server/services/
 * ConfigDependencyResolver.java.
 */
export class ConfigDependencyResolver {
  private store: ConfigStore;
  private evaluator: Evaluator;

  constructor(store: ConfigStore, evaluator: Evaluator) {
    this.store = store;
    this.evaluator = evaluator;
  }

  resolveWithDependencies(
    key: string,
    envID: string,
    contexts: Contexts
  ): RawMatch | undefined {
    const config = this.resolve(key, envID, contexts, new Set());
    if (config === undefined) return undefined;
    return { config };
  }

  private resolve(
    key: string,
    envID: string,
    contexts: Contexts,
    visited: Set<string>
  ): RawConfigWithDependencies | undefined {
    if (visited.has(key)) {
      return undefined;
    }
    visited.add(key);

    const cfg = this.store.get(key);
    if (cfg === undefined) return undefined;

    const match = this.evaluator.evaluateConfig(cfg, envID, contexts);
    if (!match.isMatch || match.value === undefined) return undefined;

    const val: Value = match.value;
    const dependencies: RawDependency[] = [];

    // Nested decryptWith: recursively resolve the key-config's own dependencies.
    if (val.confidential && val.decryptWith) {
      const keyConfig = this.resolve(
        val.decryptWith,
        envID,
        contexts,
        new Set(visited) // copy so sibling branches don't pollute each other
      );
      if (keyConfig !== undefined) {
        dependencies.push({
          dependencyType: "decryptWith",
          source: val.decryptWith,
          config: keyConfig,
        });
      }
    }

    // Provided ENV_VAR: record the pointer without reading process.env.
    if (val.type === "provided" && val.value && typeof val.value === "object") {
      const provided = val.value as ProvidedData;
      if (provided.source === "ENV_VAR" && provided.lookup) {
        dependencies.push({
          dependencyType: "providedBy",
          source: provided.lookup,
        });
      }
    }

    return {
      key: cfg.key,
      type: val.type,
      value: val.value,
      confidential: val.confidential === true ? true : undefined,
      metadata: {
        configRowIndex: match.ruleIndex,
        conditionalValueIndex: 0,
        weightedValueIndex:
          match.weightedValueIndex >= 0 ? match.weightedValueIndex : undefined,
        type: cfg.type,
        id: cfg.id,
        valueType: cfg.valueType,
      },
      dependencies: dependencies.length > 0 ? dependencies : undefined,
    };
  }
}
