import { parseConfigEnvelope } from "./envelope";
import type { ConfigEnvelope, SSEConnectionState } from "./types";
import { redactUrlCredentials, type Transport } from "./transport";
import { normalizeLogger, type Logger, type NormalizedLogger } from "./sdkLogger";

export type { SSEConnectionState };

/** Default SSE read deadline: 90s = 3x the server's 30s heartbeat cadence. */
export const DEFAULT_SSE_READ_DEADLINE_MS = 90_000;

/**
 * Reconnect backoff for the recreate supervisor, mirroring sdk-go's sseClient
 * (`sse_client.go`): jittered exponential backoff from 500ms doubling to a 30s
 * cap, retrying forever. The actual sleep is uniform in [delay/2, delay].
 */
export const SSE_RECONNECT_INITIAL_DELAY_MS = 500;
export const SSE_RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Size cap for one SSE event (qfg-6vno.20.3; ITD "Rule — size caps"): 4 MiB.
 * Counted over the raw bytes of an event block (every line up to the blank
 * line that ends it), so a `data:` line with no terminator is bounded too. An
 * event over the cap is not a frame and its connection is a failed attempt. A
 * constant, not an option.
 */
export const SSE_MAX_EVENT_BYTES = 4_194_304;

/** Error the monitored stream fails with when an event exceeds {@link SSE_MAX_EVENT_BYTES}. */
export class SSEEventTooLargeError extends Error {
  constructor() {
    super("SSE event exceeds the size cap");
    this.name = "SSEEventTooLargeError";
  }
}

/**
 * Counts the bytes of the current SSE event block in a raw byte stream and
 * reports when it passes {@link SSE_MAX_EVENT_BYTES}. A blank line ends the
 * block and resets the count. Lines end in CRLF, LF or CR; both bytes are
 * ASCII, so scanning UTF-8 bytes is safe.
 */
export class SSEEventSizeGuard {
  private eventBytes = 0;
  private atLineStart = true;
  private pendingCR = false;

  /** Feed one body chunk; returns true when the current event passed the cap. */
  push(chunk: Uint8Array): boolean {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (this.pendingCR) {
        this.pendingCR = false;
        if (b === 0x0a) continue;
      }
      if (b === 0x0d || b === 0x0a) {
        if (this.atLineStart) {
          this.eventBytes = 0;
        } else {
          this.atLineStart = true;
          this.eventBytes++;
        }
        if (b === 0x0d) this.pendingCR = true;
        continue;
      }
      this.atLineStart = false;
      if (++this.eventBytes > SSE_MAX_EVENT_BYTES) return true;
    }
    return false;
  }
}

/** Minimal shape of the eventsource client used by SSEConnection. */
export interface EventSourceLike {
  onopen: ((evt: any) => void) | null;
  onmessage: ((evt: any) => void) | null;
  onerror: ((evt: any) => void) | null;
  close: () => void;
}

/**
 * Factory for constructing an EventSource. Defaults to dynamic-importing the
 * `eventsource` package; overridable for tests.
 *
 * `onCommentFrame` must be called each time the stream delivers a complete
 * comment-only block (the server's `: keepalive`). eventsource@4 does not
 * surface comment lines (its parser is created with only onEvent/onRetry), so
 * the default factory detects them on the response body; see
 * {@link CommentFrameDetector}. A config envelope delivered through
 * `onmessage` is detected by SSEConnection itself.
 */
export type EventSourceFactory = (
  url: string,
  init: {
    headers: Record<string, string>;
    onCommentFrame?: () => void;
    /** Called once when the stream is failed for an event over {@link SSE_MAX_EVENT_BYTES}. */
    onOversized?: () => void;
  }
) => EventSourceLike;

