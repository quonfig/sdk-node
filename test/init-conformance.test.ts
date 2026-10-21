/**
 * qfg-9p4i.17.6: cross-SDK init-failure conformance (Jeff's decisions of
 * 2026-10-21, design doc "Decisions: cross-SDK conformance" 6-9).
 *
 * - D1: "unauthorized" only when every leg answered auth-class (401/403/404/410).
 * - D2: reason "timeout" iff the LAST attempt hung (or none completed).
 * - D3: initTimeout <= 0 (or NaN) runs exactly one attempt, then the policy.
 * - D4: init lines and QuonfigInitError carry hosts + "HTTP <status>" only:
 *   never URL userinfo or upstream response bodies (cause included).
 * - I5: init() after a caught failure joins the background retry.
 * - I6: SSE/poller + telemetry start at the decision point, once.
 * - I7: every init line carries { event: "quonfig.init.<name>" }.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig, QuonfigInitError } from "../src/index";
import { Transport, type LegResult } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";
import { spyOnSendTelemetry } from "./helpers/telemetrySpy";

const ENVELOPE: ConfigEnvelope = {
  meta: { version: "v7", environment: "Production" },
  configs: [
    {
      id: "flag-1",
      key: "my.flag",
      type: "feature_flag",
      valueType: "bool",
      sendToClientSdk: false,
      default: {
        rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value: true } }],
      },
    } as any,
  ],
};

const okLeg = (i: number): LegResult => ({
  result: { envelope: ENVELOPE, notChanged: false },
  sourceIndex: i,
  status: 200,
});
const statusLeg =
  (status: number) =>
  (i: number): LegResult => ({
    error: new Error(`Unexpected status ${status}`),
    status,
    sourceIndex: i,
  });
const downLeg = statusLeg(503);
/** A leg that ended on its hedge abort, as the transport reports it. */
const hungLeg = (i: number): LegResult => {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return { error, status: 0, sourceIndex: i, hung: true } as LegResult;
};

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
type Log = ReturnType<typeof logger>;

function makeClient(extra: Record<string, unknown> = {}, log: Log = logger()): Quonfig {
  return new Quonfig({
    sdkKey: "qf_sk_secret_key_never_logged",
    apiUrls: ["https://primary.example.test", "https://secondary.example.test"],
    enableSSE: false,
    fallbackPollEnabled: false,
    enableQuonfigUserContext: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    logger: log,
    __testWaitHook: (kind: string, ms: number) => (kind === "init-retry" ? 5 : ms),
    ...extra,
  } as any);
}

function calls(log: Log): unknown[][] {
  return [log.debug, log.info, log.warn, log.error].flatMap((fn) => fn.mock.calls);
}
function allLines(log: Log): string[] {
  return calls(log).map((c) =>
    c.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
  );
}
function countLines(log: Log, needle: string): number {
  return allLines(log).filter((l) => l.includes(needle)).length;
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Settle within `ms`, or report "pending". */
async function within<T>(p: Promise<T>, ms: number): Promise<T | "pending"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    p,
    new Promise<"pending">((resolve) => (t = setTimeout(() => resolve("pending"), ms))),
  ]);
  clearTimeout(t);
  return r;
}

const servers: http.Server[] = [];
async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

describe("D1: auth fast-fail needs every leg auth-class (401/403/404/410)", () => {
  it.each([404, 410])(
    "fails at once with reason unauthorized when every leg answers %i",
    async (status) => {
      spyOnSendTelemetry();
      vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
        statusLeg(status)(i)
      );
      const q = makeClient({ initTimeout: 5000 });
      const start = Date.now();
      const err = await q.init().catch((e) => e);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(err).toBeInstanceOf(QuonfigInitError);
      expect(err.reason).toBe("unauthorized");
      await q.close();
    }
  );

  it("does not decide from the primary alone (primary 401, secondary 503)", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      i === 0 ? statusLeg(401)(i) : downLeg(i)
    );
    const q = makeClient({ initTimeout: 150 });
    const err = await q.init().catch((e) => e);
    expect(err.reason).toBe("unavailable");
    await q.close();
  });
});

