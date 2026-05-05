// Helper module for the generated post.generated.test.ts and
// telemetry.generated.test.ts. These tests come from the unified YAML at
// `integration-test-data/tests/eval/{post,telemetry}.yaml` and exercise the
// SDK's three telemetry aggregators end-to-end:
//
//   - context_shape    → ContextShapeCollector
//   - evaluation_summary → EvaluationSummaryCollector
//   - example_contexts → ExampleContextCollector
//
// The helpers here are *thin adapters* — they construct the real SDK
// collectors, drive them with the YAML data + contexts, then drain the
// collector and translate the SDK's internal shape into the wire shape that
// the YAML's `expected_data` blocks describe (snake_case keys, type-tagged
// `selected_value` wrappers, etc).

import { ContextShapeCollector } from "../../src/telemetry/contextShapes";
import { EvaluationSummaryCollector } from "../../src/telemetry/evaluationSummaries";
import { ExampleContextCollector } from "../../src/telemetry/exampleContexts";
import type { ContextUploadMode, Contexts, Evaluation } from "../../src/types";
import { evaluateForTelemetry, store } from "./setup";

export type AggregatorKind = "context_shape" | "evaluation_summary" | "example_contexts";

interface ContextShapeAggregator {
  kind: "context_shape";
  collector: ContextShapeCollector;
}
interface EvaluationSummaryAggregator {
  kind: "evaluation_summary";
  collector: EvaluationSummaryCollector;
  // Side-channel populated by `feedAggregator` whenever an evaluation
  // resolves to a confidential / decryptWith value. The collector itself
  // (correctly) only emits the redacted `selectedValue` over the wire,
  // but the cross-SDK YAML asserts both the runtime resolved value
  // (`value` / `value_type`) and the redacted wire form (`selected_value`).
  // We stash the runtime unwrapped value here, keyed by config_key, so
  // `aggregatorPost` can restore the YAML's `value` field after draining.
  // Mirrors sdk-ruby's `last_unwrapped_overrides` pattern.
  unwrappedOverrides: Map<string, { unwrapped: unknown; valueType: string }>;
}
interface ExampleContextsAggregator {
  kind: "example_contexts";
  collector: ExampleContextCollector;
  // ExampleContextCollector deduplicates by `key` per (rate-limited) hour.
  // For test isolation we let each builder produce a fresh collector.
}

export type Aggregator =
  | ContextShapeAggregator
  | EvaluationSummaryAggregator
  | ExampleContextsAggregator;

// ---- buildAggregator ----------------------------------------------------

/**
 * Build a fresh aggregator of the requested kind.
 *
 * The `overrides` map mirrors the YAML `client_overrides` block — keys are
 * snake_case strings (e.g. `collect_evaluation_summaries`,
 * `context_upload_mode`). Unknown keys are ignored so the helper stays
 * resilient if YAML grows new options.
 */
export function buildAggregator(
  kind: AggregatorKind,
  overrides: Record<string, unknown>
): Aggregator {
  const uploadMode = normalizeUploadMode(overrides["context_upload_mode"]);
  const collectSummaries = overrides["collect_evaluation_summaries"] === false ? false : true;

  switch (kind) {
    case "context_shape":
      return { kind, collector: new ContextShapeCollector(uploadMode) };
    case "evaluation_summary":
      return {
        kind,
        collector: new EvaluationSummaryCollector(collectSummaries),
        unwrappedOverrides: new Map(),
      };
    case "example_contexts":
      return { kind, collector: new ExampleContextCollector(uploadMode) };
  }
}

/**
 * The YAML emits `:none`, `:shape_only`, `:periodic_example` (Ruby symbol
 * spelling). Translate those into the Node SDK's `ContextUploadMode` strings.
 * Anything unrecognised falls back to `periodic_example` (the SDK default)
 * so behaviour matches what `new Quonfig({})` would produce.
 */
function normalizeUploadMode(raw: unknown): ContextUploadMode {
  if (typeof raw !== "string") return "periodic_example";
  const normalized = raw.replace(/^:/, "").toLowerCase();
  if (normalized === "none") return "none";
  if (normalized === "shape_only" || normalized === "shapes_only") return "shapes_only";
  if (normalized === "periodic_example") return "periodic_example";
  return "periodic_example";
}

// ---- feedAggregator ------------------------------------------------------

/**
 * Feed `data` into the aggregator. Shape of `data` depends on `kind`:
 *
 *   context_shape    → a single Contexts object OR an array of them.
 *                      Each context object is pushed to ContextShapeCollector.
 *
 *   example_contexts → same shape rules as context_shape, but pushed to
 *                      ExampleContextCollector.
 *
 *   evaluation_summary → object with `keys: string[]` and optionally
 *                       `keys_without_context: string[]`. The first array is
 *                       evaluated under `contexts`; the second under `{}`.
 *                       Each evaluation is pushed to the collector.
 */
