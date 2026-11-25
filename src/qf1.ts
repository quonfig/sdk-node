/**
 * qf1 secrets: the READ side (decrypt, private key entries, keyset env vars).
 *
 * Normative spec: project/plans/secrets-qf1-spec.md (approved 2026-11-24).
 *
 *   qf1:<KEYSET>:<FINGERPRINT>:<base64url-no-pad(E || C || T)>
 *
 * X25519 (RFC 7748) + HKDF-SHA256 (RFC 5869, written out from HMAC) +
 * AES-256-GCM, with the header `qf1:<KEYSET>:<FINGERPRINT>:` as AAD. The
 * private key is found by (keyset name, fingerprint), never by trying keys.
 * `node:crypto` only. The SDK never encrypts qf1; writers live in the CLI.
 *
 * Error text (spec 9.2): every message is `qf1 <class>: ...` and names
 * keysets, fingerprints and entry positions only, never a key entry, any part
 * of an env var value, the payload, the plaintext or any derived secret.
 */

import {
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  getFips,
} from "crypto";

// ---- Constants (spec 5.1, 6.1) ----------------------------------------------

const HKDF_INFO = Buffer.from("quonfig.com/qf1/X25519", "ascii");
const OKM_LENGTH = 44;
const TAG_LENGTH = 16;
const MIN_PAYLOAD = 32 + TAG_LENGTH;
const PRIVATE_KEY_PREFIX = "qf1-priv-";
const ENTRY_BODY_CHARS = 43;

/** Spec 2, a full-string match (JS `$` without the m flag is end of input). */
export const KEYSET_NAME_RE = /^QUONFIG_KEYSET(?:_[A-Z0-9]+)*$/;
const FINGERPRINT_RE = /^[0-9a-f]{8}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const OTHER_VERSION_RE = /^qf[1-9][0-9]*:/;

// ---- Errors (spec 9) ---------------------------------------------------------

export type Qf1ErrorCode =
  | "malformed"
  | "unsupported_version"
  | "invalid_keyset_name"
  | "keyset_missing"
  | "keyset_invalid"
  | "key_not_held"
  | "invalid_ephemeral_key"
  | "decrypt_failed"
  | "invalid_key_entry";

/** Public facts an error may carry (spec 9.2): names, fingerprints, positions. */
export interface Qf1ErrorFields {
  keyset?: string;
  fingerprint?: string;
  held?: string[];
  entry?: number;
}

/** The `name` of every secret read failure (qf1 and the refused old format). */
export const DECRYPTION_ERROR_NAME = "QuonfigDecryptionError";

/**
 * sdk-node's unable-to-decrypt error. Detect it with
 * `err.name === "QuonfigDecryptionError"` and branch on `err.code`: a qf1
 * class (spec 9.1) or `"decrypt_with_not_supported"` for a value in the old
 * format. Own enumerable fields are `code` plus whichever of `keyset`,
 * `fingerprint`, `held`, `entry` apply; none is ever `undefined`.
 */
export class QuonfigDecryptionError extends Error {
  declare readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    Object.defineProperty(this, "name", {
      value: DECRYPTION_ERROR_NAME,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    (this as { code: string }).code = code;
  }
}

/** A qf1 reader failure: `qf1 <code>: <detail>`. */
export class Qf1Error extends QuonfigDecryptionError {
  declare readonly code: Qf1ErrorCode;
  declare readonly keyset?: string;
  declare readonly fingerprint?: string;
  declare readonly held?: string[];
  declare readonly entry?: number;
  /** The message after `qf1 <code>: ` (non-enumerable), so a failure can be rethrown with a config key. */
  declare readonly detail: string;

  constructor(code: Qf1ErrorCode, detail: string, fields: Qf1ErrorFields = {}) {
    super(code, `qf1 ${code}: ${detail}`);
    Object.defineProperty(this, "detail", { value: detail, enumerable: false });
    const self = this as Qf1ErrorFields;
    if (fields.keyset !== undefined) self.keyset = fields.keyset;
    if (fields.fingerprint !== undefined) self.fingerprint = fields.fingerprint;
    if (fields.held !== undefined) self.held = fields.held;
    if (fields.entry !== undefined) self.entry = fields.entry;
  }