describe("D2: reason timeout iff the last attempt hung", () => {
  it("every attempt ending on the per-leg hedge abort reports timeout, not unavailable", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      hungLeg(i)
    );
    const q = makeClient({ initTimeout: 150 });
    const err = await q.init().catch((e) => e);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.reason).toBe("timeout");
    expect(err.message).toContain("Initialization timed out");
    expect(err.message).toContain("primary=primary.example.test: timed out");
    await q.close();
  });

  it("a fast 503 followed by a hang reports timeout and names the hang, not the stale 503", async () => {
    spyOnSendTelemetry();
    let n = 0;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation((i: number) => {
      n++;
      return n <= 2 ? Promise.resolve(downLeg(i)) : new Promise(() => {});
    });
    const log = logger();
    const q = makeClient({ initTimeout: 150 }, log);
    const err = await q.init().catch((e) => e);
    expect(err.reason).toBe("timeout");
    expect(err.message).not.toContain("503");
    expect(err.message).toContain("timed out");
    const failed = allLines(log).find((l) => l.includes("init FAILED"))!;
    expect(failed).not.toContain("503");
    await q.close();
  });

  it("a hung attempt followed by fast 503s reports unavailable", async () => {
    spyOnSendTelemetry();
    let n = 0;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) => {
      n++;
      return n <= 2 ? hungLeg(i) : downLeg(i);
    });
    const q = makeClient({ initTimeout: 150 });
    const err = await q.init().catch((e) => e);
    expect(err.reason).toBe("unavailable");
    expect(err.message).toContain("HTTP 503");
    await q.close();
  });

  it("a real blackholed upstream at a short hedge abort reports timeout", async () => {
    spyOnSendTelemetry();
    const host = await serve(() => {
      /* accept, never answer */
    });
    const q = makeClient({
      apiUrls: [`http://${host}`],
      initTimeout: 400,
      configFetchHedgeAbortMs: 60,
      configFetchHedgeDelayMs: 30,
    });
    const err = await q.init().catch((e) => e);
    expect(err.reason).toBe("timeout");
    expect(err.message).toContain(`primary=${host}: timed out`);
    await q.close();
  });
});

describe("D3: initTimeout <= 0 runs exactly one attempt, then the policy", () => {
  it.each([0, -1, NaN])("fail rejects after one attempt (initTimeout=%s)", async (initTimeout) => {
    spyOnSendTelemetry();
    const spy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockImplementation(async (i: number) => downLeg(i));
    const log = logger();
    // Slow background retry so only the one init attempt is counted.
    const q = makeClient({ initTimeout, __testWaitHook: (_k: string, ms: number) => ms }, log);
    const r = await within(
      q.init().catch((e) => e),
      2000
    );
    expect(r).toBeInstanceOf(QuonfigInitError);
    expect((r as QuonfigInitError).reason).toBe("unavailable");
    // One attempt = one hedged cycle = primary + secondary.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(countLines(log, "retrying until initTimeout")).toBe(0);
    await q.close();
  });

  it("one hung attempt with initTimeout 0 reports timeout", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      hungLeg(i)
    );
    const q = makeClient({ initTimeout: 0, __testWaitHook: (_k: string, ms: number) => ms });
    const err = await q.init().catch((e) => e);
    expect(err.reason).toBe("timeout");
    await q.close();
  });

  it("continue resolves after one attempt and heals in the background", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      down ? downLeg(i) : okLeg(i)
    );
    const q = makeClient({ initTimeout: 0, onInitFailure: "continue" });
    expect(await within(q.init(), 2000)).toBeUndefined();
    expect(q.isReady()).toBe(false);
    down = false;
    await q.waitForReady({ timeoutMs: 2000 });
    await q.close();
  });

  it("wait keeps retrying after the one attempt and resolves on heal", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      down ? downLeg(i) : okLeg(i)
    );
    const q = makeClient({ initTimeout: 0, onInitFailure: "wait" });
    const p = q.init();
    expect(await within(p, 100)).toBe("pending");
    down = false;
    await p;
    expect(q.isReady()).toBe(true);
    await q.close();
  });
});

describe("D4: no URL userinfo or upstream bodies in init lines or QuonfigInitError", () => {
  it("a non-2xx answer is reported as HTTP <status>, never its body (message and cause)", async () => {
    spyOnSendTelemetry();
    const host = await serve((_req, res) => {
      res.writeHead(503);
      res.end("upstream-secret-body <html>");
    });
    const log = logger();
    const q = makeClient({ apiUrls: [`http://${host}/some/path`], initTimeout: 500 }, log);
    const err = await q.init().catch((e) => e);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.message).toContain(`primary=${host}: HTTP 503`);
    expect(err.message).not.toContain("upstream-secret-body");
    expect(String(err.cause?.message ?? "")).not.toContain("upstream-secret-body");
    for (const line of allLines(log)) expect(line).not.toContain("upstream-secret-body");
    await q.close();
  });

  it("URL credentials never reach the init lines, the error message or its cause", async () => {
    spyOnSendTelemetry();
    const host = await serve((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const log = logger();
    const q = makeClient({ apiUrls: [`http://user:s3cret@${host}`], initTimeout: 500 }, log);
    const err = await q.init().catch((e) => e);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.message).not.toContain("s3cret");
    let c: any = err.cause;
    while (c) {
      expect(String(c.message ?? c)).not.toContain("s3cret");
      c = c.cause;
    }
    for (const line of allLines(log)) expect(line).not.toContain("s3cret");
    await q.close();
  });
});

