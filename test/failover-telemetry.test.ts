import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import { FailoverCollector } from "../src/telemetry/failoverAggregator";
import { TelemetryReporter } from "../src/telemetry/reporter";
import { EvaluationSummaryCollector } from "../src/telemetry/evaluationSummaries";
import { ContextShapeCollector } from "../src/telemetry/contextShapes";
import { ExampleContextCollector } from "../src/telemetry/exampleContexts";
import type { ConfigEnvelope } from "../src/types";

/**
 * Failover telemetry emission (qfg-41nh.18). Mirrors sdk-go's
 * failover_aggregator_test.go + submitter_test.go + the client-level
 * quonfig_failover_telemetry_test.go: the SDK folds failover-behavior counters
 * (hedge-fired / guard-rejected / resolved-from) into the existing periodic
 * telemetry flush, emitting a `failover` event ONLY when at least one counter is
 * non-zero, with the exact camelCase wire keys api-telemetry's Zod schema parses.
 */

// ---- Unit: FailoverCollector ----

describe("FailoverCollector", () => {
  it("returns undefined when no failover activity was recorded", () => {
    const c = new FailoverCollector(true);
    expect(c.drain()).toBeUndefined();
  });

  it("counts, emits the exact camelCase wire shape, and clears", () => {
    const c = new FailoverCollector(true);
    c.recordHedgeFired();
    c.recordHedgeFired();
    c.recordGuardRejected();
    c.recordResolvedFrom(0); // primary
    c.recordResolvedFrom(1); // secondary
    c.recordResolvedFrom(2); // secondary (any index > 0)

    const event = c.drain();
    expect(event).toBeDefined();
    const f = event!.failover!;
    expect(f).toBeDefined();

    // Exact wire keys — api-telemetry's Zod schema + the ClickHouse MV parse
    // these camelCase keys, so drift breaks ingestion silently.
    expect(Object.keys(f).sort()).toEqual([
      "end",
      "guardRejected",
      "hedgeFired",
      "resolvedFromLkg",
      "resolvedFromPrimary",
      "resolvedFromSecondary",
      "start",
    ]);

    expect(f.hedgeFired).toBe(2);
    expect(f.guardRejected).toBe(1);
    expect(f.resolvedFromPrimary).toBe(1);
    expect(f.resolvedFromSecondary).toBe(2);
    expect(f.resolvedFromLkg).toBe(0);
    expect(typeof f.start).toBe("number");
    expect(typeof f.end).toBe("number");
    expect(f.start).toBeGreaterThan(0);
    expect(f.end).toBeGreaterThanOrEqual(f.start);

    // After drain the collector resets: a subsequent empty window is undefined.
    expect(c.drain()).toBeUndefined();
  });

  it("ignores a negative sourceIndex (SSE/datadir install, no HTTP leg)", () => {
    const c = new FailoverCollector(true);
    c.recordResolvedFrom(-1);
    expect(c.drain()).toBeUndefined();
  });

  it("no-ops entirely when disabled (full telemetry opt-out)", () => {
    const c = new FailoverCollector(false);
    c.recordHedgeFired();
    c.recordGuardRejected();
    c.recordResolvedFrom(0);
    c.recordResolvedFrom(1);
    expect(c.drain()).toBeUndefined();
  });
});

// ---- Reporter round-trip: the failover event lands on the wire ----

describe("TelemetryReporter folds the failover event into the periodic flush", () => {
  it("submits a failover event with only-non-zero-window semantics and exact keys", async () => {
    const captured: any[] = [];
    const transport = {
      postTelemetry: async (payload: any) => {
        captured.push(payload);
      },
    } as unknown as Transport;

    const failover = new FailoverCollector(true);
    failover.recordHedgeFired();
    failover.recordGuardRejected();
    failover.recordResolvedFrom(0);
    failover.recordResolvedFrom(1);

    const reporter = new TelemetryReporter({
      transport,
      instanceHash: "test-instance",
      // eval/context collectors present but empty → their drain() is undefined,
      // so the failover event is the only event on the wire.
      evaluationSummaries: new EvaluationSummaryCollector(false),
      contextShapes: new ContextShapeCollector("none"),
      exampleContexts: new ExampleContextCollector("none"),
      failover,
    });

    await reporter.sync();

    expect(captured).toHaveLength(1);
    expect(captured[0].instanceHash).toBe("test-instance");
    const failoverEvent = captured[0].events.find((e: any) => e.failover);
    expect(failoverEvent).toBeDefined();
    expect(failoverEvent.failover.hedgeFired).toBe(1);
    expect(failoverEvent.failover.guardRejected).toBe(1);
    expect(failoverEvent.failover.resolvedFromPrimary).toBe(1);
    expect(failoverEvent.failover.resolvedFromSecondary).toBe(1);
    expect(failoverEvent.failover.resolvedFromLkg).toBe(0);

    // A second sync with no new activity emits nothing (healthy steady state).
    captured.length = 0;
    await reporter.sync();
    expect(captured).toHaveLength(0);
  });
});

