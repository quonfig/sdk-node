import type { Logger } from "./sdkLogger";

/**
 * SSE connection lifecycle states surfaced via QuonfigOptions.onSSEConnectionStateChange.
 * See {@link QuonfigOptions.onSSEConnectionStateChange} for transition details.
 */
export type SSEConnectionState = "connecting" | "connected" | "error" | "disconnected";

/**
 * Aggregate connection state surfaced via {@link Quonfig.connectionState}.
 *
 * - `initializing` — `init()` has not yet completed.
 * - `connected` — SSE is live (or the SDK is running in datadir/datafile mode).
 * - `disconnected` — neither SSE nor the fallback poller is currently delivering
 *   updates (e.g. SSE errored but the fallback grace timer has not elapsed, or
 *   `close()` was called).
 * - `falling_back` — the Layer 2 HTTP fallback poller is the active update channel.
 *
 * Diagnostic only — see the README for why this MUST NOT be wired into a
 * Kubernetes liveness probe.
 */
export type ConnectionState = "connected" | "disconnected" | "falling_back" | "initializing";

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
  /**
   * Monotonic, per-branch commit counter (api-delivery emits `git rev-list
   * --count HEAD` alongside the unordered SHA in `version`). A higher
   * generation is strictly newer, so the canonical-ordering install guard can
   * compare two snapshots and keep an established client from regressing to an
   * older payload (qfg-7h5d.1.7). Optional: servers that predate the watermark
   * omit it, in which case it reads as `undefined` and is treated as 0.
   */
  generation?: number;
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
  /**
   * Enable HTTP polling as a *fallback* when SSE is unavailable. Defaults to
   * `true`. The poller only runs when:
   *   1. SSE is configured but the initial connection fails (DNS, TLS, HTTP
   *      error before any successful onopen), OR
   *   2. SSE has been disconnected and unable to reconnect for >= 2x
   *      `fallbackPollIntervalMs` (default 120s).
   * When SSE recovers (next successful onopen), the fallback poller stops.
   * Set to `false` to disable the fallback entirely.
   */
  fallbackPollEnabled?: boolean;
  /** Interval between fallback-poll fetches in ms. Default 60000 (60s). */
  fallbackPollIntervalMs?: number;
  /**
   * Read deadline for the SSE stream in ms. The SDK wraps the underlying
   * `fetch` with an `AbortController` that resets on each chunk; if no chunk
   * arrives within this window the socket is dropped and the eventsource
   * library reconnects. Default 90000 (3x the 30s server heartbeat).
   */
  sseReadDeadlineMs?: number;
  /**
   * @deprecated Use `fallbackPollEnabled` instead. The old name configured a
   * parallel poller that ran alongside SSE; the new option configures a
   * fallback that only runs when SSE is unavailable. Mapping is automatic
   * with a deprecation warning.
   */
  enablePolling?: boolean;
  /**
   * @deprecated Use `fallbackPollIntervalMs` instead. Mapping is automatic
   * with a deprecation warning.
   */
  pollInterval?: number;
  /**
   * Per-URL deadline (ms) for a single config-fetch attempt. Applies uniformly
   * to the initial fetch and to every fallback-poll fetch: each base URL in the
   * failover list gets its own timeout, so when one leg hangs (accepts the
   * connection but never responds) the attempt aborts after this window and the
   * next leg (e.g. the secondary) is reached inside the overall `initTimeout`
   * instead of being starved until it. Default 3000ms. Additive and
   * backward-compatible — the default already makes a hung upstream fail over,
   * so existing callers need not set it. Bounds the HTTP config path only; it
   * does not touch the long-lived SSE stream. (qfg-7h5d.1.7)
   */
  configFetchTimeoutMs?: number;
  /**
   * Hedge delay (ms) on the parallel-failover config-fetch path: how long to
   * wait for the primary leg before ALSO firing the secondary in parallel
   * (without cancelling the primary). A fast healthy primary answers well inside
   * this window, so the secondary is never contacted (cold standby, zero extra
   * load). Default 2000ms. Additive and backward-compatible. Bounds the HTTP
   * config path only; it does not touch the long-lived SSE stream.
   * (qfg-7h5d.1.14)
   */
  configFetchHedgeDelayMs?: number;
  /**
   * Per-leg hard-abort deadline (ms) on the parallel-failover config-fetch path.
   * Each hedged leg is bounded by this. It must exceed the longest healable
   * primary latency so a late-but-newer primary heals forward (rather than being
   * aborted), and should be less than `initTimeout` so the init-path heal leg is
   * not clipped — the SDK logs a one-time warning at construction if
   * `initTimeout <= configFetchHedgeAbortMs`. Default 6000ms. Additive and
   * backward-compatible. (qfg-7h5d.1.14)
   */
  configFetchHedgeAbortMs?: number;
  namespace?: string;
  globalContext?: Contexts;
  onNoDefault?: OnNoDefault;
  collectEvaluationSummaries?: boolean;
  contextUploadMode?: ContextUploadMode;
  initTimeout?: number;
  datadir?: string;
  datafile?: string | object;
  /** Environment name to use in datadir mode. Supersedes the QUONFIG_ENVIRONMENT env var. */
  environment?: string;
  /**
   * Opt in to live filesystem watching in datadir mode. When `true` and a
   * `datadir` is set, the SDK watches the directory and re-reads the envelope
   * via the existing loader whenever files change on disk (editor save, git
   * pull, build step). A successful swap fires `onConfigUpdate` exactly as
   * SSE/poll updates do.
   *
   * Default `false` — datadir mode is silent until you opt in.
   *
   * Behavior contract:
   *   - **Parse-then-swap**: on parse error the previous envelope continues to
   *     serve reads and the error is logged. `onConfigUpdate` is NOT fired.
   *   - **Debounced**: bursts of fs events (atomic-rename saves, git pull
   *     touching dozens of files) are coalesced into a single reload via
   *     {@link QuonfigOptions.dataDirAutoReloadDebounceMs}.
   *   - **Graceful degrade**: if watch registration fails (read-only fs,
   *     immutable container), the SDK logs and continues without watching
   *     rather than throwing.
   *   - **Symlinks**: the watcher resolves `datadir` to its real path at start
   *     time; atomic symlink flips that retarget the link are NOT detected.
   *   - **Cleanup**: `close()` stops the watcher and clears any pending
   *     debounce timer.
   */
  dataDirAutoReload?: boolean;
  /**
   * Debounce window in ms for {@link QuonfigOptions.dataDirAutoReload}. Default
   * 200 — long enough to coalesce typical editor atomic-rename bursts (3-5
   * events in <50ms) and git-pull churn, short enough that interactive edits
   * feel immediate. Has no effect when `dataDirAutoReload` is `false`.
   */
  dataDirAutoReloadDebounceMs?: number;
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
   * When enabled, the SDK reads `~/.quonfig/tokens.json` (written by
   * `qfg login`) on construction and injects
   * `{ "quonfig-user": { email: <userEmail> } }` into globalContext.
   *
   * Default ON, gated only by the presence of the tokens file. The injected
   * attribute is dev-only by construction: production servers never have the
   * tokens file, so rules keyed on `quonfig-user.email` are dead code in prod
   * and the loader no-ops there. Customer-supplied globalContext keys win on
   * collision.
   *
   * Tri-state precedence: this explicit option (if set) wins, else the
   * `QUONFIG_DEV_CONTEXT` env var (`"true"`/`"false"`), else `true`. Set this
   * to `false` (or `QUONFIG_DEV_CONTEXT=false`) to opt out.
   */
  enableQuonfigUserContext?: boolean | null;
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
 *
 * `variant` and `flagMetadata` follow the cross-SDK spec
 * `project/plans/openfeature-resolution-details.md`. `errorMessage` is set
 * only when `reason === "ERROR"`.
 */
export interface EvaluationDetails<T> {
  value: T | undefined;
  reason: EvaluationReason;
  errorCode?: EvaluationErrorCode;
  errorMessage?: string;
  variant?: string;
  flagMetadata?: Record<string, unknown>;
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
