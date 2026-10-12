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

    const snapshot = snapshotContexts(contexts);
    const key = this.groupedKey(snapshot);
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

    this.data.push([Date.now(), snapshot]);
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

/**
 * Values nested deeper than this are dropped from an example context. It bounds
 * the recursion for a pathological (non-cyclic) value; real contexts are a few
 * levels deep.
 */
const MAX_SNAPSHOT_DEPTH = 32;

const OMIT = Symbol("omit");

/**
 * Copy `contexts` into data that shares nothing with the caller, so a mutation
 * after the evaluation cannot change what the next flush sends (qfg-goi1.2.34,
 * port of sdk-go qfg-goi1.2.4 / qfg-goi1.2.44 / qfg-goi1.2.46). The copy
 * follows JSON.stringify, which is what the flush would have run: `toJSON()`
 * is called now (a Date or an ObjectId/UUID-like key becomes its string, so the
 * example keeps its identifying key), plain objects and arrays are copied, and
 * undefined, functions and symbols are dropped (null inside an array). The
 * edge that closes a cycle and anything deeper than MAX_SNAPSHOT_DEPTH are
 * dropped instead of failing the whole event. A value whose toJSON() or getter
 * throws is dropped. BigInt is kept as is (how it is sent is still open).
 */
function snapshotContexts(contexts: Contexts): Contexts {
  const out: Contexts = {};
  for (const [name, ctx] of Object.entries(contexts)) {
    const copied = snapshotValue(ctx, 0, []);
    if (
      copied !== OMIT &&
      copied !== null &&
      typeof copied === "object" &&
      !Array.isArray(copied)
    ) {
      out[name] = copied as Record<string, unknown>;
    }
  }
  return out;
}

function snapshotValue(value: unknown, depth: number, path: object[]): unknown {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return value;
    case "undefined":
    case "function":
    case "symbol":
      return OMIT;
  }
  if (value === null) return null;
  const obj = value as object;
  if (depth > MAX_SNAPSHOT_DEPTH || path.includes(obj)) return OMIT;
  path.push(obj);
  try {
    const toJSON = (obj as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      return snapshotValue(toJSON.call(obj), depth + 1, path);
    }
    if (Array.isArray(obj)) {
      return obj.map((e) => {
        const c = snapshotValue(e, depth + 1, path);
        return c === OMIT ? null : c;
      });
    }
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = snapshotValue(v, depth + 1, path);
      if (c !== OMIT) copy[k] = c;
    }
    return copy;
  } catch {
    return OMIT;
  } finally {
    path.pop();
  }
}
