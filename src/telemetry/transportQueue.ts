import type { NormalizedLogger } from "../sdkLogger";
import { TelemetryRequestError, type TelemetryHttpResult } from "../transport";

/**
 * Telemetry transport policy (qfg-mol-9u0; policy P1-P10 in
 * project/plans/2026-09-24-sdk-telemetry-transport-policy.md, contract tests in
 * integration-test-data/chaos/telemetry-transport-contract.md).
 *
 * This module owns the retained queue of serialized batches, the send gate
 * (30s floor after a failure + Retry-After), the drain loop, disable-on-auth
 * and the P7 logging episodes. It knows nothing about collectors or payload
 * shape: it stores and resends opaque bytes.
 */

/** Shipped defaults for the `telemetry*` options (server SDK class). */
export const TELEMETRY_DEFAULTS = {
  flushIntervalMs: 60_000,
  timeoutMs: 15_000,
  maxRetainedBatches: 5,
  maxRetainedBytes: 2 * 1024 * 1024,
  maxRetainedAgeMs: 300_000,
  maxEvaluationSummaries: 10_000,
  maxContextShapeFields: 10_000,
  maxExampleContexts: 10_000,
} as const;

/** No send sooner than this after a failed POST (P4). */
export const RESEND_FLOOR_MS = 30_000;
/** Retry-After is honored up to this (P4). */
export const RETRY_AFTER_CAP_MS = 600_000;
/** At most one drop WARN per this interval while dropping continues (P7). */
export const DROP_WARN_INTERVAL_MS = 600_000;
/** close() gives the live window one POST with this deadline (P8). */
export const SHUTDOWN_FLUSH_DEADLINE_MS = 5_000;
/** Bound on the example-context rate-limit map (P6). */
export const EXAMPLE_CONTEXT_SEEN_CAP = 100_000;

export type StatusClass = "ok" | "retryable" | "auth" | "rejected";

/**
 * 2xx -> ok; 401, 403, 404 -> auth; 408, 429, 5xx -> retryable; every other
 * status (other 4xx, 3xx, 1xx) -> rejected (P3).
 */
export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403 || status === 404) return "auth";
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) return "retryable";
  return "rejected";
}

/**
 * Parse a Retry-After header into a wait in ms: delta-seconds, or an HTTP-date
 * relative to `nowMs` (past dates -> 0). Unparseable -> undefined. Clamped to
 * {@link RETRY_AFTER_CAP_MS}.
 */
export function parseRetryAfterMs(header: string | undefined, nowMs: number): number | undefined {
  if (header === undefined) return undefined;
  const v = header.trim();
  if (v.length === 0) return undefined;
  let ms: number;
  if (/^\d+$/.test(v)) {
    ms = Number(v) * 1000;
  } else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return undefined;
    ms = Math.max(0, at - nowMs);
  }
  return Math.min(ms, RETRY_AFTER_CAP_MS);
}

interface RetainedBatch {
  body: Buffer;
  bytes: number;
  createdAt: number;
  oversize: boolean;
}

