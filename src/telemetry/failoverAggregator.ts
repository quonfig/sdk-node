import type { TelemetryEvent } from "../types";

/**
 * FailoverCollector accumulates failover-behavior counters over a flush window:
 * how many config-fetch cycles fired the hedge's secondary leg, how many
 * strictly-older installs the reject-older ordering guard dropped (qfg-rr5b),
 * and which upstream leg resolved each successful HTTP install. Every counter is
 * additive and carries no user data.
 *
 * It mirrors sdk-go's internal/telemetry FailoverAggregator: the record methods
 * are called directly from the failover call sites (per config-refresh, not
 * per-evaluation, so the overhead is negligible) and {@link drain} returns
 * `undefined` when every counter is zero, so a healthy steady-state client emits
 * no failover event at all. Node is single-threaded, so no locking is needed.
 *
 * `enabled` mirrors the telemetry gate: the failover signal rides any enabled
 * telemetry stream regardless of the eval/context opt-outs, but a full telemetry
 * opt-out (no sdk key, or every collector disabled) leaves it disabled and every
 * record + drain a no-op.
 */
export class FailoverCollector {
  private enabled: boolean;
  private startAt: number | undefined;
  private hedgeFired: number = 0;
  private guardRejected: number = 0;
  private resolvedFromPrimary: number = 0;
  private resolvedFromSecondary: number = 0;
  private resolvedFromLkg: number = 0;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Stamp the window start on the first record. */
  private ensureStart(): void {
    if (this.startAt === undefined) {
      this.startAt = Date.now();
    }
  }

  /**
   * Record one config-fetch cycle whose hedge fired the secondary leg (the
   * primary was slow or errored).
   */
  recordHedgeFired(): void {
    if (!this.enabled) return;
    this.ensureStart();
    this.hedgeFired++;
  }

  /**
   * Record one install dropped by the reject-older ordering guard because the
   * incoming snapshot was STRICTLY older than the held generation, on any
   * install path (HTTP or SSE). An equal-generation re-delivery is also dropped
   * by the guard but is deliberately NOT recorded here — it is expected
   * steady-state traffic (an SSE reconnect resend, a cold-ETag poll), not an
   * upstream trying to move the client backwards (qfg-rr5b).
   */
  recordGuardRejected(): void {
    if (!this.enabled) return;
    this.ensureStart();
    this.guardRejected++;
  }

  /**
   * Record one successful HTTP install by the leg that served it: `sourceIndex`
   * 0 is the primary, any index > 0 is a failover/secondary leg. A negative
   * index (SSE/datadir install with no HTTP leg) is ignored.
   */
  recordResolvedFrom(sourceIndex: number): void {
    if (!this.enabled) return;
    if (sourceIndex < 0) return;
    this.ensureStart();
    if (sourceIndex === 0) {
      this.resolvedFromPrimary++;
    } else {
      this.resolvedFromSecondary++;
    }
  }

  /**
   * Drain the window's counters into a TelemetryEvent and reset. Returns
   * `undefined` when no failover activity occurred (every counter zero), so a
   * healthy steady-state client emits no failover event.
   */
  drain(): TelemetryEvent | undefined {
    if (
      this.hedgeFired === 0 &&
      this.guardRejected === 0 &&
      this.resolvedFromPrimary === 0 &&
      this.resolvedFromSecondary === 0 &&
      this.resolvedFromLkg === 0
    ) {
      return undefined;
    }

    const event: TelemetryEvent = {
      failover: {
        start: this.startAt ?? Date.now(),
        end: Date.now(),
        hedgeFired: this.hedgeFired,
        guardRejected: this.guardRejected,
        resolvedFromPrimary: this.resolvedFromPrimary,
        resolvedFromSecondary: this.resolvedFromSecondary,
        resolvedFromLkg: this.resolvedFromLkg,
      },
    };

    this.startAt = undefined;
    this.hedgeFired = 0;
    this.guardRejected = 0;
    this.resolvedFromPrimary = 0;
    this.resolvedFromSecondary = 0;
    this.resolvedFromLkg = 0;

    return event;
  }
}
