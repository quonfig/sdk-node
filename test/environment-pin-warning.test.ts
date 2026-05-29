import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { Logger } from "../src/sdkLogger";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
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

function pinWarnings(logger: ReturnType<typeof spyLogger>): unknown[][] {
  return logger.warnCalls.filter((args) =>
    String(args[0]).includes("the client is in delivery (SDK-key) mode")
  );
}

/**
 * Minimal datadir layout so a datadir-mode client can be constructed.
 */
function createDatadir(environment: string): string {
  const dir = mkdtempSync(join(tmpdir(), "quonfig-env-pin-"));
  tempDirs.push(dir);
  const envDir = join(dir, "environments", environment);
  mkdirSync(join(envDir, "configs"), { recursive: true });
  mkdirSync(join(envDir, "feature-flags"), { recursive: true });
  mkdirSync(join(envDir, "segments"), { recursive: true });
  writeFileSync(
    join(dir, "quonfig.json"),
    JSON.stringify({ environments: [{ id: environment, name: environment }] })
  );
  return dir;
}

describe("environment pin warning in delivery mode", () => {
  it("warns when an environment pin is set in delivery (SDK-key) mode", () => {
    const logger = spyLogger();

    new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      environment: "production",
      logger,
    });

    const warnings = pinWarnings(logger);
    expect(warnings.length).toBe(1);
    const msg = String(warnings[0][0]);
    expect(msg).toContain("'production'");
    expect(msg).toContain("delivery (SDK-key) mode");
    expect(msg).toContain("ignored");
  });

  it("warns when the pin comes from QUONFIG_ENVIRONMENT in delivery mode", () => {
    vi.stubEnv("QUONFIG_ENVIRONMENT", "staging");
    const logger = spyLogger();

    new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      logger,
    });

    const warnings = pinWarnings(logger);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("'staging'");
  });

  it("does NOT warn in datadir mode even when the pin is set", () => {
    const datadir = createDatadir("Production");
    const logger = spyLogger();

    new Quonfig({
      datadir,
      environment: "Production",
      logger,
    });

    expect(pinWarnings(logger).length).toBe(0);
  });

  it("does NOT warn in delivery mode when no pin is set", () => {
    vi.stubEnv("QUONFIG_ENVIRONMENT", "");
    const logger = spyLogger();

    new Quonfig({
      sdkKey: "qf_sk_test_0001_x",
      logger,
    });

    expect(pinWarnings(logger).length).toBe(0);
  });
});
