// Code generated from integration-test-data/tests/eval/datadir_environment.yaml. DO NOT EDIT.

import { describe, it, expect, afterEach } from "vitest";
import * as path from "path";
import { Quonfig } from "../../src/quonfig";

const testDataDir = path.resolve(
  __dirname,
  "../../../integration-test-data/data/integration-tests"
);

describe("datadir_environment", () => {
  // Clean up QUONFIG_ENVIRONMENT after each test to avoid leaking between tests
  const originalEnv = process.env.QUONFIG_ENVIRONMENT;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.QUONFIG_ENVIRONMENT;
    } else {
      process.env.QUONFIG_ENVIRONMENT = originalEnv;
    }
  });

  it("datadir with environment option gets environment-specific value", async () => {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: testDataDir,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    expect(client.get("james.test.key", {})).toBe("test4");
  });

  it("datadir with QUONFIG_ENVIRONMENT env var gets environment-specific value", async () => {
    process.env.QUONFIG_ENVIRONMENT = "Production";

    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: testDataDir,
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    expect(client.get("james.test.key", {})).toBe("test4");
  });

  it("environment option supersedes QUONFIG_ENVIRONMENT env var", async () => {
    process.env.QUONFIG_ENVIRONMENT = "nonexistent";

    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: testDataDir,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    expect(client.get("james.test.key", {})).toBe("test4");
  });

  it("config without environment override returns default value", async () => {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: testDataDir,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    expect(client.get("config.with.only.default.env.row", {})).toBe(
      "hello from no env row"
    );
  });

  it("datadir without environment fails to init", async () => {
    delete process.env.QUONFIG_ENVIRONMENT;

    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: testDataDir,
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await expect(client.init()).rejects.toThrow(/environment/i);
  });

  it("datadir with invalid environment fails to init", async () => {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: testDataDir,
      environment: "nonexistent",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await expect(client.init()).rejects.toThrow(/nonexistent/i);
  });
});
