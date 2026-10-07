/**
 * qfg-goi1.2.5 (5): AES-256-GCM decryption must require the full 16-byte
 * auth tag. Without `authTagLength`, Node accepted a truncated tag (a 4-byte
 * tag decrypted fine and only emitted DEP0182), which weakens authentication.
 * We always write 16-byte tags, so valid ciphertexts are unaffected.
 */
import { describe, expect, it } from "vitest";

import { decrypt, encrypt, generateNewHexKey } from "../src/encryption";

describe("decrypt auth tag length (qfg-goi1.2.5)", () => {
  it("decrypts a value with a full 16-byte tag", () => {
    const key = generateNewHexKey();
    expect(decrypt(encrypt("hello secret", key), key)).toBe("hello secret");
  });

  it("rejects a truncated 4-byte auth tag", () => {
    const key = generateNewHexKey();
    const [data, iv, tag] = encrypt("hello secret", key).split("--");
    const truncated = [data, iv, tag!.slice(0, 8)].join("--");
    expect(() => decrypt(truncated, key)).toThrow();
  });
});
