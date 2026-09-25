import type { ConfigEnvelope } from "./types";
import { normalizeLogger, type Logger, type NormalizedLogger } from "./sdkLogger";
import SDK_VERSION from "./version";
import { realTelemetryClock, type TelemetryClock } from "./telemetry/clock";

export interface FetchResult {
  envelope?: ConfigEnvelope;
  notChanged: boolean;
}

/**
 * One hedged leg's outcome, delivered to the caller as it settles. Exactly one
 * `LegResult` is emitted per fired leg; `sourceIndex` identifies the leg
 * (0 = primary, 1 = secondary). `error` is set when the leg failed (network
 * error, timeout/abort, non-2xx); otherwise `result` carries the outcome.
 */
export interface LegResult {
  result?: FetchResult;
  error?: Error;
  sourceIndex: number;
}

const DEFAULT_DOMAIN = "quonfig.com";

/**
 * Timeout of the deprecated {@link Transport.postTelemetry} only (qfg-i2ar).
 * The reporter's POST uses `telemetryTimeoutMs` (default 15s) via
 * {@link Transport.sendTelemetry}.
 */
const TELEMETRY_POST_TIMEOUT_MS = 3000;

/** Outcome of one telemetry POST that got an HTTP response. */
export interface TelemetryHttpResult {
  status: number;
  retryAfter?: string;
  bodySnippet: string;
}

/**
 * A telemetry POST that got no HTTP response: the overall timeout fired
 * (`timeout`), the connection or request failed (`network`), or the caller
 * aborted it (`aborted`, only `close()` does this).
 */
export class TelemetryRequestError extends Error {
  readonly reason: "timeout" | "network" | "aborted";
  readonly code?: string;

