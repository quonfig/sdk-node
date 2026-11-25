// Secrets in the qf1 format through the public client (bead qfg-8seuf.8,
// spec project/plans/secrets-qf1-spec.md sections 9, 13.3, 13.5, 13.7).
// Keys come from the integration-test-data vectors at run time; no test key
// is committed here. Every test runs with every QUONFIG_KEYSET* variable of
// the machine removed and restores them afterwards.

import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { inspect } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as sdk from "../src";
import { Quonfig } from "../src/quonfig";
import { ConfigStore } from "../src/store";
import { Evaluator } from "../src/evaluator";
import { Resolver } from "../src/resolver";
import type { ConfigResponse, QuonfigOptions, Value } from "../src/types";
import { spyOnSendTelemetry } from "./helpers/telemetrySpy";

const VECTORS_PATH = resolve(
  __dirname,
  "../../integration-test-data/tests/secrets/qf1-vectors.json"
);
if (!existsSync(VECTORS_PATH)) {
  throw new Error(
    `[qf1 secrets] ${VECTORS_PATH} not found. Clone integration-test-data as a sibling to sdk-node.`
  );
}
const V = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));
const positive = (name: string) => V.positive.find((p: any) => p.name === name);
const SHORT = positive("short-ascii"); // QUONFIG_KEYSET_TEST, "hello"
const BARE = positive("bare-default-keyset"); // QUONFIG_KEYSET

// ---- env hygiene -----------------------------------------------------------

let saved: Record<string, string | undefined> = {};

function keysetVarNames(): string[] {
  return Object.keys(process.env).filter((k) => k.startsWith("QUONFIG_KEYSET"));
}

/** Every env name any vector sets (HOME, a lowercase name, one with a newline...). */
const VECTOR_ENV_NAMES: string[] = [
  ...new Set<string>([
    ...Object.keys(V.positiveEnv),
    ...[...V.negative, ...V.decryptOnly].flatMap((c: any) => Object.keys(c.env ?? {})),
  ]),
];
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  VECTOR_ENV_NAMES.map((k) => [k, process.env[k]])
);

beforeEach(() => {
  saved = {};
  for (const k of new Set([...keysetVarNames(), ...VECTOR_ENV_NAMES])) saved[k] = process.env[k];
  for (const k of keysetVarNames()) delete process.env[k];
});

afterEach(() => {
  for (const k of keysetVarNames()) if (!(k in saved)) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

// ---- builders --------------------------------------------------------------

function doc(key: string, type: string, value: Value): ConfigResponse {
  return {
    id: `id-${key}`,
    key,
    type,
    valueType: "string",
    sendToClientSdk: false,
    default: { rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value }] },
  } as ConfigResponse;
}

function secret(key: string, ciphertext: string): ConfigResponse {
  return doc(key, "secret", { type: "string", value: ciphertext, confidential: true });
}

const PLAIN = doc("plain.greeting", "config", { type: "string", value: "hi" });

async function wireClient(
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
    datafile: { meta: { version: "qf1-test", environment: "Production" }, configs },
    ...options,
  });
  await client.init();
  return client;
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to throw");
}

// ---- wire ------------------------------------------------------------------

describe("wire: type secret entries", () => {
  it("decrypts a secret entry on get and every string getter", async () => {
    setEnv(V.positiveEnv);
    const client = await wireClient([secret("s", SHORT.ciphertext), PLAIN]);
    expect(client.get("s")).toBe("hello");
    expect(client.getString("s")).toBe("hello");
    expect(client.getStringDetails("s").value).toBe("hello");
    expect(client.keys()).toContain("s");
    await client.close();
  });

  it("decrypts every positive vector through the client", async () => {
    setEnv(V.positiveEnv);
    const client = await wireClient(V.positive.map((p: any) => secret(p.name, p.ciphertext)));
    for (const p of V.positive) expect(client.getString(p.name)).toBe(p.plaintext);
    await client.close();
  });

  it("getRawMatch returns the stored ciphertext typed secret, never decrypting", async () => {
    setEnv(V.positiveEnv);
    const client = await wireClient([secret("s", SHORT.ciphertext)]);
    const raw = client.getRawMatch("s");
    expect(raw?.config.value).toBe(SHORT.ciphertext);
    expect(raw?.config.metadata.type).toBe("secret");
    expect(raw?.config.confidential).toBe(true);
    expect(raw?.config.dependencies).toBeUndefined();
    await client.close();
  });
});