// ---- Client-level: real hedge + guard through the fetch/install path ----

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

/** Telemetry-ON client (eval summaries on so the reporter is created). */
function makeClient(apiUrls: string[]): Quonfig {
  return new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls,
    enableSSE: false,
    fallbackPollEnabled: false,
    collectEvaluationSummaries: true,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    initTimeout: 8000,
  });
}

async function refresh(client: Quonfig): Promise<void> {
  await (client as unknown as { fetchAndInstall(): Promise<void> }).fetchAndInstall();
}

function failoverFrom(payloads: any[]): any | undefined {
  for (const p of payloads) {
    for (const ev of p.events ?? []) {
      if (ev.failover) return ev.failover;
    }
  }
  return undefined;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  vi.restoreAllMocks();
});

describe("failover telemetry — client-level (qfg-41nh.18)", () => {
  it("records resolvedFromPrimary on install and guardRejected on a reject-older HTTP payload", async () => {
    let gen = 42;
    let etag = '"gen-42"';
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      res.end(envelopeJSON(gen));
    });
    const url = await listen(server);

    const captured: any[] = [];
    vi.spyOn(Transport.prototype, "postTelemetry").mockImplementation(async (p: any) => {
      captured.push(p);
    });

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      expect(client.resolvedFrom()).toBe("primary");

      // Serve an OLDER generation with a distinct ETag; the reject-older guard
      // drops it — that's a guardRejected on the HTTP path.
      gen = 41;
      etag = '"gen-41"';
      await refresh(client);
      expect(client.heldGeneration()).toBe(42);

      await client.flush();

      const f = failoverFrom(captured);
      expect(f).toBeDefined();
      expect(f.hedgeFired).toBe(0);
      expect(f.guardRejected).toBe(1);
      expect(f.resolvedFromPrimary).toBe(1);
      expect(f.resolvedFromSecondary).toBe(0);
      expect(f.resolvedFromLkg).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("records hedgeFired and resolvedFromSecondary when the primary errors and the hedge serves the secondary", async () => {
    // Primary errors fast (503) → the hedge fires the secondary immediately;
    // the secondary serves gen 42 and installs. fired == 2 → hedgeFired == 1,
    // and the leg that installed was the secondary → resolvedFromSecondary == 1.
    const primary = http.createServer((_req, res) => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("primary down");
    });
    const secondary = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const primaryUrl = await listen(primary);
    const secondaryUrl = await listen(secondary);

    const captured: any[] = [];
    vi.spyOn(Transport.prototype, "postTelemetry").mockImplementation(async (p: any) => {
      captured.push(p);
    });

    const client = makeClient([primaryUrl, secondaryUrl]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      expect(client.resolvedFrom()).toBe("secondary");

      // Let the background hedge drain settle (hedgeFired is recorded once every
      // fired leg settles); both legs answer immediately on localhost.
      await new Promise((r) => setTimeout(r, 250));
      await client.flush();

      const f = failoverFrom(captured);
      expect(f).toBeDefined();
      expect(f.hedgeFired).toBe(1);
      expect(f.resolvedFromSecondary).toBe(1);
      expect(f.resolvedFromPrimary).toBe(0);
      expect(f.resolvedFromLkg).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });
});

// ---- Equal-generation re-delivery is NOT a guard rejection (qfg-rr5b) ----

/**
 * Only a STRICTLY older payload counts as guardRejected (Jeff's cross-SDK
 * decision on qfg-rr5b, 2026-09-11). An EQUAL-generation re-delivery — an SSE
 * reconnect resend, a cold-ETag poll, the fallback poller's engage-time fetch —
 * is a silent no-op: still not installed, still advances liveness exactly where
 * it did before, but NOT counted. `guardRejected` feeds the `sdk_failover`
 * alerting signal, where it must mean "a leg tried to move us backwards".
 */