  constructor(reason: "timeout" | "network" | "aborted", cause?: unknown) {
    const code = errorCode(cause);
    const detail = code ?? (cause instanceof Error ? cause.message : undefined);
    super(detail ? `telemetry POST ${reason}: ${detail}` : `telemetry POST ${reason}`);
    this.name = "TelemetryRequestError";
    this.reason = reason;
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Find a Node error code (ECONNREFUSED, ...) on an error or its cause chain. */
function errorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Default per-URL config-fetch deadline (qfg-7h5d.1.7). ~3s is short enough that
 * a hung primary fails over to the secondary well inside a default 10s
 * `initTimeout`, yet long enough to tolerate a slow-but-healthy upstream. This
 * is a per-attempt deadline on the HTTP config path only — it does NOT touch the
 * long-lived SSE stream, which keeps its own read deadline.
 */
export const DEFAULT_CONFIG_FETCH_TIMEOUT_MS = 3000;

/**
 * Default hedge delay (qfg-7h5d.1.14). How long the hedged config-fetch waits
 * for the primary leg before ALSO firing the secondary in parallel (it does not
 * cancel the primary). ~2s is below a realistic slow-but-alive primary's worst
 * case yet far enough below the per-leg abort that a healthy sub-second primary
 * is NEVER hedged — the secondary stays a cold standby and a healthy system adds
 * zero secondary load. Tunable via `configFetchHedgeDelayMs`.
 */
export const DEFAULT_CONFIG_FETCH_HEDGE_DELAY_MS = 2000;

/**
 * Default per-leg hard-abort deadline on the hedged path (qfg-7h5d.1.14). MUST
 * exceed the longest healable primary latency so a late-but-newer primary heals
 * forward (rather than aborting), and SHOULD be < `initTimeout` so the init-path
 * heal leg is not clipped (the client logs a warning at construction otherwise).
 * The chaos o03/o05 rigs slow the primary by ~3s, which sits between the 2s
 * delay and this 6s abort, so the late primary is delivered (not aborted) and
 * the reject-older path is exercised. Tunable via `configFetchHedgeAbortMs`.
 */
export const DEFAULT_CONFIG_FETCH_HEDGE_ABORT_MS = 6000;

export type DomainOptions = { domain?: string };

/**
 * Read the active Quonfig domain.
 *
 * Resolution order (highest wins):
 *   1. `options.domain` — explicit init option (mirrors @quonfig/javascript;
 *      gives server callers a non-env-var way to flip api+telemetry in lockstep)
 *   2. `process.env.QUONFIG_DOMAIN` — convenient for staging/prod deploys
 *   3. Hardcoded default `"quonfig.com"`
 */
export function getDomain(options?: DomainOptions): string {
  if (options && typeof options.domain === "string" && options.domain.length > 0) {
    return options.domain;
  }
  const v = process.env.QUONFIG_DOMAIN;
  return v && v.length > 0 ? v : DEFAULT_DOMAIN;
}

/** Derive the default ordered list of API base URLs from the active domain. */
export function defaultApiUrls(options?: DomainOptions): string[] {
  const domain = getDomain(options);
  return [`https://primary.${domain}`, `https://secondary.${domain}`];
}

/** Derive the default telemetry base URL from the active domain. */
export function defaultTelemetryUrl(options?: DomainOptions): string {
  return `https://telemetry.${getDomain(options)}`;
}

/**
 * HTTP transport for fetching configs from the Quonfig API.
 *
 * Supports ETag-based caching to avoid re-downloading unchanged configs.
 * Accepts an ordered list of base URLs and tries each in turn (primary/secondary failover).
 */

/**
 * Derive the SSE stream base URL for an apiUrl by prepending `stream.` to the hostname.
 *
 * Examples:
 *   https://primary.quonfig.com       -> https://stream.primary.quonfig.com
 *   http://localhost:8080             -> http://stream.localhost:8080
 *   https://api.example.com/some/path -> https://stream.api.example.com/some/path
 *
 * Port, scheme, and path are preserved. Trailing slashes are stripped to match
 * the normalization applied to apiUrls.
 */
export function deriveStreamUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.hostname = `stream.${url.hostname}`;
  return url.toString().replace(/\/$/, "");
}

export class Transport {
  private baseUrls: string[];
  private streamUrls: string[];
  private activeBaseUrl: string;
  private activeStreamUrl: string;
  private telemetryBaseUrl: string;
  private sdkKey: string;
  private logger: NormalizedLogger;
  /**
   * ETag cache is PER-LEG: `etags[i]` is the last ETag seen from `baseUrls[i]`.
   * The hedge runs both legs concurrently, so a single shared ETag would let a
   * 304 from one leg mask the other (and even on a single-threaded event loop two
   * overlapping refresh promises could interleave a stale `If-None-Match`). Each
   * leg reads/writes only its own slot. (qfg-7h5d.1.14)
   */
  private etags: string[];
  /**
   * Index into `baseUrls` of the leg that last succeeded for `fetchConfigs`
   * (0 = primary, >0 = a secondary reached via failover). Lets the client report
   * which leg it resolved off (`resolvedFrom()`). Starts at 0 (primary).
   */
  private activeBaseUrlIndex: number = 0;
  /**
   * Per-URL deadline (ms) for a single attempt on the SEQUENTIAL `fetchConfigs`
   * path (unchanged semantics). Each leg in the failover loop gets its own
   * `AbortSignal.timeout(fetchTimeoutMs)`, so a hung upstream aborts fast and
   * leaves budget to reach the next leg inside the caller's overall deadline
   * (e.g. `initTimeout`). Defaults to DEFAULT_CONFIG_FETCH_TIMEOUT_MS; the client
   * overwrites it from `configFetchTimeoutMs` at construction. The hedged path
   * uses `hedgeAbortMs` instead. (qfg-7h5d.1.7)
   */
  fetchTimeoutMs: number = DEFAULT_CONFIG_FETCH_TIMEOUT_MS;
  /**
   * How long the hedge waits for the primary leg before ALSO firing the
   * secondary in parallel (it does not cancel the primary). Defaults to
   * DEFAULT_CONFIG_FETCH_HEDGE_DELAY_MS; the client overwrites it from
   * `configFetchHedgeDelayMs`. (qfg-7h5d.1.14)
   */
  hedgeDelayMs: number = DEFAULT_CONFIG_FETCH_HEDGE_DELAY_MS;
  /**
   * Per-leg hard-abort deadline on the hedged path. Defaults to
   * DEFAULT_CONFIG_FETCH_HEDGE_ABORT_MS; the client overwrites it from
   * `configFetchHedgeAbortMs`. (qfg-7h5d.1.14)
   */
  hedgeAbortMs: number = DEFAULT_CONFIG_FETCH_HEDGE_ABORT_MS;
  /**
   * Test-only override. When set, `getSSEUrl()` returns this value verbatim
   * instead of deriving it from apiUrls. Used to let tests point SSE at a
   * mock server without intercepting DNS. NOT part of the public API.
   */
  private __testStreamUrlOverride?: string;

