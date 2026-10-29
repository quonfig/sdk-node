// evaluateDetails(key, contexts?) (qfg-177f): the untyped details read,
// matching sdk-go's Client.EvaluateDetails. It returns the resolved value in
// its stored form (a duration is its ISO text exactly as stored), plus the
// stored valueType, with the same reason/variant/flagMetadata/telemetry as the
// typed *Details getters. No type check, no coercion, no parse validation.

import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src";
import type { ConfigResponse, QuonfigOptions, Value } from "../src/types";
import { DATA_DIR, ENVIRONMENT } from "./integration/setup";

const clients: Quonfig[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()!.close();
  delete process.env.QFG_177F_TIMEOUT;
});

function config(key: string, valueType: string, value: Value, type = "config"): ConfigResponse {
  return {
    id: `id-${key}`,
    key,
    type,
    valueType,
    sendToClientSdk: false,
    default: { rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value }] },
  } as ConfigResponse;
}

const baseOptions: Partial<QuonfigOptions> = {
  sdkKey: "test-unused",
  enableSSE: false,
  enablePolling: false,
  enableQuonfigUserContext: false,
  contextUploadMode: "none",
};

async function inlineClient(
  configs: ConfigResponse[],
  options: Partial<QuonfigOptions> = {}
): Promise<Quonfig> {
  const client = new Quonfig({
    ...baseOptions,
    environment: "Production",
    collectEvaluationSummaries: false,
    datafile: { meta: { version: "test", environment: "Production" }, configs },
    ...options,
  } as QuonfigOptions);
  await client.init();
  clients.push(client);
  return client;
}

async function fixtureClient(): Promise<Quonfig> {
  const client = new Quonfig({
    ...baseOptions,
    datadir: DATA_DIR,
    environment: ENVIRONMENT,
    collectEvaluationSummaries: false,
  } as QuonfigOptions);
  await client.init();
  clients.push(client);
  return client;
}

