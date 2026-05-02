import * as http from "node:http";
import * as net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Transport } from "../src/transport";

function startTLSBrokenServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      // Close immediately — simulates SSL_ERROR_SYSCALL / TLS handshake failure.
      socket.destroy();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}

function startHealthyHttpServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/v2/configs")) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          ETag: '"etag-real-1"',
        });
        res.end(
          JSON.stringify({
            meta: { version: "real-v1", environment: "Production" },
            configs: [],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}

describe("Transport URL fallback against real broken-TLS endpoint", () => {
  let brokenSecure: { port: number; close: () => void };
  let healthy: { port: number; close: () => void };

  beforeEach(async () => {
    brokenSecure = await startTLSBrokenServer();
    healthy = await startHealthyHttpServer();
  });

  afterEach(() => {
    brokenSecure.close();
    healthy.close();
  });

  it("falls through from a TLS-broken first URL to a healthy second URL", async () => {
    const transport = new Transport(
      [
        `https://127.0.0.1:${brokenSecure.port}`,
        `http://127.0.0.1:${healthy.port}`,
      ],
      "test-key",
    );

    const result = await transport.fetchConfigs();
    expect(result.notChanged).toBe(false);
    expect(result.envelope?.meta.version).toBe("real-v1");
  });

  it("falls through when ONLY the broken URL is configured (no fallback) — surfaces a transport error", async () => {
    const transport = new Transport(
      [`https://127.0.0.1:${brokenSecure.port}`],
      "test-key",
    );
    await expect(transport.fetchConfigs()).rejects.toThrow();
  });
});
