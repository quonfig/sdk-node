// qf1 reader rules the shared vectors do not pin (bead qfg-8seuf.8): version
// prefixes, parse order with several faults, what an error may echo, the
// keyset cache bound, and the error shape. Keys come from the
// integration-test-data vectors at run time; no private key literal here.

import { createCipheriv, randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { inspect } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import {
  KeysetCache,
  Qf1Error,
  aadFor,
  decryptQf1,
  deriveKeyAndNonce,
  fingerprint,
  parsePrivateKeyEntry,
  publicKeyFromPrivate,
  quoteName,
  x25519,
} from "../src/qf1";
import type { ConfigResponse } from "../src/types";

const VECTORS_PATH = resolve(
  __dirname,
  "../../integration-test-data/tests/secrets/qf1-vectors.json"
);
if (!existsSync(VECTORS_PATH)) {
  throw new Error(`[qf1 hardening] ${VECTORS_PATH} not found.`);
}
const V = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));
const SHORT = V.positive.find((p: any) => p.name === "short-ascii");
const TEST_ENTRY: string = V.positiveEnv.QUONFIG_KEYSET_TEST;
const PAYLOAD: string = SHORT.ciphertext.split(":")[3];

const NAMES = ["QUONFIG_KEYSET", "QUONFIG_KEYSET_TEST", "QUONFIG_KEYSET_TEST_PROD"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of NAMES) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of NAMES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function failure(fn: () => unknown): Error & Record<string, unknown> {
  try {
    fn();
  } catch (err) {
    return err as Error & Record<string, unknown>;
  }
  throw new Error("expected a failure");
}

const none = () => undefined;

/** Test-only qf1 seal of raw plaintext BYTES (spec 7 without the writer checks). */
function sealBytes(keyset: string, privateEntry: string, plaintext: Buffer): string {
  const pub = publicKeyFromPrivate(parsePrivateKeyEntry(privateEntry));
  const fp = fingerprint(pub);
  const ephemeralPrivate = randomBytes(32);
  const e = publicKeyFromPrivate(ephemeralPrivate);
  const { key, nonce } = deriveKeyAndNonce(x25519(ephemeralPrivate, pub), e, pub);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aadFor(keyset, fp));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return `qf1:${keyset}:${fp}:${Buffer.concat([e, body]).toString("base64url")}`;
}

describe("version prefix and parse order (spec 3.5)", () => {
  it.each(["qf0:", "qf01:", "qf00:"])("%s... is malformed, not unsupported_version", (prefix) => {
    const value = `${prefix}QUONFIG_KEYSET_TEST:b3f48931:${PAYLOAD}`;
    expect((failure(() => decryptQf1(value, none)) as any).code).toBe("malformed");
  });

  it("qf2: and qf10: are unsupported_version", () => {
    for (const prefix of ["qf2:", "qf10:"]) {
      const value = `${prefix}QUONFIG_KEYSET_TEST:b3f48931:${PAYLOAD}`;
      expect((failure(() => decryptQf1(value, none)) as any).code).toBe("unsupported_version");
    }
  });

  it("an invalid keyset name AND an invalid fingerprint report the keyset name (step 3 before 4)", () => {
    const value = `qf1:HOME:B3F4:${PAYLOAD}`;
    expect((failure(() => decryptQf1(value, none)) as any).code).toBe("invalid_keyset_name");
  });

  it("an invalid fingerprint AND an invalid payload report malformed for the fingerprint", () => {
    const err = failure(() => decryptQf1("qf1:QUONFIG_KEYSET_TEST:XYZ:!!", none));
    expect(err.code).toBe("malformed");
    expect(err.message).toContain("fingerprint");
  });
});

describe("quoteName", () => {
  it("keeps a short printable name as is, in quotes", () => {
    expect(quoteName("qf2")).toBe('"qf2"');
  });

  it("truncates to 64 characters and marks the cut", () => {
    const q = quoteName("Q".repeat(500));
    expect(q).toBe(`"${"Q".repeat(64)}"...`);
  });

  it("escapes control characters, non-ASCII, quotes and backslashes", () => {
    expect(quoteName('a\nb\u0000c"d\\e fé')).toBe('"a\\u{a}b\\u{0}c\\"d\\\\e\\u{2028}f\\u{e9}"');
  });
});

