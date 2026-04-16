import type { ConfigResponse, EvalMatch } from "./types";

export const ReasonUnknown = 0;
export const ReasonStatic = 1;
export const ReasonTargetingMatch = 2;
export const ReasonSplit = 3;
export const ReasonDefault = 4;
export const ReasonError = 5;

function hasTargetingRules(cfg: ConfigResponse): boolean {
  const checkRules = (rules: { criteria: { operator: string }[] }[]) =>
    rules.some((rule) => rule.criteria.some((c) => c.operator !== "ALWAYS_TRUE"));
  if (checkRules(cfg.default.rules)) return true;
  if (cfg.environment) return checkRules(cfg.environment.rules);
  return false;
}

export function computeReason(match: EvalMatch, cfg: ConfigResponse): number {
  if (match.weightedValueIndex !== undefined && match.weightedValueIndex > 0) return ReasonSplit;
  if (match.ruleIndex === 0 && !hasTargetingRules(cfg)) return ReasonStatic;
  return ReasonTargetingMatch;
}