/**
 * Detects complete comment-only SSE blocks in a raw byte stream (qfg-goi1.10.40).
 *
 * A block is the run of lines up to a blank line. It is a comment frame when it
 * holds at least one comment line (`:` first) and no other field. `: keepalive\n\n`
 * and `:\n\n` count; a comment cut off by EOF, a bare blank line, or a block that
 * also carries `data:`/`id:`/any other field does not. Lines end in CRLF, LF or
 * CR, and a line ending may be split across chunks.
 */
export class CommentFrameDetector {
  private decoder = new TextDecoder();
  private pendingCR = false;
  private inLine = false;
  private lineIsComment = false;
  private sawComment = false;
  private sawField = false;

  /** Feed one body chunk; returns the number of comment frames it completed. */
  push(chunk: Uint8Array): number {
    const text = this.decoder.decode(chunk, { stream: true });
    let frames = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.pendingCR) {
        this.pendingCR = false;
        if (ch === "\n") continue;
      }
      if (ch === "\r" || ch === "\n") {
        if (this.endLine()) frames++;
        if (ch === "\r") this.pendingCR = true;
        continue;
      }
      if (!this.inLine) {
        this.inLine = true;
        this.lineIsComment = ch === ":";
      }
    }
    return frames;
  }

  /** Close the current line; returns true when it was the blank line ending a comment frame. */
  private endLine(): boolean {
    if (this.inLine) {
      if (this.lineIsComment) this.sawComment = true;
      else this.sawField = true;
      this.inLine = false;
      return false;
    }
    const frame = this.sawComment && !this.sawField;
    this.sawComment = false;
    this.sawField = false;
    return frame;
  }
}

export interface SSEConnectionOptions {
  /** Optional listener for SSE lifecycle transitions. See {@link SSEConnectionState}. */
  onConnectionStateChange?: (state: SSEConnectionState) => void;
  /** Test/internal hook to substitute the EventSource implementation. */
  eventSourceFactory?: EventSourceFactory;
  /** Read deadline in ms. Defaults to {@link DEFAULT_SSE_READ_DEADLINE_MS}. */
  readDeadlineMs?: number;
  /**
   * Private test seam (qfg-goi1.10.24): sees every reconnect sleep the
   * supervisor requests (kind "sse") and returns the delay actually used.
   */
  waitHook?: (kind: string, ms: number) => number;
  /**
   * Internal, test-only (qfg-6vno.2): counters the supervisor bumps. Shared
   * across SSEConnection instances by the owning client. Not public API.
   */
  counters?: SupervisorCounters;
}

/**
 * Internal, test-only supervisor counters (qfg-6vno.2). The chaos harness reads
 * them for `quonfig_sse_connect_attempts_total` and
 * `quonfig_sdk_worker_restart_total{layer="1"}`; sdk-node exports no
 * Prometheus metrics, so these are the SDK-side source of those values. Not
 * part of the public API and may change without a semver bump.
 */
export interface SupervisorCounters {
  /** Every SSE connect attempt (the first one and each reconnect). */
  sseConnectAttempts: number;
  /**
   * Every Layer 1 restart: the SSE supervisor scheduling a new worker after an
   * abnormal exit (error, read-deadline trip, failed connect), plus each
   * caught onConfigUpdate throw (contract Test 5, reason callback_panic).
   */
  workerRestartsLayer1: number;
}

/**
 * Wrap a `fetch` so that the response body is monitored by an
 * `AbortController` with a per-chunk-resetting deadline. If no chunk arrives
 * within `deadlineMs` the request is aborted, which causes the eventsource
 * library to surface onerror and reconnect — closing the silent-stall hole
 * (Layer 1 in `project/plans/sdk-hardening-and-verification.md`).
 *
 * Exported for tests; the SDK wires this in via `defaultFactory()` below.
 */