// ---- failure scope (spec 9.3) ----------------------------------------------

describe("failure scope", () => {
  it("boots with no keyset env var and serves non-secret keys", async () => {
    expect(keysetVarNames()).toEqual([]);
    const client = await wireClient([PLAIN, secret("s", SHORT.ciphertext)]);
    expect(client.getString("plain.greeting")).toBe("hi");
    await client.close();
  });

  it("a missing keyset fails only that get, with qf1 keyset_missing", async () => {
    const client = await wireClient([PLAIN, secret("s", SHORT.ciphertext)]);
    const err = errorOf(() => client.getString("s"));
    expect(err.message).toMatch(/\bqf1 keyset_missing: /);
    expect(err.message).toContain("QUONFIG_KEYSET_TEST");
    expect(err.message).toContain('"s"');
    expect(client.getString("s", undefined, "D")).toBe("D");
    expect(client.get("s", undefined, "D")).toBe("D");
    expect(client.getStringDetails("s")).toMatchObject({
      value: undefined,
      reason: "ERROR",
      errorCode: "GENERAL",
    });
    expect(client.getString("plain.greeting")).toBe("hi");
    await client.close();
  });

  it("never returns the stored qf1 string when the value cannot be decrypted", async () => {
    const client = await wireClient([secret("s", SHORT.ciphertext)], { onNoDefault: "ignore" });
    expect(client.getString("s")).toBeUndefined();
    expect(client.get("s")).toBeUndefined();
    await client.close();
  });

  it("values on a held keyset still decrypt when another keyset is missing", async () => {
    setEnv({ QUONFIG_KEYSET: V.positiveEnv.QUONFIG_KEYSET });
    const client = await wireClient([
      secret("held", BARE.ciphertext),
      secret("s", SHORT.ciphertext),
    ]);
    expect(client.getString("held")).toBe(BARE.plaintext);
    expect(() => client.getString("s")).toThrow(/qf1 keyset_missing/);
    await client.close();
  });

  it("a broken keyset fails its own values only", async () => {
    setEnv({ QUONFIG_KEYSET: V.positiveEnv.QUONFIG_KEYSET, QUONFIG_KEYSET_TEST: "not-a-key" });
    const client = await wireClient([
      secret("held", BARE.ciphertext),
      secret("s", SHORT.ciphertext),
    ]);
    expect(client.getString("held")).toBe(BARE.plaintext);
    const err = errorOf(() => client.getString("s"));
    expect(err.message).toMatch(/\bqf1 keyset_invalid: /);
    expect(err.message).toContain("entry 1");
    await client.close();
  });

  it("key_not_held names the fingerprint needed and the fingerprints held", async () => {
    setEnv({ QUONFIG_KEYSET_TEST: V.positiveEnv.QUONFIG_KEYSET });
    const held = V.keysets.find((k: any) => k.name === "QUONFIG_KEYSET").keys[0].fingerprint;
    const client = await wireClient([secret("s", SHORT.ciphertext)]);
    const err = errorOf(() => client.getString("s"));
    expect(err.message).toMatch(/\bqf1 key_not_held: /);
    expect(err.message).toContain(SHORT.fingerprint);
    expect(err.message).toContain(held);
    await client.close();
  });

  it("logs a failing secret once per key, naming the key and not the value", async () => {
    const logger = makeLogger();
    const client = await wireClient([secret("s", SHORT.ciphertext)], { logger });
    client.getString("s", undefined, "D");
    client.getString("s", undefined, "D");
    const lines = logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"s"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("qf1 keyset_missing");
    expect(lines[0]).not.toContain(SHORT.ciphertext.split(":")[3]);
    await client.close();
  });

  it("a value in a secret doc that is not a qf1 string fails as malformed", async () => {
    const client = await wireClient([
      doc("p", "secret", { type: "string", value: "plain text", confidential: true }),
      doc("n", "secret", { type: "int", value: 3, confidential: true }),
    ]);
    expect(() => client.getString("p")).toThrow(/qf1 malformed/);
    expect(() => client.get("n")).toThrow(/qf1 malformed/);
    await client.close();
  });
});

