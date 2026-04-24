// Main SDK exports
export { Quonfig, BoundQuonfig } from "./quonfig";

// Types
export type {
  QuonfigOptions,
  ConfigEnvelope,
  ConfigResponse,
  ConfigTypeString,
  ValueType,
  Value,
  Rule,
  RuleSet,
  Criterion,
  Environment,
  Meta,
  WorkspaceEnvironment,
  WorkspaceConfigDocument,
  QuonfigDatadirEnvironments,
  Contexts,
  ContextObj,
  ContextValue,
  GetValue,
  OnNoDefault,
  ContextUploadMode,
  LogLevelName,
  LogLevelNumber,
  ProvidedData,
  WeightedValue,
  WeightedValuesData,
  SchemaData,
  EvalMatch,
  Evaluation,
  RawMatch,
  RawConfigWithDependencies,
  RawDependency,
  RawDependencyType,
  RawEvaluationMetadata,
  NodeServerConfigurationRaw,
  NodeServerConfigurationAccessor,
  TypedNodeServerConfigurationRaw,
  TypedNodeServerConfigurationAccessor,
} from "./types";

// Enum-like runtime constants (e.g., ConfigType.FeatureFlag, ProvidedSource.EnvVar)
export { ConfigType, ProvidedSource, QUONFIG_SDK_LOGGING_CONTEXT_NAME } from "./types";

// Context utilities
export { contextLookup, mergeContexts, getContextValue } from "./context";

// Encryption utilities
export { encrypt, decrypt, generateNewHexKey } from "./encryption";

// Encryption namespace (for CLI compatibility: `import { encryption } from '@quonfig/node'`)
import { encrypt as _encrypt, generateNewHexKey as _generateNewHexKey } from "./encryption";
export const encryption = {
  encrypt: _encrypt,
  generateNewHexKey: _generateNewHexKey,
};

// Duration parsing
export { durationToMilliseconds } from "./duration";

// Semver comparison
export { parseSemver, compareSemver } from "./semver";
export type { SemanticVersion } from "./semver";

// Hashing
export { hashZeroToOne } from "./hashing";

// Logger utilities
export { parseLevel, wordLevelToNumber, shouldLog } from "./logger";

// Evaluator (for advanced usage / testing)
export { Evaluator } from "./evaluator";
export { ConfigStore } from "./store";
export { Resolver } from "./resolver";
export { ConfigDependencyResolver } from "./rawMatch";
export { Transport, deriveStreamUrl } from "./transport";
export { WeightedValueResolver } from "./weighted";

// Operators (for advanced usage / testing)
export {
  evaluateCriterion,
  OP_NOT_SET,
  OP_ALWAYS_TRUE,
  OP_PROP_IS_ONE_OF,
  OP_PROP_IS_NOT_ONE_OF,
  OP_PROP_STARTS_WITH_ONE_OF,
  OP_PROP_DOES_NOT_START_WITH_ONE_OF,
  OP_PROP_ENDS_WITH_ONE_OF,
  OP_PROP_DOES_NOT_END_WITH_ONE_OF,
  OP_PROP_CONTAINS_ONE_OF,
  OP_PROP_DOES_NOT_CONTAIN_ONE_OF,
  OP_PROP_MATCHES,
  OP_PROP_DOES_NOT_MATCH,
  OP_HIERARCHICAL_MATCH,
  OP_IN_INT_RANGE,
  OP_PROP_GREATER_THAN,
  OP_PROP_GREATER_THAN_OR_EQUAL,
  OP_PROP_LESS_THAN,
  OP_PROP_LESS_THAN_OR_EQUAL,
  OP_PROP_BEFORE,
  OP_PROP_AFTER,
  OP_PROP_SEMVER_LESS_THAN,
  OP_PROP_SEMVER_EQUAL,
  OP_PROP_SEMVER_GREATER_THAN,
  OP_IN_SEG,
  OP_NOT_IN_SEG,
} from "./operators";
export type { SegmentResolver } from "./operators";

// Telemetry (for advanced usage / testing)
export { EvaluationSummaryCollector } from "./telemetry/evaluationSummaries";
export { ContextShapeCollector } from "./telemetry/contextShapes";
export { ExampleContextCollector } from "./telemetry/exampleContexts";
export { TelemetryReporter } from "./telemetry/reporter";

// CLI compatibility (HTTP client, SDK-key parsing, legacy value types)
export { Client, getProjectEnvFromSdkKey, ConfigValueType, valueTypeStringForConfig } from "./cli-compat";
export type { ClientOptions, ProjectEnvId, ConfigValue } from "./cli-compat";
