import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

function makeEnvelope(version: string): ConfigEnvelope {
  return {
    meta: { version, environment: "Production" },
    configs: [],
  };
}

function mockFetchOk(envelope: ConfigEnvelope): Promise<Response> {
  return Promise.resolve({
    status: 200,
    ok: true,
    headers: { get: (name: string) => (name === "ETag" ? '"etag-v1"' : null) },
    json: () => Promise.resolve(envelope),
    text: () => Promise.resolve(""),
  } as any);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Transport fetch URL — cache-buster gating", () => {
  it("adds distinct cache-buster params across polls in development mode", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");

    const capturedUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      capturedUrls.push(url.toString());
      return mockFetchOk(makeEnvelope("v1"));
    });

    const transport = new Transport(["https://api.example.com"], "test-key");
    await transport.fetchConfigs();
    vi.advanceTimersByTime(1);
    await transport.fetchConfigs();

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).toMatch(/\?_=\d+/);
    expect(capturedUrls[1]).toMatch(/\?_=\d+/);
    expect(capturedUrls[0]).not.toBe(capturedUrls[1]);
  });

  it("sends X-Quonfig-SDK-Version sourced from package.json", async () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
      version: string;
    };
    let captured: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      captured = new Headers(init?.headers as HeadersInit);
      return mockFetchOk(makeEnvelope("v1"));
    });

    const transport = new Transport(["https://api.example.com"], "test-key");
    await transport.fetchConfigs();

    expect(captured?.get("X-Quonfig-SDK-Version")).toBe(`node-${pkg.version}`);
  });

  it("omits cache-buster in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const capturedUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      capturedUrls.push(url.toString());
      return mockFetchOk(makeEnvelope("v1"));
    });

    const transport = new Transport(["https://api.example.com"], "test-key");
    await transport.fetchConfigs();
    await transport.fetchConfigs();

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).not.toMatch(/\?_=/);
    expect(capturedUrls[1]).not.toMatch(/\?_=/);
    expect(capturedUrls[0]).toBe(capturedUrls[1]);
  });
});

describe("Transport.postTelemetry — abort-on-timeout", () => {
  it("passes an AbortSignal so a hung telemetry endpoint cannot stall close()", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    // Simulate a server that never responds: the only way this fetch settles
    // is via the abort signal. Without the timeout signal the promise hangs,
    // which is exactly the close()/afterEach flake we're fixing.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      capturedSignal = (init as RequestInit | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError"))
          );
        }
      });
    });

    const transport = new Transport(["https://api.example.com"], "test-key");

    // Must resolve promptly even though the endpoint never responds — the
    // timeout aborts the request and postTelemetry swallows the abort.
    await expect(
      transport.postTelemetry({ instanceHash: "h", events: [] })
    ).resolves.toBeUndefined();

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  }, 15000);
});