  fields(): Qf1ErrorFields {
    return {
      keyset: this.keyset,
      fingerprint: this.fingerprint,
      held: this.held,
      entry: this.entry,
    };
  }

  /** The same failure with ` (config "<key>")` appended. */
  forConfig(configKey: string): Qf1Error {
    return new Qf1Error(this.code, `${this.detail} (config "${configKey}")`, this.fields());
  }
}

function fail(code: Qf1ErrorCode, detail: string, fields?: Qf1ErrorFields): never {
  throw new Qf1Error(code, detail, fields);
}

/**
 * Quote a short writer-controlled token for an error (spec 9.2): at most 64
 * characters, anything outside printable ASCII escaped.
 */
export function quoteName(name: string): string {
  const cut = name.length > 64 ? name.slice(0, 64) : name;
  let out = "";
  for (const ch of cut) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += `\\${ch}`;
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else out += `\\u{${c.toString(16)}}`;
  }
  return `"${out}"${name.length > 64 ? "..." : ""}`;
}

/**
 * A VALID keyset name as echoed in errors and error fields: at most 64
 * characters. (A valid name is plain ASCII, so nothing needs escaping. An
 * invalid name is never echoed: it may be a pasted key or plaintext.)
 */
function shown(keyset: string): string {
  return keyset.length > 64 ? `${keyset.slice(0, 64)}...` : keyset;
}

const KEYSET_NAME_PATTERN_TEXT = "^QUONFIG_KEYSET(_[A-Z0-9]+)*$";

/** A library error named by its code or class only, never its text. */
function errorTag(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  const name = (err as { name?: unknown })?.name;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name)
      ? name
      : "unknown";
}

/** A library failure we did not expect. */
function unexpected(err: unknown): Qf1Error {
  return new Qf1Error(
    "decrypt_failed",
    `unexpected error from the crypto library (${errorTag(err)})`
  );
}

// ---- base64url (spec 3.4) ----------------------------------------------------

/** Strict canonical unpadded base64url, or undefined. */
function decodeBase64Url(text: string): Buffer | undefined {
  if (text.length === 0 || text.length % 4 === 1 || !BASE64URL_RE.test(text)) return undefined;
  const bytes = Buffer.from(text, "base64url");
  // Canonical: the unused trailing bits are zero, so re-encoding gives the input.
  if (bytes.toString("base64url") !== text) return undefined;
  return bytes;
}

// ---- HKDF-SHA256 from HMAC (RFC 5869; spec 5.3) -----------------------------

function hmacSha256(key: Uint8Array, data: Uint8Array): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** RFC 5869 2.2: PRK = HMAC-SHA256(salt, IKM). */
export function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Buffer {
  return hmacSha256(salt, ikm);
}

/** RFC 5869 2.3: T(i) = HMAC(PRK, T(i-1) || info || i); OKM = first `length` bytes. */
export function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Buffer {
  const blocks: Buffer[] = [];
  let t: Buffer = Buffer.alloc(0);
  for (let i = 1, filled = 0; filled < length; i++) {
    t = hmacSha256(prk, Buffer.concat([t, info, Buffer.of(i)]));
    blocks.push(t);
    filled += t.length;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

export interface DerivedKey {
  salt: Buffer;
  prk: Buffer;
  okm: Buffer;
  key: Buffer;
  nonce: Buffer;
}

/** salt = E || pub_r (E as transmitted); K = OKM[0:32], N = OKM[32:44]. */
export function deriveKeyAndNonce(
  sharedSecret: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array
): DerivedKey {
  const salt = Buffer.concat([ephemeralPublicKey, recipientPublicKey]);
  const prk = hkdfExtract(salt, sharedSecret);
  const okm = hkdfExpand(prk, HKDF_INFO, OKM_LENGTH);
  return { salt, prk, okm, key: okm.subarray(0, 32), nonce: okm.subarray(32, 44) };
}

// ---- X25519 (RFC 7748; spec 5.2) --------------------------------------------

const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const BASE_POINT = Buffer.concat([Buffer.of(9), Buffer.alloc(31)]);

/**
 * X25519(scalar, u): OpenSSL clamps the scalar, masks the top bit of u and
 * reduces a non-canonical u. Its refusal of an all-zero result
 * (ERR_OSSL_FAILED_DURING_DERIVATION) is returned as 32 zero bytes, so the
 * caller's all-zero check covers both behaviours; any other error propagates.
 */
export function x25519(scalar: Uint8Array, u: Uint8Array): Buffer {
  try {
    const privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_X25519_PREFIX, scalar]),
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_X25519_PREFIX, u]),
      format: "der",
      type: "spki",
    });
    return diffieHellman({ privateKey, publicKey });
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ERR_OSSL_FAILED_DURING_DERIVATION") {
      return Buffer.alloc(32);
    }
    // Any other refusal is the runtime's, not the key's: a FIPS-restricted
    // OpenSSL, for example, has no X25519. Never report it as a bad entry.
    throw x25519Refused(err);
  }
}