  constructor(
    baseUrls: string[],
    sdkKey: string,
    telemetryBaseUrl?: string,
    domain?: string,
    logger?: Logger
  ) {
    this.baseUrls = baseUrls.map((u) => u.replace(/\/$/, ""));
    this.streamUrls = this.baseUrls.map((u) => deriveStreamUrl(u));
    this.etags = new Array(this.baseUrls.length).fill("");
    this.activeBaseUrl = this.baseUrls[0];
    this.activeStreamUrl = this.streamUrls[0];
    // Resolution order: explicit telemetryUrl > options.domain > QUONFIG_DOMAIN > default.
    // QUONFIG_TELEMETRY_URL is intentionally NOT honored — use QUONFIG_DOMAIN
    // (alpha-phase: no backward-compat).
    const url = telemetryBaseUrl || defaultTelemetryUrl({ domain });
    this.telemetryBaseUrl = url.replace(/\/$/, "");
    this.sdkKey = sdkKey;
    this.logger = normalizeLogger(logger);
  }

  /**
   * Build the Basic auth header value.
   * Uses username "1" like the Go SDK: base64("1:{sdkKey}")
   */
  private getAuthHeader(): string {
    return "Basic " + Buffer.from(`1:${this.sdkKey}`).toString("base64");
  }

