/**
 * Supervisor Test 5 — callback-throw isolation (qfg-6vno.27; ITD v2026.10.22.2
 * chaos/supervisor-test-contract.md Test 5 and the `callback_errors_total`
 * vocabulary row).
 *
 * A throw (or a rejected promise) from a user callback is caught, counted in
 * the internal `quonfig_sdk_callback_errors_total{callback}` counter, logged at
 * ERROR with the exception and its stack, and is NOT a worker restart. The SDK
 * keeps processing envelopes.
 *
 * Drives the real SSE worker against a node:http server on 127.0.0.1.
 */
import * as http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { Quonfig } from "../src/quonfig";

const KEY = "callback-errors.value";

function envelopeJSON(value: string, generation: number): string {
  const rule = { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value } };
  return JSON.stringify({
    meta: { version: `gen-${generation}`, environment: "Production", generation },
    configs: [
      {
        id: "cfg-ce",
        key: KEY,
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: { rules: [rule] },
      },
    ],
  });
}

const servers: Array<() => Promise<void>> = [];
const clients: Quonfig[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {});
  await Promise.all(servers.splice(0).map((close) => close()));
});

/**
 * `/api/v2/configs` serves gen 1. The SSE stream sends gen 2, then gen 3 after
 * 200ms, then holds the connection open (keepalives only).
 */
function startServer(): Promise<{ url: string; sseAttempts: () => number }> {
  const sockets = new Set<Socket>();
  let attempts = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/v2/sse/config")) {
      attempts++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${envelopeJSON("v2", 2)}\n\n`);
      setTimeout(() => res.write(`data: ${envelopeJSON("v3", 3)}\n\n`), 200);
      return;
    }
    if (req.url?.startsWith("/api/v2/configs")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(envelopeJSON("v1", 1));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  servers.push(
    () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      })
  );
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        sseAttempts: () => attempts,
      })
    );
  });
}

interface Logged {
  level: string;
  message: string;
  args: unknown[];
}

function client(url: string, logs: Logged[], extra: Record<string, unknown>): Quonfig {
  const push =
    (level: string) =>
    (message: string, ...args: unknown[]) =>
      logs.push({ level, message, args });
  const q = new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls: [url],
    enableSSE: true,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    logger: { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") },
    ...extra,
  } as any);
  (q as any).transport.__testStreamUrlOverride = `${url}/api/v2/sse/config`;
  clients.push(q);
  return q;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`waitFor timed out after ${timeoutMs}ms: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The ERROR line for a caught callback throw: names the callback, carries the error with its stack. */
function errorLinesWith(logs: Logged[], marker: string): Logged[] {
  return logs.filter(
    (l) =>
      l.level === "error" &&
      /callback|onConfigUpdate/i.test(l.message) &&
      l.args.some((a) => a instanceof Error && a.message === marker && /\n\s+at /.test(a.stack!))
  );
}

describe("supervisor Test 5 — callback-throw isolation", () => {
  it("on_config_update: one throw -> callback_errors_total == 1, no worker restart, next envelope delivered", async () => {
    const srv = await startServer();
    const logs: Logged[] = [];
    let calls = 0;
    const q = client(srv.url, logs, {
      onConfigUpdate: () => {
        calls++;
        if (calls === 1) throw new Error("boom-on-config-update");
      },
    });
    await q.init();
    await waitFor(() => q.getString(KEY) === "v3", 5000, "gen 3 installed");
    // gen 1 (init, throws), gen 2 and gen 3 (both succeed)
    await waitFor(() => calls >= 3, 5000, "callback ran again after the throw");

    const c = q.supervisorCounters();
    expect(c.callbackErrorsOnConfigUpdate).toBe(1);
    expect(c.callbackErrorsOnConnectionStateChange).toBe(0);
    expect(c.workerRestartsLayer1).toBe(0);
    expect(errorLinesWith(logs, "boom-on-config-update")).toHaveLength(1);
    expect(q.connectionState()).toBe("connected");
    expect(q.lastSuccessfulRefresh()).toBeInstanceOf(Date);
  }, 15_000);

  it("on_config_update: a rejected promise is caught and counted the same way", async () => {
    const srv = await startServer();
    const logs: Logged[] = [];
    let calls = 0;
    const q = client(srv.url, logs, {
      onConfigUpdate: async () => {
        calls++;
        if (calls === 1) throw new Error("boom-async");
      },
    });
    await q.init();
    await waitFor(() => q.getString(KEY) === "v3" && calls >= 3, 5000, "gen 3 + 3 calls");
    await waitFor(
      () => q.supervisorCounters().callbackErrorsOnConfigUpdate === 1,
      2000,
      "async rejection counted"
    );
    expect(q.supervisorCounters().workerRestartsLayer1).toBe(0);
    expect(errorLinesWith(logs, "boom-async")).toHaveLength(1);
  }, 15_000);

  it("on_connection_state_change: one throw -> callback_errors_total == 1, ERROR log, still connects", async () => {
    const srv = await startServer();
    const logs: Logged[] = [];
    const states: string[] = [];
    const q = client(srv.url, logs, {
      onSSEConnectionStateChange: (state: string) => {
        states.push(state);
        if (states.length === 1) throw new Error("boom-state");
      },
    });
    await q.init();
    await waitFor(() => q.getString(KEY) === "v3", 5000, "gen 3 installed");

    const c = q.supervisorCounters();
    expect(c.callbackErrorsOnConnectionStateChange).toBe(1);
    expect(c.callbackErrorsOnConfigUpdate).toBe(0);
    expect(c.workerRestartsLayer1).toBe(0);
    expect(errorLinesWith(logs, "boom-state")).toHaveLength(1);
    expect(states).toContain("connected");
    expect(q.connectionState()).toBe("connected");
    expect(srv.sseAttempts()).toBe(1);
  }, 15_000);
});
