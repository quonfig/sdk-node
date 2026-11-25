// qf1 behaviour that needs a seam into node:crypto (bead qfg-8seuf.8):
// - the decrypted-value cache: a repeat read does no X25519, and an env
//   change or an in-place change of the stored ciphertext is never served
//   stale;
// - which library failures map to which qf1 class, and that an unexpected
//   library error still fails the read as a qf1 error without its text.
// Keys come from the integration-test-data vectors at run time.

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  dhCalls: 0,
  dh: undefined as undefined | ((options: any, real: (o: any) => Buffer) => Buffer),
  decipher: undefined as undefined | ((real: (...a: any[]) => any, ...args: any[]) => any),
  privateKey: undefined as undefined | ((real: (...a: any[]) => any, ...args: any[]) => any),
  fips: undefined as undefined | number,
}));

vi.mock("crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("crypto")>();
  const diffieHellman = (options: any) => {
    hooks.dhCalls++;
    return hooks.dh ? hooks.dh(options, real.diffieHellman) : real.diffieHellman(options);
  };
  const createDecipheriv = (...args: any[]) =>
    hooks.decipher
      ? hooks.decipher(real.createDecipheriv, ...args)
      : (real.createDecipheriv as any)(...args);
  const createPrivateKey = (...args: any[]) =>
    hooks.privateKey
      ? hooks.privateKey(real.createPrivateKey, ...args)
      : (real.createPrivateKey as any)(...args);
  const getFips = () => (hooks.fips !== undefined ? hooks.fips : real.getFips());
  const patched = { diffieHellman, createDecipheriv, createPrivateKey, getFips };
  return { ...real, default: { ...real, ...patched }, ...patched };
});

import { Quonfig } from "../src/quonfig";
import { Qf1Error, decryptQf1 } from "../src/qf1";
import type { ConfigResponse } from "../src/types";

const VECTORS_PATH = resolve(
  __dirname,
  "../../integration-test-data/tests/secrets/qf1-vectors.json"
);
if (!existsSync(VECTORS_PATH)) {
  throw new Error(`[qf1 crypto seams] ${VECTORS_PATH} not found.`);
}
const V = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));
const positive = (name: string) => V.positive.find((p: any) => p.name === name);
const negative = (name: string) => V.negative.find((n: any) => n.name === name);
const SHORT = positive("short-ascii"); // QUONFIG_KEYSET_TEST
const WRITE = positive("two-key-keyset-write-key"); // QUONFIG_KEYSET_TEST_PROD
const OLDER = positive("two-key-keyset-older-key"); // QUONFIG_KEYSET_TEST_PROD

const NAMES = ["QUONFIG_KEYSET", "QUONFIG_KEYSET_TEST", "QUONFIG_KEYSET_TEST_PROD"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of NAMES) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  hooks.dh = undefined;
  hooks.decipher = undefined;
  hooks.privateKey = undefined;
  hooks.fips = undefined;
});

afterEach(() => {
  for (const k of NAMES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  hooks.dh = undefined;
  hooks.decipher = undefined;
  hooks.privateKey = undefined;
  hooks.fips = undefined;
});

function secret(key: string, ciphertext: string): ConfigResponse {
  return {
    id: `id-${key}`,
    key,
    type: "secret",
    valueType: "string",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: { type: "string", value: ciphertext, confidential: true },
        },
      ],
    },
  } as ConfigResponse;
}

async function client(configs: ConfigResponse[]): Promise<Quonfig> {
  const q = new Quonfig({
    sdkKey: "test-unused",
    environment: "Production",
    enableSSE: false,
    enablePolling: false,
    enableQuonfigUserContext: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    datafile: { meta: { version: "seams", environment: "Production" }, configs },
  });
  await q.init();
  return q;
}

describe("decrypted-value cache", () => {
  it("a second read of the same secret does no X25519", async () => {
    process.env.QUONFIG_KEYSET_TEST = V.positiveEnv.QUONFIG_KEYSET_TEST;
    const q = await client([secret("s", SHORT.ciphertext)]);
    expect(q.getString("s")).toBe("hello");
    const afterFirst = hooks.dhCalls;
    expect(afterFirst).toBeGreaterThan(0); // the seam is live, so the zero below is real
    for (let i = 0; i < 50; i++) expect(q.getString("s")).toBe("hello");
    expect(hooks.dhCalls - afterFirst).toBe(0);
    await q.close();
  });

  it("an env flip, an empty value and a restore are each honoured", async () => {
    process.env.QUONFIG_KEYSET_TEST = V.positiveEnv.QUONFIG_KEYSET_TEST;
    const q = await client([secret("s", SHORT.ciphertext)]);
    expect(q.getString("s")).toBe("hello");

    // Flip to a key of another keyset: the cached plaintext must not be served.
    process.env.QUONFIG_KEYSET_TEST = V.positiveEnv.QUONFIG_KEYSET;
    expect(() => q.getString("s")).toThrow(/qf1 key_not_held/);

    process.env.QUONFIG_KEYSET_TEST = "";
    expect(() => q.getString("s")).toThrow(/qf1 keyset_missing/);

    delete process.env.QUONFIG_KEYSET_TEST;
    expect(() => q.getString("s")).toThrow(/qf1 keyset_missing/);

    process.env.QUONFIG_KEYSET_TEST = V.positiveEnv.QUONFIG_KEYSET_TEST;
    expect(q.getString("s")).toBe("hello");
    const restored = hooks.dhCalls;
    expect(q.getString("s")).toBe("hello");
    expect(hooks.dhCalls - restored).toBe(0);
    await q.close();
  });

  it("an in-place change of the stored ciphertext is never served stale", async () => {
    process.env.QUONFIG_KEYSET_TEST_PROD = V.positiveEnv.QUONFIG_KEYSET_TEST_PROD;
    const q = await client([secret("s", WRITE.ciphertext)]);
    expect(q.getString("s")).toBe(WRITE.plaintext);
    const stored = (q as any).store.get("s").default.rules[0].value;
    stored.value = OLDER.ciphertext;
    expect(q.getString("s")).toBe(OLDER.plaintext);
    await q.close();
  });
});