describe("what a keyset-name error may echo", () => {
  it("an invalid name is never quoted: a pasted private key does not reach the message or WARN", async () => {
    const value = `qf1:${TEST_ENTRY}:b3f48931:${PAYLOAD}`;
    const err = failure(() => decryptQf1(value, none));
    expect(err.code).toBe("invalid_keyset_name");
    expect(err.message).toBe(
      `qf1 invalid_keyset_name: the keyset name (${TEST_ENTRY.length} characters) does not match ^QUONFIG_KEYSET(_[A-Z0-9]+)*$`
    );
    const body = TEST_ENTRY.slice("qf1-priv-".length);
    for (let i = 0; i + 8 <= body.length; i += 8) {
      expect(err.message).not.toContain(body.slice(i, i + 8));
    }
  });

  it("an invalid name holding plaintext is not echoed either", () => {
    const err = failure(() => decryptQf1(`qf1:hunter2-is-my-password:b3f48931:${PAYLOAD}`, none));
    expect(err.message).not.toContain("hunter2");
  });

  it("a valid but huge keyset name is truncated to 64 characters wherever it is echoed", () => {
    const name = "QUONFIG_KEYSET_" + "A".repeat(400_000);
    const err = failure(() =>
      decryptQf1(`qf1:${name}:b3f48931:${PAYLOAD}`, (n) => (n === name ? undefined : undefined))
    );
    expect(err.code).toBe("keyset_missing");
    expect(err.message.length).toBeLessThan(400);
    expect(String(err.keyset).length).toBeLessThanOrEqual(70);
    expect(JSON.stringify(Object.assign({}, err)).length).toBeLessThan(800);
  });
});

describe("KeysetCache bound", () => {
  it("holds at most 64 keysets, dropping the oldest", () => {
    const cache = new KeysetCache();
    for (let i = 0; i < 200; i++) {
      expect(() => cache.get(`QUONFIG_KEYSET_N${i}`, `bad-${i}`)).toThrow(/keyset_invalid/);
    }
    expect(cache.size).toBe(64);
    expect(cache.has("QUONFIG_KEYSET_N0")).toBe(false);
    expect(cache.has("QUONFIG_KEYSET_N199")).toBe(true);
  });

  it("never caches a name whose env var is unset", () => {
    const cache = new KeysetCache();
    for (let i = 0; i < 10; i++) {
      expect(() => cache.get(`QUONFIG_KEYSET_U${i}`, undefined)).toThrow(/keyset_missing/);
    }
    expect(cache.size).toBe(0);
  });

  it("a cached keyset still decrypts", () => {
    const cache = new KeysetCache();
    const lookup = (n: string) => V.positiveEnv[n];
    expect(decryptQf1(SHORT.ciphertext, lookup, { cache })).toBe("hello");
    expect(decryptQf1(SHORT.ciphertext, lookup, { cache })).toBe("hello");
    expect(cache.size).toBe(1);
  });
});

describe("error shape", () => {
  it("a qf1 failure has name QuonfigDecryptionError, code = the class, no undefined own fields", () => {
    const err = failure(() => decryptQf1(SHORT.ciphertext, none));
    expect(err.name).toBe("QuonfigDecryptionError");
    expect(err.code).toBe("keyset_missing");
    expect(err).toBeInstanceOf(Error);
    for (const [k, v] of Object.entries(err)) expect(v, k).not.toBeUndefined();
    expect(Object.keys(err).sort()).toEqual(["code", "fingerprint", "keyset"]);
  });

  it("forConfig keeps the shape", () => {
    const err = failure(() => decryptQf1("nope", none, { configKey: "k" }));
    expect(err.name).toBe("QuonfigDecryptionError");
    expect(err.code).toBe("malformed");
    expect(Object.keys(err)).toEqual(["code"]);
  });

  it("the Qf1Error class carries the same name", () => {
    expect(new Qf1Error("malformed", "x").name).toBe("QuonfigDecryptionError");
  });
});

describe("non-UTF-8 plaintext is never echoed", () => {
  it("a sentinel sealed before invalid bytes stays out of message, stack, inspect and logs", async () => {
    const sentinel = "SENTINEL-plaintext-7Hq2";
    const value = sealBytes(
      "QUONFIG_KEYSET_TEST",
      TEST_ENTRY,
      Buffer.concat([Buffer.from(sentinel, "utf8"), Buffer.from([0xff, 0xfe, 0xc0, 0x80])])
    );
    process.env.QUONFIG_KEYSET_TEST = TEST_ENTRY;
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const cfg = {
      id: "u",
      key: "utf8.check",
      type: "secret",
      valueType: "string",
      sendToClientSdk: false,
      default: {
        rules: [
          {
            criteria: [{ operator: "ALWAYS_TRUE" }],
            value: { type: "string", value, confidential: true },
          },
        ],
      },
    } as ConfigResponse;
    const q = new Quonfig({
      sdkKey: "test-unused",
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      enableQuonfigUserContext: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      logger,
      datafile: { meta: { version: "u", environment: "Production" }, configs: [cfg] },
    });
    await q.init();
    const err = failure(() => q.getString("utf8.check"));
    expect(err.message).toMatch(/^qf1 decrypt_failed: the decrypted value is not valid UTF-8/);
    const all = [
      err.message,
      String(err.stack),
      inspect(err),
      JSON.stringify(Object.assign({}, err)),
      ...logger.warn.mock.calls.map((c) => String(c[0])),
      ...logger.error.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(all).not.toContain("SENTINEL");
    expect(all).not.toContain("7Hq2");
    await q.close();
  });
});
