/**
 * Time source for the telemetry transport: the tick timer, the per-POST
 * deadline, the 30s floor, Retry-After and retained-batch age all read it.
 *
 * Production uses {@link realTelemetryClock}. Tests inject a manual clock
 * (private `__testTelemetryClock` option) instead of faking the global timers:
 * global `fetch` (undici) schedules its own internals on the global
 * `setTimeout`, and faking that stalls real socket I/O (undici 6.28 / Node
 * 22.23 stops a keep-alive-reused POST until fake time advances).
 */
export interface TelemetryClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Wall clock; timers are unref'd so telemetry never keeps the process alive. */
export const realTelemetryClock: TelemetryClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    if (typeof t === "object" && t !== null && "unref" in t) t.unref();
    return t;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
