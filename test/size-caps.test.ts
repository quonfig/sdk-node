/**
 * Size caps (qfg-6vno.20.3; ITD v2026.10.22.2
 * chaos/supervisor-test-contract.md "Rule — size caps" and Test 10 cases 1-5).
 *
 * - One SSE event is capped at 4 MiB (4,194,304 bytes). Over the cap it is
 *   not a frame and the connection is a failed attempt; later connections
 *   that deliver only a keepalive never report connected until an envelope
 *   installs. One WARN per oversized episode, repeats at DEBUG.
 * - A 200 body from /api/v2/configs is capped at 16 MiB (16,777,216 bytes):
 *   a failed leg, nothing installed, no ETag stored.
 * - A non-2xx body is read for at most 1 KiB and never logged.
 *
 * Drives the REAL SSE worker (eventsource@4 + the SDK's fetch wrapper) and the
 * real transport against a node:http server on 127.0.0.1 (Test 9 fixture).
 */
import * as http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { type SSEConnectionState, wrapFetchWithReadDeadline } from "../src/sse";
import { Transport } from "../src/transport";

const KEY = "size-caps.value";
const SSE_CAP = 4_194_304;
const BODY_CAP = 16_777_216;

function envelopeJSON(value: string, generation: number): string {
  const rule = { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value } };
  return JSON.stringify({
    meta: { version: `gen-${generation}`, environment: "Production", generation },
    configs: [
      {
        id: "cfg-sc",
        key: KEY,
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: { rules: [rule] },
      },
    ],
  });
}

/** A valid envelope whose JSON is exactly `bytes` long (value padded with x). */
function paddedEnvelope(bytes: number, generation: number): string {
  const base = envelopeJSON("", generation).length;
  return envelopeJSON("x".repeat(bytes - base), generation);
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, hit: number) => void;

interface Rig {
  url: string;
  sseAttempts: number;
  configHits: number;
  configHeaders: http.IncomingHttpHeaders[];
  close: () => Promise<void>;
}

const rigs: Rig[] = [];
const clients: Array<{ close: () => unknown }> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const c of clients.splice(0)) {
    try {
      await c.close();
    } catch {
      /* ignore */
    }
  }
  await Promise.all(rigs.splice(0).map((r) => r.close()));
});

const smallConfigs: Handler = (_req, res, hit) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(envelopeJSON(`http-${hit}`, hit));
};

function startRig(sse: Handler, configs: Handler = smallConfigs): Promise<Rig> {
  const sockets = new Set<Socket>();
  const rig: Rig = {
    url: "",
    sseAttempts: 0,
    configHits: 0,
    configHeaders: [],
    close: async () => {},
  };
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/v2/sse/config")) {
      rig.sseAttempts++;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.flushHeaders();
      sse(req, res, rig.sseAttempts);
      return;
    }
    if (req.url?.startsWith("/api/v2/configs")) {
      rig.configHits++;
      rig.configHeaders.push(req.headers);
      configs(req, res, rig.configHits);
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

interface Logged {
  level: "debug" | "info" | "warn" | "error";
  line: string;
}

function captureLogger(lines: Logged[]) {
  const fmt = (args: unknown[]) =>
    args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : String(a))).join(" ");
  return {
    debug: (...a: unknown[]) => lines.push({ level: "debug", line: fmt(a) }),
    info: (...a: unknown[]) => lines.push({ level: "info", line: fmt(a) }),
    warn: (...a: unknown[]) => lines.push({ level: "warn", line: fmt(a) }),
    error: (...a: unknown[]) => lines.push({ level: "error", line: fmt(a) }),
  };
}

interface Observed {
  q: Quonfig;
  edges: Array<{ state: SSEConnectionState; at: number }>;
  sleeps: number[];
  logs: Logged[];
  everConnected: boolean;
  connectedEdges: () => number;
  stopSampler: () => void;
}

