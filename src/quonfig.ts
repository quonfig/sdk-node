import { randomUUID } from "crypto";
import { readFileSync } from "fs";

import type {
  ConfigEnvelope,
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
import { SSEConnection } from "./sse";
import { mergeContexts } from "./context";
import { normalizeLogger, type NormalizedLogger } from "./sdkLogger";
import { parseLevel, shouldLog } from "./logger";
import { durationToMilliseconds } from "./duration";
import { loadEnvelopeFromDatadir } from "./datadir";
import { loadQuonfigUserContext } from "./devContext";

import { EvaluationSummaryCollector } from "./telemetry/evaluationSummaries";
import { ContextShapeCollector } from "./telemetry/contextShapes";
import { ExampleContextCollector } from "./telemetry/exampleContexts";
import { TelemetryReporter } from "./telemetry/reporter";

const DEFAULT_POLL_INTERVAL = 60000;
const DEFAULT_INIT_TIMEOUT = 10000;
const DEFAULT_LOG_LEVEL: LogLevelNumber = 5; // warn

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

  isFeatureEnabled(key: string, contexts?: Contexts): boolean {
    return this.client.isFeatureEnabled(key, mergeContexts(this.boundContexts, contexts));
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
  private readonly enablePolling: boolean;
  private readonly pollInterval: number;
  private readonly namespace?: string;
  private readonly onNoDefault: OnNoDefault;
  private readonly globalContext: Contexts;
  private readonly initTimeout: number;
  private readonly datadir?: string;
  private readonly datafile?: string | object;
  private readonly requestedEnvironment: string;
  private readonly onConfigUpdate?: () => void;
  private readonly onSSEConnectionStateChange?: (state: SSEConnectionState) => void;
  private readonly loggerKey?: string;
  private readonly logger: NormalizedLogger;

  private store: ConfigStore;
  private evaluator: Evaluator;
  private resolver: Resolver;
  private dependencyResolver: ConfigDependencyResolver;
  private transport: Transport;
  private sseConnection?: SSEConnection;
  private pollTimer?: ReturnType<typeof setTimeout>;
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
    this.enablePolling = options.enablePolling ?? false;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
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
    this.onConfigUpdate = options.onConfigUpdate;
    this.onSSEConnectionStateChange = options.onSSEConnectionStateChange;
    this.loggerKey = options.loggerKey;
    this.logger = normalizeLogger(options.logger);
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

    // Start SSE for real-time updates
    if (this.enableSSE) {
      this.startSSE();
    }

    // Start polling if enabled
    if (this.enablePolling) {
      this.startPolling();
    }

    // Start telemetry reporter
    this.startTelemetry();
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
  isFeatureEnabled(key: string, contexts?: Contexts): boolean {
    const value = this.get(key, contexts, undefined);
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return false;
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

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.telemetryReporter) {
      this.telemetryReporter.stop();
      this.telemetryReporter = undefined;
    }
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
   * config's declared `valueType`.
   */
  private evaluateDetailsRaw(
    key: string,
    requestedType: RequestedType,
    contexts?: Contexts
  ): { value: GetValue | unknown; reason: EvaluationReason; errorCode?: EvaluationErrorCode } {
    if (!this.initialized) {
      return { value: undefined, reason: "ERROR", errorCode: "GENERAL" };
    }

    let mergedContexts: Contexts;
    let config;
    try {
      mergedContexts = mergeContexts(this.globalContext, contexts);
      config = this.store.get(key);
    } catch (err) {
      return { value: undefined, reason: "ERROR", errorCode: "GENERAL" };
    }

    if (config === undefined) {
      return { value: undefined, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" };
    }

    // Type-mismatch check against the config's declared valueType.
    if (!isCompatibleValueType(requestedType, config.valueType)) {
      return { value: undefined, reason: "ERROR", errorCode: "TYPE_MISMATCH" };
    }

    try {
      this.contextShapes.push(mergedContexts);
      this.exampleContexts.push(mergedContexts);

      const match = this.evaluator.evaluateConfig(config, this.environmentId, mergedContexts);

      if (!match.isMatch || match.value === undefined) {
        return { value: undefined, reason: "DEFAULT" };
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

      return { value: unwrapped, reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (msg.includes("type mismatch")) {
        return { value: undefined, reason: "ERROR", errorCode: "TYPE_MISMATCH" };
      }
      return { value: undefined, reason: "ERROR", errorCode: "GENERAL" };
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
      // DEFAULT or ERROR — pass through with no value
      return raw.errorCode
        ? { value: undefined, reason: raw.reason, errorCode: raw.errorCode }
        : { value: undefined, reason: raw.reason };
    }

    const coerced = coerce(raw.value as unknown);
    if (coerced === undefined) {
      return { value: undefined, reason: "ERROR", errorCode: "TYPE_MISMATCH" };
    }
    return { value: coerced, reason: raw.reason };
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

    this.store.update(data);
    this.environmentId = data.meta.environment;
    this.onConfigUpdate?.();
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
      this.store.update(result.envelope);
      this.environmentId = result.envelope.meta.environment;
      this.onConfigUpdate?.();
    }
  }

  private startSSE(): void {
    this.sseConnection = new SSEConnection(this.transport, this.logger, {
      onConnectionStateChange: this.onSSEConnectionStateChange,
    });
    this.sseConnection.start((envelope: ConfigEnvelope) => {
      this.store.update(envelope);
      this.environmentId = envelope.meta.environment;
      this.onConfigUpdate?.();
    });
  }

  private startPolling(): void {
    const poll = (): void => {
      this.fetchAndInstall()
        .catch((err) => {
          this.logger.warn("Polling error:", err);
        })
        .finally(() => {
          this.pollTimer = setTimeout(poll, this.pollInterval);
          if (this.pollTimer && typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
            this.pollTimer.unref();
          }
        });
    };

    this.pollTimer = setTimeout(poll, this.pollInterval);
    if (this.pollTimer && typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  private startTelemetry(): void {
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
