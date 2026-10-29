/**
 * SSE first-frame rule (qfg-goi1.10.40, ITD v2026.10.16.4
 * chaos/supervisor-test-contract.md "Rule — a connection is `connected` at
 * its first valid frame", Test 9 (a)-(d) and the Test 2 "Reset" amendment).
 *
 * A stream connection counts as connected only after its first valid frame:
 * a complete comment-only block (the `: keepalive` keepalive) or a `data:`
 * block that decodes and validates as a config envelope. 200 headers alone
 * are NOT connected. A connection that ends before its first frame is a
 * failed attempt: backoff grows, not-connected is reported, and the fallback
 * poller's engage timer is not cancelled.
 *
 * Drives the REAL SSE worker (eventsource@4 + the SDK's fetch wrapper)
 * against a node:http server on 127.0.0.1. No new dependency.
 */
import * as http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";
import { SSEConnection, type SSEConnectionState } from "../src/sse";
import { Transport } from "../src/transport";

const KEY = "first-frame.value";

function envelopeJSON(value: string, generation: number): string {
  const rule = { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value } };
  return JSON.stringify({
    meta: { version: `gen-${generation}`, environment: "Production", generation },
    configs: [
      {
        id: "cfg-ff",
        key: KEY,
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: { rules: [rule] },
      },
    ],
  });
}

type SSEHandler = (res: http.ServerResponse, attempt: number) => void;

interface Rig {
  url: string;
  sseAttempts: number;
  configHits: number;
  close: () => Promise<void>;
}

const rigs: Rig[] = [];
const clients: Array<{ close: () => unknown }> = [];

afterEach(async () => {
  for (const c of clients.splice(0)) {
    try {
      await c.close();
    } catch {
      /* ignore */
    }
  }
  await Promise.all(rigs.splice(0).map((r) => r.close()));
});

/**
 * Local server. `/api/v2/configs` answers v1 (gen 1) on hit #1 and v2 (gen 2)
 * on every later hit, so a test can observe a frozen value directly.
 * `/api/v2/sse/config` writes 200 + text/event-stream headers, flushes them,
 * then hands the response to the per-test `sse` handler.
 */
function startRig(sse: SSEHandler): Promise<Rig> {
  const sockets = new Set<Socket>();
  const rig: Rig = { url: "", sseAttempts: 0, configHits: 0, close: async () => {} };
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/v2/sse/config")) {
      rig.sseAttempts++;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.flushHeaders();
      sse(res, rig.sseAttempts);
      return;
    }
    if (req.url?.startsWith("/api/v2/configs")) {
      rig.configHits++;
      const body = rig.configHits === 1 ? envelopeJSON("v1", 1) : envelopeJSON("v2", 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  rig.close = () =>
    new Promise<void>((r) => {
      for (const s of sockets) s.destroy();
      server.close(() => r());
    });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      rig.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      rigs.push(rig);
      resolve(rig);
    });
  });
}

interface Observed {
  q: Quonfig;
  edges: Array<{ state: SSEConnectionState; at: number }>;
  sleeps: number[];
  everConnectedAt: number | null;
  everPollerActive: boolean;
  connectedEdges: () => number;
  stopSampler: () => void;
}

/**
 * Real client against the rig. Fallback grace is 2x the poll interval, so the
 * interval is the threshold knob. The wait hook records every SSE reconnect
 * sleep the supervisor requests and passes it through unchanged.
 */
