import type { Evaluation, EvaluationSummary, TelemetryEvent } from "../types";

/**
 * Collects evaluation summaries for telemetry reporting.
 *
 * Each evaluation is aggregated by (configKey, configType) and
 * counted by (configId, ruleIndex, value, weightedValueIndex).
 */
export class EvaluationSummaryCollector {
  private enabled: boolean;
  private data: Map<string, Map<string, number>> = new Map();
  private startAt: number | undefined;
  private maxDataSize: number;

  constructor(enabled: boolean, maxDataSize: number = 10000) {
    this.enabled = enabled;
    this.maxDataSize = maxDataSize;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  push(evaluation: Evaluation): void {
    if (!this.enabled) return;
    if (this.data.size >= this.maxDataSize) return;
    if (evaluation.unwrappedValue === undefined) return;
    if (evaluation.configType === "log_level") return;

    this.startAt = this.startAt ?? Date.now();

    const key = JSON.stringify([evaluation.configKey, evaluation.configType]);
    const counter = JSON.stringify([
      evaluation.configId,
      evaluation.ruleIndex,
      typeof evaluation.unwrappedValue,
      evaluation.reportableValue ?? evaluation.unwrappedValue,
      evaluation.weightedValueIndex,
    ]);

    let countersForKey = this.data.get(key);
    if (countersForKey === undefined) {
      countersForKey = new Map();
      this.data.set(key, countersForKey);
    }

    const currentCount = countersForKey.get(counter) ?? 0;
    countersForKey.set(counter, currentCount + 1);
  }

  /**
   * Drain collected summaries into a TelemetryEvent, or return undefined if empty.
   */
  drain(): TelemetryEvent | undefined {
    if (this.data.size === 0) return undefined;

    const summaries: EvaluationSummary[] = [];

    this.data.forEach((rawCounters, keyJSON) => {
      const [configKey, configType] = JSON.parse(keyJSON);

      const counters: any[] = [];
      rawCounters.forEach((count, counterJSON) => {
        const [configId, ruleIndex, valueType, value, weightedValueIndex] =
          JSON.parse(counterJSON);

        const counter: any = {
          configId,
          conditionalValueIndex: ruleIndex,
          configRowIndex: 0,
          selectedValue: { [valueType]: value },
          count,
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

    // Clear data after drain
    this.data.clear();
    this.startAt = undefined;

    return event;
  }
}
