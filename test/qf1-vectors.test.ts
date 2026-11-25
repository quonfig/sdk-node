// qf1 known-answer vectors (bead qfg-8seuf.8, spec project/plans/secrets-qf1-spec.md
// section 14). Every case in integration-test-data/tests/secrets/qf1-vectors.json
// that concerns a READER runs through src/qf1.ts: positive and decryptOnly
// values decrypt; every negative fails with its exact class (spec 3.5 / 8
// reader order); private-entry and env-value key-entry cases parse or fail as
// stated. The vectors are read from the sibling integration-test-data checkout
// (the path CI checks out), so no test key is committed to this repo.
//
// Not run here, because sdk-node has no such code: writerCases[] (the SDK
// never encrypts qf1) and publicKeyEntry key-entry cases (a reader derives
// public keys from private ones and never parses a public entry).

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import {
  Qf1Error,
  aadFor,
  decryptQf1,
  deriveKeyAndNonce,
  fingerprint,
  hkdfExpand,
  hkdfExtract,
  parseKeysetEnv,
  parsePrivateKeyEntry,
  parseQf1,
  publicKeyFromPrivate,
  x25519,
} from "../src/qf1";

const VECTORS_PATH = resolve(
  __dirname,
  "../../integration-test-data/tests/secrets/qf1-vectors.json"
);
if (!existsSync(VECTORS_PATH)) {
  throw new Error(
    `[qf1 vectors] ${VECTORS_PATH} not found. Clone integration-test-data as a sibling to sdk-node.`
  );
}

interface Env {
  [name: string]: string;
}
const V = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const unhex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));

/** An env lookup over exactly `env`, recording every name it is asked for. */
function lookupOver(env: Env): { lookup: (name: string) => string | undefined; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    lookup: (name: string) => {
      asked.push(name);
      return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;
    },
  };
}

function classOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof Qf1Error) return err.code;
    throw err;
  }
  return "<no error>";
}

describe("qf1 vectors file", () => {
  it("is the qf1 format with the spec's constants", () => {
    expect(V.format).toBe("qf1");
    expect(V.constants.hkdfInfoAscii).toBe("quonfig.com/qf1/X25519");
    expect(V.constants.okmLength).toBe(44);
  });

  it("has the case counts this suite was written against", () => {
    // A new vector category or case lands here first, so nothing is skipped silently.
    expect(V.positive).toHaveLength(9);
    expect(V.decryptOnly).toHaveLength(1);
    expect(V.negative).toHaveLength(58);
    expect(V.keyEntryCases).toHaveLength(30);
  });
});

describe("RFC sanity checks", () => {
  it("X25519 matches RFC 7748 section 6.1", () => {
    const r = V.rfcChecks.rfc7748_6_1;
    expect(hex(publicKeyFromPrivate(unhex(r.alicePrivateHex)))).toBe(r.alicePublicHex);
    expect(hex(publicKeyFromPrivate(unhex(r.bobPrivateHex)))).toBe(r.bobPublicHex);
    expect(hex(x25519(unhex(r.alicePrivateHex), unhex(r.bobPublicHex)))).toBe(r.sharedSecretHex);
    expect(hex(x25519(unhex(r.bobPrivateHex), unhex(r.alicePublicHex)))).toBe(r.sharedSecretHex);
  });

  it("HKDF-SHA256 matches RFC 5869 A.1", () => {
    const r = V.rfcChecks.rfc5869_A_1;
    const prk = hkdfExtract(unhex(r.saltHex), unhex(r.ikmHex));
    expect(hex(prk)).toBe(r.prkHex);
    expect(hex(hkdfExpand(prk, unhex(r.infoHex), r.length))).toBe(r.okmHex);
  });
});

describe("keysets[]", () => {
  for (const ks of V.keysets) {
    it(`${ks.name}: every entry parses to its bytes, public key and fingerprint`, () => {
      for (const k of ks.keys) {
        const priv = parsePrivateKeyEntry(k.privateKeyEntry);
        expect(hex(priv)).toBe(k.privateKeyHex);
        const pub = publicKeyFromPrivate(priv);
        expect(hex(pub)).toBe(k.publicKeyHex);
        expect(fingerprint(pub)).toBe(k.fingerprint);
      }
    });

    it(`${ks.name}: its envValue yields exactly its fingerprints`, () => {
      const held = parseKeysetEnv(ks.name, ks.envValue);
      expect([...held.keys()].sort()).toEqual(ks.keys.map((k: any) => k.fingerprint).sort());
    });
  }
});