describe("library failure mapping", () => {
  const lookup = (env: Record<string, string>) => (name: string) => env[name];

  function failure(fn: () => unknown): Qf1Error {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(Qf1Error);
      return err as Qf1Error;
    }
    throw new Error("expected a failure");
  }

  it("OpenSSL's all-zero refusal is invalid_ephemeral_key", () => {
    const n = negative("ephemeral-low-order-order-8-a");
    const err = failure(() => decryptQf1(n.ciphertext, lookup(n.env)));
    expect(err.code).toBe("invalid_ephemeral_key");
  });

  it("any other X25519 error is decrypt_failed without the library's text", () => {
    hooks.dh = () => {
      const e = new Error("SENTINEL-dh-text-91x") as Error & { code: string };
      e.code = "ERR_SOMETHING_ELSE";
      throw e;
    };
    const err = failure(() => decryptQf1(SHORT.ciphertext, lookup(V.positiveEnv)));
    expect(err.code).toBe("decrypt_failed");
    expect(err.message).toMatch(
      /^qf1 decrypt_failed: this runtime's crypto library refused X25519/
    );
    expect(err.message).toContain("ERR_SOMETHING_ELSE");
    expect(err.message).not.toMatch(/entry|private key/);
    expect(err.message).not.toContain("SENTINEL");
  });

  it("an all-zero result returned (not thrown) by the library is invalid_ephemeral_key", () => {
    let calls = 0;
    hooks.dh = (o, real) => (++calls === 2 ? Buffer.alloc(32) : real(o)); // 1: keyset parse, 2: decrypt
    const err = failure(() => decryptQf1(SHORT.ciphertext, lookup(V.positiveEnv)));
    expect(err.code).toBe("invalid_ephemeral_key");
  });

  it("a GCM authentication failure is decrypt_failed 'authentication failed'", () => {
    const n = negative("tampered-tag-byte");
    const err = failure(() => decryptQf1(n.ciphertext, lookup(n.env)));
    expect(err.code).toBe("decrypt_failed");
    expect(err.message).toContain("authentication failed");
  });

  it("any other AES error is decrypt_failed 'unexpected' without the library's text", () => {
    hooks.decipher = () => {
      throw new TypeError("SENTINEL-aes-text-44q");
    };
    const err = failure(() => decryptQf1(SHORT.ciphertext, lookup(V.positiveEnv)));
    expect(err.code).toBe("decrypt_failed");
    expect(err.message).toMatch(/unexpected error from the crypto library \(TypeError\)/);
    expect(err.message).not.toContain("SENTINEL");
  });
});

describe("a runtime that refuses X25519 (FIPS)", () => {
  function fipsRefusal(): never {
    const e = new Error("SENTINEL-fips-text") as Error & { code: string };
    e.code = "ERR_OSSL_EVP_UNSUPPORTED";
    throw e;
  }

  it("fails each secret read with a message naming the restriction, not a bad key entry", async () => {
    process.env.QUONFIG_KEYSET_TEST = V.positiveEnv.QUONFIG_KEYSET_TEST;
    hooks.fips = 1;
    hooks.privateKey = (real, ...args) => {
      const k = args[0];
      if (k && typeof k === "object" && Buffer.isBuffer(k.key) && k.format === "der") fipsRefusal();
      return real(...args);
    };
    const plain = {
      id: "p",
      key: "plain",
      type: "config",
      valueType: "string",
      sendToClientSdk: false,
      default: {
        rules: [
          { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value: "ok" } },
        ],
      },
    } as ConfigResponse;
    const q = await client([plain, secret("fips.s", SHORT.ciphertext)]);
    expect(q.getString("plain")).toBe("ok");
    let err: any;
    try {
      q.getString("fips.s");
    } catch (e) {
      err = e;
    }
    expect(err?.name).toBe("QuonfigDecryptionError");
    expect(err.code).toBe("decrypt_failed");
    expect(err.message).toMatch(/refused X25519 \(ERR_OSSL_EVP_UNSUPPORTED\)/);
    expect(err.message).toContain("FIPS mode is on");
    expect(err.message).not.toMatch(/entry|not a qf1 private key|keyset_invalid/);
    expect(err.message).not.toContain("SENTINEL");
    expect(q.getString("fips.s", undefined, "D")).toBe("D");
    // Not cached as a bad keyset: once the runtime allows X25519 the value reads.
    hooks.privateKey = undefined;
    hooks.fips = undefined;
    expect(q.getString("fips.s")).toBe("hello");
    await q.close();
  });
});