describe("evaluateDetails", () => {
  it("returns a static duration's ISO text unchanged", async () => {
    const q = await inlineClient([
      config("d.short", "duration", { type: "duration", value: "PT90S" }),
      config("d.long", "duration", { type: "duration", value: "P1DT6H2M1.5S" }),
    ]);

    const short = q.evaluateDetails("d.short");
    expect(short.value).toBe("PT90S");
    expect(short.valueType).toBe("duration");
    expect(short.reason).toBe("STATIC");
    expect(short.variant).toBe("static");
    expect(short.errorCode).toBeUndefined();
    expect(short.flagMetadata).toMatchObject({ configId: "id-d.short", configType: "CONFIG" });

    const long = q.evaluateDetails("d.long");
    expect(long.value).toBe("P1DT6H2M1.5S");
    expect(long.reason).toBe("STATIC");

    // Existing getters are unchanged: getDuration still gives ms and the
    // string details getter still rejects a duration.
    expect(q.getDuration("d.short")).toBe(90000);
    expect(q.getStringDetails("d.short").errorCode).toBe("TYPE_MISMATCH");
  });

  it("returns a malformed duration raw with a success reason", async () => {
    const q = await inlineClient([config("d.bad", "duration", { type: "duration", value: "30s" })]);
    const d = q.evaluateDetails("d.bad");
    expect(d.value).toBe("30s");
    expect(d.valueType).toBe("duration");
    expect(d.reason).toBe("STATIC");
    expect(d.errorCode).toBeUndefined();
    // The typed getter still treats it as malformed.
    expect(q.getDuration("d.bad", undefined, 5)).toBe(5);
  });

  it("returns other value types in their stored form", async () => {
    const q = await inlineClient([
      config("s", "string", { type: "string", value: "hello" }),
      config("b", "bool", { type: "bool", value: false }, "feature_flag"),
      config("i", "int", { type: "int", value: 42 }),
      config("l", "string_list", { type: "string_list", value: ["a", "b"] }),
      config("j", "json", { type: "json", value: { a: 1 } }),
    ]);
    expect(q.evaluateDetails("s")).toMatchObject({ value: "hello", valueType: "string" });
    expect(q.evaluateDetails("b")).toMatchObject({
      value: false,
      valueType: "bool",
      flagMetadata: { configType: "FEATURE_FLAG" },
    });
    expect(q.evaluateDetails("i")).toMatchObject({ value: 42, valueType: "int" });
    expect(q.evaluateDetails("l")).toMatchObject({ value: ["a", "b"], valueType: "string_list" });
    expect(q.evaluateDetails("j")).toMatchObject({ value: { a: 1 }, valueType: "json" });
  });

  it("returns an ENV_VAR-provided duration as its text", async () => {
    process.env.QFG_177F_TIMEOUT = "PT2M";
    const q = await inlineClient([
      config("d.env", "duration", {
        type: "provided",
        value: { source: "ENV_VAR", lookup: "QFG_177F_TIMEOUT" },
      } as Value),
    ]);
    const d = q.evaluateDetails("d.env");
    expect(d.value).toBe("PT2M");
    expect(d.valueType).toBe("duration");
    expect(d.reason).toBe("STATIC");
  });

  it("reports TARGETING_MATCH with the rule's variant", async () => {
    const q = await fixtureClient();
    const d = q.evaluateDetails("of.targeting", { user: { plan: "pro" } });
    expect(d.value).toBe(true);
    expect(d.valueType).toBe("bool");
    expect(d.reason).toBe("TARGETING_MATCH");
    expect(d.variant).toBe("targeting:0");
    expect(d.flagMetadata).toMatchObject({ ruleIndex: 0 });
    // Same variant/metadata as the typed getter.
    const typed = q.getBoolDetails("of.targeting", { user: { plan: "pro" } });
    expect(d.variant).toBe(typed.variant);
    expect(d.flagMetadata).toEqual(typed.flagMetadata);
  });

  it("reports SPLIT for a weighted rollout, matching the typed getter", async () => {
    const q = await fixtureClient();
    for (let i = 0; i < 20; i++) {
      const ctx = { user: { id: `user-${i}` } };
      const d = q.evaluateDetails("of.weighted", ctx);
      const typed = q.getStringDetails("of.weighted", ctx);
      expect(d.reason).toBe("SPLIT");
      expect(d.value).toBe(typed.value);
      expect(d.variant).toBe(typed.variant);
      expect(d.variant).toMatch(/^split:\d+$/);
      expect(d.flagMetadata).toEqual(typed.flagMetadata);
    }
  });

  it("a missing key: value undefined, same reason/errorCode as typed getters", async () => {
    const q = await inlineClient([]);
    const d = q.evaluateDetails("nope");
    const typed = q.getStringDetails("nope");
    expect(d.value).toBeUndefined();
    expect(d.valueType).toBeUndefined();
    expect(d.reason).toBe(typed.reason);
    expect(d.errorCode).toBe(typed.errorCode);
    expect(d.errorCode).toBe("FLAG_NOT_FOUND");
    expect(d.variant).toBe("default");
  });

  it("never throws: an unset ENV_VAR is reason ERROR", async () => {
    const q = await inlineClient([
      config("d.unset", "duration", {
        type: "provided",
        value: { source: "ENV_VAR", lookup: "QFG_177F_UNSET_VAR" },
      } as Value),
    ]);
    const d = q.evaluateDetails("d.unset");
    expect(d.value).toBeUndefined();
    expect(d.reason).toBe("ERROR");
    expect(d.errorCode).toBe("GENERAL");
  });

  it("is available on a bound client with merged contexts", async () => {
    const q = await fixtureClient();
    const bound = q.inContext({ user: { plan: "pro" } });
    const d = bound.evaluateDetails("of.targeting");
    expect(d.reason).toBe("TARGETING_MATCH");
    expect(d.value).toBe(true);
    expect(d.variant).toBe("targeting:0");
  });

  it("records an evaluation summary like the typed getters", async () => {
    const q = await inlineClient(
      [config("d.tel", "duration", { type: "duration", value: "PT90S" })],
      { collectEvaluationSummaries: true }
    );
    q.evaluateDetails("d.tel");
    const event = (q as any).evaluationSummaries.drain();
    const summaries = event.summaries.summaries;
    expect(summaries).toHaveLength(1);
    expect(summaries[0].key).toBe("d.tel");
    expect(summaries[0].counters[0].count).toBe(1);
  });
});
