import type { ConfigEnvelope } from "./types";
import type { Transport } from "./transport";
import { normalizeLogger, type Logger, type NormalizedLogger } from "./sdkLogger";

/**
 * SSE connection for receiving real-time config updates.
 *
 * Uses the `eventsource` npm package for Server-Sent Events.
 */
export class SSEConnection {
  private transport: Transport;
  private eventSource: any = null;
  private logger: NormalizedLogger;

  constructor(transport: Transport, logger?: Logger) {
    this.transport = transport;
    this.logger = normalizeLogger(logger);
  }

  /**
   * Start listening for SSE events.
   *
   * The onUpdate callback receives the new config envelope on each event.
   */
  start(onUpdate: (envelope: ConfigEnvelope) => void): void {
    // Dynamic import of eventsource to avoid issues when it's not installed
    this.connectSSE(onUpdate).catch((err) => {
      this.logger.warn("SSE connection failed:", err);
    });
  }

  private async connectSSE(onUpdate: (envelope: ConfigEnvelope) => void): Promise<void> {
    try {
      // Use dynamic import for eventsource
      const EventSourceModule = await import("eventsource");
      const EventSource = EventSourceModule.default || EventSourceModule;

      const url = this.transport.getSSEUrl();
      const headers = this.transport.getSSEHeaders();

      this.eventSource = new EventSource(url, { headers });

      this.eventSource.onmessage = (event: any) => {
        try {
          const envelope: ConfigEnvelope = JSON.parse(event.data);
          onUpdate(envelope);
        } catch (err) {
          this.logger.warn("SSE message parse error:", err);
        }
      };

      this.eventSource.onerror = (err: any) => {
        this.logger.warn("SSE error:", err);
        // EventSource will auto-reconnect
      };
    } catch (err) {
      this.logger.warn("Failed to initialize SSE:", err);
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
  }
}
