// ---- Value Types ----

export type ValueType =
  | "bool"
  | "int"
  | "double"
  | "string"
  | "json"
  | "string_list"
  | "log_level"
  | "weighted_values"
  | "schema"
  | "provided"
  | "duration";

// ---- Config Types ----

export type ConfigTypeString =
  | "feature_flag"
  | "config"
  | "segment"
  | "log_level"
  | "schema";

// ---- Provided Data ----

export interface ProvidedData {
  source: string;
  lookup: string;
}

// ---- Weighted Values ----

export interface WeightedValue {
  weight: number;
  value: Value;
}

export interface WeightedValuesData {
  weightedValues: WeightedValue[];
  hashByPropertyName?: string;
}

// ---- Schema ----

export interface SchemaData {
  schemaType: string;
  schema: string;
}

// ---- Value ----

export interface Value {
  type: ValueType;
  value: any;
  confidential?: boolean;
  decryptWith?: string;
}

// ---- Criterion ----

export interface Criterion {
  propertyName?: string;
  operator: string;
  valueToMatch?: Value;
}

// ---- Rule ----

export interface Rule {
  criteria: Criterion[];
  value: Value;
}

// ---- RuleSet ----

export interface RuleSet {
  rules: Rule[];
}

// ---- Environment ----

export interface Environment {
  id: string;
  rules: Rule[];
}

// ---- ConfigResponse ----

export interface ConfigResponse {
  id: string;
  key: string;
  type: ConfigTypeString;
  valueType: ValueType;
  sendToClientSdk: boolean;
  default: RuleSet;
  environment?: Environment;
}

// ---- ConfigEnvelope ----

export interface Meta {
  version: string;
  environment: string;
  workspaceId?: string;
}

export interface ConfigEnvelope {
  configs: ConfigResponse[];
  meta: Meta;
}

// ---- Context ----

export type ContextValue = string | number | boolean | string[] | null | undefined;

export type Contexts = { [contextName: string]: { [key: string]: ContextValue } };

// ---- GetValue ----

export type GetValue = string | number | boolean | string[] | undefined;

// ---- On no default behavior ----

export type OnNoDefault = "error" | "warn" | "ignore";

// ---- Context upload mode ----

export type ContextUploadMode = "none" | "shapes_only" | "periodic_example";

// ---- Options ----

export interface QuonfigOptions {
  sdkKey: string;
  apiUrl?: string;
  /** Base URL for the dedicated telemetry service. Defaults to https://telemetry.quonfig.com. Overridden by QUONFIG_TELEMETRY_URL env var. */
  telemetryUrl?: string;
  enableSSE?: boolean;
  enablePolling?: boolean;
  pollInterval?: number;
  namespace?: string;
  globalContext?: Contexts;
  onNoDefault?: OnNoDefault;
  collectEvaluationSummaries?: boolean;
  collectLoggerCounts?: boolean;
  contextUploadMode?: ContextUploadMode;
  initTimeout?: number;
  datafile?: string | object;
}

// ---- Evaluation Result ----

export interface EvalMatch {
  isMatch: boolean;
  value?: Value;
  ruleIndex: number;
  weightedValueIndex: number;
}

// ---- Log Level ----

export type LogLevelName = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogLevelNumber = 1 | 2 | 3 | 5 | 6 | 9;

// ---- Telemetry Event Types ----

export interface EvaluationCounter {
  configId: string;
  conditionalValueIndex: number;
  configRowIndex: number;
  selectedValue: any;
  count: number;
  weightedValueIndex?: number;
}

export interface EvaluationSummary {
  key: string;
  type: string;
  counters: EvaluationCounter[];
}

export interface ContextShape {
  name: string;
  fieldTypes: { [key: string]: number };
}

export interface ExampleContextEntry {
  timestamp: number;
  contextSet: {
    contexts: Array<{
      type: string;
      values: { [key: string]: any };
    }>;
  };
}

export interface TelemetryEvent {
  summaries?: {
    start: number;
    end: number;
    summaries: EvaluationSummary[];
  };
  contextShapes?: {
    shapes: ContextShape[];
  };
  exampleContexts?: {
    examples: ExampleContextEntry[];
  };
}

export interface TelemetryPayload {
  instanceHash: string;
  events: TelemetryEvent[];
}

// ---- Internal Evaluation ----

export interface Evaluation {
  configId: string;
  configKey: string;
  configType: ConfigTypeString;
  unwrappedValue: GetValue;
  reportableValue?: GetValue;
  ruleIndex: number;
  weightedValueIndex?: number;
}

// ---- Enum-like constants for CLI compatibility ----

// Runtime object for ConfigType enum access (e.g., ConfigType.FeatureFlag)
export const ConfigType = {
  FeatureFlag: "feature_flag" as ConfigTypeString,
  Config: "config" as ConfigTypeString,
  Segment: "segment" as ConfigTypeString,
  LogLevel: "log_level" as ConfigTypeString,
  Schema: "schema" as ConfigTypeString,
} as const;

export const ProvidedSource = {
  EnvVar: "ENV_VAR",
} as const;

// ---- Typed Config interfaces (augmented by CLI codegen) ----

// These are placeholder interfaces that the CLI's `gen` command
// augments via TypeScript module augmentation.
export interface NodeServerConfigurationRaw {}
export interface NodeServerConfigurationAccessor {}
export type TypedNodeServerConfigurationRaw = NodeServerConfigurationRaw;
export type TypedNodeServerConfigurationAccessor = NodeServerConfigurationAccessor;
