import * as http from "node:http";
import * as net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SSEConnection, type SSEConnectionState } from "../src/sse";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

interface LiveSSEServer {
  port: number;
  /** Emit one envelope to every currently-connected client. */
  emit: (envelope: ConfigEnvelope) => void;
  /** Forcibly close every active SSE response, simulating a network drop. */
  dropAll: () => void;
  /** Headers seen on each incoming SSE request, in arrival order. */
  observedHeaders: http.IncomingHttpHeaders[];
  close: () => Promise<void>;
}

function startSSEServer(): Promise<LiveSSEServer> {
  return new Promise((resolve) => {
    const clients: http.ServerResponse[] = [];
    const sockets = new Set<net.Socket>();
    const observedHeaders: http.IncomingHttpHeaders[] = [];

    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/v2/sse/config")) {
        observedHeaders.push(req.headers);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        // Send a comment line to flush headers and signal the stream is open.
        res.write(": connected\n\n");
        clients.push(res);
        req.on("close", () => {
          const idx = clients.indexOf(res);
          if (idx >= 0) clients.splice(idx, 1);
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        observedHeaders,
        emit: (envelope) => {
          const payload = `data: ${JSON.stringify(envelope)}\n\n`;
          for (const c of clients) c.write(payload);
        },
        dropAll: () => {
          for (const sock of sockets) sock.destroy();
          sockets.clear();
          clients.length = 0;
        },
        close: () =>
          new Promise<void>((r) => {
            for (const sock of sockets) sock.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

function envelope(version: string): ConfigEnvelope {
  return { meta: { version, environment: "Production" }, configs: [] };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 25
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

describe("SSEConnection — live-server smoke test", () => {
  let srv: LiveSSEServer;

  beforeEach(async () => {
    srv = await startSSEServer();
  });

  afterEach(async () => {
    await srv.close();
  });

  it("connects to a real SSE endpoint, receives an envelope, reconnects after a drop, and reports state transitions", async () => {
    const transport = new Transport(["http://127.0.0.1"], "test-key");
    // Reach into the same private test hook used elsewhere to point the SSE URL
    // at our local server.
    (transport as any).__testStreamUrlOverride = `http://127.0.0.1:${srv.port}/api/v2/sse/config`;

    const received: ConfigEnvelope[] = [];
    const states: SSEConnectionState[] = [];
    const sse = new SSEConnection(transport, undefined, {
      onConnectionStateChange: (s) => states.push(s),
    });

    sse.start((env) => received.push(env));

    // Wait for the eventsource library to dynamic-import + connect + onopen.
    await waitFor(() => states.includes("connected"), 5000);

    // Push the first envelope; assert delivery.
    srv.emit(envelope("v1"));
    await waitFor(() => received.some((e) => e.meta.version === "v1"), 2000);

    // Drop the connection at the socket level. The eventsource library should
    // surface onerror and then auto-reconnect.
    srv.dropAll();
    await waitFor(() => states.includes("error"), 5000);

    // Wait for the library's reconnect to land; default reconnect delay is
    // ~3s in v3. Bump timeout to be safe in CI.
    await waitFor(
      () => states.filter((s) => s === "connected").length >= 2,
      15_000
    );

    // After reconnect, the server should still be able to deliver new events.
    srv.emit(envelope("v2"));
    await waitFor(() => received.some((e) => e.meta.version === "v2"), 5000);

    sse.close();
    expect(states).toContain("disconnected");
    expect(received.map((e) => e.meta.version)).toContain("v1");
    expect(received.map((e) => e.meta.version)).toContain("v2");
  }, 30_000);

  it("sends the SDK-key Basic auth header on the SSE request", async () => {
    const sdkKey = "test-key";
    const transport = new Transport(["http://127.0.0.1"], sdkKey);
    (transport as any).__testStreamUrlOverride = `http://127.0.0.1:${srv.port}/api/v2/sse/config`;

    const states: SSEConnectionState[] = [];
    const sse = new SSEConnection(transport, undefined, {
      onConnectionStateChange: (s) => states.push(s),
    });

    sse.start(() => {});
    await waitFor(() => states.includes("connected"), 5000);

    const expected = "Basic " + Buffer.from(`1:${sdkKey}`).toString("base64");
    expect(srv.observedHeaders.length).toBeGreaterThan(0);
    expect(srv.observedHeaders[0].authorization).toBe(expected);
    expect(srv.observedHeaders[0]["x-quonfig-sdk-version"]).toMatch(/^node-/);

    sse.close();
  }, 15_000);
});
