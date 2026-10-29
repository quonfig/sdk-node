// PARSE_ERROR in the details API (qfg-wg1n). A value that does not parse as
// its declared type (a malformed ENV_VAR value, a malformed stored
// int/double/duration) is a data problem and is reported as PARSE_ERROR. A
// read of a config whose type differs from the one asked for stays
// TYPE_MISMATCH. Matches integration-test-data tests/openfeature Case 6.

import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src";
import type { ConfigResponse, EvaluationErrorCode, QuonfigOptions, Value } from "../src/types";

const ENV_VARS = ["QFG_WG1N_INT", "QFG_WG1N_DOUBLE", "QFG_WG1N_DURATION"];

const clients: Quonfig[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()!.close();
  for (const name of ENV_VARS) delete process.env[name];
});

function config(key: string, valueType: string, value: Value): ConfigResponse {
  return {
    id: `id-${key}`,
    key,
    type: "config",
    valueType,
    sendToClientSdk: false,
    default: { rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value }] },
  } as ConfigResponse;
}

function envVar(lookup: string): Value {
  return { type: "provided", value: { source: "ENV_VAR", lookup } } as Value;
}

async function client(configs: ConfigResponse[]): Promise<Quonfig> {
  const q = new Quonfig({
    sdkKey: "test-unused",
    enableSSE: false,
    enablePolling: false,
    enableQuonfigUserContext: false,
    contextUploadMode: "none",
    collectEvaluationSummaries: false,
    onNoDefault: "ignore",
    logger: { warn: () => {}, error: () => {} },
    environment: "Production",
    datafile: { meta: { version: "test", environment: "Production" }, configs },
  } as QuonfigOptions);
  await q.init();
  clients.push(q);
  return q;
}

async function fixtures(): Promise<Quonfig> {
  process.env.QFG_WG1N_INT = "12abc";
  process.env.QFG_WG1N_DOUBLE = "not-a-number";
  process.env.QFG_WG1N_DURATION = "30s";
  return client([
    config("stored.int", "int", { type: "int", value: "twelve" } as Value),
    config("stored.double", "double", { type: "double", value: "1.2.3" } as Value),
    config("stored.duration", "duration", { type: "duration", value: "30s" }),
    config("env.int", "int", envVar("QFG_WG1N_INT")),
    config("env.double", "double", envVar("QFG_WG1N_DOUBLE")),
    config("env.duration", "duration", envVar("QFG_WG1N_DURATION")),
    config("bool.flag", "bool", { type: "bool", value: true }),
    config("plain.string", "string", { type: "string", value: "hi" }),
  ]);
}

function expectError(
  details: { value: unknown; reason: string; errorCode?: string; errorMessage?: string },
  code: EvaluationErrorCode
): void {
  expect(details.value).toBeUndefined();
  expect(details.reason).toBe("ERROR");
  expect(details.errorCode).toBe(code);
  expect(details.errorMessage).toBeTruthy();
}

describe("details API: PARSE_ERROR for a malformed value", () => {
  it("getNumberDetails on a malformed stored int is PARSE_ERROR", async () => {
    const q = await fixtures();
    expectError(q.getNumberDetails("stored.int"), "PARSE_ERROR");
  });

  it("getNumberDetails on a malformed stored double is PARSE_ERROR", async () => {
    const q = await fixtures();
    expectError(q.getNumberDetails("stored.double"), "PARSE_ERROR");
  });

  it("getNumberDetails on a malformed ENV_VAR int is PARSE_ERROR", async () => {
    const q = await fixtures();
    expectError(q.getNumberDetails("env.int"), "PARSE_ERROR");
  });

  it("getNumberDetails on a malformed ENV_VAR double is PARSE_ERROR", async () => {
    const q = await fixtures();
    expectError(q.getNumberDetails("env.double"), "PARSE_ERROR");
  });

  it("a bound client reports the same PARSE_ERROR", async () => {
    const q = await fixtures();
    expectError(q.inContext({ user: { key: "u1" } }).getNumberDetails("env.int"), "PARSE_ERROR");
  });

  it("the error message never carries the raw value", async () => {
    const q = await fixtures();
    expect(q.getNumberDetails("env.int").errorMessage).not.toContain("12abc");
    expect(q.getNumberDetails("stored.int").errorMessage).not.toContain("twelve");
  });

  describe("evaluateDetails (untyped)", () => {
    it("a malformed ENV_VAR int is PARSE_ERROR", async () => {
      const q = await fixtures();
      expectError(q.evaluateDetails("env.int"), "PARSE_ERROR");
    });

    it("a malformed ENV_VAR double is PARSE_ERROR", async () => {
      const q = await fixtures();
      expectError(q.evaluateDetails("env.double"), "PARSE_ERROR");
    });

    it("a malformed ENV_VAR duration is PARSE_ERROR", async () => {
      const q = await fixtures();
      expectError(q.evaluateDetails("env.duration"), "PARSE_ERROR");
    });

    it("a malformed stored value is still returned as stored (no parse validation)", async () => {
      const q = await fixtures();
      expect(q.evaluateDetails("stored.int")).toMatchObject({ value: "twelve", reason: "STATIC" });
      expect(q.evaluateDetails("stored.double")).toMatchObject({
        value: "1.2.3",
        reason: "STATIC",
      });
      expect(q.evaluateDetails("stored.duration")).toMatchObject({
        value: "30s",
        reason: "STATIC",
      });
      expect(q.evaluateDetails("stored.int").errorCode).toBeUndefined();
    });
  });
});

describe("details API: a real type mismatch stays TYPE_MISMATCH", () => {
  it("reading a config as another type is TYPE_MISMATCH, not PARSE_ERROR", async () => {
    const q = await fixtures();
    expectError(q.getNumberDetails("bool.flag"), "TYPE_MISMATCH");
    expectError(q.getBoolDetails("plain.string"), "TYPE_MISMATCH");
    expectError(q.getStringDetails("stored.duration"), "TYPE_MISMATCH");
    // Even a malformed value is a TYPE_MISMATCH when read as the wrong type:
    // the type check comes first.
    expectError(q.getBoolDetails("env.int"), "TYPE_MISMATCH");
    expectError(q.getStringListDetails("stored.int"), "TYPE_MISMATCH");
  });
});
