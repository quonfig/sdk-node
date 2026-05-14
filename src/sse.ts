import type { ConfigEnvelope, SSEConnectionState } from "./types";
import type { Transport } from "./transport";
import { normalizeLogger, type Logger, type NormalizedLogger } from "./sdkLogger";

export type { SSEConnectionState };

/** Default SSE read deadline: 90s = 3x the server's 30s heartbeat cadence. */
export const DEFAULT_SSE_READ_DEADLINE_MS = 90_000;

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
 * Uses the `eventsource` npm package for Server-Sent Events. Reconnect/backoff
 * behavior is delegated to that library; see the README for details.
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
    this.setState("connecting");
    this.connectSSE(onUpdate).catch((err) => {
      this.logger.warn("SSE connection failed:", err);
      this.setState("error");
    });
  }

  private async connectSSE(onUpdate: (envelope: ConfigEnvelope) => void): Promise<void> {
    try {
      const factory = this.eventSourceFactory ?? (await this.defaultFactory());
      const url = this.transport.getSSEUrl();
      const headers = this.transport.getSSEHeaders();

      const es = factory(url, { headers });
      this.eventSource = es;

      es.onopen = () => {
        this.setState("connected");
      };

      es.onmessage = (event: any) => {
        try {
          const envelope: ConfigEnvelope = JSON.parse(event.data);
          onUpdate(envelope);
        } catch (err) {
          this.logger.warn("SSE message parse error:", err);
        }
      };

      es.onerror = (err: any) => {
        this.logger.warn("SSE error:", err);
        this.setState("error");
        // The eventsource library auto-reconnects; the next onopen will
        // transition us back to "connected".
      };
    } catch (err) {
      this.logger.warn("Failed to initialize SSE:", err);
      this.setState("error");
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
   * Close the SSE connection.
   */
  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.setState("disconnected");
  }
}