export function wrapFetchWithReadDeadline(
  innerFetch: typeof fetch,
  deadlineMs: number,
  onCommentFrame?: () => void,
  onOversized?: () => void
): typeof fetch {
  return (async (input: any, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const resetDeadline = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort(new Error(`SSE read deadline exceeded (${deadlineMs}ms)`));
      }, deadlineMs);
      if (timer && typeof timer === "object" && "unref" in timer) {
        (timer as any).unref();
      }
    };

    const upstreamSignal = init?.signal;
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort((upstreamSignal as any).reason);
      } else {
        upstreamSignal.addEventListener("abort", () => {
          controller.abort((upstreamSignal as any).reason);
        });
      }
    }

    resetDeadline();

    const response = await innerFetch(input, { ...init, signal: controller.signal });

    if (!response.body) {
      if (timer !== null) clearTimeout(timer);
      return response;
    }

    // Wrap the body in a TransformStream that resets the deadline on every
    // chunk. The eventsource library reads from `response.body`, so this is
    // the only seam we need. It is also where keepalives are seen: the
    // library drops comment lines, so a comment-only block is detected here
    // (first-frame rule, qfg-goi1.10.40). Only a 200 event stream counts.
    //
    // The size cap lives here too (qfg-6vno.20.3): the guard counts the bytes
    // of the current event and fails the stream at the cap, before the
    // over-cap chunk reaches the parser, so eventsource never buffers more
    // than about the cap plus one chunk for one event.
    const reader = response.body.getReader();
    const contentType = response.headers.get("content-type") ?? "";
    const isEventStream = response.status === 200 && contentType.startsWith("text/event-stream");
    const detector = onCommentFrame && isEventStream ? new CommentFrameDetector() : null;
    const sizeGuard = isEventStream ? new SSEEventSizeGuard() : null;
    const monitored = new ReadableStream<Uint8Array>({
      async pull(controllerOut) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            if (timer !== null) clearTimeout(timer);
            controllerOut.close();
            return;
          }
          resetDeadline();
          if (sizeGuard && sizeGuard.push(value)) {
            if (timer !== null) clearTimeout(timer);
            try {
              onOversized?.();
            } catch {
              /* never break the stream over a state callback */
            }
            reader.cancel().catch(() => {});
            controllerOut.error(new SSEEventTooLargeError());
            return;
          }
          if (detector && detector.push(value) > 0) {
            try {
              onCommentFrame!();
            } catch {
              /* never break the stream over a state callback */
            }
          }
          controllerOut.enqueue(value);
        } catch (err) {
          if (timer !== null) clearTimeout(timer);
          controllerOut.error(err);
        }
      },
      cancel(reason) {
        if (timer !== null) clearTimeout(timer);
        try {
          reader.cancel(reason);
        } catch {
          /* ignore */
        }
      },
    });

    return new Response(monitored, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }) as typeof fetch;
}

/**
 * SSE connection for receiving real-time config updates.
 *
 * Uses the `eventsource` npm package for Server-Sent Events, but owns
 * reconnection entirely (qfg-41nh.9): eventsource@4 treats ANY non-200
 * response as terminal (`failConnection` sets readyState=CLOSED and
 * `scheduleReconnect` early-returns on CLOSED), so a single 502 from the Fly
 * edge during a deploy would otherwise kill SSE for the process lifetime. On
 * every error the EventSource is torn down and recreated after a jittered
 * exponential backoff (sdk-go semantics: 500ms → 30s cap, retry forever). The
 * stream stays pinned to the primary stream URL — there is no URL rotation.
 *
 * Layer 1 hardening: the underlying fetch is wrapped with a resetting
 * AbortController so a silent stall (TCP connection alive but no bytes for
 * 90s) is dropped instead of waiting on the OS TCP timeout (often 2+ hours).
 */
