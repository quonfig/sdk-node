import { parseConfigEnvelope } from "./envelope";
import type { ConfigEnvelope, SSEConnectionState } from "./types";
import type { Transport } from "./transport";
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
 */
export type EventSourceFactory = (
  url: string,
  init: { headers: Record<string, string> }
) => EventSourceLike;

export interface SSEConnectionOptions {
  /** Optional listener for SSE lifecycle transitions. See {@link SSEConnectionState}. */
  onConnectionStateChange?: (state: SSEConnectionState) => void;
  /** Test/internal hook to substitute the EventSource implementation. */
  eventSourceFactory?: EventSourceFactory;
  /** Read deadline in ms. Defaults to {@link DEFAULT_SSE_READ_DEADLINE_MS}. */
  readDeadlineMs?: number;
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
  deadlineMs: number
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
    // the only seam we need.
    const reader = response.body.getReader();
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

  constructor(transport: Transport, logger?: Logger, options?: SSEConnectionOptions) {
    this.transport = transport;
    this.logger = normalizeLogger(logger);
    this.onConnectionStateChange = options?.onConnectionStateChange;
    this.eventSourceFactory = options?.eventSourceFactory;
    this.readDeadlineMs = options?.readDeadlineMs ?? DEFAULT_SSE_READ_DEADLINE_MS;
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
    try {
      const factory = this.eventSourceFactory ?? (await this.defaultFactory());
      if (this.closed) return; // close() raced the async factory import

      const url = this.transport.getSSEUrl();
      const headers = this.transport.getSSEHeaders();

      const es = factory(url, { headers });
      this.eventSource = es;

      es.onopen = () => {
        // A live stream resets the backoff so the next retry is snappy — a
        // server-initiated close is normal (the LB recycles connections
        // periodically); don't punish it. Mirrors sdk-go's runLoop.
        this.reconnectDelayMs = SSE_RECONNECT_INITIAL_DELAY_MS;
        this.setState("connected");
      };

      es.onmessage = (event: any) => {
        try {
          // A non-envelope event is dropped exactly like malformed JSON
          // (qfg-9dxb.3 Fix B): it never reaches the install guard.
          const envelope: ConfigEnvelope = parseConfigEnvelope(JSON.parse(event.data));
          onUpdate(envelope);
        } catch (err) {
          this.logger.warn("SSE message parse error:", err);
        }
      };

      es.onerror = (err: any) => {
        this.logger.warn("SSE error:", err);
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

    const delay = this.reconnectDelayMs;
    // Uniform sleep in [delay/2, delay], mirroring sdk-go's runLoop jitter.
    const sleep = delay / 2 + Math.random() * (delay / 2);
    // Exponential backoff for the next attempt; onopen resets it.
    this.reconnectDelayMs = Math.min(delay * 2, SSE_RECONNECT_MAX_DELAY_MS);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      this.setState("connecting");
      this.connectSSE(this.onUpdate!).catch((err) => {
        this.logger.warn("SSE reconnect failed:", err);
        this.setState("error");
        this.scheduleReconnect();
      });
    }, sleep);
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
      const baseFetch: typeof fetch = (input, fetchInit) =>
        fetch(input, {
          ...fetchInit,
          headers: { ...(fetchInit?.headers as Record<string, string>), ...headers },
        });
      const customFetch = wrapFetchWithReadDeadline(baseFetch, deadlineMs);
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
