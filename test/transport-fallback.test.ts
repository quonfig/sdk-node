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
});

describe("Transport URL fallback on transport-layer errors", () => {
  it("falls through to the next URL when the first throws a TLS / connection error", async () => {
    const visited: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const u = url.toString();
      visited.push(u);
      if (u.startsWith("https://primary.example.com")) {
        // Mirror what undici throws on TLS/connection failures: a TypeError
        // wrapping the underlying Node error.
        const cause = Object.assign(new Error("SSL_ERROR_SYSCALL"), {
          code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
        });
        return Promise.reject(Object.assign(new TypeError("fetch failed"), { cause }));
      }
      return mockFetchOk(makeEnvelope("v1"));
    });

    const transport = new Transport(
      ["https://primary.example.com", "https://secondary.example.com"],
      "test-key"
    );

    const result = await transport.fetchConfigs();

    expect(result.notChanged).toBe(false);
    expect(result.envelope?.meta.version).toBe("v1");
    expect(visited).toEqual([
      "https://primary.example.com/api/v2/configs",
      "https://secondary.example.com/api/v2/configs",
    ]);
    expect(transport["activeBaseUrl"]).toBe("https://secondary.example.com");
  });

  it("falls through on raw ECONNRESET-style rejections (no TypeError wrapper)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().startsWith("https://primary.")) {
        const err = Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        });
        return Promise.reject(err);
      }
      return mockFetchOk(makeEnvelope("v2"));
    });

    const transport = new Transport(
      ["https://primary.example.com", "https://secondary.example.com"],
      "test-key"
    );
    const result = await transport.fetchConfigs();
    expect(result.envelope?.meta.version).toBe("v2");
  });

  it("propagates the last transport error when every URL fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const err = Object.assign(new Error(`ECONNRESET ${url}`), {
        code: "ECONNRESET",
      });
      return Promise.reject(err);
    });

    const transport = new Transport(
      ["https://primary.example.com", "https://secondary.example.com"],
      "test-key"
    );

    await expect(transport.fetchConfigs()).rejects.toThrow(/ECONNRESET/);
  });
});