async function startClient(rig: Rig, fallbackPollIntervalMs: number): Promise<Observed> {
  const obs = {
    edges: [] as Observed["edges"],
    sleeps: [] as number[],
    logs: [] as Logged[],
    everConnected: false,
  } as Observed;
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
    logger: captureLogger(obs.logs),
    onSSEConnectionStateChange: (state) => obs.edges.push({ state, at: Date.now() }),
    __testWaitHook: (kind: string, ms: number) => {
      if (kind === "sse") obs.sleeps.push(ms);
      return ms;
    },
  } as any);
  (q as any).transport.__testStreamUrlOverride = `${rig.url}/api/v2/sse/config`;
  clients.push(q);
  const sampler = setInterval(() => {
    if (q.connectionState() === "connected" && (q as any).initialized) obs.everConnected = true;
  }, 1);
  await q.init();
  obs.q = q;
  obs.connectedEdges = () => obs.edges.filter((e) => e.state === "connected").length;
  obs.stopSampler = () => clearInterval(sampler);
  clients.push({ close: () => clearInterval(sampler) });
  return obs;
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

/** A Response whose body yields `total` bytes in `chunk`-sized pieces, counting what was pulled. */
function countingResponse(
  total: number,
  chunk: number,
  init: { status: number; headers?: Record<string, string>; fill?: string }
): { response: Response; pulled: () => number } {
  let sent = 0;
  const piece = new TextEncoder().encode((init.fill ?? "x").repeat(chunk).slice(0, chunk));
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) {
        c.close();
        return;
      }
      const n = Math.min(chunk, total - sent);
      sent += n;
      c.enqueue(n === chunk ? piece : piece.slice(0, n));
    },
  });
  return {
    response: new Response(body, { status: init.status, headers: init.headers }),
    pulled: () => sent,
  };
}

