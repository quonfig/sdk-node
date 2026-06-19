import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";

/**
 * Per-URL config-fetch timeout — the hang-failover proof (bead qfg-7h5d.1.7,
 * mirrors chaos scenario f02-primary-hang). The primary leg accepts the TCP
 * connection but never responds; with a per-URL deadline the primary attempt
 * aborts fast and the SDK resolves off the secondary, well inside the much
 * larger initTimeout budget.
 *
 * Revert check: delete the `AbortSignal.timeout(this.fetchTimeoutMs)` wiring in
 * Transport.fetchConfigs and the hung primary blocks until the 10s initTimeout —
 * init() rejects with "Initialization timed out" and the resolvedFrom()==='secondary'
 * assertion is never reached. So the test fails iff the per-URL mechanism is absent.
 */

function envelopeJSON(generation: number): string {
  return JSON.stringify({
    configs: [],
    meta: { version: `gen-${generation}`, environment: "Production", generation },
  });
}

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("per-URL config-fetch timeout (f02 hang-failover)", () => {
  it("fails over to the secondary fast when the primary hangs", async () => {
    // Primary: accept the connection, never send a response (hang).
    const hung = new Set<http.ServerResponse>();
    const primary = http.createServer((_req, res) => {
      hung.add(res); // hold it open; never end()
    });
    // Secondary: respond immediately with a valid envelope.
    const secondary = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"secondary-v1"', "Content-Type": "application/json" });
      res.end(envelopeJSON(7));
    });

    const primaryUrl = await listen(primary);
    const secondaryUrl = await listen(secondary);

    const client = new Quonfig({
      sdkKey: "test-backend-key",
      apiUrls: [primaryUrl, secondaryUrl],
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      onNoDefault: "ignore",
      // Per-URL deadline well below initTimeout: the hung primary aborts at
      // ~400ms, leaving ample budget to reach the secondary.
      configFetchTimeoutMs: 400,
      initTimeout: 10000,
    });

    const start = Date.now();
    await client.init();
    const elapsed = Date.now() - start;

    try {
      expect(client.ready()).toBe(true);
      // Resolved off the secondary leg, not the hung primary.
      expect(client.resolvedFrom()).toBe("secondary");
      expect(client.heldGeneration()).toBe(7);
      // Did NOT wait for the 10s init timeout — the per-URL deadline bounded the
      // hung primary. Generous ceiling to stay non-flaky on slow CI.
      expect(elapsed).toBeLessThan(3000);
    } finally {
      // Release the hung primary sockets so close() doesn't linger.
      for (const res of hung) res.destroy();
      await client.close().catch(() => {});
    }
  });
});
