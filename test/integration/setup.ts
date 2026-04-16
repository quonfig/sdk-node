import * as fs from "fs";
import * as path from "path";
import { ConfigStore } from "../../src/store";
import { Evaluator } from "../../src/evaluator";
import { Resolver } from "../../src/resolver";
import { computeReason } from "../../src/reason";
import type { ConfigResponse, ConfigEnvelope, Contexts, Evaluation } from "../../src/types";
import { EvaluationSummaryCollector } from "../../src/telemetry/evaluationSummaries";
import { ContextShapeCollector } from "../../src/telemetry/contextShapes";
import { ExampleContextCollector } from "../../src/telemetry/exampleContexts";

// Set environment variables for integration tests
process.env.PREFAB_INTEGRATION_TEST_ENCRYPTION_KEY =
  "c87ba22d8662282abe8a0e4651327b579cb64a454ab0f4c170b45b15f049a221";
process.env.IS_A_NUMBER = "1234";
process.env.NOT_A_NUMBER = "not_a_number";
delete process.env.MISSING_ENV_VAR;

const DATA_DIR = path.resolve(
  __dirname,
  "../../../integration-test-data/data/integration-tests"
);

const ENV_ID = "Production";

/**
 * Read all JSON files from a directory and return parsed objects.
 */
function readJsonFiles(dir: string): any[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const content = fs.readFileSync(path.join(dir, f), "utf-8");
    return JSON.parse(content);
  });
}

/**
 * Convert raw on-disk config JSON (which has `environments` array) to
 * ConfigResponse (which has a single `environment` for the target env).
 */
function toConfigResponse(raw: any): ConfigResponse {
  let environment: ConfigResponse["environment"] = undefined;

  if (Array.isArray(raw.environments)) {
    const envMatch = raw.environments.find(
      (e: any) => e.id === ENV_ID
    );
    if (envMatch) {
      environment = envMatch;
    }
  }

  return {
    id: raw.id ?? "",
    key: raw.key,
    type: raw.type,
    valueType: raw.valueType,
    sendToClientSdk: raw.sendToClientSdk ?? false,
    default: raw.default ?? { rules: [] },
    environment,
  };
}

// Load all config data
const configs: ConfigResponse[] = [];

for (const subdir of ["configs", "feature-flags", "segments", "log-levels", "schemas"]) {
  const dir = path.join(DATA_DIR, subdir);
  for (const raw of readJsonFiles(dir)) {
    configs.push(toConfigResponse(raw));
  }
}

// Create envelope and store
const envelope: ConfigEnvelope = {
  configs,
  meta: {
    version: "integration-test",
    environment: ENV_ID,
  },
};

export const store = new ConfigStore();
store.update(envelope);

export const evaluator = new Evaluator(store);
export const resolver = new Resolver(store, evaluator);
export const envID = ENV_ID;

// Re-export telemetry collectors for generated tests
export { EvaluationSummaryCollector, ContextShapeCollector, ExampleContextCollector };
export type { Contexts, Evaluation };

/**
 * Evaluate a config key and return an Evaluation object for telemetry recording.
 */
export function evaluateForTelemetry(
  key: string,
  contexts: Contexts = {}
): Evaluation | undefined {
  const cfg = store.get(key);
  if (!cfg) return undefined;

  const match = evaluator.evaluateConfig(cfg, envID, contexts);
  if (!match.isMatch || !match.value) return undefined;

  const { resolved, reportableValue } = resolver.resolveValue(
    match.value,
    cfg.key,
    cfg.valueType,
    envID,
    contexts
  );
  const unwrappedValue = resolver.unwrapValue(resolved);

  return {
    configId: cfg.id,
    configKey: cfg.key,
    configType: cfg.type as any,
    unwrappedValue,
    reportableValue,
    ruleIndex: match.ruleIndex,
    weightedValueIndex: match.weightedValueIndex,
    reason: computeReason(match, cfg),
  };
}