export class SSEConnection {
  private transport: Transport;
  private eventSource: EventSourceLike | null = null;
  private logger: NormalizedLogger;
  private onConnectionStateChange?: (state: SSEConnectionState) => void;
  private eventSourceFactory?: EventSourceFactory;
  private currentState: SSEConnectionState | null = null;
  private readDeadlineMs: number;
  private onUpdate: ((envelope: ConfigEnvelope) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number = SSE_RECONNECT_INITIAL_DELAY_MS;
  private closed = false;
  /** Whether the current connection has delivered its first valid frame. */
  private frameSeen = false;
  /**
   * Oversized gate and episode (qfg-6vno.20.3): set when a connection ended on
   * an event over {@link SSE_MAX_EVENT_BYTES}. While set, a keepalive is not a
   * frame (the server resends the oversized snapshot on every connect); the
   * next envelope clears it and ends the WARN episode.
   */
  private oversized = false;
  private waitHook?: (kind: string, ms: number) => number;
  private counters?: SupervisorCounters;

  constructor(transport: Transport, logger?: Logger, options?: SSEConnectionOptions) {
    this.transport = transport;
    this.logger = normalizeLogger(logger);
    this.onConnectionStateChange = options?.onConnectionStateChange;
    this.eventSourceFactory = options?.eventSourceFactory;
    this.readDeadlineMs = options?.readDeadlineMs ?? DEFAULT_SSE_READ_DEADLINE_MS;
    this.waitHook = options?.waitHook;
    this.counters = options?.counters;
  }

  /**
   * Start listening for SSE events.
   *
   * The onUpdate callback receives the new config envelope on each event.
   */
  start(onUpdate: (envelope: ConfigEnvelope) => void): void {
    this.onUpdate = onUpdate;
    this.closed = false;
    this.setState("connecting");
    this.connectSSE(onUpdate).catch((err) => {
      this.logger.warn("SSE connection failed:", err);
      this.setState("error");
      this.scheduleReconnect();
    });
  }

  private async connectSSE(onUpdate: (envelope: ConfigEnvelope) => void): Promise<void> {
    if (this.counters) this.counters.sseConnectAttempts++;
    try {
      const factory = this.eventSourceFactory ?? (await this.defaultFactory());
      if (this.closed) return; // close() raced the async factory import

      const url = this.transport.getSSEUrl();
      const headers = this.transport.getSSEHeaders();

      // First-frame rule (qfg-goi1.10.40): the 200 response headers (onopen)
      // are NOT "connected". Only the connection's first valid frame — a
      // comment-only block or a config envelope — resets the backoff and
      // reports `connected`. A connection that ends before it is a failed
      // attempt: onerror reports `error` and the backoff keeps growing.
      this.frameSeen = false;
      let es: EventSourceLike | null = null;
      let connOversized = false;
      const onFrame = (envelope: boolean): void => {
        if (es === null || es !== this.eventSource) return;
        if (this.oversized) {
          if (!envelope) return;
          this.oversized = false;
        }
        this.markFirstFrame();
      };
      const onOversized = (): void => {
        if (es !== null && es === this.eventSource) connOversized = true;
      };
      es = factory(url, {
        headers,
        onCommentFrame: () => onFrame(false),
        onOversized,
      });
      this.eventSource = es;

      es.onmessage = (event: any) => {
        try {
          // A non-envelope event is dropped exactly like malformed JSON
          // (qfg-9dxb.3 Fix B): it never reaches the install guard, and it is
          // not a frame.
          const envelope: ConfigEnvelope = parseConfigEnvelope(JSON.parse(event.data));
          // The connected edge fires before the envelope is installed.
          onFrame(true);
          onUpdate(envelope);
        } catch (err) {
          this.logger.warn("SSE message parse error:", err);
        }
      };

      es.onerror = (err: any) => {
        if (connOversized) {
          // One WARN per oversized episode, repeats at DEBUG (size-caps rule).
          const msg = `SSE event from ${redactUrlCredentials(url)} exceeds the maximum size of ${SSE_MAX_EVENT_BYTES} bytes; dropping it and backing off (fallback polling takes over)`;
          if (this.oversized) this.logger.debug(msg);
          else this.logger.warn(msg);
          this.oversized = true;
        } else {
          this.logger.warn("SSE error:", err);
        }
        this.setState("error");
        // eventsource@4 never reconnects after a non-200 response
        // (failConnection → readyState=CLOSED → scheduleReconnect no-ops),
        // and its network-failure reconnect is a constant 3s. Take over:
        // tear this EventSource down and recreate it after a jittered
        // exponential backoff, treating every failure — non-200 included —
        // as retryable, like sdk-go does.
        this.teardownEventSource();
        this.scheduleReconnect();
      };
    } catch (err) {
      this.logger.warn("Failed to initialize SSE:", err);
      this.setState("error");
      this.scheduleReconnect();
    }
  }

  /**
   * The current connection delivered its first valid frame: once per
   * connection, reset the backoff (a server-initiated close after a live
   * session is the normal LB recycle; don't punish it — mirrors sdk-go's
   * runLoop) and report `connected`.
   */
  private markFirstFrame(): void {
    if (this.frameSeen || this.closed) return;
    this.frameSeen = true;
    this.reconnectDelayMs = SSE_RECONNECT_INITIAL_DELAY_MS;
    this.setState("connected");
  }

  /**
   * Drop the current EventSource (if any): unhook its handlers so a stray
   * late event from the dying instance can't re-enter the supervisor, then
   * close it.
   */
  private teardownEventSource(): void {
    const es = this.eventSource;
    if (!es) return;
    this.eventSource = null;
    es.onopen = null;
    es.onmessage = null;
    es.onerror = null;
    try {
      es.close();
    } catch {
      /* ignore */
    }
  }

  /**
   * Schedule a fresh EventSource after a jittered backoff sleep. No-op when
   * the connection has been close()d or a reconnect is already pending.
   */
  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null || this.eventSource !== null) return;
    if (this.counters) this.counters.workerRestartsLayer1++;

