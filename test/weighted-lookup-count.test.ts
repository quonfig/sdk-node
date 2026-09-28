import { describe, expect, it } from "vitest";

import { WeightedValueResolver } from "../src/weighted";
import type { Contexts, WeightedValuesData } from "../src/types";

// The hash property is looked up once per weighted evaluation: the same
// lookup feeds both the bucketing fraction and the missing-property flag.
describe("WeightedValueResolver context lookups", () => {
  const wv: WeightedValuesData = {
    hashByPropertyName: "user.key",
    weightedValues: [
      { weight: 1, value: { type: "string", value: "a" } },
      { weight: 1, value: { type: "string", value: "b" } },
    ],
  } as WeightedValuesData;

  it("reads the hash property once when present", () => {
    let reads = 0;
    const user = {};
    Object.defineProperty(user, "key", {
      enumerable: true,
      get() {
        reads++;
        return "u-1";
      },
    });
    const contexts = { user } as unknown as Contexts;

    const result = new WeightedValueResolver().resolve(wv, "cfg", contexts);

    expect(reads).toBe(1);
    expect(result.missingHashProperty).toBeUndefined();
  });
});
