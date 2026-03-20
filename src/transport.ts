import type { ConfigEnvelope } from "./types";

const SDK_VERSION = "0.1.0";

export interface FetchResult {
  envelope?: ConfigEnvelope;
  notChanged: boolean;
}

/**
 * HTTP transport for fetching configs from the Quonfig API.
 *
 * Supports ETag-based caching to avoid re-downloading unchanged configs.
 */
export const DEFAULT_TELEMETRY_URL = "https://telemetry.quonfig.com";

export class Transport {
  private baseUrl: string;
  private telemetryBaseUrl: string;
  private sdkKey: string;
  private etag: string = "";

  constructor(baseUrl: string, sdkKey: string, telemetryBaseUrl?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    // Priority: QUONFIG_TELEMETRY_URL env var > constructor option > default
    const envUrl = process.env.QUONFIG_TELEMETRY_URL;
    const url = envUrl || telemetryBaseUrl || DEFAULT_TELEMETRY_URL;
    this.telemetryBaseUrl = url.replace(/\/$/, "");
    this.sdkKey = sdkKey;
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
   * Returns `{ notChanged: true }` if the server responds with 304.
   */
  async fetchConfigs(): Promise<FetchResult> {
    const headers = this.getHeaders();
    if (this.etag) {
      headers["If-None-Match"] = this.etag;
    }

    const response = await fetch(`${this.baseUrl}/api/v2/configs`, {
      method: "GET",
      headers,
    });

    if (response.status === 304) {
      return { notChanged: true };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Unexpected status ${response.status}: ${body}`);
    }

    const etag = response.headers.get("ETag");
    if (etag) {
      this.etag = etag;
    }

    const envelope = (await response.json()) as ConfigEnvelope;
    return { envelope, notChanged: false };
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
      console.warn(`[quonfig] Telemetry POST failed: ${response.status} ${body}`);
    }
  }

  /**
   * Get the SSE URL for config streaming.
   */
  getSSEUrl(): string {
    return `${this.baseUrl}/api/v2/sse/config`;
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
