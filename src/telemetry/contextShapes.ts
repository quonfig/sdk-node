import type { ContextShape, Contexts, ContextUploadMode, TelemetryEvent } from "../types";

/**
 * Collects context shapes (field names + types) for telemetry reporting.
 */
export class ContextShapeCollector {
  private enabled: boolean;
  private data: Map<string, Record<string, number>> = new Map();
  private maxDataSize: number;

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
        let shape = this.data.get(name);

        if (shape === undefined && this.data.size >= this.maxDataSize) {
          continue;
        }

        shape = shape ?? {};

        if (shape[key] === undefined) {
          shape[key] = fieldTypeForValue(value);
          this.data.set(name, shape);
        }
      }
    }
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