describe("I5: init() after a caught failure joins the background retry", () => {
  it("does not start a second init loop or re-log the first-failure WARN", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      downLeg(i)
    );
    const log = logger();
    const q = makeClient({ initTimeout: 100 }, log);
    await expect(q.init()).rejects.toBeInstanceOf(QuonfigInitError);
    const err = await q.init().catch((e) => e);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.reason).toBe("unavailable");
    expect(countLines(log, "config not loaded yet, retrying until initTimeout")).toBe(1);
    await q.close();
  });

  it("resolves once the background retry heals", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      down ? downLeg(i) : okLeg(i)
    );
    const q = makeClient({ initTimeout: 100 });
    await expect(q.init()).rejects.toBeInstanceOf(QuonfigInitError);
    const p = q.init();
    down = false;
    await p;
    expect(q.isReady()).toBe(true);
    await q.close();
  });
});

describe("I6: update channel and telemetry start at the decision point", () => {
  function sseClient(extra: Record<string, unknown>, opened: { count: number }) {
    return makeClient({
      enableSSE: true,
      collectEvaluationSummaries: true,
      __testEventSourceFactory: () => {
        opened.count++;
        return { onopen: null, onmessage: null, onerror: null, close: () => {} };
      },
      ...extra,
    });
  }

  it.each(["fail", "continue"])(
    "under %s, SSE and telemetry run while degraded, once",
    async (mode) => {
      spyOnSendTelemetry();
      let down = true;
      vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
        down ? downLeg(i) : okLeg(i)
      );
      const opened = { count: 0 };
      const q = sseClient({ initTimeout: 60, onInitFailure: mode }, opened);
      await q.init().catch(() => {});
      await new Promise((r) => setTimeout(r, 10));
      expect(q.isReady()).toBe(false);
      expect(opened.count).toBe(1);
      expect((q as any).telemetryReporter).toBeDefined();
      const reporter = (q as any).telemetryReporter;

      down = false;
      await q.waitForReady({ timeoutMs: 2000 });
      await new Promise((r) => setTimeout(r, 10));
      expect(opened.count).toBe(1);
      expect((q as any).telemetryReporter).toBe(reporter);
      await q.close();
    }
  );

  it("a config delivered by SSE while degraded heals the client", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      downLeg(i)
    );
    const sources: any[] = [];
    const q = makeClient({
      enableSSE: true,
      initTimeout: 60,
      onInitFailure: "continue",
      __testWaitHook: (kind: string, ms: number) => (kind === "init-retry" ? 60_000 : ms),
      __testEventSourceFactory: () => {
        const es = { onopen: null, onmessage: null, onerror: null, close: () => {} };
        sources.push(es);
        return es;
      },
    });
    await q.init();
    await waitFor(() => sources.length === 1 && typeof sources[0].onmessage === "function");
    sources[0].onmessage({ data: JSON.stringify(ENVELOPE) });
    await q.waitForReady({ timeoutMs: 1000 });
    expect(q.isEnabled("my.flag")).toBe(true);
    await q.close();
  });
});

describe("I7: structured event on every init line", () => {
  it("passes { event: 'quonfig.init.<name>' } with each init line", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      down ? downLeg(i) : okLeg(i)
    );
    const log = logger();
    const q = makeClient({ initTimeout: 60 }, log);
    await q.init().catch(() => {});
    down = false;
    await q.waitForReady({ timeoutMs: 2000 });

    const initCalls = calls(log).filter((c) =>
      /^\[quonfig\] (init[: ]|still not connected)/.test(String(c[0]))
    );
    const events = initCalls.map((c) => (c[c.length - 1] as { event?: string })?.event);
    expect(events).toEqual(
      expect.arrayContaining([
        "quonfig.init.start",
        "quonfig.init.retrying",
        "quonfig.init.failed",
        "quonfig.init.recovered",
      ])
    );
    for (const e of events) expect(e).toMatch(/^quonfig\.init\.[a-z_]+$/);
    await q.close();
  });
});

describe("heal line names the primary when no HTTP leg is recorded", () => {
  it("healDetail maps an unknown leg (-1) to primary", () => {
    const q = makeClient();
    (q as any).resolvedFromIndex = -1;
    expect((q as any).healDetail()).toMatch(/^ via primary/);
  });
});