function x25519Refused(err: unknown): Qf1Error {
  let fips = false;
  try {
    fips = getFips() === 1;
  } catch {
    // getFips itself unavailable: say nothing about FIPS.
  }
  return new Qf1Error(
    "decrypt_failed",
    `this runtime's crypto library refused X25519 (${errorTag(err)})${
      fips ? "; FIPS mode is on, and qf1 secrets need X25519" : ""
    }`
  );
}

export function publicKeyFromPrivate(privateKey: Uint8Array): Buffer {
  return x25519(privateKey, BASE_POINT);
}

function isAllZero(b: Uint8Array): boolean {
  for (const x of b) if (x !== 0) return false;
  return true;
}

// ---- Fingerprint and key entries (spec 4, 6.1) ------------------------------

/** lowercase-hex(SHA-256(pub)[0:4]) over the raw 32-byte public key. */
export function fingerprint(publicKey: Uint8Array): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 8);
}

/** `qf1-priv-` + exactly 43 canonical base64url characters (32 raw bytes, unclamped). */
export function parsePrivateKeyEntry(entry: string): Buffer {
  const body = entry.startsWith(PRIVATE_KEY_PREFIX)
    ? entry.slice(PRIVATE_KEY_PREFIX.length)
    : undefined;
  const bytes =
    body !== undefined && body.length === ENTRY_BODY_CHARS ? decodeBase64Url(body) : undefined;
  if (bytes === undefined || bytes.length !== 32) {
    return fail(
      "invalid_key_entry",
      `a private key entry is "${PRIVATE_KEY_PREFIX}" followed by ${ENTRY_BODY_CHARS} canonical base64url characters`
    );
  }
  return bytes;
}

// ---- The keyset env var (spec 6.2) ------------------------------------------

export interface HeldKey {
  privateKey: Buffer;
  publicKey: Buffer;
}

/** ONLY space, tab, CR and LF; never the platform trim (it also strips VT, FF, NBSP, U+2028...). */
const ENV_STRIP_RE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/**
 * Parse a keyset env var value (`undefined` = unset) into fingerprint -> key.
 * Entries with the same public key collapse; two different public keys with
 * one fingerprint make the whole keyset invalid.
 */
export function parseKeysetEnv(keyset: string, raw: string | undefined): Map<string, HeldKey> {
  const ks = shown(keyset);
  if (raw === undefined) {
    return fail("keyset_missing", `this runtime has no ${ks}`, { keyset });
  }
  const entries = raw
    .split(",")
    .map((piece) => piece.replace(ENV_STRIP_RE, ""))
    .filter((piece) => piece.length > 0);
  if (entries.length === 0) {
    return fail("keyset_missing", `${ks} is set but holds no keys`, { keyset });
  }

  const held = new Map<string, HeldKey>();
  entries.forEach((entry, index) => {
    let privateKey: Buffer;
    try {
      privateKey = parsePrivateKeyEntry(entry);
    } catch (err) {
      if (!(err instanceof Qf1Error)) throw err;
      return fail("keyset_invalid", `${ks} entry ${index + 1} is not a qf1 private key`, {
        keyset: ks,
        entry: index + 1,
      });
    }
    const publicKey = publicKeyFromPrivate(privateKey);
    const fp = fingerprint(publicKey);
    const existing = held.get(fp);
    if (existing !== undefined) {
      if (existing.publicKey.equals(publicKey)) return; // one key, written twice or clamp-equivalent
      return fail("keyset_invalid", `${ks} holds two different keys with fingerprint ${fp}`, {
        keyset: ks,
        fingerprint: fp,
      });
    }
    held.set(fp, { privateKey, publicKey });
  });
  return held;
}