export function feedAggregator(
  agg: Aggregator,
  kind: AggregatorKind,
  data: unknown,
  contexts: Contexts
): void {
  if (agg.kind !== kind) {
    throw new Error(`feedAggregator: kind mismatch — agg=${agg.kind}, requested=${kind}`);
  }

  if (kind === "context_shape" || kind === "example_contexts") {
    const records = normalizeContextRecords(data);
    for (const rec of records) {
      if (agg.kind === "context_shape") {
        agg.collector.push(rec);
      } else if (agg.kind === "example_contexts") {
        agg.collector.push(rec);
      }
    }
    return;
  }

  // evaluation_summary — drive setup.evaluateForTelemetry() to build real
  // Evaluation records, then push them through the collector.
  if (kind === "evaluation_summary" && agg.kind === "evaluation_summary") {
    const payload = (data ?? {}) as {
      keys?: string[];
      keys_without_context?: string[];
    };
    const withCtx = payload.keys ?? [];
    const withoutCtx = payload.keys_without_context ?? [];

    for (const key of withCtx) {
      const ev = evaluateForTelemetry(key, contexts);
      if (ev) {
        recordUnwrappedOverride(agg.unwrappedOverrides, ev);
        agg.collector.push(ev);
      }
    }
    for (const key of withoutCtx) {
      const ev = evaluateForTelemetry(key, {});
      if (ev) {
        recordUnwrappedOverride(agg.unwrappedOverrides, ev);
        agg.collector.push(ev);
      }
    }
  }
}

/**
 * Stash the runtime-resolved (unwrapped) value for a confidential /
 * decryptWith evaluation. The collector itself emits only the redacted
 * `selectedValue` — the runtime value never crosses the wire — but the
 * cross-SDK YAML asserts both forms, so the post-projection in
 * `aggregatorPost` reaches into this side-channel to restore `value` /
 * `value_type` from the runtime view.
 */
function recordUnwrappedOverride(
  overrides: Map<string, { unwrapped: unknown; valueType: string }>,
  ev: Evaluation
): void {
  if (ev.reportableValue === undefined) return;
  const cfg = store.get(ev.configKey);
  const valueType = cfg?.valueType ?? "string";
  overrides.set(ev.configKey, {
    unwrapped: ev.unwrappedValue,
    valueType,
  });
}

/**
 * Accept either a single `Contexts` object or an array of them. Treat
 * `null`/`undefined`/empty objects as a no-op for symmetry with how the
 * collectors handle empty pushes.
 */
function normalizeContextRecords(data: unknown): Contexts[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data as Contexts[];
  if (typeof data === "object") return [data as Contexts];
  return [];
}

// ---- aggregatorPost ------------------------------------------------------

/**
 * Drain the aggregator and translate its output into the wire shape the
 * YAML's `expected_data` blocks describe.
 *
 *   context_shape    → array of `{ name, field_types }`, or `undefined`
 *                      if the collector had nothing to drain.
 *
 *   evaluation_summary → flat array, one item per (config-key × counter),
 *                        each `{ key, type, value, value_type, count, reason,
 *                        summary: { config_row_index, conditional_value_index,
 *                        weighted_value_index? } }`. Returns `undefined` if
 *                        the collector was disabled or empty.
 *
 *   example_contexts → the *single* example context's body (e.g.
 *                      `{ user: { name, age, key } }`), or `undefined` if
 *                      no example was retained (no `key` property anywhere).
 *
 * `endpoint` is accepted for symmetry with the YAML schema and the other
 * SDK targets but is informational here — Node-side helpers don't actually
 * post.
 */
