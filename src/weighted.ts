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
   * the selection is deterministic via Murmur3 hash. Otherwise the fraction is
   * 0.0, which selects the first weighted variant (matches sdk-net/sdk-java,
   * qfg-9dxb.8). When hashByPropertyName is set but its context value is
   * undefined or null, `missingHashProperty` names that property.
   *
   * Returns the selected value and its index, or [undefined, -1] if no values.
   */
  resolve(
    wv: WeightedValuesData,
    configKey: string,
    contexts: Contexts
  ): { value: Value | undefined; index: number; missingHashProperty?: string } {
    let fraction = 0;
    let missingHashProperty: string | undefined;
    if (wv.hashByPropertyName) {
      const value = contextLookup(contexts, wv.hashByPropertyName);
      if (value !== undefined && value !== null) {
        fraction = hashZeroToOne(`${configKey}${value}`);
      } else {
        missingHashProperty = wv.hashByPropertyName;
      }
    }

    let totalWeight = 0;
    for (const entry of wv.weightedValues) {
      totalWeight += entry.weight;
    }

    const threshold = fraction * totalWeight;

    let runningSum = 0;
    for (let i = 0; i < wv.weightedValues.length; i++) {
      runningSum += wv.weightedValues[i]!.weight;
      if (runningSum >= threshold) {
        return { value: { ...wv.weightedValues[i]!.value }, index: i, missingHashProperty };
      }
    }

    // Fallback: return the first value (should not normally be reached)
    if (wv.weightedValues.length > 0) {
      return { value: { ...wv.weightedValues[0]!.value }, index: 0, missingHashProperty };
    }
    return { value: undefined, index: -1 };
  }
}
