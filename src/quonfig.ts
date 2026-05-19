import { randomUUID } from "crypto";
import { readFileSync } from "fs";

import type {
  ConfigEnvelope,
  ConfigTypeString,
  ConnectionState,
  Contexts,
  ContextUploadMode,
  Evaluation,
  EvaluationDetails,
  EvaluationErrorCode,
  EvaluationReason,
  GetValue,
  LogLevelName,
  LogLevelNumber,
  OnNoDefault,
  QuonfigOptions,
  RawMatch,
  SSEConnectionState,
  Value,
  ValueType,
} from "./types";
import { QUONFIG_SDK_LOGGING_CONTEXT_NAME } from "./types";

import { ConfigStore } from "./store";
import { Evaluator } from "./evaluator";
import { Resolver } from "./resolver";
import { ConfigDependencyResolver } from "./rawMatch";
import { Transport, defaultApiUrls } from "./transport";
import { computeReason, ReasonStatic, ReasonTargetingMatch, ReasonSplit } from "./reason";
import { SSEConnection, type EventSourceFactory } from "./sse";
import { mergeContexts } from "./context";
import { normalizeLogger, type NormalizedLogger } from "./sdkLogger";
import { parseLevel, shouldLog } from "./logger";
import { durationToMilliseconds } from "./duration";
import { loadEnvelopeFromDatadir } from "./datadir";
import { DatadirWatcher } from "./datadirWatcher";
import { loadQuonfigUserContext } from "./devContext";

import { EvaluationSummaryCollector } from "./telemetry/evaluationSummaries";
import { ContextShapeCollector } from "./telemetry/contextShapes";
import { ExampleContextCollector } from "./telemetry/exampleContexts";
import { TelemetryReporter } from "./telemetry/reporter";

const DEFAULT_FALLBACK_POLL_INTERVAL_MS = 60000;
const DEFAULT_INIT_TIMEOUT = 10000;
const DEFAULT_LOG_LEVEL: LogLevelNumber = 5; // warn
const DEFAULT_DATADIR_AUTORELOAD_DEBOUNCE_MS = 200;

/** Caller-side type token used by the *Details API for type-mismatch detection. */
type RequestedType = "bool" | "string" | "number" | "string_list" | "json";

/**
 * Decide whether the requested type is compatible with the config's declared
 * valueType. The requested side is the caller's intent (e.g. `getBoolDetails`);
 * the actual side is the server-declared `valueType`. Weighted-values configs
 * declare their underlying type in `valueType`, so the check is straightforward.
 */
function isCompatibleValueType(requested: RequestedType, actual: ValueType): boolean {
  switch (requested) {
    case "bool":
      return actual === "bool";
    case "string":
      // log-level configs are commonly read as strings ("DEBUG", etc.).
      return actual === "string" || actual === "log_level";
    case "number":
      return actual === "int" || actual === "double" || actual === "duration";
    case "string_list":
      return actual === "string_list";
    case "json":
      // JSON-shaped reads accept JSON or string_list (callers fall back).
      return actual === "json" || actual === "string_list";
  }
}

/**
 * BoundQuonfig is a Quonfig client bound to a specific context.
 * All get* calls automatically include the bound context.
 */
export class BoundQuonfig {
  private client: Quonfig;
  private boundContexts: Contexts;

  constructor(client: Quonfig, contexts: Contexts) {
    this.client = client;
    this.boundContexts = contexts;
  }

  get(key: string, contexts?: Contexts, defaultValue?: any): any {
    return this.client.get(key, mergeContexts(this.boundContexts, contexts), defaultValue);
  }

  getString(key: string, contexts?: Contexts): string | undefined {
    return this.client.getString(key, mergeContexts(this.boundContexts, contexts));
  }

  getNumber(key: string, contexts?: Contexts): number | undefined {
    return this.client.getNumber(key, mergeContexts(this.boundContexts, contexts));
  }

  getBool(key: string, contexts?: Contexts): boolean | undefined {
    return this.client.getBool(key, mergeContexts(this.boundContexts, contexts));
  }

  getStringList(key: string, contexts?: Contexts): string[] | undefined {
    return this.client.getStringList(key, mergeContexts(this.boundContexts, contexts));
  }

  getDuration(key: string, contexts?: Contexts): number | undefined {
    return this.client.getDuration(key, mergeContexts(this.boundContexts, contexts));
  }

  getJSON(key: string, contexts?: Contexts): any {
    return this.client.getJSON(key, mergeContexts(this.boundContexts, contexts));
  }

  getBoolDetails(key: string, contexts?: Contexts): EvaluationDetails<boolean> {
    return this.client.getBoolDetails(key, mergeContexts(this.boundContexts, contexts));
  }

  getStringDetails(key: string, contexts?: Contexts): EvaluationDetails<string> {
    return this.client.getStringDetails(key, mergeContexts(this.boundContexts, contexts));
  }

  getNumberDetails(key: string, contexts?: Contexts): EvaluationDetails<number> {
    return this.client.getNumberDetails(key, mergeContexts(this.boundContexts, contexts));
  }

  getStringListDetails(key: string, contexts?: Contexts): EvaluationDetails<string[]> {
    return this.client.getStringListDetails(key, mergeContexts(this.boundContexts, contexts));
  }

  getJSONDetails(key: string, contexts?: Contexts): EvaluationDetails<unknown> {
    return this.client.getJSONDetails(key, mergeContexts(this.boundContexts, contexts));
  }

  isEnabled(key: string, contexts?: Contexts): boolean {
    return this.client.isEnabled(key, mergeContexts(this.boundContexts, contexts));
  }

