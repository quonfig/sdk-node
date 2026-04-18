import { randomUUID } from "crypto";
import { readFileSync } from "fs";

import type {
  ConfigEnvelope,
  Contexts,
  ContextUploadMode,
  Evaluation,
  GetValue,
  LogLevelName,
  LogLevelNumber,
  OnNoDefault,
  QuonfigOptions,
  RawMatch,
  Value,
} from "./types";

import { ConfigStore } from "./store";
import { Evaluator } from "./evaluator";
import { Resolver } from "./resolver";
import { ConfigDependencyResolver } from "./rawMatch";
import { Transport } from "./transport";
import { computeReason } from "./reason";
import { SSEConnection } from "./sse";
import { mergeContexts } from "./context";
import { parseLevel, shouldLog } from "./logger";
import { durationToMilliseconds } from "./duration";
import { loadEnvelopeFromDatadir } from "./datadir";

import { EvaluationSummaryCollector } from "./telemetry/evaluationSummaries";
import { ContextShapeCollector } from "./telemetry/contextShapes";
import { ExampleContextCollector } from "./telemetry/exampleContexts";
import { TelemetryReporter } from "./telemetry/reporter";

const DEFAULT_API_URLS = [
  "https://primary.quonfig.com",
  "https://secondary.quonfig.com",
];
const DEFAULT_POLL_INTERVAL = 60000;
const DEFAULT_INIT_TIMEOUT = 10000;
const DEFAULT_LOG_LEVEL: LogLevelNumber = 5; // warn

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

  isFeatureEnabled(key: string, contexts?: Contexts): boolean {
    return this.client.isFeatureEnabled(key, mergeContexts(this.boundContexts, contexts));
  }

  shouldLog(args: {
    loggerName: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean {
    return this.client.shouldLog({
      ...args,
      contexts: mergeContexts(this.boundContexts, args.contexts),
    });
  }

  async flush(): Promise<void> {
    return this.client.flush();
  }

  keys(): string[] {
    return this.client.keys();
  }

  inContext(contexts: Contexts): BoundQuonfig {
    return new BoundQuonfig(this.client, mergeContexts(this.boundContexts, contexts));
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
  private readonly globalContext?: Contexts;
  private readonly initTimeout: number;
  private readonly datadir?: string;
  private readonly datafile?: string | object;
  private readonly requestedEnvironment: string;
  private readonly onConfigUpdate?: () => void;

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
    this.apiUrls = options.apiUrls ?? (options.apiUrl ? [options.apiUrl] : DEFAULT_API_URLS);
    if (this.apiUrls.length === 0) {
      throw new Error("[quonfig] apiUrls must not be empty");
    }
    this.telemetryUrl = options.telemetryUrl;
    this.enableSSE = options.enableSSE ?? true;
    this.enablePolling = options.enablePolling ?? false;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.namespace = options.namespace;
    this.onNoDefault = options.onNoDefault ?? "error";
    this.globalContext = options.globalContext;
    this.initTimeout = options.initTimeout ?? DEFAULT_INIT_TIMEOUT;
    this.datadir = options.datadir;
    this.datafile = options.datafile;
    // Environment: explicit option supersedes QUONFIG_ENVIRONMENT env var
    this.requestedEnvironment = options.environment || process.env.QUONFIG_ENVIRONMENT || "";
    this.onConfigUpdate = options.onConfigUpdate;
    this.instanceHash = randomUUID();

    // Initialize core components
    this.store = new ConfigStore();
    this.evaluator = new Evaluator(this.store);
    this.resolver = new Resolver(this.store, this.evaluator);
    this.dependencyResolver = new ConfigDependencyResolver(this.store, this.evaluator);
    this.transport = new Transport(this.apiUrls, this.sdkKey, this.telemetryUrl);

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
      console.warn("[quonfig] Initialization failed:", err);
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
    const match = this.evaluator.evaluateConfig(
      config,
      this.environmentId,
      mergedContexts
    );

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
   */
  shouldLog(args: {
    loggerName: string;
    desiredLevel: string;
    defaultLevel?: string;
    contexts?: Contexts;
  }): boolean {
    const desiredLevelNum = parseLevel(args.desiredLevel);
    if (desiredLevelNum === undefined) {
      console.warn(`[quonfig] Invalid desiredLevel "${args.desiredLevel}". Returning true.`);
      return true;
    }

    const defaultLevelNum = parseLevel(args.defaultLevel) ?? DEFAULT_LOG_LEVEL;

    return shouldLog({
      loggerName: args.loggerName,
      desiredLevel: desiredLevelNum,
      defaultLevel: defaultLevelNum,
      getConfig: (logKey: string) => {
        try {
          return this.get(logKey, args.contexts, undefined);
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
    return this.dependencyResolver.resolveWithDependencies(
      key,
      this.environmentId,
      mergedContexts
    );
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
   */
  inContext(contexts: Contexts): BoundQuonfig {
    return new BoundQuonfig(this, mergeContexts(this.globalContext, contexts));
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
   * Close the SDK. Stops SSE, polling, and telemetry.
   */
  close(): void {
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

  private handleNoDefault(key: string, defaultValue?: any): any {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    switch (this.onNoDefault) {
      case "error":
        throw new Error(`No value found for key "${key}"`);
      case "warn":
        console.warn(`[quonfig] No value found for key "${key}"`);
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
    this.sseConnection = new SSEConnection(this.transport);
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
          console.warn("[quonfig] Polling error:", err);
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
    });

    this.telemetryReporter.start();
  }
}
