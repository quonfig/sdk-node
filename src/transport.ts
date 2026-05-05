import type { ConfigEnvelope } from "./types";
import { normalizeLogger, type Logger, type NormalizedLogger } from "./sdkLogger";
import SDK_VERSION from "./version";

export interface FetchResult {
  envelope?: ConfigEnvelope;
  notChanged: boolean;
}

const DEFAULT_DOMAIN = "quonfig.com";

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
  private etag: string = "";
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
   * Fetch configs from GET /api/v2/configs with ETag caching.
   *
   * Tries each base URL in order. Returns the first successful result.
   * Returns `{ notChanged: true }` if the server responds with 304.
   */
  async fetchConfigs(): Promise<FetchResult> {
    let lastError: Error | undefined;

    for (let i = 0; i < this.baseUrls.length; i++) {
      const baseUrl = this.baseUrls[i];
      try {
        const headers = this.getHeaders();
        if (this.etag) {
          headers["If-None-Match"] = this.etag;
        }

        // In Next.js dev mode the patched fetch deduplicates by URL across a
        // request lifetime, which can cause stale config to be served even after
        // a server-side change.  Gate the cache-bust param to development so
        // production consumers don't defeat upstream HTTP / CDN caches.
        const isDev = process.env.NODE_ENV === "development";
        const configUrl = isDev
          ? `${baseUrl}/api/v2/configs?_=${Date.now()}`
          : `${baseUrl}/api/v2/configs`;
        const fetchInit: RequestInit & { cache?: string } = { method: "GET", headers };
        if (isDev) {
          fetchInit.cache = "no-store";
        }
        const response = await fetch(configUrl, fetchInit as RequestInit);

        if (response.status === 304) {
          this.activeBaseUrl = baseUrl;
          this.activeStreamUrl = this.streamUrls[i];
          return { notChanged: true };
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Unexpected status ${response.status} from ${baseUrl}: ${body}`);
        }

        const etag = response.headers.get("ETag");
        if (etag) {
          this.etag = etag;
        }

        this.activeBaseUrl = baseUrl;
        this.activeStreamUrl = this.streamUrls[i];
        const envelope = (await response.json()) as ConfigEnvelope;
        return { envelope, notChanged: false };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error("All API URLs failed");
  }

  /**
   * Post telemetry data to the telemetry endpoint.
   */
  async postTelemetry(data: any): Promise<void> {
    const headers = this.getHeaders({
      "Content-Type": "application/json",
    });

    const response = await fetch(`${this.telemetryBaseUrl}/api/v1/telemetry/`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      // Telemetry failures are non-fatal; just log
      const body = await response.text().catch(() => "");
      this.logger.warn(`Telemetry POST failed: ${response.status} ${body}`);
    }
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