  /** @deprecated Use `isEnabled` instead. Kept for backwards compatibility with the Reforge launch SDK and earlier Quonfig releases. */
  isFeatureEnabled(key: string, contexts?: Contexts): boolean {
    return this.isEnabled(key, contexts);
  }

  shouldLog(args: {
    configKey: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean;
  shouldLog(args: {
    loggerPath: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean;
  shouldLog(args: {
    configKey?: string;
    loggerPath?: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean {
    return this.client.shouldLog({
      ...(args as any),
      contexts: mergeContexts(this.boundContexts, args.contexts),
    });
  }

  async flush(): Promise<void> {
    return this.client.flush();
  }

  keys(): string[] {
    return this.client.keys();
  }

  inContext(contexts: Contexts): BoundQuonfig;
  inContext<T>(contexts: Contexts, fn: (rf: BoundQuonfig) => T): T;
  inContext<T>(contexts: Contexts, fn?: (rf: BoundQuonfig) => T): BoundQuonfig | T {
    const bound = new BoundQuonfig(this.client, mergeContexts(this.boundContexts, contexts));
    return fn ? fn(bound) : bound;
  }
}

/**
 * Quonfig is the main SDK client.
 *
 * Usage:
 * ```typescript
 * const quonfig = new Quonfig({ sdkKey: "your-key" });
 * await quonfig.init();
 * const value = quonfig.get("my-config");
 * ```
 */
export class Quonfig {
  private readonly sdkKey: string;
  private readonly apiUrls: string[];
  private readonly telemetryUrl?: string;
  private readonly enableSSE: boolean;
  private readonly fallbackPollEnabled: boolean;
  private readonly fallbackPollIntervalMs: number;
  private readonly sseReadDeadlineMs?: number;
  private readonly namespace?: string;
  private readonly onNoDefault: OnNoDefault;
  private readonly globalContext: Contexts;
  private readonly initTimeout: number;
  private readonly datadir?: string;
  private readonly datafile?: string | object;
  private readonly requestedEnvironment: string;
  private readonly dataDirAutoReload: boolean;
  private readonly dataDirAutoReloadDebounceMs: number;
  private datadirWatcher?: DatadirWatcher;
  private readonly onConfigUpdate?: () => void;
  private readonly onSSEConnectionStateChange?: (state: SSEConnectionState) => void;
  private readonly loggerKey?: string;
  private readonly logger: NormalizedLogger;
  private readonly testEventSourceFactory?: EventSourceFactory;

  private store: ConfigStore;
  private evaluator: Evaluator;
  private resolver: Resolver;
  private dependencyResolver: ConfigDependencyResolver;
  private transport: Transport;
  private sseConnection?: SSEConnection;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private fallbackPollerEngaged: boolean = false;
  private fallbackEngageTimer?: ReturnType<typeof setTimeout>;
  private sseEverConnected: boolean = false;
  private lastSSEState?: SSEConnectionState;
  private lastSuccessfulRefreshAt?: Date;
  private closed: boolean = false;
  private telemetryReporter?: TelemetryReporter;
  private instanceHash: string;
  private environmentId: string = "";
  private initialized: boolean = false;

  // Telemetry collectors
  private evaluationSummaries: EvaluationSummaryCollector;
  private contextShapes: ContextShapeCollector;
  private exampleContexts: ExampleContextCollector;

  constructor(options: QuonfigOptions) {
    this.sdkKey = options.sdkKey ?? process.env.QUONFIG_BACKEND_SDK_KEY ?? "";
    if (!this.sdkKey && !options.datadir && !options.datafile) {
      throw new Error(
        'Quonfig SDK requires an SDK key. Pass sdkKey: "qf_sk_..." in the constructor options, or set the QUONFIG_BACKEND_SDK_KEY environment variable. Note: the option name is sdkKey, not apiKey.'
      );
    }
    // apiUrls resolution: explicit option > options.domain > QUONFIG_DOMAIN > default.
    this.apiUrls = options.apiUrls ?? defaultApiUrls({ domain: options.domain });
    if (this.apiUrls.length === 0) {
      throw new Error("[quonfig] apiUrls must not be empty");
    }
    this.telemetryUrl = options.telemetryUrl;
    this.enableSSE = options.enableSSE ?? true;
    this.logger = normalizeLogger(options.logger);

    // Map deprecated enablePolling/pollInterval onto the new fallback options.
    // The behavior change (parallel → fallback-only) is intentional per the
    // sdk-hardening plan; alpha phase, no semver hold (resolved Q1).
    let fallbackEnabled: boolean;
    let fallbackInterval: number;
    if (options.enablePolling !== undefined) {
      this.logger.warn(
        "[quonfig] `enablePolling` is deprecated; use `fallbackPollEnabled`. The new option only polls when SSE is unavailable (was: parallel poll on top of SSE)."
      );
      fallbackEnabled = options.fallbackPollEnabled ?? options.enablePolling;
    } else {
      fallbackEnabled = options.fallbackPollEnabled ?? true;
    }
    if (options.pollInterval !== undefined) {
      this.logger.warn("[quonfig] `pollInterval` is deprecated; use `fallbackPollIntervalMs`.");
      fallbackInterval = options.fallbackPollIntervalMs ?? options.pollInterval;
    } else {
      fallbackInterval = options.fallbackPollIntervalMs ?? DEFAULT_FALLBACK_POLL_INTERVAL_MS;
    }
    this.fallbackPollEnabled = fallbackEnabled;
    this.fallbackPollIntervalMs = fallbackInterval;
    this.sseReadDeadlineMs = options.sseReadDeadlineMs;
    this.testEventSourceFactory = (options as any).__testEventSourceFactory;

    this.namespace = options.namespace;
    this.onNoDefault = options.onNoDefault ?? "error";
    const devContextEnabled =
      options.enableQuonfigUserContext === true || process.env.QUONFIG_DEV_CONTEXT === "true";
    const devContext = devContextEnabled
      ? loadQuonfigUserContext(this.apiUrls, options.logger)
      : undefined;
    this.globalContext = mergeContexts(devContext, options.globalContext);
    this.initTimeout = options.initTimeout ?? DEFAULT_INIT_TIMEOUT;
    this.datadir = options.datadir;
    this.datafile = options.datafile;
    // Environment: explicit option supersedes QUONFIG_ENVIRONMENT env var
    this.requestedEnvironment = options.environment || process.env.QUONFIG_ENVIRONMENT || "";
    this.dataDirAutoReload = options.dataDirAutoReload ?? false;
    this.dataDirAutoReloadDebounceMs =
      options.dataDirAutoReloadDebounceMs ?? DEFAULT_DATADIR_AUTORELOAD_DEBOUNCE_MS;
    this.onConfigUpdate = options.onConfigUpdate;
    this.onSSEConnectionStateChange = options.onSSEConnectionStateChange;
    this.loggerKey = options.loggerKey;
    this.instanceHash = randomUUID();

    // Initialize core components
    this.store = new ConfigStore();
    this.evaluator = new Evaluator(this.store);
    this.resolver = new Resolver(this.store, this.evaluator);
    this.dependencyResolver = new ConfigDependencyResolver(this.store, this.evaluator);
    this.transport = new Transport(
      this.apiUrls,
      this.sdkKey,
      this.telemetryUrl,
      options.domain,
      options.logger
    );

    // Initialize telemetry collectors
    const contextUploadMode: ContextUploadMode = options.contextUploadMode ?? "periodic_example";
    this.evaluationSummaries = new EvaluationSummaryCollector(
      options.collectEvaluationSummaries ?? true
    );
    this.contextShapes = new ContextShapeCollector(contextUploadMode);
    this.exampleContexts = new ExampleContextCollector(contextUploadMode);
  }

  /**
   * Initialize the SDK. Downloads configs from the API (or loads from datadir/datafile)
   * and starts background update mechanisms (SSE/polling).
   *
   * Must be called before using any get* methods.
   */
  async init(): Promise<void> {
    if (this.datadir || this.datafile) {
      this.loadLocalData();
      this.initialized = true;
      if (this.datadir && this.dataDirAutoReload) {
        this.startDatadirWatcher();
      }
      this.startTelemetry();
      return;
    }

    // Fetch configs with a timeout
    const fetchPromise = this.fetchAndInstall();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Initialization timed out")), this.initTimeout);
    });

    try {
      await Promise.race([fetchPromise, timeoutPromise]);
    } catch (err) {
      this.logger.warn("Initialization failed:", err);
      throw err;
    }

    this.initialized = true;

    // Boot log: announce the chosen update mode so deployers can see the new
    // SSE-with-fallback behavior at startup. Per qfg-47c2.7 acceptance.
    this.logBootMode();

    // Start SSE for real-time updates
    if (this.enableSSE) {
      this.startSSE();
    } else if (this.fallbackPollEnabled) {
      // No SSE configured — Layer 2 acts as the *only* update channel.
      this.engageFallbackPoller("sse-disabled");
    }

    // Start telemetry reporter
    this.startTelemetry();
  }

  private logBootMode(): void {
    if (this.enableSSE && this.fallbackPollEnabled) {
      this.logger.info(
        `[quonfig] update channel: SSE (real-time) with HTTP fallback poll every ${this.fallbackPollIntervalMs}ms when SSE is unavailable`
      );
    } else if (this.enableSSE) {
      this.logger.info(
        "[quonfig] update channel: SSE only (fallback poll disabled — set fallbackPollEnabled=true for HTTP fallback during SSE outages)"
      );
    } else if (this.fallbackPollEnabled) {
      this.logger.info(
        `[quonfig] update channel: HTTP polling only (every ${this.fallbackPollIntervalMs}ms; SSE disabled)`
      );
    } else {
      this.logger.info(
        "[quonfig] update channel: NONE (both SSE and fallback poll are disabled — config will not refresh after init)"
      );
    }
  }

  /**
   * Get a config value by key. Evaluates rules against the provided context.
   */
  get(key: string, contexts?: Contexts, defaultValue?: any): any {
    this.requireInitialized();

    const mergedContexts = mergeContexts(this.globalContext, contexts);
    const config = this.store.get(key);

    if (config === undefined) {
      return this.handleNoDefault(key, defaultValue);
    }

    // Record context for telemetry
    this.contextShapes.push(mergedContexts);
    this.exampleContexts.push(mergedContexts);

    // Evaluate
    const match = this.evaluator.evaluateConfig(config, this.environmentId, mergedContexts);

    if (!match.isMatch || match.value === undefined) {
      return this.handleNoDefault(key, defaultValue);
    }

    // Resolve (ENV_VAR, decryption)
    const { resolved, reportableValue } = this.resolver.resolveValue(
      match.value,
      config.key,
      config.valueType,
      this.environmentId,
      mergedContexts
    );

    // Unwrap to plain value
    const unwrapped = this.resolver.unwrapValue(resolved);

    // Record evaluation for telemetry
    const evaluation: Evaluation = {
      configId: config.id,
      configKey: config.key,
      configType: config.type,
      unwrappedValue: unwrapped as GetValue,
      reportableValue: reportableValue,
      ruleIndex: match.ruleIndex,
      weightedValueIndex: match.weightedValueIndex >= 0 ? match.weightedValueIndex : undefined,
      reason: computeReason(match, config),
    };
    this.evaluationSummaries.push(evaluation);

    return unwrapped;
  }

  /**
   * Get a string config value.
   */
  getString(key: string, contexts?: Contexts): string | undefined {
    const value = this.get(key, contexts, undefined);
    if (value === undefined) return undefined;
    return String(value);
  }

  /**
   * Get a boolean config value with evaluation details (reason + error code).
   *
   * Unlike {@link Quonfig.getBool}, this method NEVER throws — errors are
   * surfaced as `{ value: undefined, reason: "ERROR", errorCode: ... }`.
   */
  getBoolDetails(key: string, contexts?: Contexts): EvaluationDetails<boolean> {
    return this.evaluateDetailsTyped<boolean>(key, "bool", contexts, (raw) => {
      if (typeof raw === "boolean") return raw;
      // weighted_values can resolve to other types; coerce defensively
      return !!raw;
    });
  }

  /**
   * Get a string config value with evaluation details (reason + error code).
   * Never throws — errors surface via `reason: "ERROR"` + `errorCode`.
   */
  getStringDetails(key: string, contexts?: Contexts): EvaluationDetails<string> {
    return this.evaluateDetailsTyped<string>(key, "string", contexts, (raw) => String(raw));
  }

  /**
   * Get a numeric config value with evaluation details (reason + error code).
   * Never throws — errors surface via `reason: "ERROR"` + `errorCode`.
   */
  getNumberDetails(key: string, contexts?: Contexts): EvaluationDetails<number> {
    return this.evaluateDetailsTyped<number>(key, "number", contexts, (raw) => {
      if (typeof raw === "number") return raw;
      const n = Number(raw);
      return Number.isNaN(n) ? (undefined as unknown as number) : n;
    });
  }

  /**
   * Get a string-list config value with evaluation details (reason + error code).
   * Never throws — errors surface via `reason: "ERROR"` + `errorCode`.
   */
  getStringListDetails(key: string, contexts?: Contexts): EvaluationDetails<string[]> {
    return this.evaluateDetailsTyped<string[]>(key, "string_list", contexts, (raw) => {
      if (Array.isArray(raw)) return raw.map((v: any) => String(v));
      return undefined as unknown as string[];
    });
  }

  /**
   * Get a JSON config value with evaluation details (reason + error code).
   * Never throws — errors surface via `reason: "ERROR"` + `errorCode`.
   */
  getJSONDetails(key: string, contexts?: Contexts): EvaluationDetails<unknown> {
    return this.evaluateDetailsTyped<unknown>(key, "json", contexts, (raw) => raw);
  }

  /**
   * Get a number config value.
   */
  getNumber(key: string, contexts?: Contexts): number | undefined {
    const value = this.get(key, contexts, undefined);
    if (value === undefined) return undefined;
    return typeof value === "number" ? value : Number(value);
  }

  /**
   * Get a boolean config value.
   */
  getBool(key: string, contexts?: Contexts): boolean | undefined {
    const value = this.get(key, contexts, undefined);
    if (value === undefined) return undefined;
    return !!value;
  }

  /**
   * Get a string list config value.
   */
  getStringList(key: string, contexts?: Contexts): string[] | undefined {
    const value = this.get(key, contexts, undefined);
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value.map((v: any) => String(v));
    return undefined;
  }

  /**
   * Get a duration config value in milliseconds.
   */
  getDuration(key: string, contexts?: Contexts): number | undefined {
    const value = this.get(key, contexts, undefined);
    if (value === undefined) return undefined;
    // If the evaluator already unwrapped it to ms (duration type), return as-is
    if (typeof value === "number") return value;
    // If it's a string, parse it
    if (typeof value === "string") return durationToMilliseconds(value);
    return undefined;
  }

  /**
   * Get a JSON config value (parsed).
   */
  getJSON(key: string, contexts?: Contexts): any {
    const value = this.get(key, contexts, undefined);
    if (value === undefined) return undefined;
    // If already parsed (from unwrap), return as-is
    return value;
  }

  /**
   * Check if a feature flag is enabled.
   * Returns false if the key is not found or the value is not a boolean.
   */
  isEnabled(key: string, contexts?: Contexts): boolean {
    const value = this.get(key, contexts, undefined);
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return false;
  }

  /** @deprecated Use `isEnabled` instead. Kept for backwards compatibility with the Reforge launch SDK and earlier Quonfig releases. */
  isFeatureEnabled(key: string, contexts?: Contexts): boolean {
    return this.isEnabled(key, contexts);
  }

  /**
   * Check if a log message should be logged at the given level.
   *
   * Two shapes are supported:
   *
   * 1. `{configKey, ...}` — primitive shape. Evaluates the named config
   *    as a log level. The caller is responsible for any per-logger routing.
   *
   * 2. `{loggerPath, ...}` — convenience shape. Requires `loggerKey` on
   *    the Quonfig constructor. The SDK evaluates `loggerKey` with
   *    `contexts["quonfig-sdk-logging"] = { key: loggerPath }` merged in,
   *    letting a single config drive per-logger rules. `loggerPath` is
   *    passed through without normalization.
   */
  shouldLog(args: {
    configKey: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean;
  shouldLog(args: {
    loggerPath: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean;
  shouldLog(args: {
    configKey?: string;
    loggerPath?: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean {
    const desiredLevelNum = parseLevel(args.desiredLevel);
    if (desiredLevelNum === undefined) {
      this.logger.warn(`Invalid desiredLevel "${args.desiredLevel}". Returning true.`);
      return true;
    }

    const defaultLevelNum = parseLevel(args.defaultLevel) ?? DEFAULT_LOG_LEVEL;

    let resolvedConfigKey: string;
    let resolvedContexts: Contexts | undefined = args.contexts;

    if (args.loggerPath !== undefined) {
      if (args.configKey !== undefined) {
        throw new Error("[quonfig] shouldLog: pass either `configKey` or `loggerPath`, not both.");
      }
      if (!this.loggerKey) {
        throw new Error(
          "[quonfig] shouldLog({loggerPath}) requires the `loggerKey` option on the Quonfig constructor. " +
            'Pass `loggerKey: "log-level.<your-app>"` or use the `configKey` form instead.'
        );
      }
      resolvedConfigKey = this.loggerKey;
      // Inject the logger path under the quonfig-sdk-logging context with a
      // `key` property. The existing example-context telemetry (see
      // src/telemetry/exampleContexts.ts) auto-captures contexts that have a
      // `key`, so logger paths show up in the dashboard for free.
      resolvedContexts = mergeContexts(args.contexts, {
        [QUONFIG_SDK_LOGGING_CONTEXT_NAME]: { key: args.loggerPath },
      });
    } else if (args.configKey !== undefined) {
      resolvedConfigKey = args.configKey;
    } else {
      throw new Error("[quonfig] shouldLog requires either `configKey` or `loggerPath`.");
    }

    return shouldLog({
      configKey: resolvedConfigKey,
      desiredLevel: desiredLevelNum,
      defaultLevel: defaultLevelNum,
      getConfig: (logKey: string) => {
        try {
          return this.get(logKey, resolvedContexts, undefined);
        } catch {
          return undefined;
        }
      },
    });
  }

  /**
   * Get all config keys currently in the store.
   */
  keys(): string[] {
    this.requireInitialized();
    return this.store.keys();
  }

  /**
   * Server-safe raw match: returns the matched Value + a dependency tree
   * (decryptWith / providedBy) WITHOUT reading process.env and WITHOUT
   * calling decrypt(). For use on servers that ship config to customer SDKs;
   * customer SDKs resolve the dependencies in their own runtime.
   */
  getRawMatch(key: string, contexts?: Contexts): RawMatch | undefined {
    this.requireInitialized();
    const mergedContexts = mergeContexts(this.globalContext, contexts);
    return this.dependencyResolver.resolveWithDependencies(key, this.environmentId, mergedContexts);
  }

  /**
   * Get the raw ConfigResponse for a key (for advanced usage / CLI tooling).
   */
  rawConfig(key: string): import("./types").ConfigResponse | undefined {
    this.requireInitialized();
    return this.store.get(key);
  }

  /**
   * Wall-clock time of the most recent envelope install, from any source (SSE
   * push, fallback poll, or initial fetch / datadir load).
   *
   * Returns `undefined` if no envelope has been installed yet.
   *
   * **Diagnostic only.** Do NOT wire this into a Kubernetes liveness probe —
   * a transient network blip will trip any freshness threshold and cause a
   * rolling restart cascade. See the README "Diagnostic health signals"
   * section.
   */
  lastSuccessfulRefresh(): Date | undefined {
    return this.lastSuccessfulRefreshAt;
  }

  /**
   * Current aggregate connection state for this client.
   *
   * - `initializing` — `init()` has not yet completed.
   * - `connected` — SSE is live, or the SDK is running from a local
   *   datadir/datafile and has loaded its envelope.
   * - `disconnected` — no channel is currently delivering updates (SSE has
   *   errored but the fallback grace timer has not elapsed yet, or `close()`
   *   has been called).
   * - `falling_back` — the Layer 2 HTTP fallback poller is the active update
   *   channel.
   *
   * **Diagnostic only.** Do NOT wire this into a Kubernetes liveness probe —
   * see the README "Diagnostic health signals" section.
   */
  connectionState(): ConnectionState {
    if (this.closed) return "disconnected";
    if (!this.initialized) return "initializing";
    if (this.fallbackPollerEngaged) return "falling_back";
    if (this.sseConnection && this.lastSSEState !== "connected") return "disconnected";
    return "connected";
  }

  /**
   * Create a BoundQuonfig with the given context baked in.
   *
   * With a callback, invokes `fn` with the BoundQuonfig and returns its result
   * (including Promises), so callers can scope work to a context without
   * leaking the bound client.
   */
  inContext(contexts: Contexts): BoundQuonfig;
  inContext<T>(contexts: Contexts, fn: (rf: BoundQuonfig) => T): T;
  inContext<T>(contexts: Contexts, fn?: (rf: BoundQuonfig) => T): BoundQuonfig | T {
    const bound = new BoundQuonfig(this, mergeContexts(this.globalContext, contexts));
    return fn ? fn(bound) : bound;
  }

  /**
   * Flush pending telemetry data immediately. Useful in serverless environments
   * (Vercel, Lambda) where the process may be frozen before the background
   * timer fires.
   *
   * ```typescript
   * const value = quonfig.get("my-flag", contexts);
   * await quonfig.flush();
   * return NextResponse.json({ value });
   * ```
   */
  async flush(): Promise<void> {
    if (this.telemetryReporter) {
      await this.telemetryReporter.sync();
    }
  }

  /**
   * Close the SDK. Drains pending telemetry, then stops SSE, polling, and
   * the telemetry reporter. Returns a Promise so callers can `await close()`
   * before exiting; matches Go/Ruby/Python "close drains" behavior and the
   * sdk-javascript@0.0.12 contract.
   */
  async close(): Promise<void> {
    await this.flush();

    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = undefined;
    }

    if (this.datadirWatcher) {
      this.datadirWatcher.close();
      this.datadirWatcher = undefined;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.cancelPendingFallbackEngage();
    this.fallbackPollerEngaged = false;

    if (this.telemetryReporter) {
      this.telemetryReporter.stop();
      this.telemetryReporter = undefined;
    }

    this.closed = true;
  }

  // ---- Private methods ----

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new Error("[quonfig] Not initialized. Call init() first.");
    }
  }

  /**
   * Internal: evaluate a config and return {value, reason, errorCode} without
   * throwing. The `requestedType` is used to detect TYPE_MISMATCH against the
   * config's declared `valueType`. When the evaluation produces metadata
   * (configId, configType, ruleIndex, weightedValueIndex), it is returned in
   * `evaluation` so callers can build OpenFeature-style flagMetadata.
   */
  private evaluateDetailsRaw(
    key: string,
    requestedType: RequestedType,
    contexts?: Contexts
  ): {
    value: GetValue | unknown;
    reason: EvaluationReason;
    errorCode?: EvaluationErrorCode;
    errorMessage?: string;
    evaluation?: Evaluation;
    configId?: string;
    configType?: ConfigTypeString;
  } {
    if (!this.initialized) {
      return {
        value: undefined,
        reason: "ERROR",
        errorCode: "GENERAL",
        errorMessage: "Quonfig SDK not initialized",
      };
    }

    let mergedContexts: Contexts;
    let config;
    try {
      mergedContexts = mergeContexts(this.globalContext, contexts);
      config = this.store.get(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { value: undefined, reason: "ERROR", errorCode: "GENERAL", errorMessage: message };
    }

    if (config === undefined) {
      return {
        value: undefined,
        reason: "ERROR",
        errorCode: "FLAG_NOT_FOUND",
        errorMessage: `No config found for key "${key}"`,
      };
    }

    // Type-mismatch check against the config's declared valueType.
    if (!isCompatibleValueType(requestedType, config.valueType)) {
      return {
        value: undefined,
        reason: "ERROR",
        errorCode: "TYPE_MISMATCH",
        errorMessage: `Config "${key}" has type ${config.valueType}, expected ${requestedType}`,
        configId: config.id,
        configType: config.type,
      };
    }

    try {
      this.contextShapes.push(mergedContexts);
      this.exampleContexts.push(mergedContexts);

      const match = this.evaluator.evaluateConfig(config, this.environmentId, mergedContexts);

      if (!match.isMatch || match.value === undefined) {
        return {
          value: undefined,
          reason: "DEFAULT",
          configId: config.id,
          configType: config.type,
        };
      }

      const { resolved, reportableValue } = this.resolver.resolveValue(
        match.value,
        config.key,
        config.valueType,
        this.environmentId,
        mergedContexts
      );

      const unwrapped = this.resolver.unwrapValue(resolved);

      const reasonNum = computeReason(match, config);
      const reason: EvaluationReason =
        reasonNum === ReasonStatic
          ? "STATIC"
          : reasonNum === ReasonSplit
            ? "SPLIT"
            : reasonNum === ReasonTargetingMatch
              ? "TARGETING_MATCH"
              : "TARGETING_MATCH";

      const evaluation: Evaluation = {
        configId: config.id,
        configKey: config.key,
        configType: config.type,
        unwrappedValue: unwrapped as GetValue,
        reportableValue: reportableValue,
        ruleIndex: match.ruleIndex,
        weightedValueIndex: match.weightedValueIndex >= 0 ? match.weightedValueIndex : undefined,
        reason: reasonNum,
      };
      this.evaluationSummaries.push(evaluation);

      return { value: unwrapped, reason, evaluation };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const msg = message.toLowerCase();
      if (msg.includes("type mismatch")) {
        return {
          value: undefined,
          reason: "ERROR",
          errorCode: "TYPE_MISMATCH",
          errorMessage: message,
          configId: config.id,
          configType: config.type,
        };
      }
      return {
        value: undefined,
        reason: "ERROR",
        errorCode: "GENERAL",
        errorMessage: message,
        configId: config.id,
        configType: config.type,
      };
    }
  }

  /**
   * Internal: typed wrapper around evaluateDetailsRaw — applies a value
   * coercer and surfaces TYPE_MISMATCH if the coercer can't produce a value.
   */
  private evaluateDetailsTyped<T>(
    key: string,
    requestedType: RequestedType,
    contexts: Contexts | undefined,
    coerce: (raw: unknown) => T | undefined
  ): EvaluationDetails<T> {
    const raw = this.evaluateDetailsRaw(key, requestedType, contexts);
    if (raw.reason !== "STATIC" && raw.reason !== "TARGETING_MATCH" && raw.reason !== "SPLIT") {
      // DEFAULT or ERROR — pass through with no value but still attach
      // variant + flagMetadata per the cross-SDK spec.
      const base: EvaluationDetails<T> = {
        value: undefined,
        reason: raw.reason,
        variant: this.buildVariant(raw.reason, undefined, undefined),
        flagMetadata: this.buildFlagMetadata(raw.configId, raw.configType, undefined, undefined),
      };
      if (raw.errorCode) base.errorCode = raw.errorCode;
      if (raw.errorMessage) base.errorMessage = raw.errorMessage;
      return base;
    }

    const coerced = coerce(raw.value as unknown);
    if (coerced === undefined) {
      return {
        value: undefined,
        reason: "ERROR",
        errorCode: "TYPE_MISMATCH",
        errorMessage: `Config "${key}" value could not be coerced to ${requestedType}`,
        variant: this.buildVariant("ERROR", undefined, undefined),
        flagMetadata: this.buildFlagMetadata(
          raw.evaluation?.configId,
          raw.evaluation?.configType,
          undefined,
          undefined
        ),
      };
    }

    const ev = raw.evaluation;
    return {
      value: coerced,
      reason: raw.reason,
      variant: this.buildVariant(raw.reason, ev?.ruleIndex, ev?.weightedValueIndex),
      flagMetadata: this.buildFlagMetadata(
        ev?.configId,
        ev?.configType,
        ev?.ruleIndex,
        ev?.weightedValueIndex,
        raw.reason
      ),
    };
  }

  /**
   * Build the variant string per the cross-SDK spec
   * (project/plans/openfeature-resolution-details.md §2).
   */
  private buildVariant(
    reason: EvaluationReason,
    ruleIndex: number | undefined,
    weightedValueIndex: number | undefined
  ): string {
    switch (reason) {
      case "STATIC":
        return "static";
      case "TARGETING_MATCH":
        return ruleIndex !== undefined ? `targeting:${ruleIndex}` : "targeting:0";
      case "SPLIT":
        return weightedValueIndex !== undefined ? `split:${weightedValueIndex}` : "split:0";
      case "DEFAULT":
      case "ERROR":
      default:
        return "default";
    }
  }

  /**
   * Build the flagMetadata map per the cross-SDK spec
   * (project/plans/openfeature-resolution-details.md §3) using node/go/java
   * camelCase keys and SHOUTY_SNAKE configType values.
   */
  private buildFlagMetadata(
    configId: string | undefined,
    configType: ConfigTypeString | undefined,
    ruleIndex: number | undefined,
    weightedValueIndex: number | undefined,
    reason?: EvaluationReason
  ): Record<string, unknown> {
    const md: Record<string, unknown> = {};
    if (configId !== undefined) md.configId = configId;
    if (configType !== undefined) md.configType = configType.toUpperCase();
    if (this.requestedEnvironment) md.environment = this.requestedEnvironment;
    if (
      ruleIndex !== undefined &&
      ruleIndex >= 0 &&
      (reason === "TARGETING_MATCH" || reason === "SPLIT")
    ) {
      md.ruleIndex = ruleIndex;
    }
    if (weightedValueIndex !== undefined && reason === "SPLIT") {
      md.weightedValueIndex = weightedValueIndex;
    }
    return md;
  }

  private handleNoDefault(key: string, defaultValue?: any): any {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    switch (this.onNoDefault) {
      case "error":
        throw new Error(`No value found for key "${key}"`);
      case "warn":
        this.logger.warn(`No value found for key "${key}"`);
        return undefined;
      case "ignore":
        return undefined;
    }
  }

  private loadLocalData(): void {
    const data = this.loadLocalEnvelope();
    this.installEnvelope(data);
  }

  /**
   * Wire up filesystem watching for `datadir` when `dataDirAutoReload` is on.
   * On registration failure (read-only fs, immutable container) we log and
   * continue without watching — the SDK keeps serving the envelope captured
   * at init() time rather than throwing.
   */
  private startDatadirWatcher(): void {
    if (!this.datadir) return;
    const watcher = new DatadirWatcher({
      datadir: this.datadir,
      debounceMs: this.dataDirAutoReloadDebounceMs,
      onChange: () => this.reloadDatadir(),
      onError: (err) => {
        this.logger.warn("[quonfig] datadir watcher error:", err);
      },
    });
    if (!watcher.start()) {
      this.logger.warn(
        "[quonfig] dataDirAutoReload requested but watcher registration failed; continuing without auto-reload"
      );
      return;
    }
    this.datadirWatcher = watcher;
  }

  /**
   * Re-read the datadir into a fresh envelope and atomically install it. Parse
   * errors (mid-write JSON, garbage file) are logged and swallowed: the
   * previous envelope stays in the store and `onConfigUpdate` does NOT fire.
   */
  private reloadDatadir(): void {
    if (this.closed) return;
    if (!this.datadir) return;
    try {
      const envelope = loadEnvelopeFromDatadir(this.datadir, this.requestedEnvironment);
      this.installEnvelope(envelope);
    } catch (err) {
      this.logger.warn("[quonfig] datadir reload failed; keeping previous envelope:", err);
    }
  }

  /**
   * Apply a freshly received envelope to the store, advance the environment id,
   * record the wall-clock refresh time (surfaced via {@link Quonfig.lastSuccessfulRefresh}),
   * and notify the user's `onConfigUpdate` callback.
   */
  private installEnvelope(envelope: ConfigEnvelope): void {
    this.store.update(envelope);
    this.environmentId = envelope.meta.environment;
    this.lastSuccessfulRefreshAt = new Date();
    this.invokeOnConfigUpdate();
  }

  /**
   * Invoke the user's onConfigUpdate callback, catching any thrown error so
   * an exception in user code does not crash the SDK supervisor (Tier 1
   * supervisor contract Test 5; chaos scenario 10).
   */
  private invokeOnConfigUpdate(): void {
    if (!this.onConfigUpdate) return;
    try {
      this.onConfigUpdate();
    } catch (err) {
      this.logger.error("[quonfig] onConfigUpdate callback threw:", err);
    }
  }

  private loadLocalEnvelope(): ConfigEnvelope {
    if (this.datadir) {
      return loadEnvelopeFromDatadir(this.datadir, this.requestedEnvironment);
    }

    if (typeof this.datafile === "string") {
      const raw = readFileSync(this.datafile, "utf-8");
      return JSON.parse(raw);
    }

    if (typeof this.datafile === "object") {
      return this.datafile as ConfigEnvelope;
    }

    throw new Error("Invalid local configuration: expected datadir or datafile");
  }

  private async fetchAndInstall(): Promise<void> {
    const result = await this.transport.fetchConfigs();

    if (result.notChanged) {
      return;
    }

    if (result.envelope) {
      this.installEnvelope(result.envelope);
    }
  }

  private startSSE(): void {
    this.sseConnection = new SSEConnection(this.transport, this.logger, {
      onConnectionStateChange: (state) => this.handleSSEStateChange(state),
      eventSourceFactory: this.testEventSourceFactory,
      readDeadlineMs: this.sseReadDeadlineMs,
    });
    this.sseConnection.start((envelope: ConfigEnvelope) => {
      this.installEnvelope(envelope);
    });
  }

  /**
   * Layer 2 supervisor: react to SSE lifecycle transitions.
   *
   * - First successful "connected" → mark sseEverConnected, clear any fallback.
   * - Subsequent "connected" → clear any fallback (SSE recovered).
   * - "error" before any "connected" → engage fallback immediately (initial-
   *   connect failure: DNS, TLS, HTTP 5xx, etc.).
   * - "error" after a successful "connected" → schedule a 2x-poll-interval
   *   grace timer; if still not reconnected when it fires, engage fallback.
   */
  private handleSSEStateChange(state: SSEConnectionState): void {
    this.lastSSEState = state;

    if (this.onSSEConnectionStateChange) {
      try {
        this.onSSEConnectionStateChange(state);
      } catch (err) {
        this.logger.warn("onSSEConnectionStateChange callback threw:", err);
      }
    }

    if (!this.fallbackPollEnabled) return;

    switch (state) {
      case "connected":
        this.sseEverConnected = true;
        this.cancelPendingFallbackEngage();
        if (this.fallbackPollerEngaged) {
          this.disengageFallbackPoller("sse-recovered");
        }
        break;
      case "error":
        if (!this.sseEverConnected) {
          // Initial-connect failure — start polling now.
          this.engageFallbackPoller("initial-sse-failure");
        } else if (!this.fallbackPollerEngaged && !this.fallbackEngageTimer) {
          // Connected → disconnected edge. Give the eventsource library
          // 2x the poll interval to reconnect on its own (default 120s)
          // before falling back to HTTP polling.
          const grace = this.fallbackPollIntervalMs * 2;
          this.fallbackEngageTimer = setTimeout(() => {
            this.fallbackEngageTimer = undefined;
            this.engageFallbackPoller("sse-disconnected-grace-elapsed");
          }, grace);
          if (
            this.fallbackEngageTimer &&
            typeof this.fallbackEngageTimer === "object" &&
            "unref" in this.fallbackEngageTimer
          ) {
            (this.fallbackEngageTimer as any).unref();
          }
        }
        break;
      case "connecting":
      case "disconnected":
        // No-op for Layer 2: "connecting" is the lifecycle preamble before
        // either "connected" or "error"; "disconnected" only fires on close().
        break;
    }
  }

  private cancelPendingFallbackEngage(): void {
    if (this.fallbackEngageTimer) {
      clearTimeout(this.fallbackEngageTimer);
      this.fallbackEngageTimer = undefined;
    }
  }

  /** Engage Layer 2 fallback polling. No-op if already engaged or disabled. */
  private engageFallbackPoller(reason: string): void {
    if (!this.fallbackPollEnabled || this.fallbackPollerEngaged) return;
    this.fallbackPollerEngaged = true;
    this.logger.warn(
      `[quonfig] SSE unavailable (${reason}); engaging HTTP fallback poll every ${this.fallbackPollIntervalMs}ms`
    );
    this.startFallbackPolling();
  }

  /** Stop Layer 2 fallback polling. No-op if not engaged. */
  private disengageFallbackPoller(reason: string): void {
    if (!this.fallbackPollerEngaged) return;
    this.fallbackPollerEngaged = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.logger.info(`[quonfig] HTTP fallback poll disengaged (${reason})`);
  }

  private startFallbackPolling(): void {
    const poll = (): void => {
      // If we were disengaged while a poll was in flight, abandon scheduling.
      if (!this.fallbackPollerEngaged) return;
      this.fetchAndInstall()
        .catch((err) => {
          this.logger.warn("Fallback poll error:", err);
        })
        .finally(() => {
          if (!this.fallbackPollerEngaged) return;
          this.pollTimer = setTimeout(poll, this.fallbackPollIntervalMs);
          if (this.pollTimer && typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
            this.pollTimer.unref();
          }
        });
    };

    this.pollTimer = setTimeout(poll, this.fallbackPollIntervalMs);
    if (this.pollTimer && typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  /**
   * Internal accessor for the chaos harness and test suite — `true` when the
   * Layer 2 HTTP fallback poller is currently scheduled. NOT part of the
   * public API; the documented `connectionState()` accessor lands in
   * qfg-47c2.14.
   */
  fallbackPollerActive(): boolean {
    return this.fallbackPollerEngaged;
  }

  private startTelemetry(): void {
    // No-account local mode: when the SDK was constructed with only datadir/
    // datafile and no sdkKey, there's nowhere to post telemetry and no
    // workspace to attribute it to. Skip the reporter entirely so an
    // offline/open-source consumer doesn't generate failed POST attempts to
    // telemetry.quonfig.com on every eval.
    if (!this.sdkKey) return;

    const anyEnabled =
      this.evaluationSummaries.isEnabled() ||
      this.contextShapes.isEnabled() ||
      this.exampleContexts.isEnabled();

    if (!anyEnabled) return;

    this.telemetryReporter = new TelemetryReporter({
      transport: this.transport,
      instanceHash: this.instanceHash,
      evaluationSummaries: this.evaluationSummaries,
      contextShapes: this.contextShapes,
      exampleContexts: this.exampleContexts,
      logger: this.logger,
    });

    this.telemetryReporter.start();
  }
}