// ---- decryptWith (spec 13.3 R1) --------------------------------------------

describe("decryptWith values are no longer read (R1)", () => {
  // A hex key config that WOULD decrypt the old-format value below.
  const oldKey = sdk.generateNewHexKey();
  const oldCiphertext = sdk.encrypt("legacy-plaintext-zq7", oldKey);
  const keyConfig = doc("old.key", "config", { type: "string", value: oldKey });

  for (const [label, confidential] of [
    ["confidential", true],
    ["non-confidential", false],
  ] as const) {
    it(`a ${label} value carrying decryptWith fails with an error naming decryptWith`, async () => {
      const client = await wireClient([
        keyConfig,
        doc("old.secret", "config", {
          type: "string",
          value: oldCiphertext,
          confidential,
          decryptWith: "old.key",
        }),
      ]);
      const err = errorOf(() => client.getString("old.secret"));
      expect(err.message).toMatch(/\bdecryptWith\b/);
      expect(err.message).not.toContain("legacy-plaintext-zq7");
      expect(client.getString("old.secret", undefined, "D")).toBe("D");
      await client.close();
    });
  }

  const NON_STRING_SHAPES: Array<[string, unknown]> = [
    ["a number", 7],
    ["an array", ["old.key"]],
    ["an object", { k: 1 }],
    ["true", true],
    ["a non-empty string", "old.key"],
  ];

  for (const [label, shape] of NON_STRING_SHAPES) {
    it(`decryptWith as ${label} fails over the wire without reading the key config`, async () => {
      const value = { type: "string", value: "stored", decryptWith: shape } as unknown as Value;
      const client = await wireClient([keyConfig, doc("dw", "config", value)]);
      const get = vi.spyOn((client as any).store, "get");
      const err = errorOf(() => client.getString("dw"));
      expect(err.message).toMatch(/\bdecryptWith\b/);
      expect(get.mock.calls.map((c) => c[0])).not.toContain("old.key");
      expect(client.getString("dw", undefined, "D")).toBe("D");
      await client.close();
    });
  }

  for (const [label, shape] of [
    ["undefined", undefined],
    ["null", null],
    ["the empty string", ""],
  ] as Array<[string, unknown]>) {
    it(`decryptWith as ${label} is no decryptWith at all`, async () => {
      const value = { type: "string", value: "plain", decryptWith: shape } as unknown as Value;
      const client = await wireClient([doc("dw", "config", value)]);
      expect(client.getString("dw")).toBe("plain");
      await client.close();
    });
  }

  it("the refusal has name QuonfigDecryptionError and code decrypt_with_not_supported", async () => {
    const client = await wireClient([
      doc("dw", "config", { type: "string", value: "x", decryptWith: "old.key" }),
    ]);
    const err = errorOf(() => client.getString("dw")) as Error & { code?: string };
    expect(err.name).toBe("QuonfigDecryptionError");
    expect(err.code).toBe("decrypt_with_not_supported");
    expect(Object.keys(err)).toEqual(["code"]);
    await client.close();
  });

  it("never looks up the decryptWith key config", async () => {
    const store = new ConfigStore();
    const value: Value = {
      type: "string",
      value: oldCiphertext,
      confidential: true,
      decryptWith: "old.key",
    };
    store.update({
      meta: { version: "t", environment: "" },
      configs: [keyConfig, doc("old.secret", "config", value)],
    });
    const get = vi.spyOn(store, "get");
    const resolver = new Resolver(store, new Evaluator(store));
    expect(() => resolver.resolveValue(value, "old.secret", "string", "", {})).toThrow(
      /decryptWith/
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("a secret value carrying decryptWith also fails", async () => {
    const client = await wireClient([
      doc("s", "secret", {
        type: "string",
        value: SHORT.ciphertext,
        confidential: true,
        decryptWith: "old.key",
      }),
    ]);
    setEnv(V.positiveEnv);
    expect(() => client.getString("s")).toThrow(/decryptWith/);
    await client.close();
  });
});

// ---- datadir (spec 13.7) ---------------------------------------------------

describe("datadir: secrets/ is loaded last", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdk-node-qf1-"));
    writeFileSync(
      join(dir, "quonfig.json"),
      JSON.stringify({ environments: ["Production"], workspace: "t" })
    );
    for (const sub of ["configs", "secrets", "feature-flags"]) mkdirSync(join(dir, sub));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function write(sub: string, d: ConfigResponse): void {
    writeFileSync(join(dir, sub, `${d.key}.json`), JSON.stringify(d));
  }

  async function datadirClient(): Promise<Quonfig> {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: dir,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      enableQuonfigUserContext: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    return client;
  }

  it("a secret shadows a configs/ copy of the same key", async () => {
    setEnv(V.positiveEnv);
    write(
      "configs",
      doc("dup", "config", {
        type: "string",
        value: "AA--00--BB",
        confidential: true,
        decryptWith: "k",
      })
    );
    write("secrets", secret("dup", SHORT.ciphertext));
    const client = await datadirClient();
    expect(client.getString("dup")).toBe("hello");
    await client.close();
  });

  it("the directory, not the document, makes a value a secret", async () => {
    setEnv(V.positiveEnv);
    // A doc in secrets/ that claims to be a config is still a secret.
    write("secrets", { ...secret("claims.config", SHORT.ciphertext), type: "config" } as any);
    // A qf1-looking string in configs/ is not decrypted.
    write(
      "configs",
      doc("plain.qf1", "config", { type: "string", value: SHORT.ciphertext, confidential: true })
    );
    const client = await datadirClient();
    expect(client.getString("claims.config")).toBe("hello");
    expect(client.getString("plain.qf1")).toBe(SHORT.ciphertext);
    await client.close();
  });

  for (const shape of [7, ["k"], { k: 1 }, true, "k"] as unknown[]) {
    it(`a configs/ value with decryptWith ${JSON.stringify(shape)} fails`, async () => {
      write("configs", doc("k", "config", { type: "string", value: "the-key" }));
      write(
        "configs",
        doc("dw", "config", {
          type: "string",
          value: "stored",
          decryptWith: shape,
        } as unknown as Value)
      );
      const client = await datadirClient();
      expect(() => client.getString("dw")).toThrow(/\bdecryptWith\b/);
      expect(client.getString("dw", undefined, "D")).toBe("D");
      await client.close();
    });
  }

  it("boots with no keyset and serves configs/ while a secret get fails", async () => {
    write("configs", PLAIN);
    write("secrets", secret("s", SHORT.ciphertext));
    const client = await datadirClient();
    expect(client.getString("plain.greeting")).toBe("hi");
    expect(() => client.getString("s")).toThrow(/qf1 keyset_missing/);
    await client.close();
  });
});

// ---- telemetry (spec 13.5) -------------------------------------------------

describe("telemetry redaction", () => {
  function md5Redaction(s: string): string {
    return `*****${createHash("md5").update(s).digest("hex").slice(0, 5)}`;
  }

  it("reports a hash over the stored ciphertext, never the plaintext", () => {
    setEnv(V.positiveEnv);
    const store = new ConfigStore();
    const cfg = secret("s", SHORT.ciphertext);
    store.update({ meta: { version: "t", environment: "" }, configs: [cfg] });
    const resolver = new Resolver(store, new Evaluator(store));
    const val = cfg.default.rules[0]!.value;
    const { resolved, reportableValue } = resolver.resolveValue(
      val,
      "s",
      "string",
      "",
      {},
      "secret"
    );
    expect(resolved.value).toBe("hello");
    expect(reportableValue).toBe(md5Redaction(SHORT.ciphertext));
    expect(reportableValue).not.toBe(md5Redaction("hello"));
  });

  it("redacts a secret even when the stored value lacks confidential: true", () => {
    setEnv(V.positiveEnv);
    const store = new ConfigStore();
    const val: Value = { type: "string", value: SHORT.ciphertext };
    const resolver = new Resolver(store, new Evaluator(store));
    const { resolved, reportableValue } = resolver.resolveValue(
      val,
      "s",
      "string",
      "",
      {},
      "secret"
    );
    expect(resolved.value).toBe("hello");
    expect(reportableValue).toBe(md5Redaction(SHORT.ciphertext));
  });

  it("the evaluation is reported with type secret", async () => {
    setEnv(V.positiveEnv);
    const { payloads } = spyOnSendTelemetry();
    const client = await wireClient([secret("s", SHORT.ciphertext)], {
      collectEvaluationSummaries: true,
    });
    const pushed: any[] = [];
    const collector = (client as any).evaluationSummaries;
    const orig = collector.push.bind(collector);
    collector.push = (e: any, ref: any) => {
      pushed.push(e);
      return orig(e, ref);
    };
    client.getString("s");
    expect(pushed).toHaveLength(1);
    expect(pushed[0].configType).toBe("secret");
    expect(pushed[0].reportableValue).toBe(md5Redaction(SHORT.ciphertext));
    await client.close();
    const summaries = payloads().flatMap((p: any) =>
      p.events.flatMap((e: any) => e.summaries?.summaries ?? [])
    );
    expect(summaries.map((x: any) => [x.key, x.type])).toEqual([["s", "secret"]]);
    expect(JSON.stringify(payloads())).not.toContain("hello");
    vi.restoreAllMocks();
  });
});

// ---- no leaks (spec 9.2) ---------------------------------------------------

describe("error text never carries key material, ciphertext payload or plaintext", () => {
  /** Every string that must never appear in any error surface. */
  function forbiddenFor(env: Record<string, string>, ciphertext: string): string[] {
    const out = new Set<string>();
    for (const value of Object.values(env)) {
      for (const piece of value.split(",")) {
        const t = piece.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
        if (t.length >= 16) out.add(t);
        const body = t.replace(/^qf1-priv-/, "");
        if (body.length >= 16) out.add(body.slice(0, 16));
      }
    }
    for (const k of V.keysets.flatMap((ks: any) => ks.keys)) {
      out.add(k.privateKeyHex);
      out.add(k.privateKeyEntry.slice("qf1-priv-".length, "qf1-priv-".length + 16));
    }
    const payload = ciphertext.split(":")[3];
    if (payload && payload.length >= 16) out.add(payload.slice(0, 16));
    for (const p of [...V.positive, ...V.decryptOnly]) {
      if (p.plaintext.length >= 8) out.add(p.plaintext);
      out.add(p.sharedSecretHex ?? "never");
    }
    out.delete("never");
    return [...out];
  }

  function surfaces(err: Error, warnLines: string[]): string {
    const own: Record<string, unknown> = {};
    for (const k of Object.keys(err)) own[k] = (err as any)[k];
    return [err.message, String(err.stack), JSON.stringify(own), inspect(err), ...warnLines].join(
      "\n"
    );
  }

  for (const n of V.negative) {
    it(`${n.name} (${n.expectedError})`, async () => {
      setEnv(n.env);
      const logger = makeLogger();
      const client = await wireClient([secret("leak.check", n.ciphertext)], { logger });
      const err = errorOf(() => client.getString("leak.check"));
      expect(err.message).toMatch(new RegExp(`\\bqf1 ${n.expectedError}: `));
      const text = surfaces(
        err,
        logger.warn.mock.calls.map((c) => String(c[0]))
      );
      for (const f of forbiddenFor(n.env, n.ciphertext)) expect(text).not.toContain(f);
      await client.close();
    });
  }
});

// ---- deprecated old-format exports ------------------------------------------

describe("deprecated old-format exports still work", () => {
  it("encrypt / decrypt / generateNewHexKey round-trip", () => {
    const key = sdk.generateNewHexKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(sdk.decrypt(sdk.encrypt("old format", key), key)).toBe("old format");
  });

  it("the encryption namespace still encrypts", () => {
    const key = sdk.encryption.generateNewHexKey();
    expect(sdk.decrypt(sdk.encryption.encrypt("ns", key), key)).toBe("ns");
  });
});

// Must stay last in this file: every env name a vector set is back as it was.
describe("env hygiene", () => {
  it("restores every env name the vectors set", () => {
    expect(VECTOR_ENV_NAMES).toContain("HOME");
    for (const k of VECTOR_ENV_NAMES)
      expect(process.env[k], JSON.stringify(k)).toBe(ORIGINAL_ENV[k]);
  });
});
