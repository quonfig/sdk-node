/**
 * Scriptable in-process telemetry endpoint for the telemetry transport
 * contract (integration-test-data/chaos/telemetry-transport-contract.md).
 *
 * A real `node:http` server on 127.0.0.1:0. Each received POST is recorded
 * (raw body bytes) and answered by the next scripted step, else the default
 * step (200). A `hang` step holds the response until `release(i, step)` or the
 * client disconnects (an aborted request).
 */
import { createHash } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

export type StubStep = { status: number; retryAfter?: string; body?: string } | { hang: true };

export interface TelemetryStub {
  url: string;
  script(...steps: StubStep[]): void;
  setDefault(step: StubStep): void;
  postCount(): number;
  body(i: number): Buffer;
  sha(i: number): string;
  json(i: number): any;
  header(i: number, name: string): string | undefined;
  waitForPosts(n: number): Promise<void>;
  release(i: number, step: StubStep): void;
  close(): Promise<void>;
}

export async function startTelemetryStub(): Promise<TelemetryStub> {
  const bodies: Buffer[] = [];
  const headers: http.IncomingHttpHeaders[] = [];
  const held = new Map<number, http.ServerResponse>();
  const queue: StubStep[] = [];
  let defaultStep: StubStep = { status: 200 };

  const answer = (res: http.ServerResponse, step: StubStep): void => {
    if ("hang" in step) return;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (step.retryAfter !== undefined) h["Retry-After"] = step.retryAfter;
    res.writeHead(step.status, h);
    res.end(step.body ?? "{}");
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const i = bodies.length;
      bodies.push(Buffer.concat(chunks));
      headers.push(req.headers);
      const step = queue.length > 0 ? queue.shift()! : defaultStep;
      if ("hang" in step) {
        held.set(i, res);
        res.on("close", () => held.delete(i));
        return;
      }
      answer(res, step);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    script: (...steps) => {
      queue.push(...steps);
    },
    setDefault: (step) => {
      defaultStep = step;
    },
    postCount: () => bodies.length,
    body: (i) => bodies[i],
    sha: (i) => createHash("sha256").update(bodies[i]).digest("hex"),
    json: (i) => JSON.parse(bodies[i].toString("utf8")),
    header: (i, name) => {
      const v = headers[i]?.[name.toLowerCase()];
      return Array.isArray(v) ? v.join(", ") : v;
    },
    waitForPosts: async (n) => {
      // Poll on setImmediate + performance.now(), which the tests leave real.
      // Not vi.waitFor: under fake timers it advances the fake clock by its
      // poll interval, which would skew the failure times the tests assert on.
      const start = performance.now();
      while (bodies.length < n) {
        if (performance.now() - start > 5000) {
          throw new Error(`stub saw ${bodies.length} POSTs, want ${n}`);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    },
    release: (i, step) => {
      const res = held.get(i);
      if (!res) throw new Error(`POST ${i} is not held`);
      held.delete(i);
      answer(res, step);
    },
    close: async () => {
      for (const res of held.values()) res.destroy();
      held.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