/** At most this many keysets are kept; the oldest goes first. */
const KEYSET_CACHE_LIMIT = 64;

/**
 * Process-wide cache of parsed keysets (spec 6.2, decision 33), keyed by the
 * env var's name and current value: a keyset is parsed (one X25519 per key)
 * once per distinct value, and a changed value is re-parsed. A failure is
 * cached the same way and rethrown fresh. A name whose env var is unset is
 * never cached, and at most KEYSET_CACHE_LIMIT names are kept (keyset names
 * are writer-controlled, so the cache must not grow with them).
 */
export class KeysetCache {
  private entries = new Map<
    string,
    { raw: string; held?: Map<string, HeldKey>; error?: Qf1Error }
  >();

  get size(): number {
    return this.entries.size;
  }

  has(keyset: string): boolean {
    return this.entries.has(keyset);
  }

  get(keyset: string, raw: string | undefined): Map<string, HeldKey> {
    if (raw === undefined) {
      this.entries.delete(keyset);
      return parseKeysetEnv(keyset, raw); // throws keyset_missing
    }
    let entry = this.entries.get(keyset);
    if (entry === undefined || entry.raw !== raw) {
      try {
        entry = { raw, held: parseKeysetEnv(keyset, raw) };
      } catch (err) {
        // Cache only what the env value itself decides; a runtime refusal
        // (decrypt_failed) is retried on the next read.
        if (!(err instanceof Qf1Error) || err.code !== "keyset_invalid") throw err;
        entry = { raw, error: err };
      }
      this.entries.delete(keyset);
      this.entries.set(keyset, entry);
      while (this.entries.size > KEYSET_CACHE_LIMIT) {
        this.entries.delete(this.entries.keys().next().value!);
      }
    }
    if (entry.error !== undefined) {
      throw new Qf1Error(entry.error.code, entry.error.detail, entry.error.fields());
    }
    return entry.held!;
  }
}

// ---- The ciphertext string (spec 3) -----------------------------------------

export interface Qf1Parsed {
  keyset: string;
  fingerprint: string;
  ephemeralPublicKey: Buffer;
  ciphertextAndTag: Buffer;
  aad: Buffer;
}

/** AAD = ASCII `qf1:<KEYSET>:<FINGERPRINT>:` (spec 5.4). */
export function aadFor(keyset: string, fp: string): Buffer {
  return Buffer.from(`qf1:${keyset}:${fp}:`, "latin1");
}

/** Spec 3.5, in order; the first failing step decides the class. */
export function parseQf1(value: unknown): Qf1Parsed {
  if (typeof value !== "string") {
    return fail("malformed", "the stored value is not a string");
  }
  if (!value.startsWith("qf1:")) {
    const version = OTHER_VERSION_RE.exec(value);
    if (version !== null) {
      return fail(
        "unsupported_version",
        `the value uses format ${quoteName(version[0].slice(0, -1))}; this SDK reads qf1`
      );
    }
    return fail("malformed", 'the value does not start with "qf1:"');
  }

  const fields = value.split(":");
  if (fields.length !== 4) {
    return fail(
      "malformed",
      `a qf1 value has 4 colon-separated fields, this one has ${fields.length}`
    );
  }
  const [, keyset, fp, payloadText] = fields as [string, string, string, string];

  if (!KEYSET_NAME_RE.test(keyset)) {
    return fail(
      "invalid_keyset_name",
      // Never echo it: an invalid field may be a pasted key or plaintext.
      `the keyset name (${keyset.length} characters) does not match ${KEYSET_NAME_PATTERN_TEXT}`
    );
  }
  if (!FINGERPRINT_RE.test(fp)) {
    return fail(
      "malformed",
      `the fingerprint field is not 8 lowercase hex characters (keyset ${shown(keyset)})`
    );
  }
  const payload = decodeBase64Url(payloadText);
  if (payload === undefined) {
    return fail(
      "malformed",
      `the payload is not canonical unpadded base64url (keyset ${shown(keyset)} fingerprint ${fp})`
    );
  }
  if (payload.length < MIN_PAYLOAD) {
    return fail(
      "malformed",
      `the payload is ${payload.length} bytes, below the ${MIN_PAYLOAD}-byte minimum (keyset ${shown(keyset)} fingerprint ${fp})`
    );
  }
  const ephemeralPublicKey = payload.subarray(0, 32);
  if ((ephemeralPublicKey[31]! & 0x80) !== 0) {
    return fail(
      "malformed",
      `the ephemeral key has its top bit set (keyset ${shown(keyset)} fingerprint ${fp})`
    );
  }
  return {
    keyset,
    fingerprint: fp,
    ephemeralPublicKey,
    ciphertextAndTag: payload.subarray(32),
    aad: aadFor(keyset, fp),
  };
}