export function aggregatorPost(agg: Aggregator, kind: AggregatorKind, _endpoint: string): unknown {
  if (agg.kind !== kind) {
    throw new Error(`aggregatorPost: kind mismatch — agg=${agg.kind}, requested=${kind}`);
  }

  if (agg.kind === "context_shape") {
    const event = agg.collector.drain();
    if (!event || !event.contextShapes) return undefined;
    const shapes = event.contextShapes.shapes;
    if (shapes.length === 0) return undefined;
    return shapes.map((s) => ({
      name: s.name,
      field_types: s.fieldTypes,
    }));
  }

  if (agg.kind === "example_contexts") {
    const event = agg.collector.drain();
    if (!event || !event.exampleContexts) return undefined;
    const examples = event.exampleContexts.examples;
    if (examples.length === 0) return undefined;
    // YAML's expected_data for example_contexts is a single-record
    // map (the inner contexts hash), not the wire-level list. Reconstruct
    // that hash from the first retained example.
    const first = examples[0]!;
    const out: Contexts = {};
    for (const c of first.contextSet.contexts) {
      out[c.type] = c.values;
    }
    return out;
  }

  if (agg.kind === "evaluation_summary") {
    const event = agg.collector.drain();
    if (!event || !event.summaries) return undefined;
    const summaries = event.summaries.summaries;
    if (summaries.length === 0) return undefined;

    // YAML's expected_data sorts results by config type alphabetically
    // (CONFIG before FEATURE_FLAG before LOG_LEVEL etc.), preserving
    // insertion order within each type bucket. Match that here so the
    // generated tests can compare with `.toEqual`.
    const sorted = [...summaries].sort((a, b) => {
      const ta = telemetryConfigType(a.type);
      const tb = telemetryConfigType(b.type);
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });

    const out: EvaluationSummaryWireRecord[] = [];
    for (const s of sorted) {
      for (const counter of s.counters) {
        let wireValueType = wireValueTypeFor(counter.selectedValue);
        let wireValue: unknown = unwrapSelectedValue(counter.selectedValue);
        // Confidential / decryptWith values: `selectedValue` carries the
        // redacted wire form (e.g. `{string: "*****abc12"}`), but the YAML
        // asserts `value` / `value_type` against the runtime resolved
        // plaintext. Pull those back from the side-channel populated by
        // `feedAggregator` (mirrors sdk-ruby's `last_unwrapped_overrides`).
        const override = agg.unwrappedOverrides.get(s.key);
        if (override !== undefined) {
          wireValue = override.unwrapped;
          wireValueType = override.valueType;
        }
        const summary: WireSummary = {
          config_row_index: counter.configRowIndex,
          conditional_value_index: counter.conditionalValueIndex,
        };
        if (counter.weightedValueIndex !== undefined && counter.weightedValueIndex >= 0) {
          summary.weighted_value_index = counter.weightedValueIndex;
        }
        const record: EvaluationSummaryWireRecord = {
          key: s.key,
          type: telemetryConfigType(s.type),
          value: wireValue,
          value_type: wireValueType,
          count: counter.count,
          reason: counter.reason,
          summary,
        };
        // Always emit selected_value (the proto-style {<wrapperKey>: value}).
        // The api-telemetry server expects it on every eval-summary row;
        // the cross-SDK YAML asserts it uniformly.
        if (counter.selectedValue !== undefined && counter.selectedValue !== null) {
          record.selected_value = counter.selectedValue;
        }
        out.push(record);
      }
    }
    return out;
  }

  return undefined;
}

interface WireSummary {
  config_row_index: number;
  conditional_value_index: number;
  weighted_value_index?: number;
}

interface EvaluationSummaryWireRecord {
  key: string;
  type: string;
  value: unknown;
  value_type: string;
  count: number;
  reason: number;
  selected_value?: unknown;
  summary: WireSummary;
}

/**
 * The collector stores `selectedValue` as `{ [valueType]: value }` where
 * valueType is the JS `typeof` (`"string"`, `"number"`, `"boolean"`,
 * `"object"`). Translate that back into a primitive value.
 */
function unwrapSelectedValue(selectedValue: unknown): unknown {
  if (selectedValue === null || selectedValue === undefined) return undefined;
  if (typeof selectedValue !== "object") return selectedValue;
  const entries = Object.entries(selectedValue as Record<string, unknown>);
  if (entries.length !== 1) return selectedValue;
  return entries[0]![1];
}

/**
 * Map the collector's stored selectedValue wrapper into the snake_case
 * `value_type` string the YAML uses (`"string"`, `"int"`, `"double"`,
 * `"bool"`, `"string_list"`).
 *
 * Note: integers vs doubles are both `number` in JS, so we differentiate
 * via `Number.isInteger` (matches what fieldTypeForValue does for context
 * shapes).
 */
function wireValueTypeFor(selectedValue: unknown): string {
  const v = unwrapSelectedValue(selectedValue);
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "double";
  if (Array.isArray(v)) return "string_list";
  return "string";
}

/**
 * Translate the collector's stored config type (snake_case from
 * `ConfigTypeString`) into the SCREAMING_SNAKE the YAML uses.
 */
function telemetryConfigType(internal: string): string {
  if (internal === "feature_flag") return "FEATURE_FLAG";
  if (internal === "config") return "CONFIG";
  if (internal === "segment") return "SEGMENT";
  if (internal === "log_level") return "LOG_LEVEL";
  if (internal === "schema") return "SCHEMA";
  return internal.toUpperCase();
}

// Re-exports so callers can build their own collectors if they want a more
// hands-on test path. Keeps the module self-contained.
export { ContextShapeCollector, EvaluationSummaryCollector, ExampleContextCollector };
export type { Evaluation };