describe("Test 10 — size caps", () => {
  it("case 1: oversized SSE event -> backoff, never connected, poller fetches, one WARN with 4194304", async () => {
    const big = paddedEnvelope(SSE_CAP + 1, 2);
    const rig = await startRig((_req, res) => res.write(`id: g2\ndata: ${big}\n\n`));
    const o = await startClient(rig, 500); // grace 1s

    await waitFor(
      () => rig.sseAttempts >= 3 && rig.configHits >= 2,
      10_000,
      ">=3 SSE connects and a fallback fetch"
    );
    await sleep(200);
    o.stopSampler();

    expect(o.connectedEdges()).toBe(0);
    expect(o.everConnected).toBe(false);
    o.sleeps.forEach((ms, i) => expect(ms).toBeGreaterThanOrEqual(250 * 2 ** i));
    expect(o.sleeps.length).toBeGreaterThanOrEqual(2);
    const warns = o.logs.filter((l) => l.level === "warn" && l.line.includes(String(SSE_CAP)));
    expect(warns).toHaveLength(1);
    // the SDK key never reaches the line
    expect(warns[0].line).not.toContain("test-backend-key");
    expect(o.q.getString(KEY)).not.toMatch(/^x+$/);
  }, 20_000);

  it("case 1 gate: a keepalive after an oversized event does not report connected", async () => {
    const big = paddedEnvelope(SSE_CAP + 1, 2);
    const rig = await startRig((_req, res) => res.write(`: keepalive\n\ndata: ${big}\n\n`));
    const o = await startClient(rig, 5000);

    await waitFor(() => rig.sseAttempts >= 3, 10_000, ">=3 SSE connects");
    await sleep(100);
    o.stopSampler();

    // Connection 1's keepalive is a legitimate first frame; after the
    // oversized event, later keepalives are not.
    expect(o.connectedEdges()).toBe(1);
    // The connection-1 keepalive reset the delay, then every later attempt grew it.
    for (let i = 1; i < o.sleeps.length; i++) {
      expect(o.sleeps[i]).toBeGreaterThanOrEqual(250 * 2 ** i);
    }
  }, 20_000);

  it("case 1 episode: an installed SSE envelope ends the episode (next oversized warns again)", async () => {
    const big = paddedEnvelope(SSE_CAP + 1, 3);
    const rig = await startRig((_req, res, attempt) => {
      if (attempt === 1) res.write(`data: ${big}\n\n`);
      else if (attempt === 2) res.end(`data: ${envelopeJSON("sse-2", 2)}\n\n`);
      else res.write(`data: ${big}\n\n`);
    });
    const o = await startClient(rig, 5000);
    await waitFor(() => rig.sseAttempts >= 4, 10_000, ">=4 SSE connects");
    await sleep(100);
    o.stopSampler();

    expect(o.connectedEdges()).toBe(1); // connection 2's envelope
    const warns = o.logs.filter((l) => l.level === "warn" && l.line.includes(String(SSE_CAP)));
    expect(warns).toHaveLength(2);
    expect(o.logs.some((l) => l.level === "debug" && l.line.includes(String(SSE_CAP)))).toBe(true);
  }, 20_000);

  it("case 2: 8 MiB with no newline -> the connection ends and is retried with backoff", async () => {
    const chunk = "y".repeat(1024 * 1024);
    const rig = await startRig((_req, res) => {
      res.write("data: ");
      for (let i = 0; i < 8; i++) res.write(chunk);
      // hold the stream open
    });
    const o = await startClient(rig, 5000);
    await waitFor(() => rig.sseAttempts >= 3, 10_000, ">=3 SSE connects");
    o.stopSampler();
    expect(o.connectedEdges()).toBe(0);
    o.sleeps.forEach((ms, i) => expect(ms).toBeGreaterThanOrEqual(250 * 2 ** i));
  }, 20_000);

  it("case 2 memory: the stream seam stops pulling near the cap for a no-newline event", async () => {
    const { response, pulled } = countingResponse(8 * 1024 * 1024, 64 * 1024, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const wrapped = wrapFetchWithReadDeadline(
      async () => response,
      60_000,
      () => {}
    );
    const res = await wrapped("http://127.0.0.1/x");
    const reader = res.body!.getReader();
    let got = 0;
    let failed: unknown = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        got += value.byteLength;
      }
    } catch (err) {
      failed = err;
    }
    expect(failed).not.toBeNull();
    expect(got).toBeLessThanOrEqual(SSE_CAP);
    // the source stream pre-pulls a chunk or two ahead (highWaterMark); the
    // bound is "near the cap", far under the 8 MiB the server would send
    expect(pulled()).toBeLessThanOrEqual(SSE_CAP + 4 * 64 * 1024);
  });

  for (const withLength of [true, false]) {
    it(`case 3: 16 MiB + 1 config body (${withLength ? "with" : "no"} Content-Length) -> failed leg, no install, no ETag`, async () => {
      const big = paddedEnvelope(BODY_CAP + 1, 5);
      const rig = await startRig(
        () => {},
        (_req, res) => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ETag: '"oversized-etag"',
          };
          if (withLength) headers["Content-Length"] = String(Buffer.byteLength(big));
          res.writeHead(200, headers);
          if (withLength) res.end(big);
          else {
            // chunked: no Content-Length
            for (let i = 0; i < big.length; i += 1024 * 1024)
              res.write(big.slice(i, i + 1024 * 1024));
            res.end();
          }
        }
      );
      const t = new Transport([rig.url], "test-key");
      await expect(t.fetchConfigs()).rejects.toThrow(String(BODY_CAP));
      await expect(t.fetchConfigs()).rejects.toThrow();
      expect(rig.configHits).toBe(2);
      expect(rig.configHeaders[1]["if-none-match"]).toBeUndefined();
    }, 20_000);
  }

  it("case 3 bounded: Content-Length over the cap fails before reading the body", async () => {
    const { response, pulled } = countingResponse(BODY_CAP + 1, 64 * 1024, {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(BODY_CAP + 1) },
    });
    vi.stubGlobal("fetch", async () => response);
    const t = new Transport(["http://127.0.0.1:1"], "test-key");
    await expect(t.fetchConfigs()).rejects.toThrow(String(BODY_CAP));
    expect(pulled()).toBeLessThanOrEqual(64 * 1024);
  });

  it("case 3 bounded: without Content-Length the read stops at the cap", async () => {
    const { response, pulled } = countingResponse(BODY_CAP * 2, 64 * 1024, {
      status: 200,
      headers: { "content-type": "application/json" },
      fill: " ",
    });
    vi.stubGlobal("fetch", async () => response);
    const t = new Transport(["http://127.0.0.1:1"], "test-key");
    await expect(t.fetchConfigs()).rejects.toThrow(String(BODY_CAP));
    expect(pulled()).toBeLessThanOrEqual(BODY_CAP + 4 * 64 * 1024);
  });

  it("case 3 client: an oversized poll installs nothing and lastSuccessfulRefresh does not advance", async () => {
    const big = paddedEnvelope(BODY_CAP + 1, 9);
    const rig = await startRig(
      () => {},
      (_req, res, hit) => {
        res.writeHead(200, { "Content-Type": "application/json", ETag: `"e${hit}"` });
        res.end(hit === 1 ? envelopeJSON("v1", 1) : big);
      }
    );
    const q = new Quonfig({
      sdkKey: "test-backend-key",
      apiUrls: [rig.url],
      enableSSE: false,
      enablePolling: true,
      pollInterval: 200,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      onNoDefault: "ignore",
      logger: captureLogger([]),
    } as any);
    clients.push(q);
    await q.init();
    const refreshed = q.lastSuccessfulRefresh();
    await waitFor(() => rig.configHits >= 3, 10_000, ">=2 polls");
    expect(q.getString(KEY)).toBe("v1");
    expect(q.lastSuccessfulRefresh()).toEqual(refreshed);
    expect(rig.configHeaders[2]["if-none-match"]).toBe('"e1"');
  }, 20_000);

  it("case 4: 502 with a 2 MiB marker body -> marker in no log line or error", async () => {
    const MARKER = "SIZE-CAPS-MARKER-7f3a";
    const body = (MARKER + "z".repeat(1000)).repeat(2 * 1024);
    const rig = await startRig(
      () => {},
      (_req, res) => {
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end(body);
      }
    );
    const logs: Logged[] = [];
    const t = new Transport([rig.url], "test-key", undefined, undefined, captureLogger(logs));
    const err = await t.fetchConfigs().then(
      () => null,
      (e: Error) => e
    );
    expect(err).not.toBeNull();
    expect(`${err!.message} ${err!.stack}`).not.toContain(MARKER);
    expect(logs.some((l) => l.line.includes(MARKER))).toBe(false);
  });

  it("case 4 bounded: a non-2xx body is read for at most 1 KiB", async () => {
    const { response, pulled } = countingResponse(2 * 1024 * 1024, 512, { status: 502 });
    vi.stubGlobal("fetch", async () => response);
    const t = new Transport(["http://127.0.0.1:1"], "test-key");
    await expect(t.fetchConfigs()).rejects.toThrow(/502/);
    expect(pulled()).toBeLessThanOrEqual(1024 + 512);
  });

  it("case 4 telemetry: deprecated postTelemetry logs at most 1 KiB of a non-2xx body", async () => {
    const { response, pulled } = countingResponse(2 * 1024 * 1024, 512, {
      status: 500,
      fill: "m",
    });
    vi.stubGlobal("fetch", async () => response);
    const logs: Logged[] = [];
    const t = new Transport(
      ["http://127.0.0.1:1"],
      "test-key",
      "http://127.0.0.1:1",
      undefined,
      captureLogger(logs)
    );
    await t.postTelemetry({});
    expect(pulled()).toBeLessThanOrEqual(1024 + 512);
    const warn = logs.find((l) => l.level === "warn")!;
    expect(warn.line).toContain("500");
    expect(warn.line.length).toBeLessThan(1024 + 200);
  });

  it("case 5 control: a 3 MiB SSE envelope and a 12 MiB HTTP envelope install", async () => {
    const sseBig = paddedEnvelope(3 * 1024 * 1024, 3);
    const httpBig = paddedEnvelope(12 * 1024 * 1024, 2);
    const rig = await startRig(
      (_req, res) => res.write(`data: ${sseBig}\n\n`),
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(httpBig);
      }
    );
    const o = await startClient(rig, 5000);
    // init installed the 12 MiB HTTP envelope (gen 2) ...
    expect(o.q.getString(KEY)!.length).toBeGreaterThan(11 * 1024 * 1024);
    // ... and the 3 MiB SSE envelope (gen 3) installs on top.
    await waitFor(() => o.connectedEdges() === 1, 10_000, "SSE connected");
    await waitFor(
      () => {
        const v = o.q.getString(KEY);
        return v !== undefined && v.length < 4 * 1024 * 1024;
      },
      10_000,
      "SSE envelope installed"
    );
    o.stopSampler();
    expect(o.logs.some((l) => l.line.includes(String(SSE_CAP)))).toBe(false);
  }, 30_000);
});
