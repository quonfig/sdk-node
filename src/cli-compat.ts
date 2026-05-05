/**
 * CLI-compatibility types and utilities.
 *
 * These are needed by @quonfig/cli but are NOT part of the core SDK.
 * They provide the HTTP API client, SDK-key parsing, and legacy
 * config-value types that the CLI's CRUD commands depend on.
 */

import type { ConfigResponse, ValueType } from "./types";

// ---- HTTP API Client ----

export interface ClientOptions {
  jwt?: string;
  sdkKey?: string;
  apiUrl: string;
  clientIdentifier: string;
  log?: (category: string | unknown, message?: unknown) => void;
}

/**
 * Minimal HTTP client for the Quonfig REST API.
 * Used by the CLI for CRUD operations (create, set-default, download, etc.).
 */
export class Client {
  private jwt?: string;
  private sdkKey?: string;
  private apiUrl: string;
  private clientIdentifier: string;
  private log: (category: string | unknown, message?: unknown) => void;

  constructor(options: ClientOptions) {
    this.jwt = options.jwt;
    this.sdkKey = options.sdkKey;
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.clientIdentifier = options.clientIdentifier;
    this.log = options.log ?? (() => {});
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Version": this.clientIdentifier,
    };

    if (this.jwt) {
      h["Authorization"] = `Bearer ${this.jwt}`;
    } else if (this.sdkKey) {
      // Match Transport.getAuthHeader: base64("1:{sdkKey}"). api-delivery and
      // api-telemetry both split on the first colon; sending base64(sdkKey)
      // alone yields no colon and api-telemetry returns 401.
      h["Authorization"] = `Basic ${Buffer.from(`1:${this.sdkKey}`).toString("base64")}`;
    }

    return h;
  }

  async get(path: string): Promise<Response> {
    const url = `${this.apiUrl}${path}`;
    this.log("ApiClient", `GET ${url}`);
    return fetch(url, { method: "GET", headers: this.headers() });
  }

  async post(path: string, payload: unknown): Promise<Response> {
    const url = `${this.apiUrl}${path}`;
    const isORPC = path.startsWith("/api/v1/");
    this.log("ApiClient", `POST ${url}`);
    // oRPC endpoints use a wire format: request wrapped as { json: <payload> }
    const body = isORPC ? JSON.stringify({ json: payload }) : JSON.stringify(payload);
    const raw = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    if (!isORPC) return raw;
    // Unwrap oRPC response envelope: { json: <result> } → <result>
    const text = await raw.text();
    let unwrapped = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "json" in parsed) {
        unwrapped = JSON.stringify(parsed.json);
      }
    } catch {
      // not JSON, pass through
    }
    return new Response(unwrapped, {
      status: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
    });
  }

  async put(path: string, payload: unknown): Promise<Response> {
    const url = `${this.apiUrl}${path}`;
    this.log("ApiClient", `PUT ${url}`);
    return fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
  }
}

// ---- SDK Key Parsing ----

export interface ProjectEnvId {
  id: string;
  projectId: number;
}

/**
 * Parse a Prefab/Quonfig SDK key to extract the project-environment ID.
 * SDK keys are typically in the format: `<projectId>-<envId>-<secret>`
 */
export function getProjectEnvFromSdkKey(sdkKey: string): ProjectEnvId {
  const parts = sdkKey.split("-");

  if (parts.length < 2) {
    throw new Error(`Invalid SDK key format: cannot extract projectEnvId`);
  }

  return {
    id: parts.slice(0, 2).join("-"),
    projectId: Number.parseInt(parts[0], 10) || 0,
  };
}

// ---- Legacy ConfigValue / ConfigValueType ----

/**
 * ConfigValueType enum, matching the legacy quonfig-common types.
 * Used by the CLI's coerce and config-value-dto utilities.
 */
export enum ConfigValueType {
  NotSetValue = 0,
  Int = 1,
  String = 2,
  Bytes = 3,
  Double = 4,
  Bool = 5,
  // 6 was WeightedValues in Prefab
  // 7 was LimitDefinition in Prefab
  LimitDefinition = 7,
  LogLevel = 8,
  StringList = 9,
  IntRange = 10,
  Duration = 11,
  Json = 12,
}

/**
 * ConfigValue represents a typed value in the legacy format.
 * Used by the CLI for constructing API request payloads.
 */
export interface ConfigValue {
  int?: bigint | number;
  string?: string;
  bytes?: Uint8Array;
  double?: number;
  bool?: boolean;
  logLevel?: string;
  stringList?: { values: string[] };
  intRange?: { start?: number; end?: number };
  duration?: { definition?: string; millis?: number };
  json?: { json: string };
  provided?: { source: string; lookup: string };
  confidential?: boolean;
  decryptWith?: string;
}

// ---- valueTypeStringForConfig ----

/**
 * Extract the value-type string for a ConfigResponse (e.g., "bool", "string", "int").
 * Used by the CLI's `serve` command to format evaluation responses.
 */
export function valueTypeStringForConfig(config: ConfigResponse): ValueType | undefined {
  return config.valueType;
}
