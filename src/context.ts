import type { ContextValue, Contexts } from "./types";

/**
 * Look up a property value from contexts using dotted notation.
 * "user.email" -> contexts["user"]["email"]
 * If there is no dot, look up in the unnamed ("") context: "domain" -> contexts[""]["domain"]
 */
export function contextLookup(
  contexts: Contexts,
  propertyName: string | undefined
): ContextValue | undefined {
  if (propertyName === undefined) {
    return undefined;
  }

  const dotIndex = propertyName.indexOf(".");
  if (dotIndex === -1) {
    // No dot -- look up in the unnamed ("") context
    const ctx = contexts[""];
    if (ctx === undefined) {
      return undefined;
    }
    return ctx[propertyName];
  }

  const contextName = propertyName.slice(0, dotIndex);
  const key = propertyName.slice(dotIndex + 1);

  const ctx = contexts[contextName];
  if (ctx === undefined) {
    return undefined;
  }

  return ctx[key];
}

/**
 * Merge multiple context sets, oldest tier first. A named context in a later set
 * REPLACES the whole same-named context from earlier sets: the earlier set's
 * attributes in that context are dropped, not merged property by property.
 * Named contexts a later set does not mention survive unchanged.
 *
 * This is the documented rule (docs: concepts/context, "Adding to and Merging
 * Contexts") and it applies to every tier: dev context + globalContext,
 * globalContext + per-call (JIT) contexts, withContext/inContext, and nesting.
 */
export function mergeContexts(...sets: (Contexts | undefined)[]): Contexts {
  const result: Contexts = {};

  for (const cs of sets) {
    if (cs === undefined) {
      continue;
    }

    for (const [name, ctx] of Object.entries(cs)) {
      result[name] = { ...ctx };
    }
  }

  return result;
}

/**
 * Get context value with support for magic properties.
 * "prefab.current-time" and "quonfig.current-time" return current UTC millis.
 */
export function getContextValue(
  contexts: Contexts,
  propertyName: string
): { value: any; exists: boolean } {
  // Handle magic current-time properties
  if (
    propertyName === "prefab.current-time" ||
    propertyName === "quonfig.current-time" ||
    propertyName === "reforge.current-time"
  ) {
    return { value: Date.now(), exists: true };
  }

  const value = contextLookup(contexts, propertyName);
  return { value, exists: value !== undefined && value !== null };
}
