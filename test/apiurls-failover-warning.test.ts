import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { Logger } from "../src/sdkLogger";

// qfg-41nh.26: The default (and every QUONFIG_DOMAIN-derived) apiUrls list
// carries a primary and a secondary leg, and the SDK hedges/fails over between
// them. An explicit `apiUrls` with a single entry silently drops the secondary,
// so we emit a one-time WARN at init pointing the caller at the fix.

const FAILOVER_WARN_FRAGMENT = "explicit apiUrls disables automatic failover";

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

function failoverWarnings(logger: ReturnType<typeof spyLogger>): unknown[][] {
  return logger.warnCalls.filter((args) => String(args[0]).includes(FAILOVER_WARN_FRAGMENT));
}

describe("explicit apiUrls failover warning", () => {
  it("warns when a single explicit apiUrl disables failover", () => {
    const logger = spyLogger();

    new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      apiUrls: ["https://primary.example.test"],
      logger,
    });

    const warnings = failoverWarnings(logger);
    expect(warnings.length).toBe(1);
    const msg = String(warnings[0][0]);
    expect(msg).toContain("pass both primary and secondary URLs to keep it");
  });

  it("does NOT warn when two explicit apiUrls preserve failover", () => {
    const logger = spyLogger();

    new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      apiUrls: ["https://primary.example.test", "https://secondary.example.test"],
      logger,
    });

    expect(failoverWarnings(logger).length).toBe(0);
  });

  it("does NOT warn on the default QUONFIG_DOMAIN-derived two-URL list", () => {
    const logger = spyLogger();

    new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      logger,
    });

    expect(failoverWarnings(logger).length).toBe(0);
  });
});
