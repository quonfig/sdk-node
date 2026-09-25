import type { TelemetryClock } from "../../src/telemetry/clock";

/** Let pending promise callbacks and already-completed I/O callbacks run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Manual clock for the telemetry transport contract (the contract's
 * `advance(ms)`). Injected through the private `__testTelemetryClock` option,
 * so only the SDK's telemetry timers move; the global timers stay real and
 * undici's socket I/O is untouched (vitest fake timers stall undici 6.28's
 * keep-alive reuse on Node 22.23).
 */
export class ManualClock implements TelemetryClock {
  private t: number;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = Date.parse("2026-09-25T00:00:00Z")) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Timers scheduled and not yet fired or cleared. */
  pending(): number {
    return this.timers.size;
  }

  /**
   * Move time forward by `ms`, firing due timers in time order (ties in
   * scheduling order), settling promise callbacks between timers.
   */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      await settle();
      let nextId: number | undefined;
      let next: { at: number; fn: () => void } | undefined;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (next === undefined || timer.at < next.at)) {
          nextId = id;
          next = timer;
        }
      }
      if (next === undefined || nextId === undefined) break;
      this.timers.delete(nextId);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
    await settle();
  }
}
