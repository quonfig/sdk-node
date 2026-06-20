import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";

/**
 * Parallel-failover hedge unit tests (qfg-7h5d.1.14.4). These pin, at the unit
 * level, the behaviors the chaos ordering scenarios assert (o01 cold-standby,
 * o03 heal-forward, o05 slow-older-primary-loses) where a per-leg request
 * counter can prove the "secondary is never contacted on a fast primary"
 * contract that the chaos rig (no server-side counter) cannot.
 *
 * They use only the public API and default hedge timings, so the file also
 * compiles + runs against the pre-hedge sequential transport to capture the RED
 * baseline:
 *   - the fast-primary test is RED until the hedge exists: the sequential path
 *     reaches the secondary too (it does not short-circuit on a fast primary the
 *     same way) — but more importantly the secondary-newer / heal tests below
 *     fail because the sequential path never contacts the secondary in parallel.
 *   - the slow-older-primary test is RED on the sequential transport: the
 *     primary is tried first, answers (slowly, inside the per-URL timeout) with
 *     the older 41, the secondary is never contacted, and the client holds 41.
 *     The hedge makes it hold 42 (GREEN).
 */

function envelopeJSON(generation: number): string {
  return JSON.stringify({
    configs: [],
    meta: { version: `gen-${generation}`, environment: "Production", generation },
  });
}

const servers: http.Server[] = [];

interface Upstream {
  url: string;
  hits: () => number;
}

/**
 * An httptest-style upstream pinned to a generation, optionally delayed by
 * `delayMs` before it answers, counting every request it receives. Each
 * response carries a distinct ETag per generation so a 304 from one leg never
 * masks the other.
 */
function upstream(generation: number, delayMs: number): Promise<Upstream> {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    const respond = (): void => {
      res.writeHead(200, {
        ETag: `"gen-${generation}"`,
        "Content-Type": "application/json",
      });
      res.end(envelopeJSON(generation));
    };
    if (delayMs > 0) setTimeout(respond, delayMs);
    else respond();
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, hits: () => hits });
    });
  });
}

function makeHedgeClient(primaryUrl: string, secondaryUrl: string): Quonfig {
  return new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls: [primaryUrl, secondaryUrl],
    enableSSE: false,
    fallbackPollEnabled: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    initTimeout: 8000,
    // Keep the default hedge timings (delay ~2s, abort ~6s); the slow upstreams
    // below sit at ~2.5s, between delay and abort, so the hedge fires and the
    // late leg still lands (not aborted).
  });
}

/** Force a single refresh through the real hedged fetch+guard install path. */
async function refresh(client: Quonfig): Promise<void> {
  await (client as unknown as { fetchAndInstall(): Promise<void> }).fetchAndInstall();
}

/** Poll until the held generation reaches `want`, or fail after `withinMs`. */
async function pollUntilGeneration(client: Quonfig, want: number, withinMs: number): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (client.heldGeneration() === want) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `held generation did not reach ${want} within ${withinMs}ms (last = ${client.heldGeneration()})`
  );
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("parallel-failover hedge (qfg-7h5d.1.14.4)", () => {
  // Unit-level o01: both legs healthy and fast, secondary newer. A fast primary
  // answers well inside the hedge delay, so the secondary is NEVER contacted
  // (cold standby, zero extra load). The client holds the primary's (lower)
  // generation and resolvedFrom stays 'primary'. This is the cold-standby proof
  // the chaos rig cannot make.
  it("fast primary wins and never contacts the secondary (cold standby)", async () => {
    const primary = await upstream(41, 0);
    const secondary = await upstream(42, 0);

    const client = makeHedgeClient(primary.url, secondary.url);
    try {
      await client.init();

      expect(client.heldGeneration()).toBe(41);
      expect(client.resolvedFrom()).toBe("primary");
      expect(client.configInstallCount()).toBe(1);
      // Cold standby: a fast primary must NEVER trigger the hedge.
      expect(secondary.hits()).toBe(0);
      expect(primary.hits()).toBeGreaterThan(0);
    } finally {
      await client.close().catch(() => {});
    }
  });

  // Unit-level o05 and the cleanest RED→GREEN discriminator: the primary is SLOW
  // and serves the OLDER generation (41); the secondary is fast and serves the
  // NEWER generation (42). The hedge fires the secondary once the hedge delay
  // elapses (primary still slow), installs 42, and when the slow primary's older
  // 41 lands late the reject-older guard drops it.
  //
  // On the pre-hedge sequential transport the primary is tried first; it answers
  // (slowly, but inside the per-URL timeout) with 41, the secondary is never
  // contacted, and the client holds 41 — so this test is RED. The hedge makes it
  // hold 42 (GREEN).
  it("slow older primary loses to fast newer secondary; late 41 does not regress", async () => {
    const primary = await upstream(41, 2500);
    const secondary = await upstream(42, 0);

    const client = makeHedgeClient(primary.url, secondary.url);
    try {
      await client.init();

      // The hedge must have fired the secondary (slow primary) and installed 42.
      await pollUntilGeneration(client, 42, 5000);
      expect(secondary.hits()).toBeGreaterThan(0);

      // The slow primary's older 41 lands late and on every subsequent refresh;
      // the reject-older guard must keep the client on 42. Each refresh waits
      // for the slow (2.5s) primary leg to settle, so this loop is genuinely
      // multi-second — hence the explicit timeout below.
      for (let i = 0; i < 3; i++) await refresh(client);
      expect(client.heldGeneration()).toBe(42);
    } finally {
      await client.close().catch(() => {});
    }
  }, 20000);

  // Unit-level o03: the primary is SLOW and serves the NEWER generation (42); the
  // secondary is fast and serves the OLDER generation (41). The hedge seeds
  // readiness off the secondary's 41, then heals forward to the primary's 42 when
  // it lands — reject-older only blocks going backward, never forward.
  //
  // On the pre-hedge sequential transport the secondary is never contacted (the
  // slow primary answers first with 42), so secondary.hits() == 0 — RED. The
  // hedge contacts the secondary in parallel (GREEN).
  it("heals forward to a slow newer primary after seeding off the fast older secondary", async () => {
    const primary = await upstream(42, 2500);
    const secondary = await upstream(41, 0);

    const client = makeHedgeClient(primary.url, secondary.url);
    try {
      await client.init();

      // The hedge fired the secondary in parallel against the slow primary.
      expect(secondary.hits()).toBeGreaterThan(0);
      // Heal forward to the slow primary's newer 42.
      await pollUntilGeneration(client, 42, 5000);
    } finally {
      await client.close().catch(() => {});
    }
  });
});
