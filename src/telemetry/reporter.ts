import type { TelemetryEvent, TelemetryPayload } from "../types";
import type { Transport } from "../transport";
import { normalizeLogger, type Logger, type NormalizedLogger } from "../sdkLogger";
import type { EvaluationSummaryCollector } from "./evaluationSummaries";
import type { ContextShapeCollector } from "./contextShapes";
import type { ExampleContextCollector } from "./exampleContexts";

/**
 * TelemetryReporter periodically drains collected telemetry data and sends it
 * to the Quonfig telemetry endpoint.
 */
export class TelemetryReporter {
  private transport: Transport;
  private instanceHash: string;
  private evaluationSummaries: EvaluationSummaryCollector;
  private contextShapes: ContextShapeCollector;
  private exampleContexts: ExampleContextCollector;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private initialDelay: number;
  private maxDelay: number;
  private currentDelay: number;
  private stopped: boolean = false;
  private logger: NormalizedLogger;

  constructor(args: {
    transport: Transport;
    instanceHash: string;
    evaluationSummaries: EvaluationSummaryCollector;
    contextShapes: ContextShapeCollector;
    exampleContexts: ExampleContextCollector;
    initialDelay?: number;
    maxDelay?: number;
    logger?: Logger;
  }) {
    this.transport = args.transport;
    this.instanceHash = args.instanceHash;
    this.evaluationSummaries = args.evaluationSummaries;
    this.contextShapes = args.contextShapes;
    this.exampleContexts = args.exampleContexts;
    this.initialDelay = args.initialDelay ?? 8000;
    this.maxDelay = args.maxDelay ?? 600000;
    this.currentDelay = this.initialDelay;
    this.logger = normalizeLogger(args.logger);
  }

  /**
   * Start the periodic telemetry reporting loop.
   */
  start(): void {
    if (this.stopped) return;
    this.scheduleNext();
  }

  /**
   * Stop telemetry reporting.
   */
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;

    this.timer = setTimeout(async () => {
      try {
        await this.sync();
        // Success — reset to base interval
        this.currentDelay = this.initialDelay;
      } catch (err) {
        this.logger.warn("Telemetry sync error:", err);
        // Exponential backoff with cap on failure
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxDelay);
      } finally {
        this.scheduleNext();
      }
    }, this.currentDelay);

    // Allow the timer to not prevent process exit
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  async sync(): Promise<void> {
    const events: TelemetryEvent[] = [];

    // Drain evaluation summaries
    const summaryEvent = this.evaluationSummaries.drain();
    if (summaryEvent) events.push(summaryEvent);

    // Drain context shapes
    const shapesEvent = this.contextShapes.drain();
    if (shapesEvent) events.push(shapesEvent);

    // Drain example contexts
    const examplesEvent = this.exampleContexts.drain();
    if (examplesEvent) events.push(examplesEvent);

    if (events.length === 0) return;

    const payload: TelemetryPayload = {
      instanceHash: this.instanceHash,
      events,
    };

    await this.transport.postTelemetry(payload);
  }
}
