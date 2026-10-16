import type { Evaluation, EvaluationSummary, EvaluationCounter, TelemetryEvent } from "../types";

/**
 * Map a runtime value onto the proto-style wrapper key used by every SDK's
 * eval-summary `selectedValue` payload: bool / int / double / string /
 * stringList. This must match sdk-go's marshalSelectedValue and sdk-ruby's
 * EvaluationSummariesAggregator#wrap_selected_value so the api-telemetry
 * server sees a consistent shape across SDKs.
 */
function wrapperKeyForValue(v: unknown): string {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "double";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "stringList";
  return "string";
}

type Counter = { count: number; reason: number };

// A per-value counter identity, cached on the installed value it came from,
// plus the live counter it maps to in `window`.
type CounterSlot = {
  key: string;
  counterKey: string;
  configId: string;
  ruleIndex: number;
  weightedValueIndex: number | undefined;
  window: number;
  counter?: Counter;
};

export class EvaluationSummaryCollector {
  private enabled: boolean;
  private data: Map<string, Map<string, Counter>> = new Map();
  // Weak, so a replaced config's values (and their cached keys) are collected.
  private slots: WeakMap<object, CounterSlot> = new WeakMap();
  private window = 0;
  private startAt: number | undefined;
  private maxDataSize: number;

  constructor(enabled: boolean, maxDataSize: number = 10000) {
    this.enabled = enabled;
    this.maxDataSize = maxDataSize;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Count one evaluation. `valueRef` is the installed (stored) value object the
   * evaluation resolved to. Stored values are replaced, never mutated, on each
   * install, so the counter identity is computed once per installed value and
   * a repeat read in the same window is a counter increment instead of a
   * serialization of the selected value (qfg-23uf). A value resolved fresh on
   * each read (ENV_VAR, decryption) is a different object every time and
   * simply never hits the cache.
   */
  push(evaluation: Evaluation, valueRef?: object): void {
    if (!this.enabled) return;
    if (evaluation.unwrappedValue === undefined) return;
    if (evaluation.configType === "log_level") return;

    let slot = valueRef === undefined ? undefined : this.slots.get(valueRef);
    if (
      slot !== undefined &&
      (slot.configId !== evaluation.configId ||
        slot.ruleIndex !== evaluation.ruleIndex ||
        slot.weightedValueIndex !== evaluation.weightedValueIndex)
    ) {
      slot = undefined;
    }
    if (slot?.window === this.window && slot.counter) {
      slot.counter.count++;
      return;
    }

    if (slot === undefined) {
      slot = this.newSlot(evaluation);
      if (valueRef !== undefined) this.slots.set(valueRef, slot);
    }

    const { key, counterKey } = slot;
    // Cap on distinct (configKey, configType) per window: a NEW key beyond the
    // cap is dropped, an existing key keeps counting (P6).
    if (!this.data.has(key) && this.data.size >= this.maxDataSize) return;

    this.startAt = this.startAt ?? Date.now();

    let countersForKey = this.data.get(key);
    if (countersForKey === undefined) {
      countersForKey = new Map();
      this.data.set(key, countersForKey);
    }

    let counter = countersForKey.get(counterKey);
    if (counter === undefined) {
      counter = { count: 1, reason: evaluation.reason };
      countersForKey.set(counterKey, counter);
    } else {
      counter.count++;
    }
    slot.window = this.window;
    slot.counter = counter;
  }

  private newSlot(evaluation: Evaluation): CounterSlot {
    const key = JSON.stringify([evaluation.configKey, evaluation.configType]);

    // For redacted (confidential / decryptWith) values, the wire shape is
    // always `{string: "*****<md5>"}` regardless of the underlying type —
    // the redaction itself is a string and must not masquerade as the
    // original wrapper. For plain evaluations, derive the wrapper from
    // the runtime unwrapped value.
    const isRedacted = evaluation.reportableValue !== undefined;
    const wrapperKey = isRedacted ? "string" : wrapperKeyForValue(evaluation.unwrappedValue);
    const selectedRaw = evaluation.reportableValue ?? evaluation.unwrappedValue;
    const counterKey = JSON.stringify([
      evaluation.configId,
      evaluation.ruleIndex,
      wrapperKey,
      selectedRaw,
      evaluation.weightedValueIndex,
    ]);
    return {
      key,
      counterKey,
      configId: evaluation.configId,
      ruleIndex: evaluation.ruleIndex,
      weightedValueIndex: evaluation.weightedValueIndex,
      window: -1,
    };
  }

  /**
   * Stop recording for the rest of the process and clear buffered data. Called
   * when telemetry is disabled after a 401/403/404 (P3), so nothing aggregates
   * for a dead endpoint.
   */
  disable(): void {
    this.enabled = false;
    this.data.clear();
    this.window++;
    this.startAt = undefined;
  }

  drain(): TelemetryEvent | undefined {
    if (this.data.size === 0) return undefined;

    const summaries: EvaluationSummary[] = [];

    this.data.forEach((rawCounters, keyJSON) => {
      const [configKey, configType] = JSON.parse(keyJSON);

      const counters: EvaluationCounter[] = [];
      rawCounters.forEach(({ count, reason }, counterJSON) => {
        const [configId, ruleIndex, wrapperKey, value, weightedValueIndex] =
          JSON.parse(counterJSON);

        const counter: EvaluationCounter = {
          configId,
          conditionalValueIndex: ruleIndex,
          configRowIndex: 0,
          selectedValue: { [wrapperKey]: value },
          count,
          reason,
        };

        if (weightedValueIndex !== undefined && weightedValueIndex >= 0) {
          counter.weightedValueIndex = weightedValueIndex;
        }

        counters.push(counter);
      });

      summaries.push({
        key: configKey,
        type: configType,
        counters,
      });
    });

    const event: TelemetryEvent = {
      summaries: {
        start: this.startAt ?? Date.now(),
        end: Date.now(),
        summaries,
      },
    };

    this.data.clear();
    this.window++;
    this.startAt = undefined;

    return event;
  }
}
