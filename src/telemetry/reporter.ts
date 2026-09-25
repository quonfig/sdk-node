import type { TelemetryEvent, TelemetryPayload } from "../types";
import type { Transport } from "../transport";
import { normalizeLogger, type Logger, type NormalizedLogger } from "../sdkLogger";
import type { EvaluationSummaryCollector } from "./evaluationSummaries";
import type { ContextShapeCollector } from "./contextShapes";
import type { ExampleContextCollector } from "./exampleContexts";
import type { FailoverCollector } from "./failoverAggregator";
import {
  SHUTDOWN_FLUSH_DEADLINE_MS,
  TELEMETRY_DEFAULTS,
  TelemetryTransportQueue,
} from "./transportQueue";

/** Resolved transport settings (see the `telemetry*` options on QuonfigOptions). */
export interface TelemetryReporterConfig {
  flushIntervalMs: number;
  timeoutMs: number;
  maxRetainedBatches: number;
  maxRetainedBytes: number;
  maxRetainedAgeMs: number;
}

/** A positive finite number, else the default (same handling as the other ms options). */
function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * TelemetryReporter drains the collectors once per tick and hands the
 * serialized window to a {@link TelemetryTransportQueue}, which retains failed
 * batches byte-for-byte and resends them under the transport policy
 * (qfg-mol-9u0: 60s ticks, one POST in flight, 30s floor after a failure,
 * Retry-After, 5 batches / 2MB / 5 min retention, disable on 401/403/404).
 */
export class TelemetryReporter {
  readonly config: TelemetryReporterConfig;

  private transport: Transport;
  private instanceHash: string;
  private evaluationSummaries: EvaluationSummaryCollector;
  private contextShapes: ContextShapeCollector;
  private exampleContexts: ExampleContextCollector;
  private failover: FailoverCollector;
  private logger: NormalizedLogger;
  private queue: TelemetryTransportQueue;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private pendingTick: Promise<void> | undefined;

  constructor(args: {
    transport: Transport;
    instanceHash: string;
    evaluationSummaries: EvaluationSummaryCollector;
    contextShapes: ContextShapeCollector;
    exampleContexts: ExampleContextCollector;
    failover: FailoverCollector;
    logger?: Logger;
    flushIntervalMs?: number;
    timeoutMs?: number;
    maxRetainedBatches?: number;
    maxRetainedBytes?: number;
    maxRetainedAgeMs?: number;
    /** @deprecated Use `flushIntervalMs`. Used as the flush interval when `flushIntervalMs` is not set. */
    initialDelay?: number;
    /** @deprecated Ignored: the adaptive backoff was removed in 1.3.0. */
    maxDelay?: number;
  }) {
    this.transport = args.transport;
    this.instanceHash = args.instanceHash;
    this.evaluationSummaries = args.evaluationSummaries;
    this.contextShapes = args.contextShapes;
    this.exampleContexts = args.exampleContexts;
    this.failover = args.failover;
    this.logger = normalizeLogger(args.logger);
    this.config = {
      flushIntervalMs: positiveOr(
        args.flushIntervalMs ?? args.initialDelay,
        TELEMETRY_DEFAULTS.flushIntervalMs
      ),
      timeoutMs: positiveOr(args.timeoutMs, TELEMETRY_DEFAULTS.timeoutMs),
      maxRetainedBatches: positiveOr(
        args.maxRetainedBatches,
        TELEMETRY_DEFAULTS.maxRetainedBatches
      ),
      maxRetainedBytes: positiveOr(args.maxRetainedBytes, TELEMETRY_DEFAULTS.maxRetainedBytes),
      maxRetainedAgeMs: positiveOr(args.maxRetainedAgeMs, TELEMETRY_DEFAULTS.maxRetainedAgeMs),
    };
    this.queue = new TelemetryTransportQueue({
      send: (body, timeoutMs, signal) => this.transport.sendTelemetry(body, { timeoutMs, signal }),
      telemetryUrl: this.transport.getTelemetryUrl(),
      logger: this.logger,
      timeoutMs: this.config.timeoutMs,
      maxRetainedBatches: this.config.maxRetainedBatches,
      maxRetainedBytes: this.config.maxRetainedBytes,
      maxRetainedAgeMs: this.config.maxRetainedAgeMs,
      onDisabled: () => this.onDisabled(),
    });
  }

