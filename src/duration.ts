// Quonfig duration grammar (qfg-2agi.9). The one definition lives in
// integration-test-data/tests/duration/grammar.yaml:
//
//   ^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$
//
// plus: at least one component, no dangling T, a fraction only on S with at
// most 9 digits, total magnitude <= P36500D. ASCII digits only ([0-9], never
// \d) and anchored to the whole string.
const PATTERN =
  /^P(?:([0-9]+)D)?(?:T(?=[0-9])(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)(?:\.([0-9]{1,9}))?S)?)?$/;

/**
 * Thrown internally when a stored or ENV_VAR-provided duration is outside the
 * grammar. Its message never carries the raw value (it may be a secret).
 */
export class InvalidDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDurationError";
  }
}

const NANOS_PER_SECOND = 1_000_000_000n;
const NANOS_PER_MILLI = 1_000_000n;
const MAX_NANOS = 36_500n * 86_400n * NANOS_PER_SECOND;

/**
 * Parse a duration string against the Quonfig grammar and return its length
 * in whole milliseconds (exact decimal arithmetic, rounded half up), or
 * `undefined` if the string is not a valid Quonfig duration.
 */
export function parseDurationMillis(duration: string): number | undefined {
  if (typeof duration !== "string") return undefined;
  const m = PATTERN.exec(duration);
  if (m === null) return undefined;
  const [, days, hours, minutes, seconds, fraction] = m;
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) {
    return undefined;
  }

  const wholeSeconds =
    ((BigInt(days ?? "0") * 24n + BigInt(hours ?? "0")) * 60n + BigInt(minutes ?? "0")) * 60n +
    BigInt(seconds ?? "0");
  const nanos = wholeSeconds * NANOS_PER_SECOND + BigInt((fraction ?? "").padEnd(9, "0") || "0");
  if (nanos > MAX_NANOS) return undefined;

  return Number((nanos + NANOS_PER_MILLI / 2n) / NANOS_PER_MILLI);
}

/**
 * Parse an ISO 8601 duration string and return the number of milliseconds.
 *
 * Accepts the Quonfig duration grammar, e.g. PT0.2S, PT90S, PT30M,
 * P1DT6H2M1.5S. Returns 0 for a string outside the grammar; use
 * {@link parseDurationMillis} to tell a malformed value from a zero duration.
 */
export function durationToMilliseconds(duration: string): number {
  return parseDurationMillis(duration) ?? 0;
}