export type TelemetrySend = (
  body: Buffer,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<TelemetryHttpResult>;

export class TelemetryTransportQueue {
  private readonly send: TelemetrySend;
  private readonly telemetryUrl: string;
  private readonly logger: NormalizedLogger;
  private readonly timeoutMs: number;
  private readonly maxRetainedBatches: number;
  private readonly maxRetainedBytes: number;
  private readonly maxRetainedAgeMs: number;
  private readonly onDisabled: () => void;

  private queue: RetainedBatch[] = [];
  private inFlight: AbortController | undefined;
  private idle: Promise<void> = Promise.resolve();
  private lastFailureAt = -Infinity;
  private retryAfterUntil = 0;
  private isDisabled = false;

  // Outage episode (P7).
  private failuresSinceSuccess = 0;
  private firstFailureAt: number | undefined;
  private lastResult = "";
  private lastDropWarnAt: number | undefined;
  private dropsSinceWarn = 0;
  private dropsThisOutage = 0;

  // Rejected-batch (other 4xx) cadence.
  private lastRejectErrorAt: number | undefined;
  private rejectsSinceError = 0;

  constructor(args: {
    send: TelemetrySend;
    telemetryUrl: string;
    logger: NormalizedLogger;
    timeoutMs: number;
    maxRetainedBatches: number;
    maxRetainedBytes: number;
    maxRetainedAgeMs: number;
    onDisabled: () => void;
  }) {
    this.send = args.send;
    this.telemetryUrl = args.telemetryUrl;
    this.logger = args.logger;
    this.timeoutMs = args.timeoutMs;
    this.maxRetainedBatches = args.maxRetainedBatches;
    this.maxRetainedBytes = args.maxRetainedBytes;
    this.maxRetainedAgeMs = args.maxRetainedAgeMs;
    this.onDisabled = args.onDisabled;
  }

  /** A POST is in flight. */
  get busy(): boolean {
    return this.inFlight !== undefined;
  }

  get disabled(): boolean {
    return this.isDisabled;
  }

  /** Every queued batch, including a not-yet-sent oversize one. */
  get retainedCount(): number {
    return this.queue.length;
  }

  get retainedBytes(): number {
    let n = 0;
    for (const b of this.queue) n += b.bytes;
    return n;
  }

  /** Discard batches older than the max age (strictly greater). Tick step 2. */
  expire(): void {
    const now = Date.now();
    while (this.queue.length > 0 && now - this.queue[0].createdAt > this.maxRetainedAgeMs) {
      this.queue.shift();
      this.recordDrop(`batch older than ${Math.round(this.maxRetainedAgeMs / 60_000)} min`);
    }
    // Batches are appended in time order, so only the head can be expired; the
    // loop above covers every expired one.
  }

  /** The 30s floor after a failure and any Retry-After have both elapsed. Tick step 3. */
  sendAllowed(): boolean {
    const now = Date.now();
    return now >= this.lastFailureAt + RESEND_FLOOR_MS && now >= this.retryAfterUntil;
  }

  /** Append a serialized window and enforce the caps (drop oldest). Tick step 4. */
  append(body: Buffer): void {
    const oversize = body.length > this.maxRetainedBytes;
    this.queue.push({ body, bytes: body.length, createdAt: Date.now(), oversize });

    let count = 0;
    let bytes = 0;
    for (const b of this.queue) {
      if (b.oversize) continue;
      count++;
      bytes += b.bytes;
    }
    while (count > this.maxRetainedBatches || bytes > this.maxRetainedBytes) {
      const i = this.queue.findIndex((b) => !b.oversize);
      if (i < 0) break;
      const [evicted] = this.queue.splice(i, 1);
      count--;
      bytes -= evicted.bytes;
      this.recordDrop("retained queue full");
    }
  }

  /**
   * POST queued batches oldest-first, one at a time; stop at the first
   * failure. Tick step 5.
   */
  drain(): Promise<void> {
    const run = this.drainLoop();
    this.idle = run.catch(() => undefined);
    return run;
  }

  /** Resolves when no drain is running. */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  /** Abort the in-flight POST, if any (close()). The aborted batch is kept but never resent. */
  abortInFlight(): void {
    this.inFlight?.abort();
  }

  /**
   * close(): one POST of the live window bounded by `deadlineMs`. Never
   * retains, never touches the outage episode, never throws.
   */
  async sendFinal(body: Buffer, deadlineMs: number): Promise<void> {
    const controller = new AbortController();
    this.inFlight = controller;
    let result: string | undefined;
    try {
      const res = await this.send(body, deadlineMs, controller.signal);
      if (classifyStatus(res.status) !== "ok") result = String(res.status);
    } catch (err) {
      result = describeError(err);
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined;
    }
    if (result !== undefined) {
      this.logger.debug(
        `Telemetry final flush at shutdown failed (${result}); ${body.length} bytes dropped, ${this.retainedCount} retained batch(es) abandoned`
      );
    }
  }

  private async drainLoop(): Promise<void> {
    while (this.queue.length > 0 && !this.isDisabled) {
      const batch = this.queue[0];
      const controller = new AbortController();
      this.inFlight = controller;
      let res: TelemetryHttpResult | undefined;
      let err: unknown;
      try {
        res = await this.send(batch.body, this.timeoutMs, controller.signal);
      } catch (e) {
        err = e;
      } finally {
        if (this.inFlight === controller) this.inFlight = undefined;
      }

      if (err !== undefined) {
        if (err instanceof TelemetryRequestError && err.reason === "aborted") return;
        this.onRetryableFailure(batch, describeError(err), undefined);
        break;
      }

      const status = res!.status;
      const cls = classifyStatus(status);
      if (cls === "ok") {
        this.queue.shift();
        this.onSuccess();
        continue;
      }
      if (cls === "retryable") {
        this.onRetryableFailure(batch, String(status), res!.retryAfter);
        break;
      }
      if (cls === "auth") {
        this.disable(status);
        return;
      }
      // rejected: drop this batch, report, carry on with the next one.
      this.queue.shift();
      this.onRejected(status, batch.bytes, res!.bodySnippet);
    }

    // Oversize batches are never carried across ticks.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].oversize) {
        this.queue.splice(i, 1);
        this.recordDrop("batch larger than the byte cap");
      }
    }
  }

  private onSuccess(): void {
    if (this.failuresSinceSuccess === 0) return;
    const seconds = Math.round((Date.now() - (this.firstFailureAt ?? Date.now())) / 1000);
    this.logger.info(
      `Telemetry recovered: POST succeeded after ${this.failuresSinceSuccess} failed attempt(s) over ${seconds}s; ${this.dropsThisOutage} batch(es) were dropped.`
    );
    this.failuresSinceSuccess = 0;
    this.firstFailureAt = undefined;
    this.dropsThisOutage = 0;
    this.lastDropWarnAt = undefined;
    this.dropsSinceWarn = 0;
  }

  private onRetryableFailure(
    batch: RetainedBatch,
    result: string,
    retryAfter: string | undefined
  ): void {
    const now = Date.now();
    this.failuresSinceSuccess++;
    this.firstFailureAt ??= now;
    this.lastFailureAt = now;
    this.lastResult = result;
    const wait = parseRetryAfterMs(retryAfter, now);
    if (wait !== undefined) this.retryAfterUntil = now + wait;

    const nextMs = Math.max(this.lastFailureAt + RESEND_FLOOR_MS, this.retryAfterUntil) - now;
    this.logger.debug(
      `Telemetry POST failed (${result}); ${this.retainedCount} batch(es) / ${this.retainedBytes} bytes retained, next send in >= ${Math.ceil(nextMs / 1000)}s`
    );

    if (batch.oversize) {
      const i = this.queue.indexOf(batch);
      if (i >= 0) this.queue.splice(i, 1);
      this.recordDrop("batch larger than the byte cap");
    }
  }

  private disable(status: number): void {
    const hint = status === 404 ? "wrong telemetryUrl" : "the SDK key was rejected";
    this.logger.error(
      `Telemetry disabled for this process: ${this.telemetryUrl} answered ${status} (${hint}). Flag evaluation is unaffected.`
    );
    this.queue.length = 0;
    this.isDisabled = true;
    this.onDisabled();
  }

  private onRejected(status: number, bytes: number, bodySnippet: string): void {
    const now = Date.now();
    if (
      this.lastRejectErrorAt === undefined ||
      now - this.lastRejectErrorAt >= DROP_WARN_INTERVAL_MS
    ) {
      const n = this.rejectsSinceError;
      this.logger.error(
        `Telemetry batch rejected with ${status} and dropped (${bytes} bytes${n > 0 ? `, ${n} more since the last report` : ""}): ${bodySnippet}. This is likely an SDK bug; please report it.`
      );
      this.lastRejectErrorAt = now;
      this.rejectsSinceError = 0;
    } else {
      this.rejectsSinceError++;
      this.logger.debug(`Telemetry batch rejected with ${status} and dropped (${bytes} bytes)`);
    }
  }

  private recordDrop(reason: string): void {
    const now = Date.now();
    this.dropsSinceWarn++;
    this.dropsThisOutage++;
    const lastResult = this.lastResult || "none";
    if (this.lastDropWarnAt === undefined) {
      this.logger.warn(
        `Telemetry is dropping data: ${reason} (last POST result: ${lastResult}). ${this.dropsThisOutage} batch(es) dropped so far; retained queue ${this.retainedCount}/${this.maxRetainedBatches} batches, ${this.retainedBytes} bytes. Flag evaluation is unaffected; further drops log at debug with a summary every 10 min.`
      );
      this.lastDropWarnAt = now;
      this.dropsSinceWarn = 0;
    } else if (now - this.lastDropWarnAt >= DROP_WARN_INTERVAL_MS) {
      const minutes = Math.round((now - this.lastDropWarnAt) / 60_000);
      this.logger.warn(
        `Telemetry still dropping data: ${this.dropsSinceWarn} batch(es) dropped in the last ${minutes} min (last POST result: ${lastResult}); retained queue ${this.retainedCount} batches, ${this.retainedBytes} bytes.`
      );
      this.lastDropWarnAt = now;
      this.dropsSinceWarn = 0;
    } else {
      this.logger.debug(
        `Telemetry dropped a batch: ${reason}; ${this.dropsSinceWarn} since the last warning`
      );
    }
  }
}

/** `lastResult` text for a request that got no HTTP response. */
function describeError(err: unknown): string {
  if (err instanceof TelemetryRequestError) {
    if (err.reason === "timeout") return "timeout";
    if (err.reason === "aborted") return "aborted";
    const cause = (err as { cause?: unknown }).cause;
    const detail = err.code ?? (cause instanceof Error ? cause.message : err.message);
    return `network error: ${detail}`;
  }
  return `network error: ${err instanceof Error ? err.message : String(err)}`;
}