describe("positive[]", () => {
  for (const p of V.positive) {
    it(`${p.name}: every intermediate matches`, () => {
      const parsed = parseQf1(p.ciphertext);
      expect(parsed.keyset).toBe(p.keyset);
      expect(parsed.fingerprint).toBe(p.fingerprint);
      expect(hex(parsed.ephemeralPublicKey)).toBe(p.ephemeralPublicKeyHex);
      expect(hex(parsed.ciphertextAndTag)).toBe(p.ciphertextAndTagHex);
      expect(hex(parsed.aad)).toBe(p.aadHex);
      expect(Buffer.from(aadFor(p.keyset, p.fingerprint)).toString("latin1")).toBe(p.aadAscii);

      const priv = parsePrivateKeyEntry(p.recipientPrivateKeyEntry);
      const pub = publicKeyFromPrivate(priv);
      expect(hex(pub)).toBe(p.recipientPublicKeyHex);
      expect(fingerprint(pub)).toBe(p.fingerprint);

      const s = x25519(priv, parsed.ephemeralPublicKey);
      expect(hex(s)).toBe(p.sharedSecretHex);
      // The writer side of the same agreement, from the fixed ephemeral key.
      expect(hex(x25519(unhex(p.ephemeralPrivateKeyHex), pub))).toBe(p.sharedSecretHex);
      expect(hex(publicKeyFromPrivate(unhex(p.ephemeralPrivateKeyHex)))).toBe(
        p.ephemeralPublicKeyHex
      );

      const d = deriveKeyAndNonce(s, parsed.ephemeralPublicKey, pub);
      expect(hex(d.salt)).toBe(p.hkdfSaltHex);
      expect(hex(d.prk)).toBe(p.prkHex);
      expect(hex(d.okm)).toBe(p.okmHex);
      expect(hex(d.key)).toBe(p.aesKeyHex);
      expect(hex(d.nonce)).toBe(p.nonceHex);
      expect(p.hkdfInfoHex).toBe(V.constants.hkdfInfoHex);
    });

    it(`${p.name}: decrypts with positiveEnv, reading only its own keyset`, () => {
      const { lookup, asked } = lookupOver(V.positiveEnv);
      const plaintext = decryptQf1(p.ciphertext, lookup);
      expect(plaintext).toBe(p.plaintext);
      expect(Buffer.from(plaintext, "utf8").toString("hex")).toBe(p.plaintextHex);
      expect(asked).toEqual([p.keyset]);
    });
  }
});

describe("decryptOnly[]", () => {
  for (const d of V.decryptOnly) {
    it(`${d.name}: decrypts`, () => {
      const { lookup } = lookupOver(d.env);
      const plaintext = decryptQf1(d.ciphertext, lookup);
      expect(plaintext).toBe(d.plaintext);
      expect(Buffer.from(plaintext, "utf8").toString("hex")).toBe(d.plaintextHex);
    });
  }
});

describe("negative[]", () => {
  for (const n of V.negative) {
    const tag = n.mustReject ? " (mustReject)" : "";
    it(`${n.name}: ${n.expectedError}${tag}`, () => {
      const { lookup, asked } = lookupOver(n.env);
      expect(classOf(() => decryptQf1(n.ciphertext, lookup))).toBe(n.expectedError);
      // At most the one env var named by the header is ever read (spec 8 step 2),
      // and none at all for a parse failure (spec 2: never read an invalid name).
      expect(asked.length).toBeLessThanOrEqual(1);
      if (["malformed", "unsupported_version", "invalid_keyset_name"].includes(n.expectedError)) {
        expect(asked).toEqual([]);
      }
    });
  }

  it("covers every reader error class", () => {
    const classes = new Set(V.negative.map((n: any) => n.expectedError));
    expect([...classes].sort()).toEqual(
      [
        "decrypt_failed",
        "invalid_ephemeral_key",
        "invalid_keyset_name",
        "key_not_held",
        "keyset_invalid",
        "keyset_missing",
        "malformed",
        "unsupported_version",
      ].sort()
    );
  });
});

describe("keyEntryCases[] (reader kinds)", () => {
  const readerCases = V.keyEntryCases.filter((c: any) => c.kind !== "publicKeyEntry");

  it("has the reader cases this suite was written against", () => {
    expect(readerCases.filter((c: any) => c.kind === "privateKeyEntry")).toHaveLength(7);
    expect(readerCases.filter((c: any) => c.kind === "envValue")).toHaveLength(11);
  });

  for (const c of readerCases) {
    it(`${c.kind} ${c.name}`, () => {
      if (c.kind === "privateKeyEntry") {
        if (c.expectedError) {
          expect(classOf(() => parsePrivateKeyEntry(c.input))).toBe(c.expectedError);
        } else {
          expect(hex(parsePrivateKeyEntry(c.input))).toBe(c.expectedHex);
        }
        return;
      }
      // envValue: `input` null/undefined means the variable is unset.
      const raw = c.input === null ? undefined : c.input;
      if (c.expectedError) {
        expect(classOf(() => parseKeysetEnv(c.keyset, raw))).toBe(c.expectedError);
      } else {
        const held = parseKeysetEnv(c.keyset, raw);
        expect([...held.keys()].sort()).toEqual([...c.expectedFingerprints].sort());
      }
    });
  }
});
