import murmurhash from "murmurhash";

/**
 * Hash a string to a float64 in [0, 1) using Murmur3.
 * This matches the Go SDK's HashZeroToOne implementation.
 */
export function hashZeroToOne(value: string): number {
  const hash = murmurhash.v3(value);
  // MaxUint32 = 4294967295
  return hash / 4294967295;
}
