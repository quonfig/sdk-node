// Code generated from integration-test-data/tests/eval/get_or_raise.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient, withEnv } from "./setup";

async function assertInitializationTimeoutError(
  key: string,
  timeoutSec: number,
  apiURL: string,
  _onInitFailure: string
): Promise<void> {
  const { Quonfig } = await import("../../src/quonfig");
  // Use 10.255.255.1 (RFC5737-style unreachable IP) so the fetch hangs and the init timer wins.
  const targetURL = "http://10.255.255.1:8080";
  const client = new Quonfig({
    sdkKey: "test-unused",
    apiUrls: [targetURL],
    enableSSE: false,
    enablePolling: false,
    initTimeout: Math.max(1, Math.floor(timeoutSec * 1000)),
  });
  await expect(client.init()).rejects.toThrow(/initialization|timeout|timed out/i);
}

async function assertClientConstructionRaises(
  key: string,
  timeoutSec: number,
  apiURL: string,
  _onInitFailure: string,
  _fn: string,
  errClass: any
): Promise<void> {
  const { Quonfig } = await import("../../src/quonfig");
  const targetURL = "http://10.255.255.1:8080";
  const client = new Quonfig({
    sdkKey: "test-unused",
    apiUrls: [targetURL],
    enableSSE: false,
    enablePolling: false,
    initTimeout: Math.max(1, Math.floor(timeoutSec * 1000)),
    onNoDefault: "error",
  });
  try {
    await client.init();
  } catch {}
  expect(() => client.get(key)).toThrow(errClass);
}

async function assertClientConstructionValue(
  key: string,
  timeoutSec: number,
  apiURL: string,
  _onInitFailure: string,
  _fn: string
): Promise<unknown> {
  const { Quonfig } = await import("../../src/quonfig");
  const targetURL = "http://10.255.255.1:8080";
  const client = new Quonfig({
    sdkKey: "test-unused",
    apiUrls: [targetURL],
    enableSSE: false,
    enablePolling: false,
    initTimeout: Math.max(1, Math.floor(timeoutSec * 1000)),
  });
  try {
    await client.init();
  } catch {}
  return client.get(key);
}

describe("get_or_raise", () => {
  it("get_or_raise can raise an error if value not found", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("my-missing-key")).toThrow(Error);
    });
  });

  it("get_or_raise returns a default value instead of raising", async () => {
    await withClient({}, (client) => {
      expect(client.get("my-missing-key", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("get_or_raise raises the correct error if it doesn't raise on init timeout", async () => {
    await assertClientConstructionRaises(
      "any-key",
      0.01,
      "https://app.staging-prefab.cloud",
      "return",
      "get_or_raise",
      Error
    );
  });

  it("get_or_raise can raise an error if the client does not initialize in time", async () => {
    await assertInitializationTimeoutError(
      "any-key",
      0.01,
      "https://app.staging-prefab.cloud",
      "raise"
    );
  });

  it("raises an error if a config is provided by a missing environment variable", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("provided.by.missing.env.var")).toThrow(Error);
    });
  });

  it("raises an error if an env-var-provided config cannot be coerced to configured type", async () => {
    await withClient({}, (client) => {
      expect(() => client.getNumber("provided.not.a.number")).toThrow(Error);
    });
  });

  it("raises an error for decryption failure", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("a.broken.secret.config")).toThrow(Error);
    });
  });

  it("raises an error if an env-var-provided duration 30s cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_30S: "30s" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.30s")).toThrow(Error);
      });
    });
  });

  it("raises an error if an env-var-provided duration PT0.5H cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_PT0_5H: "PT0.5H" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.PT0.5H")).toThrow(Error);
      });
    });
  });

  it("raises an error if an env-var-provided duration P1DT cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_P1DT: "P1DT" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.P1DT")).toThrow(Error);
      });
    });
  });

  it("raises an error if an env-var-provided duration garbage cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_GARBAGE: "garbage" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.garbage")).toThrow(Error);
      });
    });
  });

  it("raises an error if a stored duration 30s cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.30s")).toThrow(Error);
    });
  });

  it("raises an error if a stored duration PT0.5H cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.PT0.5H")).toThrow(Error);
    });
  });

  it("raises an error if a stored duration P1DT cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.P1DT")).toThrow(Error);
    });
  });

  it("raises an error if a stored duration garbage cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.garbage")).toThrow(Error);
    });
  });

  it("raises an error if a stored duration empty cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.empty")).toThrow(Error);
    });
  });
});
