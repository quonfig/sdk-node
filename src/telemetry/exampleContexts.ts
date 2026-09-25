import type { Contexts, ContextUploadMode, ExampleContextEntry, TelemetryEvent } from "../types";
import { EXAMPLE_CONTEXT_SEEN_CAP } from "./transportQueue";

/**
 * Collects example contexts for telemetry reporting.
 * Only collects when contextUploadMode is "periodic_example".
 */
export class ExampleContextCollector {
  private enabled: boolean;
  private data: Array<[number, Contexts]> = [];
  private seen: Map<string, number> = new Map();
  private maxDataSize: number;
  private rateLimitMs: number;
  private maxSeen: number;

  /**
   * `maxDataSize` caps the examples per window; `maxSeen` bounds the
   * rate-limit map (P6). When the map is full and pruning frees nothing, a
   * new example is not recorded (drop newest).
   */
  constructor(
    contextUploadMode: ContextUploadMode,
    maxDataSize: number = 10000,
    rateLimitMs: number = 60 * 60 * 1000, // 1 hour
    maxSeen: number = EXAMPLE_CONTEXT_SEEN_CAP
  ) {
    this.enabled = contextUploadMode === "periodic_example";
    this.maxDataSize = maxDataSize;
    this.rateLimitMs = rateLimitMs;
    this.maxSeen = maxSeen;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  push(contexts: Contexts): void {
    if (!this.enabled) return;
    if (this.data.length >= this.maxDataSize) return;

    const key = this.groupedKey(contexts);
    if (key.length === 0) return;

    // Rate limit: skip if seen recently
    const lastSeen = this.seen.get(key);
    if (lastSeen !== undefined && Date.now() - lastSeen < this.rateLimitMs) {
      return;
    }

    if (lastSeen === undefined && this.seen.size >= this.maxSeen) {
      this.pruneCache();
      if (this.seen.size >= this.maxSeen) return;
    }

    this.data.push([Date.now(), contexts]);
    this.seen.set(key, Date.now());
  }

  /**
   * Stop recording for the rest of the process and clear buffered data. Called
   * when telemetry is disabled after a 401/403/404 (P3), so nothing aggregates
   * for a dead endpoint.
   */
  disable(): void {
    this.enabled = false;
    this.data.length = 0;
    this.seen.clear();
  }

  /**
   * Drain collected examples into a TelemetryEvent, or return undefined if empty.
   */
  drain(): TelemetryEvent | undefined {
    if (this.data.length === 0) return undefined;

    const examples: ExampleContextEntry[] = this.data.map(([timestamp, contexts]) => {
      const contextsList = Object.entries(contexts).map(([type, ctx]) => {
        const values: Record<string, any> = {};
        for (const [key, value] of Object.entries(ctx)) {
          values[key] = value;
        }
        return { type, values };
      });

      return {
        timestamp,
        contextSet: { contexts: contextsList },
      };
    });

    // Clear data after drain
    this.data.length = 0;
    this.pruneCache();

    return {
      exampleContexts: { examples },
    };
  }

  private groupedKey(contexts: Contexts): string {
    return Object.values(contexts)
      .map((ctx) => {
        const key = ctx["key"] ?? ctx["trackingId"];
        return typeof key === "string" ? key : JSON.stringify(key);
      })
      .filter((str) => str !== undefined && str !== null && String(str).length > 0)
      .sort()
      .join("|");
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seen.entries()) {
      if (now - timestamp > this.rateLimitMs) {
        this.seen.delete(key);
      }
    }
  }
}
