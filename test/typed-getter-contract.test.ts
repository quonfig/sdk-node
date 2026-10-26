// Typed-getter contract (qfg-zvyy, sdk-node 2.0). The integration-test-data
// matrix (`getter.contract.*` in get / get_or_raise / enabled) pins the
// values; these cases cover what the corpus cannot see: once-per-key
// logging, isEnabled on a flag with no matching rule, BoundQuonfig defaults,
// the Details error codes, and the exported error class.

import { afterEach, describe, expect, it, vi } from "vitest";

import { BoundQuonfig, Quonfig, QuonfigTypeMismatchError } from "../src";
import type { ConfigResponse, QuonfigOptions, Value } from "../src/types";
import { DATA_DIR, ENVIRONMENT } from "./integration/setup";

const clients: Quonfig[] = [];

function warnedAbout(logger: ReturnType<typeof makeLogger>, key: string): string[] {
  return logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`"${key}"`));
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function fixtureClient(options: Partial<QuonfigOptions> = {}): Promise<Quonfig> {
  const client = new Quonfig({
    sdkKey: "test-unused",
    datadir: DATA_DIR,
    environment: ENVIRONMENT,
    enableSSE: false,
    enablePolling: false,
    enableQuonfigUserContext: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    ...options,
  });
  await client.init();
  clients.push(client);
  return client;
}

function config(key: string, valueType: string, value: Value, type = "config"): ConfigResponse {
  return {
    id: key,
    key,
    type,
    valueType,
    sendToClientSdk: false,
    default: { rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value }] },
  } as ConfigResponse;
}

/** A flag whose only rule targets one user: everyone else matches nothing. */
const NO_MATCH_FLAG: ConfigResponse = {
  id: "no-match-flag",
  key: "no-match-flag",
  type: "feature_flag",
  valueType: "bool",
  sendToClientSdk: false,
  default: {
    rules: [
      {
        criteria: [
          {
            propertyName: "user.key",
            operator: "PROP_IS_ONE_OF",
            valueToMatch: { type: "string_list", value: ["only-me"] },
          },
        ],
        value: { type: "bool", value: true },
      },
    ],
  },
} as ConfigResponse;

