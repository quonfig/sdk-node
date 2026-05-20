// Code generated from integration-test-data/tests/eval/datadir_value_type.yaml. DO NOT EDIT.
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

describe("datadir_value_type", () => {
  it("datadir int config value is loaded as a number, not a string", async () => {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: TEST_DATA_DIR,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    expect(client.get("brand.new.int", {})).toBe(123);
    const __raw = client.rawConfig("brand.new.int");
    expect(__raw, "rawConfig(brand.new.int) should be loaded").toBeDefined();
    const __rawValue = __raw!.default.rules[0].value.value;
    expect(
      typeof __rawValue,
      `datadir loader must coerce brand.new.int to a number, got ${typeof __rawValue} (${JSON.stringify(__rawValue)})`
    ).toBe("number");
  });

  it("datadir double config value is loaded as a number, not a string", async () => {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: TEST_DATA_DIR,
      environment: "Production",
      enableSSE: false,
      enablePolling: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
    });
    await client.init();
    expect(client.get("my-double-key", {})).toBe(9.95);
    const __raw = client.rawConfig("my-double-key");
    expect(__raw, "rawConfig(my-double-key) should be loaded").toBeDefined();
    const __rawValue = __raw!.default.rules[0].value.value;
    expect(
      typeof __rawValue,
      `datadir loader must coerce my-double-key to a number, got ${typeof __rawValue} (${JSON.stringify(__rawValue)})`
    ).toBe("number");
  });
});
