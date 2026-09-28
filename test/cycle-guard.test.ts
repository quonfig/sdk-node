import { describe, expect, it } from "vitest";

import { ConfigStore } from "../src/store";
import { Evaluator } from "../src/evaluator";
import { Resolver } from "../src/resolver";
import { Quonfig } from "../src/quonfig";
import type { ConfigResponse, Value } from "../src/types";

// qfg-9dxb.7: a malformed workspace (segment that references itself, or a
// decryptWith chain that loops) must not recurse until a RangeError escapes
// get(). Semantics match sdk-go (qfg-9dxb.4): a segment cycle is treated as a
// missing segment (IN_SEG false, NOT_IN_SEG true); a decryptWith cycle is an
// ordinary decryption failure.

// A segment whose only matching rule is <operator> <ref>, falling through to false.
function segRef(key: string, ref: string, operator = "IN_SEG"): ConfigResponse {
  return {
    id: key,
    key,
    type: "segment",
    valueType: "bool",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator, valueToMatch: { type: "string", value: ref } }],
          value: { type: "bool", value: true },
        },
        { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value: false } },
      ],
    },
  };
}

function flagInSeg(key: string, seg: string, operator = "IN_SEG"): ConfigResponse {
  return { ...segRef(key, seg, operator), type: "feature_flag" };
}

function confidential(key: string, decryptWith: string): ConfigResponse {
  return {
    id: key,
    key,
    type: "config",
    valueType: "string",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: {
            type: "string",
            value: "AA--00112233445566778899AABB--BB",
            confidential: true,
            decryptWith,
          },
        },
      ],
    },
  };
}

function setup(configs: ConfigResponse[]) {
  const store = new ConfigStore();
  store.update({ meta: { version: "test", environment: "" }, configs });
  const evaluator = new Evaluator(store);
  const resolver = new Resolver(store, evaluator);
  return { store, evaluator, resolver };
}

describe("segment cycle guard (qfg-9dxb.7)", () => {
  const cases: Record<string, ConfigResponse[]> = {
    "self-reference": [segRef("seg-a", "seg-a")],
    "two-cycle": [segRef("seg-a", "seg-b"), segRef("seg-b", "seg-a")],
    "three-cycle": [segRef("seg-a", "seg-b"), segRef("seg-b", "seg-c"), segRef("seg-c", "seg-a")],
  };

  for (const [name, segs] of Object.entries(cases)) {
    it(`IN_SEG ${name}: cyclic segment does not match and does not throw`, () => {
      const flag = flagInSeg("flag", "seg-a");
      const { evaluator, store } = setup([...segs, flag]);

      const res = evaluator.evaluateConfig(store.get("flag")!, "", {});
      expect(res.isMatch).toBe(true);
      expect(res.value?.value).toBe(false);

      // Evaluating the segment itself directly must also terminate and not match.
      const segRes = evaluator.evaluateConfig(store.get("seg-a")!, "", {});
      expect(segRes.value?.value).toBe(false);
    });
  }

  it("NOT_IN_SEG on a cyclic segment is true (cycle == missing segment)", () => {
    const flag = flagInSeg("flag", "seg-a", "NOT_IN_SEG");
    const { evaluator, store } = setup([segRef("seg-a", "seg-b"), segRef("seg-b", "seg-a"), flag]);
    // seg-a -> seg-b -> (seg-a is on the path: missing) => seg-b false => seg-a false,
    // so flag's NOT_IN_SEG seg-a is true.
    const res = evaluator.evaluateConfig(store.get("flag")!, "", {});
    expect(res.value?.value).toBe(true);

    // Self-referencing NOT_IN_SEG: inner reference is missing => true.
    const self = setup([segRef("seg-a", "seg-a", "NOT_IN_SEG")]);
    expect(self.evaluator.evaluateConfig(self.store.get("seg-a")!, "", {}).value?.value).toBe(true);
  });

  it("diamond (flag -> A, flag -> B, A -> C, B -> C) still resolves", () => {
    const leaf: ConfigResponse = {
      id: "seg-c",
      key: "seg-c",
      type: "segment",
      valueType: "bool",
      sendToClientSdk: false,
      default: {
        rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value: true } }],
      },
    };
    const flag: ConfigResponse = {
      id: "flag",
      key: "flag",
      type: "feature_flag",
      valueType: "bool",
      sendToClientSdk: false,
      default: {
        rules: [
          {
            criteria: [
              { operator: "IN_SEG", valueToMatch: { type: "string", value: "seg-a" } },
              { operator: "IN_SEG", valueToMatch: { type: "string", value: "seg-b" } },
            ],
            value: { type: "bool", value: true },
          },
          { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value: false } },
        ],
      },
    };
    const { evaluator, store } = setup([
      leaf,
      segRef("seg-a", "seg-c"),
      segRef("seg-b", "seg-c"),
      flag,
    ]);
    expect(evaluator.evaluateConfig(store.get("flag")!, "", {}).value?.value).toBe(true);
  });
});

describe("decryptWith cycle guard (qfg-9dxb.7)", () => {
  const cases: Record<string, ConfigResponse[]> = {
    "key decrypts with itself": [confidential("secret", "k"), confidential("k", "k")],
    "key cycle A->B->A": [
      confidential("secret", "a"),
      confidential("a", "b"),
      confidential("b", "a"),
    ],
    "value decrypts with itself": [confidential("secret", "secret")],
  };

  for (const [name, configs] of Object.entries(cases)) {
    it(`${name}: throws a decryption Error, not RangeError`, () => {
      const { resolver, store } = setup(configs);
      const cfg = store.get("secret")!;
      const val: Value = cfg.default.rules[0]!.value;
      let err: unknown;
      try {
        resolver.resolveValue(val, cfg.key, cfg.valueType, "", {});
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(RangeError);
      expect((err as Error).message).toMatch(/decryptWith cycle/);
    });
  }

  it("get() surfaces an ordinary Error and getStringDetails reports ERROR", async () => {
    const q = new Quonfig({
      sdkKey: "test",
      environment: "Production",
      datafile: {
        meta: { version: "test", environment: "Production" },
        configs: [confidential("secret", "a"), confidential("a", "b"), confidential("b", "a")],
      },
    });
    await q.init();
    expect(() => q.get("secret")).toThrow(/decryptWith cycle/);
    const details = q.getStringDetails("secret");
    expect(details.reason).toBe("ERROR");
  });
});
