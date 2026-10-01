// Duration grammar + malformed-value contract (qfg-2agi.9).
//
// The grammar cases come straight from the shared fixture
// integration-test-data/tests/duration/grammar.yaml (qfg-2agi.29), the ONE
// definition of which duration strings Quonfig accepts and their integer
// millisecond values. The malformed-value contract (plan decision 3,
// project/plans/2026-10-01-duration-validity.md) is asserted through the
// public client over the integration-test-data datadir.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { Quonfig } from "../src/quonfig";
import { durationToMilliseconds, parseDurationMillis } from "../src/duration";
import type { Logger } from "../src/sdkLogger";

const ITD = resolve(__dirname, "../../integration-test-data");
const GRAMMAR = resolve(ITD, "tests/duration/grammar.yaml");
const DATADIR = resolve(ITD, "data/integration-tests");

for (const p of [GRAMMAR, DATADIR]) {
  if (!existsSync(p)) {
    throw new Error(
      `[duration tests] ${p} not found. Clone integration-test-data as a sibling to sdk-node.`
    );
  }
}

interface Grammar {
  valid: { value: string; millis: number }[];
  invalid: string[];
}
const grammar = yaml.load(readFileSync(GRAMMAR, "utf-8")) as Grammar;

describe("duration grammar fixture (integration-test-data/tests/duration/grammar.yaml)", () => {
  it("fixture is non-empty", () => {
    expect(grammar.valid.length).toBeGreaterThan(10);
    expect(grammar.invalid.length).toBeGreaterThan(10);
  });

  for (const { value, millis } of grammar.valid) {
    it(`valid ${JSON.stringify(value)} -> ${millis} ms`, () => {
      expect(parseDurationMillis(value)).toBe(millis);
      expect(durationToMilliseconds(value)).toBe(millis);
    });
  }

  for (const value of grammar.invalid) {
    it(`invalid ${JSON.stringify(value)} is rejected`, () => {
      expect(parseDurationMillis(value)).toBeUndefined();
      // The public helper keeps its number return type; malformed input maps to
      // its documented 0 fallback instead of a misread value.
      expect(durationToMilliseconds(value)).toBe(0);
    });
  }
});

describe("malformed duration contract through the public client", () => {
  const ENV = {
    QUONFIG_ITD_DURATION_PT1_5S: "PT1.5S",
    QUONFIG_ITD_DURATION_30S: "30s",
    QUONFIG_ITD_DURATION_PT0_5H: "PT0.5H",
    QUONFIG_ITD_DURATION_P1DT: "P1DT",
    QUONFIG_ITD_DURATION_GARBAGE: "garbage",
  };
  const STORED = [
    "test.duration.malformed.30s",
    "test.duration.malformed.PT0.5H",
    "test.duration.malformed.P1DT",
    "test.duration.malformed.garbage",
    "test.duration.malformed.empty",
  ];
  const PROVIDED = [
    "provided.duration.malformed.30s",
    "provided.duration.malformed.PT0.5H",
    "provided.duration.malformed.P1DT",
    "provided.duration.malformed.garbage",
  ];

  const warn = vi.fn();
  const logger: Logger = { debug: () => {}, info: () => {}, warn, error: () => {} };
  let ignoring: Quonfig;
  let raising: Quonfig;

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    const base = {
      sdkKey: "test-sdk-key",
      datadir: DATADIR,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none" as const,
      logger,
    };
    ignoring = new Quonfig({ ...base, onNoDefault: "ignore" });
    raising = new Quonfig({ ...base, onNoDefault: "error" });
    await ignoring.init();
    await raising.init();
  });

  afterAll(() => {
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("env-var-provided PT1.5S -> 1500 via getDuration", () => {
    expect(ignoring.getDuration("provided.duration.PT1.5S")).toBe(1500);
  });

  // qfg-2agi.22: the return type must not depend on where the value came from.
  // A stored duration comes back from get() as integer ms, so an ENV_VAR one must too.
  it("env-var-provided PT1.5S -> 1500 via get (not the ISO string)", () => {
    expect(ignoring.get("provided.duration.PT1.5S")).toBe(1500);
    expect(ignoring.getNumberDetails("provided.duration.PT1.5S").value).toBe(1500);
  });

  for (const key of [...STORED, ...PROVIDED]) {
    it(`${key}: getDuration with no default returns undefined`, () => {
      expect(ignoring.getDuration(key)).toBeUndefined();
    });

    it(`${key}: get with a default returns the default`, () => {
      expect(ignoring.get(key, {}, 7000)).toBe(7000);
    });

    it(`${key}: raising client throws instead of returning a value`, () => {
      expect(() => raising.getDuration(key)).toThrow(Error);
    });

    it(`${key}: getNumberDetails reports ERROR with an errorCode`, () => {
      const details = ignoring.getNumberDetails(key);
      expect(details.value).toBeUndefined();
      expect(details.reason).toBe("ERROR");
      expect(details.errorCode).toBeDefined();
    });
  }

  it("warns once per key", () => {
    warn.mockClear();
    const key = "test.duration.malformed.garbage";
    const fresh = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir: DATADIR,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      onNoDefault: "ignore",
      logger,
    });
    return fresh.init().then(() => {
      fresh.getDuration(key);
      fresh.getDuration(key);
      fresh.get(key, {}, 1);
      const calls = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(key));
      expect(calls).toHaveLength(1);
    });
  });
});