  /**
   * Common headers for all requests.
   */
  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: this.getAuthHeader(),
      "X-Quonfig-SDK-Version": `node-${SDK_VERSION}`,
      Accept: "application/json",
      ...extra,
    };
  }

  /**
   * Fetch GET /api/v2/configs from `baseUrls[i]`, using ONLY that leg's ETag slot
   * (`etags[i]`), bounded by its own `abortMs` deadline. Fully reads/decodes the
   * body before resolving, so the leg is self-contained. Never throws — every
   * outcome (success, 304, network error, non-2xx, abort) resolves to a
   * `LegResult` carrying `sourceIndex=i`. The shared `activeBaseUrl*` fields are
   * NOT mutated here: the hedge fires two legs and the caller (client) decides
   * which one installs, then snapshots its `sourceIndex` for `resolvedFrom()`.
   * (qfg-7h5d.1.14)
   */
  private async fetchFromUrlAt(i: number, abortMs: number): Promise<LegResult> {
    const baseUrl = this.baseUrls[i];
    try {
      const headers = this.getHeaders();
      // Per-leg ETag: read only this leg's slot so a 304 from the other leg can
      // never mask this one, and two overlapping hedge cycles can't interleave a
      // stale If-None-Match across legs. (qfg-7h5d.1.14)
      const etag = this.etags[i];
      if (etag) {
        headers["If-None-Match"] = etag;
      }

      // In Next.js dev mode the patched fetch deduplicates by URL across a
      // request lifetime, which can cause stale config to be served even after
      // a server-side change.  Gate the cache-bust param to development so
      // production consumers don't defeat upstream HTTP / CDN caches.
      const isDev = process.env.NODE_ENV === "development";
      const configUrl = isDev
        ? `${baseUrl}/api/v2/configs?_=${Date.now()}`
        : `${baseUrl}/api/v2/configs`;
      const fetchInit: RequestInit & { cache?: string } = {
        method: "GET",
        headers,
        // Bound this single leg so a hung upstream (accepts the connection but
        // never responds) aborts after abortMs instead of running forever. The
        // signal stays active through the body read, so a slow body is bounded
        // too. The abort surfaces as a rejected fetch, caught below.
        signal: AbortSignal.timeout(abortMs),
      };
      if (isDev) {
        fetchInit.cache = "no-store";
      }
      const response = await fetch(configUrl, fetchInit as RequestInit);

      if (response.status === 304) {
        return { result: { notChanged: true }, sourceIndex: i };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Unexpected status ${response.status} from ${baseUrl}: ${body}`);
      }

      const newEtag = response.headers.get("ETag");
      if (newEtag) {
        this.etags[i] = newEtag;
      }

      const envelope = (await response.json()) as ConfigEnvelope;
      return { result: { envelope, notChanged: false }, sourceIndex: i };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error(String(err)), sourceIndex: i };
    }
  }

  /**
   * Record which leg last produced a config, so `getActiveBaseUrlIndex()` (and,
   * on the sequential path, `getSSEUrl()`) reflect it.
   *
   * `trackStream` distinguishes the two callers:
   *   - The SEQUENTIAL `fetchConfigs` path passes `true` — its historic behavior,
   *     so the fallback poller's SSE reconnect tracks the leg it last reached.
   *   - The HEDGED install path passes `false` — SSE is pinned to the PRIMARY
   *     stream and never fails over (the chaos suite asserts this in f05), so a
   *     hedged secondary install advances the base-url index (for `resolvedFrom`)
   *     but leaves the active stream on the primary. (qfg-7h5d.1.14)
   */
  markActiveLeg(i: number, trackStream: boolean): void {
    if (i < 0 || i >= this.baseUrls.length) return;
    this.activeBaseUrlIndex = i;
    this.activeBaseUrl = this.baseUrls[i];
    if (trackStream) {
      this.activeStreamUrl = this.streamUrls[i];
    }
  }

  /**
   * Sequential config fetch: try each base URL in order, returning the first
   * successful result. Retained for any non-hedged caller; the init/refresh
   * install path uses {@link Transport.fetchConfigsHedged}. Returns
   * `{ notChanged: true }` on 304. Uses the per-leg ETag slots and the
   * per-attempt `fetchTimeoutMs` deadline (unchanged semantics).
   */
  async fetchConfigs(): Promise<FetchResult> {
    let lastError: Error | undefined;
    for (let i = 0; i < this.baseUrls.length; i++) {
      const lr = await this.fetchFromUrlAt(i, this.fetchTimeoutMs);
      if (lr.error) {
        lastError = lr.error;
        continue;
      }
      // Sequential path keeps its historic side effect of marking the winning
      // leg active (the fallback poller relies on it), stream included.
      this.markActiveLeg(i, true);
      return lr.result!;
    }
    throw lastError ?? new Error("All API URLs failed");
  }

  /**
   * Parallel-failover hedge (qfg-7h5d.1.14). Fires the PRIMARY leg (index 0)
   * first and, only if it has not settled within `hedgeDelayMs` OR errors fast,
   * ALSO fires the SECONDARY leg (index 1) in parallel — without cancelling the
   * primary. A fast healthy primary means the secondary is NEVER contacted (cold
   * standby). Each fired leg runs under its own `hedgeAbortMs` deadline and its
   * own ETag slot.
   *
   * `onLeg` is invoked exactly once per fired leg, in arrival order, as soon as
   * that leg settles. The returned promise resolves once every fired leg has
   * settled (so the caller can rely on "all legs done" for the both-fail path).
   * The caller installs each successful leg through the reject-older guard so
   * watermark-max falls out (higher generation wins; a late older payload never
   * regresses; a late newer payload heals forward) with no source ranking.
   */
  async fetchConfigsHedged(onLeg: (leg: LegResult) => void): Promise<void> {
    const hedgeDelay =
      this.hedgeDelayMs > 0 ? this.hedgeDelayMs : DEFAULT_CONFIG_FETCH_HEDGE_DELAY_MS;
    const hedgeAbort =
      this.hedgeAbortMs > 0 ? this.hedgeAbortMs : DEFAULT_CONFIG_FETCH_HEDGE_ABORT_MS;
    const hasSecondary = this.baseUrls.length > 1;

    const pending: Promise<void>[] = [];
    // At-most-once latch so the secondary fires exactly once and NEVER after a
    // fast primary win. Mirrors the sdk-go `secondaryFired` CAS; on a single
    // thread a boolean check-then-set is atomic so no real CAS is needed.
    let secondaryDecided = false;

    const fireLeg = (i: number): void => {
      pending.push(
        this.fetchFromUrlAt(i, hedgeAbort).then((leg) => {
          onLeg(leg);
        })
      );
    };

    const fireSecondary = (): void => {
      if (!hasSecondary || secondaryDecided) return;
      secondaryDecided = true;
      fireLeg(1);
    };

    // Fire the primary and track its settle so the hedge can decide on a fast
    // error (hedge now) vs a fast success/304 (never hedge).
    let primaryError: Error | undefined;
    let primarySettled = false;
    const primaryDone = this.fetchFromUrlAt(0, hedgeAbort).then((leg) => {
      primarySettled = true;
      primaryError = leg.error;
      onLeg(leg);
    });
    pending.push(primaryDone);

    // Race the primary against the hedge-delay timer.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delayElapsed = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, hedgeDelay);
    });
    await Promise.race([primaryDone, delayElapsed]);
    if (timer) clearTimeout(timer);

    if (primarySettled) {
      // Primary settled before (or right at) the hedge delay.
      if (primaryError) {
        fireSecondary(); // fast error -> hedge now
      } else {
        secondaryDecided = true; // fast success/304 -> never hedge (cold standby)
      }
    } else {
      // Primary still in flight after the hedge delay -> hedge in parallel.
      fireSecondary();
    }

    // Wait for every fired leg (primary always; secondary if fired) to settle so
    // the caller's both-fail / heal-forward accounting is complete.
    await Promise.all(pending);
  }

  /**
   * Full URL of the telemetry endpoint the SDK POSTs to.
   */
  getTelemetryUrl(): string {
    return `${this.telemetryBaseUrl}/api/v1/telemetry/`;
  }

  /**
   * POST one serialized telemetry batch (the exact bytes; the caller retains
   * and resends the same Buffer, so the server can dedup a resend of a batch
   * that did land). Resolves with the HTTP status, the `Retry-After` header
   * and the first 1024 characters of the response body; rejects with a
   * {@link TelemetryRequestError} on timeout, network error or abort. Never
   * logs: the telemetry queue owns the logging policy. (qfg-mol-9u0)
   *
   * `timeoutMs` bounds the whole request, response body included. It is an
   * AbortController fired by `opts.clock` (default: the wall clock), not
   * `AbortSignal.timeout`, so tests can drive it with a manual clock. Global
   * `fetch` exposes no separate connect-timeout knob, so the overall deadline
   * also bounds connect/TLS.
   */
  async sendTelemetry(
    body: Buffer,
    opts: { timeoutMs: number; signal?: AbortSignal; clock?: TelemetryClock }
  ): Promise<TelemetryHttpResult> {
    const clock = opts.clock ?? realTelemetryClock;
    const controller = new AbortController();
    let reason: TelemetryRequestError["reason"] | undefined;
    const abort = (r: TelemetryRequestError["reason"]): void => {
      if (reason === undefined) reason = r;
      controller.abort();
    };
    const timer = clock.setTimeout(() => abort("timeout"), opts.timeoutMs);
    const onCallerAbort = (): void => abort("aborted");
    if (opts.signal) {
      if (opts.signal.aborted) onCallerAbort();
      else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      const response = await fetch(this.getTelemetryUrl(), {
        method: "POST",
        headers: this.getHeaders({ "Content-Type": "application/json" }),
        body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
        signal: controller.signal,
      });
      const text = await response.text();
      const retryAfter = response.headers.get("retry-after") ?? undefined;
      const result: TelemetryHttpResult = {
        status: response.status,
        bodySnippet: text.slice(0, 1024),
      };
      if (retryAfter !== undefined) result.retryAfter = retryAfter;
      return result;
    } catch (err) {
      if (reason !== undefined) throw new TelemetryRequestError(reason, err);
      throw new TelemetryRequestError("network", err);
    } finally {
      clock.clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /**
   * Post telemetry data to the telemetry endpoint.
   *
   * @deprecated Kept for callers of the exported `Transport` class. The SDK's
   * own reporter uses {@link Transport.sendTelemetry}, which returns the
   * outcome instead of logging it. This method keeps its historic behavior
   * (3s timeout, WARN on failure). Removed in 2.0.0.
   */
  async postTelemetry(data: any): Promise<void> {
    const headers = this.getHeaders({
      "Content-Type": "application/json",
    });

    let response: Response;
    try {
      response = await fetch(this.getTelemetryUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(TELEMETRY_POST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`Telemetry POST failed: ${err}`);
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn(`Telemetry POST failed: ${response.status} ${body}`);
    }
  }

  /**
   * Index into the configured base-URL list of the leg that last succeeded for
   * `fetchConfigs` — 0 for the primary, >0 for a secondary reached via failover.
   * The client snapshots this at install time to report `resolvedFrom()`.
   */
  getActiveBaseUrlIndex(): number {
    return this.activeBaseUrlIndex;
  }

  /**
   * Get the SSE URL for config streaming.
   *
   * Uses the `stream.<hostname>` URL derived from whichever apiUrl last
   * succeeded for fetchConfigs. The SSE path (`/api/v2/sse/config`) is
   * unchanged; only the hostname differs from the HTTP endpoints.
   *
   * When `__testStreamUrlOverride` is set, returns it verbatim — used by
   * tests to point SSE at a mock server without DNS trickery.
   */
  getSSEUrl(): string {
    if (this.__testStreamUrlOverride !== undefined) {
      return this.__testStreamUrlOverride;
    }
    return `${this.activeStreamUrl}/api/v2/sse/config`;
  }

  /**
   * Get auth headers for SSE connection.
   */
  getSSEHeaders(): Record<string, string> {
    return this.getHeaders({
      Accept: "text/event-stream",
    });
  }
}
