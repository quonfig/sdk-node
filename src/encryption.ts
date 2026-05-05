import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type { CipherGCMTypes } from "crypto";

const CIPHER_TYPE: CipherGCMTypes = "aes-256-gcm";
const SEPARATOR = "--";
const KEY_LENGTH = 32; // 32 bytes for aes-256-gcm

/**
 * Generate a new random hex-encoded 32-byte key for AES-256-GCM encryption.
 */
export function generateNewHexKey(): string {
  return randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * Encrypt a string using AES-256-GCM.
 *
 * Returns a string in format: "DATA--IV--AUTH_TAG" where each part is hex-encoded.
 */
export function encrypt(clearText: string, keyStringHex: string): string {
  if (keyStringHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `Invalid key length. Key must be a 64 character hex string (representing a 32-byte key). You provided ${keyStringHex.length} characters.`
    );
  }

  const key = Buffer.from(keyStringHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_TYPE, key, iv);
  let encrypted = cipher.update(clearText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return [encrypted, iv.toString("hex"), tag].join(SEPARATOR);
}

/**
 * Decrypt an AES-256-GCM encrypted value.
 *
 * The encrypted string must be in format: "DATA--IV--AUTH_TAG" where each part is hex-encoded.
 */
export function decrypt(encryptedString: string, keyStringHex: string): string {
  if (keyStringHex.length !== 64) {
    throw new Error("Invalid key length. Key must be a 64-character hex string.");
  }

  const key = Buffer.from(keyStringHex, "hex");
  const parts = encryptedString.split(SEPARATOR);

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted string. Must contain encrypted data, IV, and auth tag.");
  }

  const encryptedDataPart = parts[0]!;
  const ivPart = parts[1]!;
  const authTagPart = parts[2]!;

  if (encryptedDataPart === "") {
    return "";
  }

  const encryptedData = Buffer.from(encryptedDataPart, "hex");
  const iv = Buffer.from(ivPart, "hex");
  const authTag = Buffer.from(authTagPart, "hex");

  const decipher = createDecipheriv(CIPHER_TYPE, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}