// ---- Decrypt (spec 8) ---------------------------------------------------------

const GCM_AUTH_FAILED = "Unsupported state or unable to authenticate data";
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface DecryptOptions {
  /** Appended to every error as ` (config "<key>")`. */
  configKey?: string;
  /** Reuse parsed keysets; without one each call parses its keyset afresh. */
  cache?: KeysetCache;
}

/**
 * Decrypt a stored qf1 value. `lookupEnv` is asked for exactly one name, the
 * keyset in the header, and only after that name passed spec 2.
 */
export function decryptQf1(
  value: unknown,
  lookupEnv: (name: string) => string | undefined,
  options: DecryptOptions = {}
): string {
  try {
    return decryptInner(value, lookupEnv, options.cache);
  } catch (caught) {
    // Anything that is not one of our classified failures still fails the
    // read as a qf1 error, named by its code or class only (never its text).
    const err = caught instanceof Qf1Error ? caught : unexpected(caught);
    throw options.configKey !== undefined ? err.forConfig(options.configKey) : err;
  }
}

function decryptInner(
  value: unknown,
  lookupEnv: (name: string) => string | undefined,
  cache: KeysetCache | undefined
): string {
  const parsed = parseQf1(value);
  const { keyset, fingerprint: fp } = parsed;
  const ks = shown(keyset);

  const raw = lookupEnv(keyset);
  let held: Map<string, HeldKey>;
  try {
    held = cache !== undefined ? cache.get(keyset, raw) : parseKeysetEnv(keyset, raw);
  } catch (err) {
    if (err instanceof Qf1Error && err.code === "keyset_missing") {
      throw new Qf1Error(
        "keyset_missing",
        `value is encrypted to ${ks} fingerprint ${fp}; ${err.detail}`,
        { keyset: ks, fingerprint: fp }
      );
    }
    throw err;
  }

  const key = held.get(fp);
  if (key === undefined) {
    const heldFps = [...held.keys()].sort();
    return fail(
      "key_not_held",
      `value is encrypted to ${ks} fingerprint ${fp}; this runtime holds ${ks} fingerprints [${heldFps.join(", ")}]`,
      { keyset: ks, fingerprint: fp, held: heldFps }
    );
  }

  const shared = x25519(key.privateKey, parsed.ephemeralPublicKey);
  if (isAllZero(shared)) {
    return fail(
      "invalid_ephemeral_key",
      `the value's ephemeral key gives an all-zero shared secret (${ks} fingerprint ${fp})`,
      { keyset: ks, fingerprint: fp }
    );
  }

  const { key: aesKey, nonce } = deriveKeyAndNonce(
    shared,
    parsed.ephemeralPublicKey,
    key.publicKey
  );
  const body = parsed.ciphertextAndTag;
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce, { authTagLength: TAG_LENGTH });
    decipher.setAAD(parsed.aad);
    decipher.setAuthTag(body.subarray(body.length - TAG_LENGTH));
    // Nothing is released until final() has verified the tag.
    plaintext = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_LENGTH)),
      decipher.final(),
    ]);
  } catch (err) {
    // OpenSSL's GCM tag mismatch; any other failure is unexpected().
    if ((err as Error)?.message !== GCM_AUTH_FAILED) throw err;
    return fail(
      "decrypt_failed",
      `authentication failed for a value encrypted to ${ks} fingerprint ${fp}`,
      { keyset: ks, fingerprint: fp }
    );
  }

  try {
    return STRICT_UTF8.decode(plaintext);
  } catch (err) {
    if ((err as { code?: unknown })?.code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw err;
    return fail(
      "decrypt_failed",
      `the decrypted value is not valid UTF-8 (${ks} fingerprint ${fp})`,
      { keyset: ks, fingerprint: fp }
    );
  } finally {
    plaintext.fill(0);
  }
}
