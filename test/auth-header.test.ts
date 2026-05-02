import { afterEach, describe, expect, it, vi } from "vitest";

import { Client } from "../src/cli-compat";
import { Transport } from "../src/transport";

const KEY = "qf_sk_development_0044_c2082147b45b8815";
const expectedHeader = `Basic ${Buffer.from(`1:${KEY}`).toString("base64")}`;

const fetchOk = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    text: () => Promise.resolve(""),
    json: () => Promise.resolve({}),
  } as unknown as Response);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth header consistency", () => {
  it("Transport.postTelemetry sends Basic base64('1:KEY') (matches api-telemetry's user:key shape)", async () => {
    let captured: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      captured = new Headers(init?.headers as HeadersInit);
      return fetchOk();
    });

    const transport = new Transport(["https://api.example.com"], KEY);
    await transport.postTelemetry({ instanceHash: "abc", events: [] });

    expect(captured?.get("Authorization")).toBe(expectedHeader);
  });

  it("ApiClient (Client) sends Basic base64('1:KEY') so api-telemetry accepts the auth", async () => {
    let captured: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      captured = new Headers(init?.headers as HeadersInit);
      return fetchOk();
    });

    const client = new Client({
      sdkKey: KEY,
      apiUrl: "https://api.example.com",
      clientIdentifier: "test/0.0.0",
    });
    await client.get("/api/v1/telemetry/");

    expect(captured?.get("Authorization")).toBe(expectedHeader);
  });
});