  /**
   * Start the tick timer. Fixed cadence: tick k fires at k * flushIntervalMs
   * regardless of how long a drain takes.
   */
  start(): void {
    if (this.closed || this.queue.disabled || this.timer !== undefined) return;
    this.schedule();
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.closed || this.queue.disabled) return;
      this.schedule();
      void this.tick().catch((err) => this.logger.debug(`Telemetry tick failed: ${err}`));
    }, this.config.flushIntervalMs);
    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One tick of the contract's model: skip if closed, disabled or a POST is in
   * flight (P2; the live window keeps aggregating); expire aged batches; skip
   * if the 30s floor or Retry-After has not elapsed; serialize the live window
   * once and append it; drain oldest-first.
   */
  tick(): Promise<void> {
    if (this.closed || this.queue.disabled || this.queue.busy || this.pendingTick) {
      return Promise.resolve();
    }
    const run = this.runTick();
    this.pendingTick = run;
    const clear = (): void => {
      if (this.pendingTick === run) this.pendingTick = undefined;
    };
    run.then(clear, clear);
    return run;
  }

  private async runTick(): Promise<void> {
    this.queue.expire();
    if (!this.queue.sendAllowed()) return;
    const body = this.serializeWindow();
    if (body !== undefined) this.queue.append(body);
    await this.queue.drain();
  }

  /** Resolves when no tick (and so no POST) is running. */
  async whenIdle(): Promise<void> {
    while (this.pendingTick) {
      await this.pendingTick.catch(() => undefined);
    }
    await this.queue.whenIdle();
  }

  /**
   * Send the live window now (public `Quonfig.flush()`). Waits for an
   * in-flight POST first (bounded by the request timeout), then runs a tick,
   * so after a failure it respects the 30s floor and Retry-After. Never throws.
   */
  async flush(): Promise<void> {
    if (this.closed || this.queue.disabled) return;
    try {
      await this.whenIdle();
      await this.tick();
    } catch (err) {
      this.logger.debug(`Telemetry flush failed: ${err}`);
    }
  }

  /**
   * Shutdown (P8): stop the timer, abort any in-flight POST, then give the
   * live window one POST with a 5s deadline. The retained queue is not
   * drained. Idempotent; never blocks exit (all timers are unref'd).
   */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.clearTimer();
    this.queue.abortInFlight();
    this.closing = (async () => {
      if (this.queue.disabled) return;
      const body = this.serializeWindow();
      if (body === undefined) return;
      await this.queue.sendFinal(body, Math.min(SHUTDOWN_FLUSH_DEADLINE_MS, this.config.timeoutMs));
    })();
    return this.closing;
  }

  /** @deprecated Use {@link TelemetryReporter.flush}. Kept for callers of the exported class. */
  sync(): Promise<void> {
    return this.flush();
  }

  /**
   * Stop the timer and abort any in-flight POST without a final flush.
   * @deprecated Use {@link TelemetryReporter.close}.
   */
  stop(): void {
    this.closed = true;
    this.clearTimer();
    this.queue.abortInFlight();
  }

  /** Test-visible state (the contract's retained_count / retained_bytes / telemetry_enabled). */
  debugState(): {
    retainedCount: number;
    retainedBytes: number;
    enabled: boolean;
    inFlight: boolean;
    timerActive: boolean;
  } {
    return {
      retainedCount: this.queue.retainedCount,
      retainedBytes: this.queue.retainedBytes,
      enabled: !this.queue.disabled,
      inFlight: this.queue.busy,
      timerActive: this.timer !== undefined,
    };
  }

  private onDisabled(): void {
    this.clearTimer();
    this.evaluationSummaries.disable();
    this.contextShapes.disable();
    this.exampleContexts.disable();
    this.failover.disable();
  }

  /**
   * Drain the collectors into one serialized payload. This is the only
   * serialization: the queue stores and resends these exact bytes (P5, P9).
   */
  private serializeWindow(): Buffer | undefined {
    const events: TelemetryEvent[] = [];
    const summaryEvent = this.evaluationSummaries.drain();
    if (summaryEvent) events.push(summaryEvent);
    const shapesEvent = this.contextShapes.drain();
    if (shapesEvent) events.push(shapesEvent);
    const examplesEvent = this.exampleContexts.drain();
    if (examplesEvent) events.push(examplesEvent);
    // Undefined unless the window saw failover activity.
    const failoverEvent = this.failover.drain();
    if (failoverEvent) events.push(failoverEvent);
    if (events.length === 0) return undefined;

    const payload: TelemetryPayload = { instanceHash: this.instanceHash, events };
    return Buffer.from(JSON.stringify(payload), "utf8");
  }
}
