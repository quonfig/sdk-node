import { afterEach, describe, expect, it, vi } from "vitest";

import { Transport, deriveStreamUrl } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deriveStreamUrl", () => {
  it("prepends 'stream.' to a production-style https hostname", () => {
    expect(deriveStreamUrl("https://primary.quonfig.com")).toBe(
      "https://stream.primary.quonfig.com"
    );
  });

  it("prepends 'stream.' to localhost, preserving scheme and port", () => {
    expect(deriveStreamUrl("http://localhost:8080")).toBe(
      "http://stream.localhost:8080"
    );
  });

  it("preserves non-root paths", () => {
    expect(deriveStreamUrl("https://api.example.com/some/path")).toBe(
      "https://stream.api.example.com/some/path"
    );
  });

  it("preserves explicit ports on non-default schemes", () => {
    expect(deriveStreamUrl("https://api.example.com:8443")).toBe(
      "https://stream.api.example.com:8443"
    );
  });

  it("strips a trailing slash to match apiUrl normalization", () => {
    expect(deriveStreamUrl("https://primary.quonfig.com/")).toBe(
      "https://stream.primary.quonfig.com"
    );
  });

  it("works for the secondary host if one is passed", () => {
    expect(deriveStreamUrl("https://secondary.quonfig.com")).toBe(
      "https://stream.secondary.quonfig.com"
    );
  });
});

function envelopeOk(): ConfigEnvelope {
  return {
    meta: { version: "v1", environment: "Production" },
    configs: [],
  };
}

function mockFetchOk(envelope: ConfigEnvelope): Promise<Response> {
  return Promise.resolve({
    status: 200,
    ok: true,
    headers: { get: () => null },
    json: () => Promise.resolve(envelope),
    text: () => Promise.resolve(""),
  } as any);
}

describe("Transport.getSSEUrl", () => {
  it("derives SSE URL from the primary apiUrl by default", () => {
    const transport = new Transport(["https://primary.quonfig.com"], "test-key");
    expect(transport.getSSEUrl()).toBe(
      "https://stream.primary.quonfig.com/api/v2/sse/config"
    );
  });

  it("tracks the stream URL that corresponds to the successful apiUrl on failover", async () => {
    // First base URL throws; second succeeds. Active stream URL should match
    // whichever apiUrl handled the request.
    const call = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const s = url.toString();
      if (s.startsWith("https://primary.quonfig.com")) {
        return Promise.reject(new Error("boom"));
      }
      return mockFetchOk(envelopeOk());
    });

    const transport = new Transport(
      ["https://primary.quonfig.com", "https://secondary.quonfig.com"],
      "test-key"
    );

    await transport.fetchConfigs();
    expect(call).toHaveBeenCalledTimes(2);
    expect(transport.getSSEUrl()).toBe(
      "https://stream.secondary.quonfig.com/api/v2/sse/config"
    );
  });

  it("honors __testStreamUrlOverride for injected test servers", () => {
    const transport = new Transport(["https://primary.quonfig.com"], "test-key");
    // Reach into private test hook — not part of the public API.
    (transport as any).__testStreamUrlOverride = "http://127.0.0.1:12345";
    expect(transport.getSSEUrl()).toBe("http://127.0.0.1:12345");
  });
});
