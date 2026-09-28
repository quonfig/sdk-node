import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";

/**
 * Reject-older install guard — the canonical-ordering proof (bead qfg-7h5d.1.7,
 * mirrors chaos scenarios o02/o03/o04). Install only if the incoming
 * Meta.generation advances the held generation: a fresh client seeds off
 * whatever arrives first, an established client never regresses to an older
 * payload, a same-generation snapshot is a no-op. An unversioned (gen<=0)
 * payload installs only while the client has never held a real generation
 * (qfg-9dxb.9).
 */

function envelopeJSON(generation: number): string {
  return JSON.stringify({
    configs: [],
    meta: { version: `gen-${generation}`, environment: "Production", generation },
  });
}

function flagEnvelope(value: boolean, meta: Record<string, unknown>): Record<string, unknown> {
  return {
    meta,
    configs: [
      {
        id: "flag-1",
        key: "build.dark-mode",
        type: "feature_flag",
        valueType: "bool",
        sendToClientSdk: false,
        default: {
          rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value } }],
        },
      },
    ],
  };
}

function flagJSON(value: boolean, generation: number): string {
  return JSON.stringify(
    flagEnvelope(value, {
      version: `gen-${generation}-${value}`,
      environment: "Production",
      generation,
    })
  );
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

describe("install guard: a gen<=0 payload never overrides a held real generation (qfg-9dxb.9)", () => {
  it("holds gen N (NEW) against a gen-0 (OLD) payload, and a gen-N re-delivery stays NEW", async () => {
    // Distinct ETags per phase so each body is served as a full 200 and never
    // masked as a 304 by the transport's per-leg If-None-Match slot.
    let body = flagJSON(true, 42);
    let etag = '"gen-42"';

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      res.end(body);
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      const establishedInstalls = client.configInstallCount();

      // Gen 0 today only comes from a server whose git object store is damaged
      // (rev-count failed). It must not move the client back to OLD content.
      body = flagJSON(false, 0);
      etag = '"gen-0"';
      await refresh(client);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.configInstallCount()).toBe(establishedInstalls);
      expect(client.heldGeneration()).toBe(42);

      // A payload with NO meta.generation field is equally unversioned.
      body = JSON.stringify(
        flagEnvelope(false, { version: "no-generation", environment: "Production" })
      );
      etag = '"no-generation"';
      await refresh(client);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.configInstallCount()).toBe(establishedInstalls);

      // The healthy gen N re-delivered: still NEW (never stuck on OLD).
      body = flagJSON(true, 42);
      etag = '"gen-42-again"';
      await refresh(client);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.heldGeneration()).toBe(42);

      // A newer versioned snapshot still heals forward.
      body = flagJSON(false, 43);
      etag = '"gen-43"';
      await refresh(client);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(false);
      expect(client.heldGeneration()).toBe(43);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("a client that has only ever seen gen 0 installs each gen-0 payload", async () => {
    let body = flagJSON(true, 0);
    let etag = '"gen-0-a"';

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      res.end(body);
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(0);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      const seedInstalls = client.configInstallCount();

      body = flagJSON(false, 0);
      etag = '"gen-0-b"';
      await refresh(client);
      expect(client.configInstallCount()).toBe(seedInstalls + 1);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(false);

      body = flagJSON(true, 0);
      etag = '"gen-0-c"';
      await refresh(client);
      expect(client.configInstallCount()).toBe(seedInstalls + 2);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.heldGeneration()).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("an ignored gen-0 200 does not leave its ETag behind to mask the same sha's repaired generation", async () => {
    // api-delivery's ETag is the git sha. A machine can serve sha B at gen 0
    // (damaged rev-count) and later repair the generation for the SAME sha, so
    // the ETag does not change. If the ignored gen-0 response's ETag were kept,
    // every later poll would 304 and the client would stay on A until the next
    // commit.
    let state = { sha: '"sha-A"', value: true, generation: 5 };
    const ifNoneMatch: (string | undefined)[] = [];

    const server = http.createServer((req, res) => {
      const inm = req.headers["if-none-match"];
      ifNoneMatch.push(inm);
      if (inm === state.sha) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { ETag: state.sha, "Content-Type": "application/json" });
      res.end(flagJSON(state.value, state.generation));
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(5);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);

      // Commit B served at gen 0: ignored, client stays on A.
      state = { sha: '"sha-B"', value: false, generation: 0 };
      await refresh(client);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.heldGeneration()).toBe(5);

      // Same sha B, generation repaired to 6.
      state = { sha: '"sha-B"', value: false, generation: 6 };
      await refresh(client);
      expect(client.heldGeneration()).toBe(6);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(false);

      // The accepted 200 still stores its ETag: the next poll is conditional
      // on sha B and answered 304.
      await refresh(client);
      expect(ifNoneMatch[ifNoneMatch.length - 1]).toBe('"sha-B"');
      expect(client.heldGeneration()).toBe(6);
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
