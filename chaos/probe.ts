/**
 * The sdk-node chaos runner's SDK probe (`run-chaos.test.ts`): the state the
 * expectation expressions in `expressions.ts` read. Kept out of the runner so
 * it is unit-tested in `test/chaos-probe.test.ts`.
 */

import type { SSEConnectionState } from "../src/types";
import type { ExpressionProbe } from "./expressions";

/** The slice of the Quonfig client the probe reads. */
export interface RefreshSource {
  lastSuccessfulRefresh(): Date | undefined;
}

export class ChaosProbe implements ExpressionProbe {
  // Same vocabulary as sdk-go's chaosProbe; values that the SDK does not yet
  // expose stay at sentinel defaults.
  connState: "initializing" | "connected" | "reconnecting" | "falling_back" | "disconnected" =
    "initializing";
  connAttempts = 0;
  restartLayer1 = 0;
  restartLayer2 = 0;
  fallbackActive = false;
  processCrashed = false;
  logs: string[] = [];

  constructor(private client?: RefreshSource) {}

  /** Attach the client once constructed (its options close over this probe). */
  attach(client: RefreshSource): void {
    this.client = client;
  }

  /**
   * ms epoch of the client's last successful refresh (0 before the first).
   * Read from client.lastSuccessfulRefresh(), which a 304 or a same-generation
   * fallback poll also advances. onConfigUpdate fires only on an install, so
   * stamping from it froze the probe across 304-only polls (qfg-goi1.10.33).
   */
  get lastRefresh(): number {
    return this.client?.lastSuccessfulRefresh()?.getTime() ?? 0;
  }

  onSSEState(state: SSEConnectionState): void {
    if (state === "connected") {
      if (this.connState === "connected" || this.connState === "reconnecting") {
        // already connected once; reconnect counts as a restart
      }
      this.connState = "connected";
      this.connAttempts++;
    } else if (state === "error" || state === "connecting") {
      if (this.connState === "connected") {
        // connected → error edge counts as a Layer 1 worker restart.
        this.restartLayer1++;
      }
      this.connState = "reconnecting";
    } else if (state === "disconnected") {
      this.connState = "disconnected";
    }
  }
  setFallbackActive(active: boolean): void {
    this.fallbackActive = active;
    if (active) {
      this.connState = "falling_back";
    }
  }
  log(level: string, msg: string): void {
    this.logs.push(`level=${level.toLowerCase()} ${msg}`);
    // Map "onConfigUpdate callback threw" to a Layer 1 restart so chaos
    // scenario 10 (callback throw) sees worker_restart_total increment per
    // panic. The supervisor-test-contract notes the increment is optional, but
    // the chaos scenario requires it. The SDK's invokeOnConfigUpdate emits
    // `[quonfig] onConfigUpdate callback threw:` on each catch.
    if (/onConfigUpdate callback threw/i.test(msg)) {
      this.restartLayer1++;
    }
  }
  // known is false for a metric name the probe does not implement, so the
  // evaluator fails the expectation instead of reading a silent 0.
  sdkMetric(name: string, labels: Record<string, string>): { value: number; known: boolean } {
    if (name === "quonfig_sdk_worker_restart_total") {
      if (labels.layer === "1") return { value: this.restartLayer1, known: true };
      if (labels.layer === "2") return { value: this.restartLayer2, known: true };
      return { value: this.restartLayer1 + this.restartLayer2, known: true };
    }
    if (name === "quonfig_sse_connect_attempts_total") {
      return { value: this.connAttempts, known: true };
    }
    return { value: 0, known: false };
  }
  logMatches(level: string, re: RegExp): number {
    let n = 0;
    for (const line of this.logs) {
      if (level && !line.toLowerCase().includes(`level=${level.toLowerCase()}`)) continue;
      if (re.test(line)) n++;
    }
    return n;
  }
}