async function startClient(rig: Rig, fallbackPollIntervalMs: number): Promise<Observed> {
  const obs: Partial<Observed> & {
    edges: Observed["edges"];
    sleeps: number[];
    everConnectedAt: number | null;
    everPollerActive: boolean;
  } = { edges: [], sleeps: [], everConnectedAt: null, everPollerActive: false };

  const q = new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls: [rig.url],
    enableSSE: true,
    fallbackPollEnabled: true,
    fallbackPollIntervalMs,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    initTimeout: 5000,
    onSSEConnectionStateChange: (state) => obs.edges.push({ state, at: Date.now() }),
    __testWaitHook: (kind: string, ms: number) => {
      if (kind === "sse") obs.sleeps.push(ms);
      return ms;
    },
  } as any);
  (q as any).transport.__testStreamUrlOverride = `${rig.url}/api/v2/sse/config`;
  clients.push(q);

  const sampler = setInterval(() => {
    if (
      obs.everConnectedAt === null &&
      q.connectionState() === "connected" &&
      (q as any).initialized
    ) {
      obs.everConnectedAt = Date.now();
    }
    if ((q as any).fallbackPollerActive()) obs.everPollerActive = true;
  }, 1);

  await q.init();
  obs.q = q;
  obs.connectedEdges = () => obs.edges.filter((e) => e.state === "connected").length;
  obs.stopSampler = () => clearInterval(sampler);
  clients.push({ close: () => clearInterval(sampler) });
  return obs as Observed;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`waitFor timed out after ${timeoutMs}ms: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Test 9 — first-frame rule against a local server", () => {
  it("9a headers only: never connected, backoff grows, poller engages and delivers v2", async () => {
    const rig = await startRig((res) => res.end());
    // Grace = 2 x 500ms = 1s, deliberately longer than the longest
    // initial-delay reconnect sleep (500ms): with a shorter grace the OLD
    // code engages between flaps and the v2 assertion would be vacuous.
    const t0 = Date.now();
    const o = await startClient(rig, 500);
    expect(o.q.getString(KEY)).toBe("v1");

    await waitFor(
      () => (o.q as any).fallbackPollerActive() && o.q.getString(KEY) === "v2",
      3000,
      "poller active and get == v2"
    );
    expect(o.q.connectionState()).toBe("falling_back");

    // Let the 3s window elapse to count attempts against the ladder.
    await sleep(Math.max(0, t0 + 3000 - Date.now()));
    o.stopSampler();
    expect(rig.sseAttempts).toBeLessThanOrEqual(4);
    o.sleeps.forEach((ms, i) => expect(ms).toBeGreaterThanOrEqual(250 * 2 ** i));
    expect(o.connectedEdges()).toBe(0);
    expect(o.everConnectedAt).toBeNull();
  }, 15_000);

  it("frameless 200 held open: connectionState() is 'initializing', not 'disconnected' (qfg-rzgo)", async () => {
    // 200 + headers, then nothing: no frame, no close. Per the supervisor
    // contract (Test 6) the client keeps its prior state, 'initializing'.
    const rig = await startRig(() => {});
    const o = await startClient(rig, 5000); // grace 10s: the poller stays off
    await waitFor(() => rig.sseAttempts >= 1, 3000, "SSE request reached the server");
    await sleep(300);
    o.stopSampler();

    expect(rig.sseAttempts).toBe(1);
    expect(o.connectedEdges()).toBe(0);
    expect(o.q.connectionState()).toBe("initializing");
  }, 15_000);

  it("9b headers early, frame late: exactly one connected edge, at the keepalive", async () => {
    let sendAt = 0;
    const rig = await startRig((res) => {
      setTimeout(() => {
        sendAt = Date.now();
        res.write(": keepalive\n\n");
      }, 1000);
    });
    const o = await startClient(rig, 5000); // grace 10s
    await waitFor(() => sendAt > 0 && o.connectedEdges() >= 1, 5000, "keepalive sent + edge");
    await sleep(200);
    o.stopSampler();

    expect(sendAt).toBeGreaterThan(0);
    expect(o.connectedEdges()).toBe(1);
    const edge = o.edges.find((e) => e.state === "connected")!;
    expect(edge.at).toBeGreaterThanOrEqual(sendAt - 50);
    expect(o.everConnectedAt).not.toBeNull();
    expect(o.everConnectedAt!).toBeGreaterThanOrEqual(sendAt - 50);
    expect(rig.sseAttempts).toBe(1);
  }, 15_000);

  it("9c one keepalive then close: connected per attempt, backoff stays at initial delay, no poller", async () => {
    const rig = await startRig((res) => res.end(": keepalive\n\n"));
    const o = await startClient(rig, 500); // grace 1s > 500ms max initial-delay sleep
    await sleep(2500);
    o.stopSampler();

    const attempts = rig.sseAttempts;
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(o.connectedEdges()).toBeGreaterThanOrEqual(attempts - 1);
    expect(o.connectedEdges()).toBeLessThanOrEqual(attempts);
    for (const ms of o.sleeps) expect(ms).toBeLessThanOrEqual(500);
    expect(o.everPollerActive).toBe(false);
    expect(o.q.getString(KEY)).toBe("v1");
  }, 15_000);

  it("9d control: envelope v2 then hold: one connected edge, v2 via SSE, no poller", async () => {
    const rig = await startRig((res) => res.write(`data: ${envelopeJSON("v2", 2)}\n\n`));
    const o = await startClient(rig, 5000);
    await waitFor(() => o.q.getString(KEY) === "v2", 5000, "get == v2");
    await sleep(200);
    o.stopSampler();

    expect(o.connectedEdges()).toBe(1);
    expect(o.q.connectionState()).toBe("connected");
    expect(o.everPollerActive).toBe(false);
    expect(rig.configHits).toBe(1);
  }, 15_000);
});

function sseConnection(
  rig: Rig,
  states: SSEConnectionState[],
  sleeps: number[],
  waitMs: number
): SSEConnection {
  const transport = new Transport([rig.url], "test-key");
  (transport as any).__testStreamUrlOverride = `${rig.url}/api/v2/sse/config`;
  const sse = new SSEConnection(transport, undefined, {
    onConnectionStateChange: (s) => states.push(s),
    waitHook: (kind, ms) => {
      if (kind === "sse") sleeps.push(ms);
      return waitMs;
    },
  });
  clients.push(sse);
  return sse;
}

describe("Test 2 reset amendment — only a frame resets the backoff", () => {
  it("frame resets the delay; a frameless 200 grows it", async () => {
    // conn1 503, conn2 envelope + close, conn3 503, conn4 200 + no frame +
    // close, conn5 hold. The rig always writes 200, so the 503 legs use a
    // dedicated server that branches before writeHead.
    const sockets = new Set<Socket>();
    let attempt = 0;
    const server = http.createServer((req, res) => {
      attempt++;
      if (attempt === 1 || attempt === 3) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("unavailable");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      if (attempt === 2) res.end(`data: ${envelopeJSON("v1", 1)}\n\n`);
      else if (attempt === 4) res.end();
      // attempt 5+: hold open
    });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    const url = await new Promise<string>((r) =>
      server.listen(0, "127.0.0.1", () =>
        r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      )
    );
    rigs.push({
      url,
      sseAttempts: 0,
      configHits: 0,
      close: () =>
        new Promise<void>((r) => {
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
    });

    const states: SSEConnectionState[] = [];
    const sleeps: number[] = [];
    const sse = sseConnection({ url } as Rig, states, sleeps, 1);
    sse.start(() => {});
    await waitFor(() => attempt >= 5, 5000, "5 connection attempts");

    expect(sleeps.length).toBeGreaterThanOrEqual(4);
    expect(sleeps[1]).toBeLessThanOrEqual(500); // reset by conn2's frame
    expect(sleeps[3]).toBeGreaterThanOrEqual(500); // conn4 had no frame: NOT reset
  }, 15_000);
});

describe("first-frame parser table: connected iff a valid frame", () => {
  const env = envelopeJSON("v1", 1);
  const cases: Array<[string, string, boolean]> = [
    ["empty body", "", false],
    ["keepalive cut off by EOF", ": keepalive\n", false],
    ["bare comment block", ":\n\n", true],
    ["keepalive block", ": keepalive\n\n", true],
    ["keepalive block, CRLF", ": keepalive\r\n\r\n", true],
    ["malformed data", "data: {nope\n\n", false],
    ["valid JSON, not an envelope", 'data: {"a":1}\n\n', false],
    ["envelope with no terminating blank line", `data: ${env}\n`, false],
    ["id-only block", "id: 5\n\n", false],
    ["bare blank line", "\n\n", false],
    ["comment plus malformed data in one block", ": hi\ndata: {nope\n\n", false],
    ["garbage block then keepalive", "data: {nope\n\n: keepalive\n\n", true],
    ["envelope block", `data: ${env}\n\n`, true],
  ];

  for (const [name, body, frame] of cases) {
    it(`${name} -> ${frame ? "frame" : "not a frame"}`, async () => {
      const rig = await startRig((res) => res.end(body));
      const states: SSEConnectionState[] = [];
      const sse = sseConnection(rig, states, [], 60_000);
      sse.start(() => {});
      await waitFor(() => states.includes("error"), 5000, "connection end");
      expect(states.filter((s) => s === "connected").length).toBe(frame ? 1 : 0);
      sse.close();
    }, 10_000);
  }
});