async function inlineClient(
  configs: ConfigResponse[],
  options: Partial<QuonfigOptions> = {}
): Promise<Quonfig> {
  const client = new Quonfig({
    sdkKey: "test-unused",
    environment: "Production",
    enableSSE: false,
    enablePolling: false,
    enableQuonfigUserContext: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    datafile: { meta: { version: "test", environment: "Production" }, configs },
    ...options,
  });
  await client.init();
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("no string coercion", () => {
  it('getBool on a stored string "false" is never true', async () => {
    const client = await fixtureClient({ onNoDefault: "ignore" });
    expect(client.getBool("getter.contract.string.false")).toBeUndefined();
    expect(client.getBool("getter.contract.string.false", undefined, true)).toBe(true);
    expect(client.getBool("getter.contract.string.false", undefined, false)).toBe(false);
  });

  it('getNumber on a stored string "abc" is never NaN', async () => {
    const client = await inlineClient([config("abc", "string", { type: "string", value: "abc" })], {
      onNoDefault: "ignore",
    });
    expect(client.getNumber("abc")).toBeUndefined();
    expect(client.getNumber("abc", undefined, 5)).toBe(5);
    expect(client.getInt("abc", undefined, 5)).toBe(5);
  });

  it('getNumber on a stored string "3" is a type mismatch', async () => {
    const client = await fixtureClient();
    expect(client.getNumber("getter.contract.string.number", undefined, 7)).toBe(7);
    expect(() => client.getNumber("getter.contract.string.number")).toThrow(
      QuonfigTypeMismatchError
    );
  });
});

describe("int <-> double", () => {
  it("getNumber reads ints and doubles as they are", async () => {
    const client = await fixtureClient();
    expect(client.getNumber("getter.contract.int")).toBe(30);
    expect(client.getNumber("getter.contract.double")).toBe(3.9);
    expect(client.getNumber("getter.contract.double.huge")).toBe(1e300);
  });

  it("getInt reads an int, and a whole double within +/-(2^53-1)", async () => {
    const client = await fixtureClient();
    expect(client.getInt("getter.contract.int")).toBe(30);
    expect(client.getInt("getter.contract.double.whole")).toBe(3);
  });

  it("getInt never truncates: 3.9, 1e300 and 2^53 are type mismatches", async () => {
    const client = await fixtureClient();
    for (const key of [
      "getter.contract.double",
      "getter.contract.double.huge",
      "getter.contract.double.unsafe",
    ]) {
      expect(client.getInt(key, undefined, 7)).toBe(7);
      expect(() => client.getInt(key)).toThrow(/^Config ".*" has type double, expected int$/);
    }
  });

  it("getInt accepts -(2^53-1) and rejects -(2^53)", async () => {
    const client = await inlineClient([
      config("min-safe", "double", { type: "double", value: "-9007199254740991" }),
      config("min-unsafe", "double", { type: "double", value: "-9007199254740992" }),
    ]);
    expect(client.getInt("min-safe")).toBe(-9007199254740991);
    expect(client.getInt("min-unsafe", undefined, 1)).toBe(1);
  });

  it("a malformed stored int is no value, not NaN", async () => {
    const client = await fixtureClient({ onNoDefault: "ignore" });
    expect(client.getNumber("getter.contract.int.malformed")).toBeUndefined();
    expect(client.getInt("getter.contract.int.malformed", undefined, 7)).toBe(7);
    expect(client.get("getter.contract.int.malformed", undefined, 7)).toBe(7);
  });
});

describe("resolution errors with a default", () => {
  it("get(k, ctx, default) returns the default on a missing ENV_VAR or decryption failure", async () => {
    const client = await fixtureClient(); // onNoDefault: "error"
    expect(client.get("provided.by.missing.env.var", undefined, "D")).toBe("D");
    expect(client.get("a.broken.secret.config", undefined, "D")).toBe("D");
    expect(client.getString("a.broken.secret.config", undefined, "D")).toBe("D");
  });

  it("without a default, onNoDefault: 'error' rethrows the underlying error", async () => {
    const client = await fixtureClient();
    expect(() => client.get("provided.by.missing.env.var")).toThrow(
      /^Environment variable ".*" not set for config/
    );
    expect(() => client.getBool("getter.contract.string")).toThrow(QuonfigTypeMismatchError);
  });
});

describe("once-per-key logging", () => {
  it("logs one WARN per key that names the key, never the value", async () => {
    const logger = makeLogger();
    const client = await fixtureClient({ logger, onNoDefault: "ignore" });
    for (let i = 0; i < 3; i++) {
      client.getBool("getter.contract.string", undefined, false);
      client.getBool("getter.contract.string");
      client.getInt("getter.contract.double", undefined, 1);
    }
    const lines = logger.warn.mock.calls.map((c) => String(c[0]));
    const forString = lines.filter((l) => l.includes('"getter.contract.string"'));
    const forDouble = lines.filter((l) => l.includes('"getter.contract.double"'));
    expect(forString).toHaveLength(1);
    expect(forDouble).toHaveLength(1);
    expect(forString[0]).toContain("has type string, expected bool");
    for (const l of lines) expect(l).not.toContain("3.9");
  });

  it("logs a decryption failure once and never logs the secret", async () => {
    const logger = makeLogger();
    const client = await fixtureClient({ logger });
    client.getString("a.broken.secret.config", undefined, "D");
    client.getString("a.broken.secret.config", undefined, "D");
    client.isEnabled("a.broken.secret.config");
    const lines = logger.warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("a.broken.secret.config"));
    expect(lines).toHaveLength(1);
  });

  it("does not log a missing key read with a default", async () => {
    const logger = makeLogger();
    const client = await fixtureClient({ logger });
    expect(client.getString("my-missing-key", undefined, "D")).toBe("D");
    expect(warnedAbout(logger, "my-missing-key")).toHaveLength(0);
  });
});

describe("isEnabled never throws", () => {
  it("returns false for a present flag with no matching rule, under onNoDefault: 'error'", async () => {
    const logger = makeLogger();
    const client = await inlineClient([NO_MATCH_FLAG], { logger });
    expect(client.isEnabled("no-match-flag", { user: { key: "someone-else" } })).toBe(false);
    expect(client.isEnabled("no-match-flag", { user: { key: "someone-else" } })).toBe(false);
    expect(client.isEnabled("no-match-flag", { user: { key: "only-me" } })).toBe(true);
    expect(warnedAbout(logger, "no-match-flag")).toHaveLength(1);
  });

  it("returns false for an unset ENV_VAR, a decryption failure and a non-bool value", async () => {
    const client = await fixtureClient();
    expect(client.isEnabled("getter.contract.provided.bool.missing")).toBe(false);
    expect(client.isEnabled("a.broken.secret.config")).toBe(false);
    expect(client.isEnabled("getter.contract.string.true")).toBe(false);
    expect(client.isEnabled("getter.contract.int")).toBe(false);
  });
});

