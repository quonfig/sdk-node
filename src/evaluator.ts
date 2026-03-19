import type {
  ConfigResponse,
  Contexts,
  Criterion,
  EvalMatch,
  Rule,
  Value,
} from "./types";
import { getContextValue } from "./context";
import { evaluateCriterion } from "./operators";
import type { SegmentResolver } from "./operators";
import { WeightedValueResolver } from "./weighted";
import type { ConfigStore } from "./store";

/**
 * Evaluator is the main evaluation engine. It evaluates configs against contexts,
 * resolving rules, operators, segments, and weighted values.
 *
 * This is a faithful port of the Go SDK's evalcore.Evaluator.
 */
export class Evaluator {
  private configStore: ConfigStore;
  private weighted: WeightedValueResolver;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.weighted = new WeightedValueResolver();
  }

  /**
   * Evaluate a config for the given environment and context.
   *
   * Evaluation flow:
   *  1. Find the environment block matching envID (if any)
   *  2. Iterate its rules top-to-bottom; first match wins
   *  3. If no env-specific match, fall back to default.rules
   *  4. For each rule, all criteria must match (AND logic)
   *  5. If matched value is weighted_values, resolve through WeightedValueResolver
   */
  evaluateConfig(
    cfg: ConfigResponse,
    envID: string,
    contexts: Contexts
  ): EvalMatch {
    // Try environment-specific rules first
    if (envID && cfg.environment && cfg.environment.id === envID) {
      const match = this.evaluateRules(cfg, cfg.environment.rules ?? [], contexts, 0);
      if (match !== undefined) {
        return match;
      }
    }

    // Fall back to default rules
    const match = this.evaluateRules(cfg, cfg.default.rules ?? [], contexts, 0);
    if (match !== undefined) {
      return match;
    }

    return { isMatch: false, ruleIndex: -1, weightedValueIndex: -1 };
  }

  private evaluateRules(
    cfg: ConfigResponse,
    rules: Rule[],
    contexts: Contexts,
    ruleIndexOffset: number
  ): EvalMatch | undefined {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      if (this.evaluateAllCriteria(cfg, rule.criteria, contexts)) {
        const value = { ...rule.value };
        const match: EvalMatch = {
          isMatch: true,
          value,
          ruleIndex: ruleIndexOffset + i,
          weightedValueIndex: -1,
        };

        // Resolve weighted values
        if (value.type === "weighted_values" && value.value) {
          const wvData = value.value;
          if (wvData && wvData.weightedValues) {
            const resolved = this.weighted.resolve(wvData, cfg.key, contexts);
            if (resolved.value !== undefined) {
              match.value = resolved.value;
              match.weightedValueIndex = resolved.index;
            }
          }
        }

        return match;
      }
    }
    return undefined;
  }

  private evaluateAllCriteria(
    cfg: ConfigResponse,
    criteria: Criterion[],
    contexts: Contexts
  ): boolean {
    for (const criterion of criteria) {
      if (!this.evaluateSingleCriterion(cfg, criterion, contexts)) {
        return false;
      }
    }
    return true;
  }

  private evaluateSingleCriterion(
    cfg: ConfigResponse,
    criterion: Criterion,
    contexts: Contexts
  ): boolean {
    const propertyName = criterion.propertyName ?? "";
    const { value: contextValue, exists: contextExists } = getContextValue(
      contexts,
      propertyName
    );

    // Build a segment resolver that recursively evaluates segment configs
    const segmentResolver: SegmentResolver = (segmentKey: string) => {
      const segConfig = this.configStore.get(segmentKey);
      if (segConfig === undefined) {
        return { result: false, found: false };
      }
      // Evaluate the segment config (segments have no environment, use default rules)
      const segMatch = this.evaluateConfig(segConfig, "", contexts);
      if (!segMatch.isMatch || segMatch.value === undefined) {
        return { result: false, found: false };
      }
      return { result: !!segMatch.value.value, found: true };
    };

    return evaluateCriterion(contextValue, contextExists, criterion, segmentResolver);
  }
}
