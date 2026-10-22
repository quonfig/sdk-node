/**
 * The sdk-node chaos runner's SDK probe (`run-chaos.test.ts`): the state the
 * expectation expressions in `expressions.ts` read. Kept out of the runner so
 * it is unit-tested in `test/chaos-probe.test.ts` and
 * `test/chaos-sdk-hooks.test.ts`.
 *
 * Every value an expression asserts on comes from the SDK itself (qfg-6vno.2):
 * `connectionState()`, `fallbackPollerActive()`, `lastSuccessfulRefresh()`,
 * `isReady()` and the internal `supervisorCounters()` hook. The probe keeps no
 * state machine of its own, so it cannot report a state the supervisor
 * contract forbids (such as `reconnecting`). The only runner-side facts are
 * the ones only the runner can observe: whether init() raised
 * (`processCrashed`, `initState`), the SDK's log lines, and how many
 * onConfigUpdate callbacks fired after the init call returned.
 */

import type { SupervisorCounters } from "../src/sse";
import type { ConnectionState } from "../src/types";
import type { ExpressionProbe, MetricReading } from "./expressions";

/** The slice of the Quonfig client the probe reads. */
export interface ProbeClient {
  lastSuccessfulRefresh(): Date | undefined;
  connectionState(): ConnectionState;
  fallbackPollerActive(): boolean;
  supervisorCounters(): SupervisorCounters;
  isReady(): boolean;
}

/**
 * Why `worker_restart_total{layer="2"}` is SKIPPED (Decision 6: unimplemented
 * = SKIPPED with a reason): sdk-node's fallback poller is a timer chain, not a
 * supervised worker, so the SDK has no layer-2 restart to count.
 */
export const LAYER2_SKIP_REASON =
  "sdk-node counts no layer-2 restarts: the fallback poller is a timer chain, not a " +
  "supervised worker, so the SDK has no layer-2 restart counter (Decision 6)";

export class ChaosProbe implements ExpressionProbe {
  processCrashed = false;
  logs: string[] = [];
  /** Init-failure scenarios: 'pending' | 'returned' | 'raised' (README). */
  initState: "pending" | "returned" | "raised" | "" = "";
  /** onConfigUpdate callbacks after the init call returned or raised. */
  readyEvents = 0;
  /** Init-failure scenarios: the SDK's string getter with a caller default. */
  getString?: (key: string, dflt: string) => string;

  constructor(private client?: ProbeClient) {}

  /** Attach the client once constructed (its options close over this probe). */
  attach(client: ProbeClient): void {
    this.client = client;
  }

  /** client.connectionState(), verbatim. */
  get connState(): string {
    return this.client?.connectionState() ?? "initializing";
  }

  get fallbackActive(): boolean {
    return this.client?.fallbackPollerActive() ?? false;
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

  ready(): boolean {
    return this.client?.isReady() ?? false;
  }

  log(level: string, msg: string): void {
    this.logs.push(`level=${level.toLowerCase()} ${msg}`);
  }

  // known is false for a metric name the probe does not implement, so the
  // evaluator fails the expectation instead of reading a silent 0. A metric the
  // SDK does not have is SKIPPED with a reason.
  sdkMetric(name: string, labels: Record<string, string>): MetricReading {
    const counters = this.client?.supervisorCounters();
    if (name === "quonfig_sdk_worker_restart_total") {
      if (labels.layer === "1") {
        return { value: counters?.workerRestartsLayer1 ?? 0, known: true };
      }
      return { value: 0, known: true, skip: LAYER2_SKIP_REASON };
    }
    if (name === "quonfig_sse_connect_attempts_total") {
      return { value: counters?.sseConnectAttempts ?? 0, known: true };
    }
    if (name === "quonfig_sdk_callback_errors_total") {
      if (labels.callback === "on_config_update") {
        return { value: counters?.callbackErrorsOnConfigUpdate ?? 0, known: true };
      }
      if (labels.callback === "on_connection_state_change") {
        return { value: counters?.callbackErrorsOnConnectionStateChange ?? 0, known: true };
      }
      return { value: 0, known: false };
    }
    return { value: 0, known: false };
  }

  logMatches(level: string, re: RegExp): number {
    let n = 0;
    for (const line of this.logs) {
      if (level && !line.toLowerCase().startsWith(`level=${level.toLowerCase()} `)) continue;
      if (re.test(line)) n++;
    }
    return n;
  }
}
