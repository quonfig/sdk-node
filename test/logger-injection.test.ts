import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import { normalizeLogger } from "../src/sdkLogger";
import type { Logger } from "../src/sdkLogger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function spyLogger() {
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const debugCalls: unknown[][] = [];
  const infoCalls: unknown[][] = [];
  const logger: Logger = {
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
    error: (...args: unknown[]) => {
      errorCalls.push(args);
    },
    debug: (...args: unknown[]) => {
      debugCalls.push(args);
    },
    info: (...args: unknown[]) => {
      infoCalls.push(args);
    },
  };
  return Object.assign(logger, { warnCalls, errorCalls, debugCalls, infoCalls });
}

describe("pluggable Logger option", () => {
  it("routes transport telemetry-POST failures to the supplied logger (not console.warn)", async () => {
    const logger = spyLogger();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server boom"),
    } as any);

    const transport = new Transport(
      ["https://api.example.com"],
      "test-key",
      "https://telemetry.example.com",
      undefined,
      logger
    );

    await transport.postTelemetry({ instanceHash: "h", events: [] } as any);

    expect(logger.warnCalls.length).toBe(1);
    const msg = String(logger.warnCalls[0][0]);
    expect(msg).toContain("Telemetry POST failed");
    expect(msg).toContain("500");
    expect(msg).not.toContain("[quonfig]");
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("falls back to console.warn with [quonfig] prefix when no logger is supplied", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
    } as any);

    const transport = new Transport(
      ["https://api.example.com"],
      "test-key",
      "https://telemetry.example.com"
    );

    await transport.postTelemetry({ instanceHash: "h", events: [] } as any);

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    const args = consoleWarn.mock.calls[0];
    expect(String(args[0])).toContain("[quonfig]");
    expect(String(args[0])).toContain("Telemetry POST failed");
  });

  it("does not throw when the supplied logger lacks debug/info and those levels are emitted", () => {
    const minimalLogger: Logger = {
      warn: () => {},
      error: () => {},
    };
    const normalized = normalizeLogger(minimalLogger);
    expect(() => normalized.debug("hi")).not.toThrow();
    expect(() => normalized.info("hi")).not.toThrow();
  });

  it("Quonfig accepts a logger option and routes shouldLog warnings through it", () => {
    const logger = spyLogger();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const quonfig = new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      logger,
    });

    const result = quonfig.shouldLog({
      configKey: "log-level.foo",
      desiredLevel: "NOT-A-LEVEL",
    });

    expect(result).toBe(true);
    expect(logger.warnCalls.length).toBe(1);
    expect(String(logger.warnCalls[0][0])).toContain("Invalid desiredLevel");
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