    const delay = this.reconnectDelayMs;
    // Uniform sleep in [delay/2, delay], mirroring sdk-go's runLoop jitter.
    const sleep = delay / 2 + Math.random() * (delay / 2);
    // Exponential backoff for the next attempt; a connection's first valid
    // frame resets it (markFirstFrame).
    this.reconnectDelayMs = Math.min(delay * 2, SSE_RECONNECT_MAX_DELAY_MS);
    const wait = this.waitHook ? this.waitHook("sse", sleep) : sleep;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      this.setState("connecting");
      this.connectSSE(this.onUpdate!).catch((err) => {
        this.logger.warn("SSE reconnect failed:", err);
        this.setState("error");
        this.scheduleReconnect();
      });
    }, wait);
    if (
      this.reconnectTimer &&
      typeof this.reconnectTimer === "object" &&
      "unref" in this.reconnectTimer
    ) {
      (this.reconnectTimer as any).unref();
    }
  }

  private async defaultFactory(): Promise<EventSourceFactory> {
    // eventsource v3 dropped the default export and the `headers` init option.
    // Auth headers must be injected via a custom `fetch` instead.
    const { EventSource } = await import("eventsource");
    const deadlineMs = this.readDeadlineMs;
    return (url, init) => {
      const headers = init.headers;
      const onCommentFrame = init.onCommentFrame;
      const onOversized = init.onOversized;
      const baseFetch: typeof fetch = (input, fetchInit) =>
        fetch(input, {
          ...fetchInit,
          headers: { ...(fetchInit?.headers as Record<string, string>), ...headers },
        });
      const customFetch = wrapFetchWithReadDeadline(
        baseFetch,
        deadlineMs,
        onCommentFrame,
        onOversized
      );
      return new EventSource(url, { fetch: customFetch }) as EventSourceLike;
    };
  }

  private setState(next: SSEConnectionState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    if (this.onConnectionStateChange) {
      try {
        this.onConnectionStateChange(next);
      } catch (err) {
        this.logger.warn("onConnectionStateChange callback threw:", err);
      }
    }
  }

  /**
   * Close the SSE connection and stop the reconnect supervisor.
   */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownEventSource();
    this.setState("disconnected");
  }
}