describe("BoundQuonfig forwards defaults", () => {
  it("returns the default on a type mismatch, the value otherwise", async () => {
    const client = await fixtureClient();
    const bound: BoundQuonfig = client.withContext({ user: { key: "u" } });
    expect(bound.getBool("getter.contract.string", undefined, true)).toBe(true);
    expect(bound.getString("getter.contract.int", undefined, "D")).toBe("D");
    expect(bound.getInt("getter.contract.double", undefined, 7)).toBe(7);
    expect(bound.getNumber("getter.contract.int", undefined, 7)).toBe(30);
    expect(bound.getStringList("getter.contract.string", undefined, ["d"])).toEqual(["d"]);
    expect(bound.getDuration("getter.contract.string.duration", undefined, 5)).toBe(5);
    expect(bound.getJSON("getter.contract.string_list", undefined, { d: 1 })).toEqual({ d: 1 });
    expect(() => bound.getBool("getter.contract.string")).toThrow(QuonfigTypeMismatchError);
  });
});

describe("Details getters", () => {
  it("report ERROR / TYPE_MISMATCH for a wrong-type value, with no value", async () => {
    const client = await fixtureClient();
    for (const details of [
      client.getBoolDetails("getter.contract.string.false"),
      client.getNumberDetails("getter.contract.string.number"),
      client.getStringDetails("getter.contract.int"),
      client.getJSONDetails("getter.contract.string_list"),
      client.getStringListDetails("getter.contract.json"),
      client.getNumberDetails("getter.contract.duration"),
      client.getNumberDetails("getter.contract.int.malformed"),
    ]) {
      expect(details.value).toBeUndefined();
      expect(details.reason).toBe("ERROR");
      expect(details.errorCode).toBe("TYPE_MISMATCH");
    }
  });

  it("report ERROR / GENERAL for an unset ENV_VAR or a decryption failure", async () => {
    const client = await fixtureClient();
    for (const details of [
      client.getStringDetails("provided.by.missing.env.var"),
      client.getStringDetails("a.broken.secret.config"),
    ]) {
      expect(details.value).toBeUndefined();
      expect(details.reason).toBe("ERROR");
      expect(details.errorCode).toBe("GENERAL");
    }
  });

  it("still read matching values", async () => {
    const client = await fixtureClient();
    expect(client.getBoolDetails("getter.contract.bool").value).toBe(true);
    expect(client.getNumberDetails("getter.contract.int").value).toBe(30);
    expect(client.getNumberDetails("getter.contract.double").value).toBe(3.9);
  });
});

describe("warning sets do not shadow each other", () => {
  it("an isEnabled call before init() does not hide a later read-failure warning", async () => {
    const logger = makeLogger();
    const client = new Quonfig({
      sdkKey: "test-unused",
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      enableQuonfigUserContext: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      logger,
      datafile: {
        meta: { version: "test", environment: "Production" },
        configs: [config("early", "string", { type: "string", value: "x" })],
      },
    });
    clients.push(client);
    expect(client.isEnabled("early")).toBe(false);
    await client.init();
    expect(client.getBool("early", undefined, false)).toBe(false);
    const lines = warnedAbout(logger, "early");
    expect(lines.some((l) => l.includes("has type string, expected bool"))).toBe(true);
  });
});

describe("untyped get() never coerces a malformed stored bool", () => {
  it("a bool config holding a non-boolean is a malformed value, not !!value", async () => {
    const logger = makeLogger();
    const client = await inlineClient(
      [config("bad-bool", "bool", { type: "bool", value: "false" as unknown as boolean })],
      { logger, onNoDefault: "ignore" }
    );
    expect(client.get("bad-bool")).toBeUndefined();
    expect(client.get("bad-bool", undefined, "D")).toBe("D");
    expect(client.getBool("bad-bool", undefined, false)).toBe(false);
    expect(client.isEnabled("bad-bool")).toBe(false);
    expect(warnedAbout(logger, "bad-bool")).toHaveLength(1);
  });
});
