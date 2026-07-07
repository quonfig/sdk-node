import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { ConfigEnvelope } from "../src/types";

/**
 * Refresh-liveness stamp (qfg-41nh.11, mirrors sdk-go's refresh_liveness_test.go).
 *
 * lastSuccessfulRefresh() is a LIVENESS signal, not an install counter. A fetch
 * that completes successfully at the HTTP layer — 200 installed, 200 rejected
 * by the reject-older guard as equal-or-older, or 304 Not Modified — proves the
 * config source is reachable and the held config current, so it must advance
 * the stamp. Transport errors must not. A received-and-processed SSE message
 * stamps whether it installs or is a guard no-op. Without this a healthy
 * long-lived client parked on 304s under-reports liveness (the stamp freezes
 * even though every fetch succeeds).
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

function makeClient(apiUrls: string[]): Quonfig {
  return new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls,
    enableSSE: false,
    fallbackPollEnabled: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    initTimeout: 5000,
  });
}

/** Force a single refresh through the real fetch+guard install path. */
async function refresh(client: Quonfig): Promise<void> {
  await (client as unknown as { fetchAndInstall(): Promise<void> }).fetchAndInstall();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("refresh liveness stamp (qfg-41nh.11)", () => {
  it("stamps on the init install and again on a 304 Not Modified (no re-install)", async () => {
    const server = http.createServer((req, res) => {
      // Honor the conditional request: a matching If-None-Match is a real 304.
      if (req.headers["if-none-match"] === '"gen-42"') {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      const first = client.lastSuccessfulRefresh();
      expect(first).toBeInstanceOf(Date);
      const installs = client.configInstallCount();

      await sleep(5);
      await refresh(client); // answered 304 Not Modified

      const second = client.lastSuccessfulRefresh();
      expect(second!.getTime()).toBeGreaterThan(first!.getTime());
      // A 304 must not re-install or move the held config.
      expect(client.configInstallCount()).toBe(installs);
      expect(client.heldGeneration()).toBe(42);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("stamps on a guard-rejected 200 failover (fetch succeeded, install was a no-op)", async () => {
    let primaryDead = false;
    const primary = http.createServer((_req, res) => {
      if (primaryDead) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("primary refused");
        return;
      }
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    // The secondary varies its ETag per request so every fetch is a full 200
    // (never a 304): isolate the guard-rejected path.
    let secReq = 0;
    const secondary = http.createServer((_req, res) => {
      secReq++;
      res.writeHead(200, { ETag: `"gen-41-${secReq}"`, "Content-Type": "application/json" });
      res.end(envelopeJSON(41));
    });
    const primaryUrl = await listen(primary);
    const secondaryUrl = await listen(secondary);

    const client = makeClient([primaryUrl, secondaryUrl]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      const installs = client.configInstallCount();
      const first = client.lastSuccessfulRefresh();

      // Primary goes dark; the refresh fails over to the secondary's OLDER gen
      // 41, which the reject-older guard drops — but the fetch itself succeeded.
      primaryDead = true;
      await sleep(5);
      await refresh(client);

      const second = client.lastSuccessfulRefresh();
      expect(second!.getTime()).toBeGreaterThan(first!.getTime());
      // The stamp must NOT come from an install: held config and install count
      // are unchanged (the older payload was rejected).
      expect(client.configInstallCount()).toBe(installs);
      expect(client.heldGeneration()).toBe(42);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("does NOT stamp when every leg fails (errors are not liveness)", async () => {
    let dead = false;
    const server = http.createServer((_req, res) => {
      if (dead) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("gone");
        return;
      }
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      const first = client.lastSuccessfulRefresh();
      expect(first).toBeInstanceOf(Date);

      dead = true;
      await sleep(5);
      await expect(refresh(client)).rejects.toBeTruthy();

      // A failed refresh must leave the stamp exactly where it was.
      expect(client.lastSuccessfulRefresh()!.getTime()).toBe(first!.getTime());
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("stamps on a received SSE message even when the reject-older guard drops it (no re-install)", async () => {
    // No network: drive the SSE envelope sink directly (the sink for every
    // parsed SSE message). A fresh client seeds off the first message; a
    // same-generation repeat is a guard no-op that must still advance liveness.
    const client = makeClient(["https://example.test"]);
    const drive = (
      client as unknown as { handleSSEEnvelope(env: ConfigEnvelope): void }
    ).handleSSEEnvelope.bind(client);
    try {
      const env42 = JSON.parse(envelopeJSON(42)) as ConfigEnvelope;

      drive(env42); // fresh client → installs → stamps
      const first = client.lastSuccessfulRefresh();
      expect(first).toBeInstanceOf(Date);
      const installs = client.configInstallCount();

      await sleep(5);
      drive(env42); // same generation → guard no-op, but message was received
      const second = client.lastSuccessfulRefresh();
      expect(second!.getTime()).toBeGreaterThan(first!.getTime());
      expect(client.configInstallCount()).toBe(installs);
    } finally {
      await client.close().catch(() => {});
    }
  });
});
