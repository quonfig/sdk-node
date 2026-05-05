import type { Logger } from "./sdkLogger";

/**
 * SSE connection lifecycle states surfaced via QuonfigOptions.onSSEConnectionStateChange.
 * See {@link QuonfigOptions.onSSEConnectionStateChange} for transition details.
 */
export type SSEConnectionState = "connecting" | "connected" | "error" | "disconnected";

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

export type ConfigTypeString = "feature_flag" | "config" | "segment" | "log_level" | "schema";

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

export interface WorkspaceEnvironment {
  id: string;
  rules: Rule[];
}

export interface WorkspaceConfigDocument {
  id?: string;
  key: string;
  type: ConfigTypeString;
  valueType: ValueType;
  sendToClientSdk?: boolean;
  default?: RuleSet;
  environments?: WorkspaceEnvironment[];
}

export interface QuonfigDatadirEnvironments {
  environments: string[];
}

// ---- Context ----

export type ContextValue = unknown;

export type Contexts = { [contextName: string]: { [key: string]: ContextValue } };

// Alias for Reforge-compatible naming. The CLI-generated typesafe client emits
// `contexts?: Contexts | ContextObj` on every accessor; with ContextValue widened
// to unknown, Contexts and ContextObj resolve to the same structural type.
export type ContextObj = Contexts;

// ---- GetValue ----

export type GetValue = string | number | boolean | string[] | undefined;

// ---- On no default behavior ----

export type OnNoDefault = "error" | "warn" | "ignore";

// ---- Context upload mode ----

export type ContextUploadMode = "none" | "shapes_only" | "periodic_example";

// ---- Options ----

export interface QuonfigOptions {
  /** SDK key for authentication. Falls back to the `QUONFIG_BACKEND_SDK_KEY` env var when omitted. */
  sdkKey?: string;
  /**
   * Single knob that flips api + sse + telemetry URLs in lockstep. Mirrors
   * the `domain` option in @quonfig/javascript.
   *   `domain: "quonfig-staging.com"` derives:
   *     api:        https://primary.quonfig-staging.com (+ secondary)
   *     sse:        https://stream.primary.quonfig-staging.com (+ secondary)
   *     telemetry:  https://telemetry.quonfig-staging.com
   *
   * Resolution order (highest wins): explicit `apiUrls` / `telemetryUrl` >
   * `domain` init option > `process.env.QUONFIG_DOMAIN` > `"quonfig.com"`.
   */
  domain?: string;
  /**
   * Ordered list of API base URLs to try. Escape hatch for deploys that don't
   * follow the `primary.${domain}` / `secondary.${domain}` convention.
   * SSE stream URLs are derived by prepending `stream.` to each hostname.
   * When set, wins over `domain`.
   */
  apiUrls?: string[];
  /**
   * Base URL for the dedicated telemetry service. Escape hatch for deploys
   * that split telemetry off the primary domain. When set, wins over `domain`.
   */
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
  datadir?: string;
  datafile?: string | object;
  /** Environment name to use in datadir mode. Supersedes the QUONFIG_ENVIRONMENT env var. */
  environment?: string;
  /** Called whenever the config store is updated (SSE push, poll, or initial load). Use this to react to live config changes. */
  onConfigUpdate?: () => void;
  /**
   * Called when the SSE connection transitions between lifecycle states.
   * States: `connecting` (start or auto-reconnect after error), `connected`
   * (stream active), `error` (transport error; eventsource will auto-reconnect),
   * `disconnected` (close() called). Useful for surfacing SSE health to host
   * applications. Has no effect when `enableSSE: false`.
   */
  onSSEConnectionStateChange?: (state: SSEConnectionState) => void;
  /**
   * When true (or when env var `QUONFIG_DEV_CONTEXT=true`), the SDK reads
   * `~/.quonfig/tokens.json` (written by `qfg login`) on construction and
   * injects `{ "quonfig-user": { email: <userEmail> } }` into globalContext.
   *
   * Default OFF. The injected attribute is dev-only by construction: production
   * servers never have the tokens file, so rules keyed on `quonfig-user.email`
   * are dead code in prod. Customer-supplied globalContext keys win on collision.
   */
  enableQuonfigUserContext?: boolean;
  /**
   * Config key used by the `shouldLog({loggerPath, ...})` convenience overload.
   *
   * When set (e.g. `"log-level.app-quonfig"`), callers can invoke
   * `shouldLog({loggerPath: "com.myapp.Auth", desiredLevel: "DEBUG"})` and
   * the SDK will evaluate the named config with the logger path injected
   * as `contexts["quonfig-sdk-logging"] = { key: loggerPath }`. Using the
   * `key` property means logger paths are auto-captured by the existing
   * example-context telemetry and flow to the dashboard for free.
   *
   * Callers retain the escape hatch of passing `configKey` directly.
   */
  /**
   * Optional logger that receives SDK-internal warnings and errors (transport
   * failures, SSE errors, telemetry POST failures, etc.). When omitted, the
   * SDK writes to `console.warn`/`console.error` with a `[quonfig]` prefix.
   *
   * Shape matches Pino, Winston, Bunyan, and `console`, so host apps can pass
   * their existing logger instance directly.
   */
  logger?: Logger;
  loggerKey?: string;
}

/** Context name under which the logger-path convenience injects the logger path. */
export const QUONFIG_SDK_LOGGING_CONTEXT_NAME = "quonfig-sdk-logging";

// ---- Evaluation Result ----

export interface EvalMatch {
  isMatch: boolean;
  value?: Value;
  ruleIndex: number;
  weightedValueIndex: number;
}

// ---- Public Evaluation Details (for *Details API) ----

/** Reason returned by `get*Details` methods. Mirrors OpenFeature StandardResolutionReasons subset. */
export type EvaluationReason = "STATIC" | "TARGETING_MATCH" | "SPLIT" | "DEFAULT" | "ERROR";

/** Error code returned alongside `reason: "ERROR"` from `get*Details` methods. */
export type EvaluationErrorCode = "FLAG_NOT_FOUND" | "TYPE_MISMATCH" | "GENERAL";

/**
 * Result of a `get*Details` evaluation. Includes the resolved value (when
 * available) plus a reason describing how the value was selected, along with
 * an optional error code when the reason is `"ERROR"`.
 */
export interface EvaluationDetails<T> {
  value: T | undefined;
  reason: EvaluationReason;
  errorCode?: EvaluationErrorCode;
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
  reason: number;
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
  reason: number;
}

// ---- Raw Match (server-side dependency resolution) ----

export interface RawEvaluationMetadata {
  configRowIndex: number;
  conditionalValueIndex: number;
  weightedValueIndex?: number;
  type: ConfigTypeString;
  id: string;
  valueType: ValueType;
}

export type RawDependencyType = "decryptWith" | "providedBy";

export interface RawDependency {
  dependencyType: RawDependencyType;
  source: string;
  config?: RawConfigWithDependencies;
}

export interface RawConfigWithDependencies {
  key: string;
  type: ValueType;
  value: any;
  confidential?: boolean;
  metadata: RawEvaluationMetadata;
  dependencies?: RawDependency[];
}

export interface RawMatch {
  config: RawConfigWithDependencies;
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
