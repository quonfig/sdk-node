import type { ContextShape, Contexts, ContextUploadMode, TelemetryEvent } from "../types";

/**
 * Collects context shapes (field names + types) for telemetry reporting.
 * `maxDataSize` caps the distinct (contextName, fieldName) pairs per window;
 * a new pair beyond the cap is dropped, existing pairs are untouched (P6).
 */
export class ContextShapeCollector {
  private enabled: boolean;
  private data: Map<string, Record<string, number>> = new Map();
  private maxDataSize: number;
  private fieldCount = 0;

  constructor(contextUploadMode: ContextUploadMode, maxDataSize: number = 10000) {
    this.enabled = contextUploadMode !== "none";
    this.maxDataSize = maxDataSize;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  push(contexts: Contexts): void {
    if (!this.enabled) return;

    for (const [name, ctx] of Object.entries(contexts)) {
      for (const [key, value] of Object.entries(ctx)) {
        const shape = this.data.get(name);
        if (shape !== undefined && shape[key] !== undefined) continue;
        if (this.fieldCount >= this.maxDataSize) continue;

        const next = shape ?? {};
        next[key] = fieldTypeForValue(value);
        this.data.set(name, next);
        this.fieldCount++;
      }
    }
  }

  /**
   * Stop recording for the rest of the process and clear buffered data. Called
   * when telemetry is disabled after a 401/403/404 (P3), so nothing aggregates
   * for a dead endpoint.
   */
  disable(): void {
    this.enabled = false;
    this.data.clear();
    this.fieldCount = 0;
  }

  /**
   * Drain collected shapes into a TelemetryEvent, or return undefined if empty.
   */
  drain(): TelemetryEvent | undefined {
    if (this.data.size === 0) return undefined;

    const shapes: ContextShape[] = [];
    this.data.forEach((shape, name) => {
      shapes.push({ name, fieldTypes: shape });
    });

    // Clear data after drain
    this.data.clear();
    this.fieldCount = 0;

    return {
      contextShapes: { shapes },
    };
  }
}

/**
 * Determine the field type number for a context value.
 * Maps to the same type numbers as the prefab SDK:
 *   1 = int, 2 = string, 4 = double, 5 = bool, 10 = string_list
 */
export function fieldTypeForValue(value: unknown): number {
  if (Number.isInteger(value)) return 1;
  if (typeof value === "number") return 4;
  if (typeof value === "boolean") return 5;
  if (Array.isArray(value)) return 10;
  return 2; // string
}
