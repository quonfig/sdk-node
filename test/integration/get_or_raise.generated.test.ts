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
  onInitFailure: string
): Promise<void> {
  // sdk-node has no on_init_failure option; its only behaviour is :raise (init() rejects).
  expect(onInitFailure).toBe("raise");
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
  await expect(client.init()).rejects.toThrow(/^Initialization timed out$/);
}

async function assertClientConstructionRaises(
  key: string,
  timeoutSec: number,
  apiURL: string,
  onInitFailure: string,
  _fn: string,
  errMatcher: RegExp
): Promise<void> {
  // sdk-node has no on_init_failure option, so :return (init failure -> keep
  // going and evaluate with no config) cannot be expressed. Fail loudly
  // rather than assert on whatever an uninitialized client throws.
  if (onInitFailure !== "raise")
    throw new Error(`sdk-node has no on_init_failure=${onInitFailure} option`);
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
  await expect(client.init()).rejects.toThrow();
  expect(() => client.get(key)).toThrow(errMatcher);
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
      expect(() => client.getString("my-missing-key")).toThrow(/^No value found for key "/);
    });
  });

  it("get_or_raise returns a default value instead of raising", async () => {
    await withClient({}, (client) => {
      expect(client.get("my-missing-key", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  // unsupported by sdk-node: sdk-node has no on_init_failure option: init() always rejects when initTimeout elapses and the client stays uninitialized, so a getter throws "Not initialized", never the :return-mode missing_default error
  it.skip("get_or_raise raises the correct error if it doesn't raise on init timeout", async () => {
    await assertClientConstructionRaises(
      "any-key",
      0.01,
      "https://app.staging-prefab.cloud",
      "return",
      "get_or_raise",
      /^No value found for key "/
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
      expect(() => client.getString("provided.by.missing.env.var")).toThrow(
        /^Environment variable ".*" not set for config "/
      );
    });
  });

  it("raises an error if an env-var-provided config cannot be coerced to configured type", async () => {
    await withClient({}, (client) => {
      expect(() => client.getNumber("provided.not.a.number")).toThrow(
        /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error for decryption failure", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("a.broken.secret.config")).toThrow(
        /^(Invalid key length|Invalid encrypted string|Unsupported state or unable to authenticate data)/
      );
    });
  });

  it("raises an error if an env-var-provided duration 30s cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_30S: "30s" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.30s")).toThrow(
          /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if an env-var-provided duration PT0.5H cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_PT0_5H: "PT0.5H" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.PT0.5H")).toThrow(
          /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if an env-var-provided duration P1DT cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_P1DT: "P1DT" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.P1DT")).toThrow(
          /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if an env-var-provided duration garbage cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_GARBAGE: "garbage" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.garbage")).toThrow(
          /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if a stored duration 30s cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.30s")).toThrow(
        /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration PT0.5H cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.PT0.5H")).toThrow(
        /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration P1DT cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.P1DT")).toThrow(
        /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration garbage cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.garbage")).toThrow(
        /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration empty cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.empty")).toThrow(
        /^(Cannot convert ".*" to (int|double)|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });
});
