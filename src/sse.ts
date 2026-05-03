import type { ConfigEnvelope, SSEConnectionState } from "./types";
import type { Transport } from "./transport";
import { normalizeLogger, type Logger, type NormalizedLogger } from "./sdkLogger";

export type { SSEConnectionState };

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
}

/**
 * SSE connection for receiving real-time config updates.
 *
 * Uses the `eventsource` npm package for Server-Sent Events. Reconnect/backoff
 * behavior is delegated to that library; see the README for details.
 */
export class SSEConnection {
  private transport: Transport;
  private eventSource: EventSourceLike | null = null;
  private logger: NormalizedLogger;
  private onConnectionStateChange?: (state: SSEConnectionState) => void;
  private eventSourceFactory?: EventSourceFactory;
  private currentState: SSEConnectionState | null = null;

  constructor(transport: Transport, logger?: Logger, options?: SSEConnectionOptions) {
    this.transport = transport;
    this.logger = normalizeLogger(logger);
    this.onConnectionStateChange = options?.onConnectionStateChange;
    this.eventSourceFactory = options?.eventSourceFactory;
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
    const EventSourceModule: any = await import("eventsource");
    const EventSourceCtor = EventSourceModule.default || EventSourceModule;
    return (url, init) => new EventSourceCtor(url, init) as EventSourceLike;
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
