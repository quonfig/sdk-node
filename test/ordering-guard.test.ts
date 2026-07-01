import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";

/**
 * Reject-older install guard — the canonical-ordering proof (bead qfg-7h5d.1.7,
 * mirrors chaos scenarios o02/o03/o04). Install only if the incoming
 * Meta.generation advances the held generation: a fresh client seeds off
 * whatever arrives first, an established client never regresses to an older
 * payload, a same-generation snapshot is a no-op.
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("reject-older install guard (o02 secondary-older)", () => {
  it("an established client never regresses to an older failover payload", async () => {
    let primaryDead = false;

    const primary = http.createServer((_req, res) => {
      if (primaryDead) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("primary refused");
        return;
      }
      res.writeHead(200, { ETag: '"primary-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const secondary = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"secondary-41"', "Content-Type": "application/json" });
      res.end(envelopeJSON(41));
    });

    const primaryUrl = await listen(primary);
    const secondaryUrl = await listen(secondary);

    const client = makeClient([primaryUrl, secondaryUrl]);
    try {
      await client.init();
      // Establishes on the primary's newer generation.
      expect(client.heldGeneration()).toBe(42);
      expect(client.resolvedFrom()).toBe("primary");

      // Primary goes dark; every refresh now fails over to the secondary's
      // OLDER gen 41. The reject-older guard must keep the client on 42.
      primaryDead = true;
      for (let i = 0; i < 5; i++) await refresh(client);

      expect(client.heldGeneration()).toBe(42);
      // resolvedFrom() must not flip — the older leg was rejected, not installed.
      expect(client.resolvedFrom()).toBe("primary");
    } finally {
      await client.close().catch(() => {});
    }
  });
});

describe("install-guard carve-out: established client installs an unversioned snapshot (gen <= 0)", () => {
  it("an established client at gen 42 installs an incoming gen<=0 payload instead of freezing", async () => {
    // The server starts on a real positive generation, then flips to
    // unversioned payloads. Distinct ETags per phase so the bumped body is
    // never masked as a 304 by the transport's per-leg If-None-Match slot.
    let body = envelopeJSON(42);
    let etag = '"gen-42"';

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      res.end(body);
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      // Established on a real positive generation.
      expect(client.heldGeneration()).toBe(42);
      const establishedInstalls = client.configInstallCount();
      expect(establishedInstalls).toBeGreaterThan(0);

      // An unversioned snapshot arrives (generation 0 — a server that predates
      // the generation watermark). It carries no ordering info, so the guard
      // must NOT reject it as "older": the established client installs it
      // (held falls to 0, install count advances) rather than freezing on 42.
      body = envelopeJSON(0);
      etag = '"gen-0"';
      await refresh(client);
      expect(client.configInstallCount()).toBe(establishedInstalls + 1);
      expect(client.heldGeneration()).toBe(0);

      // A payload with NO meta.generation field at all is equally unversioned
      // (generation ?? 0 → 0) and also installs via the same carve-out.
      body = JSON.stringify({
        configs: [],
        meta: { version: "no-generation", environment: "Production" },
      });
      etag = '"no-generation"';
      await refresh(client);
      expect(client.configInstallCount()).toBe(establishedInstalls + 2);
      expect(client.heldGeneration()).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });
});

describe("install guard heals forward and seeds (o03/o04)", () => {
  it("seeds off the older snapshot, no-ops on same generation, heals forward to newer", async () => {
    let gen = 41; // fresh client seeds off the older snapshot first

    const server = http.createServer((_req, res) => {
      // Distinct ETag per generation so a bumped generation isn't masked as a
      // 304 by the transport's shared If-None-Match.
      res.writeHead(200, { ETag: `"gen-${gen}"`, "Content-Type": "application/json" });
      res.end(envelopeJSON(gen));
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(41);
      const seedInstalls = client.configInstallCount();

      // Same generation served again (304 → no install; guard would also reject).
      for (let i = 0; i < 3; i++) await refresh(client);
      expect(client.configInstallCount()).toBe(seedInstalls);
      expect(client.heldGeneration()).toBe(41);

      // A newer generation lands: heal forward to 42 (reject-older only blocks
      // going backward).
      gen = 42;
      await refresh(client);
      expect(client.heldGeneration()).toBe(42);
    } finally {
      await client.close().catch(() => {});
    }
  });
});
