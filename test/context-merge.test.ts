import { describe, expect, it } from "vitest";

import { mergeContexts } from "../src/context";
import { Quonfig } from "../src/quonfig";
import type { ConfigEnvelope, Contexts } from "../src/types";

// Documented rule (docs: concepts/context.md, "Adding to and Merging Contexts"):
// a newer tier that supplies a named context REPLACES that whole named context.
// Named contexts the newer tier does not mention survive. (qfg-2agi.24 / .35)

function rule(key: string, prop: string, val: string): ConfigEnvelope["configs"][number] {
  return {
    id: "cfg-" + key,
    key,
    type: "config",
    valueType: "string",
    sendToClientSdk: false,
    default: {
      rules: [
        { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value: "default" } },
      ],
    },
    environment: {
      id: "Production",
      rules: [
        {
          criteria: [
            {
              propertyName: prop,
              operator: "PROP_IS_ONE_OF",
              valueToMatch: { type: "string_list", value: [val] },
            },
          ],
          value: { type: "string", value: "present" },
        },
        { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value: "absent" } },
      ],
    },
  };
}

const datafile: ConfigEnvelope = {
  meta: { version: "test", environment: "Production" },
  configs: [
    rule("email", "user.email", "a@prefab.cloud"),
    rule("plan", "user.plan", "pro"),
    rule("team", "team.key", "t1"),
  ],
};

const T1: Contexts = { user: { email: "a@prefab.cloud" }, team: { key: "t1" } };
const T2: Contexts = { user: { plan: "pro" } };

async function makeClient(globalContext?: Contexts): Promise<Quonfig> {
  const q = new Quonfig({
    sdkKey: "test",
    datafile,
    environment: "Production",
    globalContext,
    enableQuonfigUserContext: false,
  });
  await q.init();
  return q;
}

type Getter = { getString(key: string, contexts?: Contexts): string | undefined };

function expectReplaceNamed(g: Getter, jit?: Contexts) {
  expect(g.getString("email", jit)).toBe("absent"); // older user.email dropped
  expect(g.getString("plan", jit)).toBe("present"); // newer user.plan applied
  expect(g.getString("team", jit)).toBe("present"); // unmentioned team survives
}

describe("mergeContexts: same-named context replaces the whole previous one", () => {
  it("mergeContexts replaces a named context and keeps unmentioned ones", () => {
    expect(mergeContexts(T1, T2)).toEqual({
      user: { plan: "pro" },
      team: { key: "t1" },
    });
  });

  it("mergeContexts does not alias its inputs", () => {
    const a: Contexts = { user: { email: "x" } };
    const out = mergeContexts(a);
    (out.user as Record<string, unknown>).email = "y";
    expect(a.user.email).toBe("x");
  });

  it("global + JIT", async () => {
    expectReplaceNamed(await makeClient(T1), T2);
  });

  it("global + withContext", async () => {
    expectReplaceNamed((await makeClient(T1)).withContext(T2));
  });

  it("global + inContext", async () => {
    expectReplaceNamed((await makeClient(T1)).inContext(T2));
  });

  it("withContext + JIT", async () => {
    expectReplaceNamed((await makeClient()).withContext(T1), T2);
  });

  it("nested withContext", async () => {
    expectReplaceNamed((await makeClient()).withContext(T1).withContext(T2));
  });

  it("nested withContext callback form", async () => {
    const q = await makeClient();
    q.withContext(T1, (a) => a.withContext(T2, (b) => expectReplaceNamed(b)));
  });

  it("baseline: without a newer tier the older user context is used", async () => {
    const q = (await makeClient()).withContext(T1);
    expect(q.getString("email")).toBe("present");
    expect(q.getString("team")).toBe("present");
  });
});
