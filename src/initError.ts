/**
 * Why the client has no Quonfig config (init-failure design B.4):
 *
 * - `"timeout"`: the last attempt hung (every leg ran out of time without an
 *   answer), or no attempt completed within `initTimeout` (or the
 *   `waitForReady` deadline).
 * - `"unavailable"`: the last attempt failed with an answer or a fast error
 *   (connection refused, DNS, 5xx, ...), or the client was closed first.
 * - `"unauthorized"`: every delivery leg rejected the SDK key
 *   (401/403/404/410).
 */
export type QuonfigInitErrorReason = "timeout" | "unavailable" | "unauthorized";

/**
 * Raised by `init()` under `onInitFailure: "fail"` (the default) when no config
 * could be loaded, and by `waitForReady({ timeoutMs })` when the client is not
 * ready in time. The client object survives it and keeps retrying in the
 * background; see `isReady()` / `waitForReady()`.
 */
export class QuonfigInitError extends Error {
  readonly reason: QuonfigInitErrorReason;
  /** The last delivery error, when there was one. */
  override readonly cause?: unknown;

  constructor(reason: QuonfigInitErrorReason, message: string, cause?: unknown) {
    super(message);
    this.name = "QuonfigInitError";
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
  }
}
