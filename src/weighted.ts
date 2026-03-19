import type { Contexts, Value, WeightedValuesData } from "./types";
import { hashZeroToOne } from "./hashing";
import { contextLookup } from "./context";

/**
 * WeightedValueResolver resolves weighted value distributions to a single value.
 *
 * This is a faithful port of the Go SDK's WeightedValueResolver.
 */
export class WeightedValueResolver {
  /**
   * Resolve picks a value from the weighted distribution.
   *
   * If hashByPropertyName is set and the context has a value for that property,
   * the selection is deterministic via Murmur3 hash. Otherwise, it falls back
   * to Math.random().
   *
   * Returns the selected value and its index, or [undefined, -1] if no values.
   */
  resolve(
    wv: WeightedValuesData,
    configKey: string,
    contexts: Contexts
  ): { value: Value | undefined; index: number } {
    const fraction = this.getUserFraction(wv, configKey, contexts);

    let totalWeight = 0;
    for (const entry of wv.weightedValues) {
      totalWeight += entry.weight;
    }

    const threshold = fraction * totalWeight;

    let runningSum = 0;
    for (let i = 0; i < wv.weightedValues.length; i++) {
      runningSum += wv.weightedValues[i]!.weight;
      if (runningSum >= threshold) {
        return { value: { ...wv.weightedValues[i]!.value }, index: i };
      }
    }

    // Fallback: return the first value (should not normally be reached)
    if (wv.weightedValues.length > 0) {
      return { value: { ...wv.weightedValues[0]!.value }, index: 0 };
    }
    return { value: undefined, index: -1 };
  }

  private getUserFraction(
    wv: WeightedValuesData,
    configKey: string,
    contexts: Contexts
  ): number {
    if (wv.hashByPropertyName) {
      const value = contextLookup(contexts, wv.hashByPropertyName);
      if (value !== undefined && value !== null) {
        const valueToHash = `${configKey}${value}`;
        return hashZeroToOne(valueToHash);
      }
    }
    return Math.random();
  }
}
