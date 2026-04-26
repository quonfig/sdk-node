// Code generated from integration-test-data/tests/eval/datadir_environment.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import * as path from "path";
import { Quonfig } from "../../src/quonfig";

const TEST_DATA_DIR = path.resolve(
  __dirname,
  "../../../integration-test-data/data/integration-tests"
);

describe("datadir_environment", () => {

  it("datadir with environment option gets environment-specific value", async () => {
    const client = new Quonfig({ sdkKey: "test-unused", datadir: TEST_DATA_DIR, environment: "Production", enableSSE: false, enablePolling: false, collectEvaluationSummaries: false, contextUploadMode: "none" });
    await client.init();
    expect(client.get("james.test.key", {})).toBe("test4");
  });

  it("datadir with QUONFIG_ENVIRONMENT env var gets environment-specific value", async () => {
    const __prev: Record<string, string | undefined> = {};
    const __envVars = { QUONFIG_ENVIRONMENT: "Production" };
    for (const [k, v] of Object.entries(__envVars)) { __prev[k] = process.env[k]; process.env[k] = v; }
    try {
      const client = new Quonfig({ sdkKey: "test-unused", datadir: TEST_DATA_DIR, enableSSE: false, enablePolling: false, collectEvaluationSummaries: false, contextUploadMode: "none" });
      await client.init();
      expect(client.get("james.test.key", {})).toBe("test4");
    } finally {
      for (const [k, v] of Object.entries(__prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it("environment option supersedes QUONFIG_ENVIRONMENT env var", async () => {
    const __prev: Record<string, string | undefined> = {};
    const __envVars = { QUONFIG_ENVIRONMENT: "nonexistent" };
    for (const [k, v] of Object.entries(__envVars)) { __prev[k] = process.env[k]; process.env[k] = v; }
    try {
      const client = new Quonfig({ sdkKey: "test-unused", datadir: TEST_DATA_DIR, environment: "Production", enableSSE: false, enablePolling: false, collectEvaluationSummaries: false, contextUploadMode: "none" });
      await client.init();
      expect(client.get("james.test.key", {})).toBe("test4");
    } finally {
      for (const [k, v] of Object.entries(__prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it("config without environment override returns default value", async () => {
    const client = new Quonfig({ sdkKey: "test-unused", datadir: TEST_DATA_DIR, environment: "Production", enableSSE: false, enablePolling: false, collectEvaluationSummaries: false, contextUploadMode: "none" });
    await client.init();
    expect(client.get("config.with.only.default.env.row", {})).toBe("hello from no env row");
  });

  it("datadir without environment fails to init", async () => {
    const client = new Quonfig({ sdkKey: "test-unused", datadir: TEST_DATA_DIR, enableSSE: false, enablePolling: false, collectEvaluationSummaries: false, contextUploadMode: "none" });
    await expect(client.init()).rejects.toThrow(Error);
  });

  it("datadir with invalid environment fails to init", async () => {
    const client = new Quonfig({ sdkKey: "test-unused", datadir: TEST_DATA_DIR, environment: "nonexistent", enableSSE: false, enablePolling: false, collectEvaluationSummaries: false, contextUploadMode: "none" });
    await expect(client.init()).rejects.toThrow(Error);
  });
});