/** Drive the SSE envelope sink directly (the sink for every parsed SSE message). */
function driveSSE(client: Quonfig, envelope: ConfigEnvelope): void {
  (client as unknown as { handleSSEEnvelope(e: ConfigEnvelope): void }).handleSSEEnvelope(envelope);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("guardRejected counts strictly-older payloads only (qfg-rr5b)", () => {
  it("does NOT count an equal-generation re-delivery on the HTTP fetch path, but still advances liveness", async () => {
    // A fresh ETag on every response makes each fetch a full 200 at the SAME
    // generation — the cold-ETag poll / fallback-poller engage-fetch shape.
    let req = 0;
    const server = http.createServer((_req, res) => {
      req++;
      res.writeHead(200, { ETag: `"gen-42-${req}"`, "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const url = await listen(server);

    const captured: any[] = [];
    vi.spyOn(Transport.prototype, "postTelemetry").mockImplementation(async (p: any) => {
      captured.push(p);
    });

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      const installs = client.configInstallCount();
      const firstStamp = client.lastSuccessfulRefresh();
      expect(firstStamp).toBeInstanceOf(Date);

      // Two same-generation re-deliveries. Both are dropped by the guard.
      await sleep(5);
      await refresh(client);
      await refresh(client);

      // Not installed, held config unmoved...
      expect(client.configInstallCount()).toBe(installs);
      expect(client.heldGeneration()).toBe(42);
      // ...but liveness still advanced, exactly as before (qfg-41nh.11).
      expect(client.lastSuccessfulRefresh()!.getTime()).toBeGreaterThan(firstStamp!.getTime());

      await client.flush();

      const f = failoverFrom(captured);
      expect(f).toBeDefined();
      expect(f.resolvedFromPrimary).toBe(1); // the init install
      expect(f.guardRejected).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("does NOT count an equal-generation SSE re-delivery (reconnect resend), but still advances liveness", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const url = await listen(server);

    const captured: any[] = [];
    vi.spyOn(Transport.prototype, "postTelemetry").mockImplementation(async (p: any) => {
      captured.push(p);
    });

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      const installs = client.configInstallCount();
      const firstStamp = client.lastSuccessfulRefresh();

      // api-delivery's sendInitialConfig re-sends the current envelope on every
      // connect, so every reconnect hands the client the generation it holds.
      const env42 = JSON.parse(envelopeJSON(42)) as ConfigEnvelope;
      await sleep(5);
      driveSSE(client, env42);
      driveSSE(client, env42);

      expect(client.configInstallCount()).toBe(installs);
      expect(client.heldGeneration()).toBe(42);
      expect(client.lastSuccessfulRefresh()!.getTime()).toBeGreaterThan(firstStamp!.getTime());

      await client.flush();

      const f = failoverFrom(captured);
      expect(f).toBeDefined();
      expect(f.resolvedFromPrimary).toBe(1); // the init install; SSE records none
      expect(f.guardRejected).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("DOES count a strictly older SSE payload as guardRejected", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const url = await listen(server);

    const captured: any[] = [];
    vi.spyOn(Transport.prototype, "postTelemetry").mockImplementation(async (p: any) => {
      captured.push(p);
    });

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(42);
      const installs = client.configInstallCount();

      // A stale stream tries to move the client backwards: that IS the thing
      // guardRejected exists to alert on.
      driveSSE(client, JSON.parse(envelopeJSON(41)) as ConfigEnvelope);

      expect(client.configInstallCount()).toBe(installs);
      expect(client.heldGeneration()).toBe(42);

      await client.flush();

      const f = failoverFrom(captured);
      expect(f).toBeDefined();
      expect(f.guardRejected).toBe(1);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("never counts an unversioned (generation <= 0) snapshot — the carve-out installs it", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(envelopeJSON(42));
    });
    const url = await listen(server);

    const captured: any[] = [];
    vi.spyOn(Transport.prototype, "postTelemetry").mockImplementation(async (p: any) => {
      captured.push(p);
    });

    const client = makeClient([url]);
    try {
      await client.init();
      const installs = client.configInstallCount();

      // A pre-watermark server's snapshot carries no ordering information, so
      // the guard can't call it older: it installs, and nothing is counted.
      driveSSE(client, JSON.parse(envelopeJSON(0)) as ConfigEnvelope);
      expect(client.configInstallCount()).toBe(installs + 1);

      await client.flush();

      const f = failoverFrom(captured);
      expect(f).toBeDefined();
      expect(f.guardRejected).toBe(0);
    } finally {
      await client.close().catch(() => {});
    }
  });
});
