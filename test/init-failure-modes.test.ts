/**
 * qfg-9p4i.10 (node minor): onInitFailure fail | wait | continue, the
 * readiness API (isReady / waitForReady), QuonfigInitError and the init
 * logging contract.
 *
 * Spec: project/plans/2026-10-05-init-failure-design.md (Decisions, B.1-B.4, C).
 * The ITD get_or_raise init cases cover fail/continue against real sockets;
 * these cover wait, heal and the log lines with a mocked transport.
 */
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
const downLeg = (i: number): LegResult => ({
  error: new Error("Unexpected status 503: down"),
  status: 503,
  sourceIndex: i,
});
const authLeg = (i: number): LegResult => ({
  error: new Error("Unexpected status 401"),
  status: 401,
  sourceIndex: i,
});

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeClient(extra: Record<string, unknown> = {}, log = logger()): Quonfig {
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

function allLines(log: ReturnType<typeof logger>): string[] {
  return [log.debug, log.info, log.warn, log.error].flatMap((fn) =>
    fn.mock.calls.map((c) => c.map(String).join(" "))
  );
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onInitFailure (qfg-9p4i.10)", () => {
  it("rejects an unknown onInitFailure value at construction", () => {
    expect(() => makeClient({ onInitFailure: "raise" })).toThrow(
      /onInitFailure must be one of "fail", "wait" or "continue"/
    );
  });

  it("fail (default) retries until initTimeout, then rejects with QuonfigInitError and logs the contract lines", async () => {
    spyOnSendTelemetry();
    const fetchSpy = vi
      .spyOn(Transport.prototype, "fetchFromUrlAt")
      .mockImplementation(async (i: number) => downLeg(i));
    const log = logger();
    const q = makeClient({ initTimeout: 150 }, log);

    const err = await q.init().catch((e) => e);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.name).toBe("QuonfigInitError");
    expect(err.reason).toBe("unavailable");
    expect(err.message).toContain("primary=primary.example.test: Unexpected status 503: down");
    expect(err.message).toContain("secondary=secondary.example.test");
    // It retried through the blip rather than failing on the first attempt.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(2);

    expect(log.debug).toHaveBeenCalledWith(
      "[quonfig] init: fetching config (initTimeout=0.15s, onInitFailure=fail)"
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[quonfig] init: config not loaded yet, retrying until initTimeout (0.15s). primary=primary.example.test:"
      )
    );
    expect(log.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[quonfig\] init FAILED: no config after 0\.\ds\. primary=.*onInitFailure=fail: raising QuonfigInitError\. Options: onInitFailure=wait to keep waiting, onInitFailure=continue to start on code defaults, or raise initTimeout\.$/
      )
    );
    for (const line of allLines(log)) expect(line).not.toContain("qf_sk_secret");
    expect(q.isReady()).toBe(false);
    await q.close();
  });

  it("fail rejects at once (reason unauthorized) when every leg answers 401", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      authLeg(i)
    );
    const log = logger();
    const q = makeClient({ initTimeout: 5000 }, log);
    const start = Date.now();
    const err = await q.init().catch((e) => e);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.reason).toBe("unauthorized");
    expect(log.error).toHaveBeenCalledWith(
      "[quonfig] init FAILED: SDK key rejected (401) by primary and secondary. Check the key and environment. onInitFailure=fail: raising now."
    );
    await q.close();
  });

  it("a hang reports reason timeout and keeps the 'Initialization timed out' text", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(() => new Promise(() => {}));
    const q = makeClient({ initTimeout: 50 });
    const err = await q.init().catch((e) => e);
    expect(err.reason).toBe("timeout");
    expect(err.message).toContain("Initialization timed out");
    await q.close();
  });

  it("wait keeps blocking past initTimeout and resolves once config loads", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      down ? downLeg(i) : okLeg(i)
    );
    const log = logger();
    const q = makeClient({ initTimeout: 50, onInitFailure: "wait" }, log);
    let settled = false;
    const p = q.init().then(() => (settled = true));

    await new Promise((r) => setTimeout(r, 150));
    expect(settled).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[quonfig\] init: no config after 0\.\ds\. onInitFailure=wait: still blocking startup and retrying indefinitely\. primary=.*Use onInitFailure=fail or continue to bound startup\.$/
      )
    );

    down = false;
    await p;
    expect(q.isReady()).toBe(true);
    expect(q.isEnabled("my.flag")).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[quonfig\] init recovered: config loaded after \d+\.\ds via primary \(version v7\)\. Now serving live config\.$/
      )
    );
    await q.close();
  });

  it("close() during a wait settles init() and rejects pending waitForReady()", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      downLeg(i)
    );
    const q = makeClient({ initTimeout: 20, onInitFailure: "wait" });
    const p = q.init();
    const ready = q.waitForReady().catch((e) => e);
    await new Promise((r) => setTimeout(r, 60));
    await q.close();
    await p;
    const err = await ready;
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.reason).toBe("unavailable");
  });

  it("continue resolves on code defaults, serves PROVIDER_NOT_READY, then heals in the background", async () => {
    spyOnSendTelemetry();
    let down = true;
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      down ? downLeg(i) : okLeg(i)
    );
    const log = logger();
    const q = makeClient({ initTimeout: 50, onInitFailure: "continue" }, log);

    await q.init();
    expect(q.isReady()).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[quonfig\] init: no config after 0\.\ds\. onInitFailure=continue: STARTING ON CODE DEFAULTS\. This instance may disagree with the rest of your fleet\. Retrying in background\. primary=/
      )
    );
    expect(q.get("my.flag", {}, "fallback")).toBe("fallback");
    const details = q.getBoolDetails("my.flag");
    expect(details.reason).toBe("ERROR");
    expect(details.errorCode).toBe("PROVIDER_NOT_READY");

    const ready = q.waitForReady({ timeoutMs: 2000 });
    down = false;
    await ready;
    expect(q.isReady()).toBe(true);
    expect(q.isEnabled("my.flag")).toBe(true);
    await q.close();
  });

  it("waitForReady({ timeoutMs }) rejects with reason timeout when still not ready", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      downLeg(i)
    );
    const q = makeClient({ initTimeout: 20, onInitFailure: "continue" });
    await q.init();
    const err = await q.waitForReady({ timeoutMs: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(QuonfigInitError);
    expect(err.reason).toBe("timeout");
    await q.close();
  });

  it("a healthy boot logs nothing above DEBUG about init and isReady() flips true", async () => {
    spyOnSendTelemetry();
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockImplementation(async (i: number) =>
      okLeg(i)
    );
    const log = logger();
    const q = makeClient({}, log);
    expect(q.isReady()).toBe(false);
    await q.init();
    await q.waitForReady();
    expect(q.isReady()).toBe(true);
    const loud = [...log.warn.mock.calls, ...log.error.mock.calls].map((c) => String(c[0]));
    expect(loud.filter((l) => l.includes("init"))).toEqual([]);
    await q.close();
  });
});
