// Code generated from integration-test-data/tests/eval/telemetry.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { collectTelemetry, telemetryPost, TELEMETRY_PROBE_KEY } from "./setup";

describe("telemetry", () => {
  it("reason is STATIC for config with no targeting rules", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.string", client.get("brand.new.string"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.string",
        type: "CONFIG",
        value: "hello.world",
        value_type: "string",
        count: 1,
        reason: 1,
        selected_value: { string: "hello.world" },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("reason is STATIC for feature flag with only ALWAYS_TRUE rules", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("always.true", client.get("always.true"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "always.true",
        type: "FEATURE_FLAG",
        value: true,
        value_type: "bool",
        count: 1,
        reason: 1,
        selected_value: { bool: true },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("reason is TARGETING_MATCH when config has targeting rules but evaluation falls through", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("my-test-key", client.get("my-test-key"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "my-test-key",
        type: "CONFIG",
        value: "my-test-value",
        value_type: "string",
        count: 1,
        reason: 2,
        selected_value: { string: "my-test-value" },
        summary: { config_row_index: 0, conditional_value_index: 1 },
      },
    ]);
  });

  it("reason is TARGETING_MATCH when a targeting rule matches", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      const scope = client.withContext({ user: { key: "michael" } });
      observed.set("feature-flag.integer", scope.get("feature-flag.integer"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "feature-flag.integer",
        type: "FEATURE_FLAG",
        value: 5,
        value_type: "int",
        count: 1,
        reason: 2,
        selected_value: { int: 5 },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("reason is SPLIT for weighted value evaluation", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      const scope = client.withContext({ user: { tracking_id: "92a202f2" } });
      observed.set("feature-flag.weighted", scope.get("feature-flag.weighted"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "feature-flag.weighted",
        type: "FEATURE_FLAG",
        value: 2,
        value_type: "int",
        count: 1,
        reason: 3,
        selected_value: { int: 2 },
        summary: { config_row_index: 0, conditional_value_index: 0, weighted_value_index: 2 },
      },
    ]);
  });

  it("reason is SPLIT for weighted value landing in bucket 0", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      const scope = client.withContext({ user: { tracking_id: "3e9459d6" } });
      observed.set("feature-flag.weighted", scope.get("feature-flag.weighted"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "feature-flag.weighted",
        type: "FEATURE_FLAG",
        value: 1,
        value_type: "int",
        count: 1,
        reason: 3,
        selected_value: { int: 1 },
        summary: { config_row_index: 0, conditional_value_index: 0, weighted_value_index: 0 },
      },
    ]);
  });

  it("reason is TARGETING_MATCH for feature flag fallthrough with targeting rules", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("feature-flag.integer", client.get("feature-flag.integer"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "feature-flag.integer",
        type: "FEATURE_FLAG",
        value: 3,
        value_type: "int",
        count: 1,
        reason: 2,
        selected_value: { int: 3 },
        summary: { config_row_index: 0, conditional_value_index: 1 },
      },
    ]);
  });

  it("evaluation summary deduplicates identical evaluations", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.string", client.get("brand.new.string"));
      observed.set("brand.new.string", client.get("brand.new.string"));
      observed.set("brand.new.string", client.get("brand.new.string"));
      observed.set("brand.new.string", client.get("brand.new.string"));
      observed.set("brand.new.string", client.get("brand.new.string"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.string",
        type: "CONFIG",
        value: "hello.world",
        value_type: "string",
        count: 5,
        reason: 1,
        selected_value: { string: "hello.world" },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("evaluation summary creates separate counters for different rules of same config", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      const scope = client.withContext({ user: { key: "michael" } });
      observed.set("feature-flag.integer", scope.get("feature-flag.integer"));
      observed.set("feature-flag.integer", client.get("feature-flag.integer"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "feature-flag.integer",
        type: "FEATURE_FLAG",
        value: 5,
        value_type: "int",
        count: 1,
        reason: 2,
        selected_value: { int: 5 },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
      {
        key: "feature-flag.integer",
        type: "FEATURE_FLAG",
        value: 3,
        value_type: "int",
        count: 1,
        reason: 2,
        selected_value: { int: 3 },
        summary: { config_row_index: 0, conditional_value_index: 1 },
      },
    ]);
  });

  it("evaluation summary groups by config key", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.string", client.get("brand.new.string"));
      observed.set("always.true", client.get("always.true"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.string",
        type: "CONFIG",
        value: "hello.world",
        value_type: "string",
        count: 1,
        reason: 1,
        selected_value: { string: "hello.world" },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
      {
        key: "always.true",
        type: "FEATURE_FLAG",
        value: true,
        value_type: "bool",
        count: 1,
        reason: 1,
        selected_value: { bool: true },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("selectedValue wraps string correctly", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.string", client.get("brand.new.string"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.string",
        type: "CONFIG",
        value: "hello.world",
        value_type: "string",
        count: 1,
        reason: 1,
        selected_value: { string: "hello.world" },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("selectedValue wraps boolean correctly", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.boolean", client.get("brand.new.boolean"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.boolean",
        type: "CONFIG",
        value: false,
        value_type: "bool",
        count: 1,
        reason: 1,
        selected_value: { bool: false },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("selectedValue wraps int correctly", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.int", client.get("brand.new.int"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.int",
        type: "CONFIG",
        value: 123,
        value_type: "int",
        count: 1,
        reason: 1,
        selected_value: { int: 123 },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("selectedValue wraps double correctly", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("brand.new.double", client.get("brand.new.double"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "brand.new.double",
        type: "CONFIG",
        value: 123.99,
        value_type: "double",
        count: 1,
        reason: 1,
        selected_value: { double: 123.99 },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("selectedValue wraps string list correctly", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("my-string-list-key", client.get("my-string-list-key"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "my-string-list-key",
        type: "CONFIG",
        value: ["a", "b", "c"],
        value_type: "string_list",
        count: 1,
        reason: 1,
        selected_value: { stringList: ["a", "b", "c"] },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("context shape merges fields across multiple records", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      client.get(TELEMETRY_PROBE_KEY, { user: { name: "alice", age: 30 } });
      client.get(TELEMETRY_PROBE_KEY, {
        user: { name: "bob", score: 9.5 },
        team: { name: "engineering" },
      });
    });
    expect(telemetryPost(posted, "context_shape", observed)).toEqual([
      { name: "user", field_types: { name: 2, age: 1, score: 4 } },
      { name: "team", field_types: { name: 2 } },
    ]);
  });

  it("example contexts deduplicates by key value", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      client.get(TELEMETRY_PROBE_KEY, { user: { key: "user-123", name: "alice" } });
      client.get(TELEMETRY_PROBE_KEY, { user: { key: "user-123", name: "bob" } });
    });
    expect(telemetryPost(posted, "example_contexts", observed)).toEqual({
      user: { key: "user-123", name: "alice" },
    });
  });

  it("telemetry disabled emits nothing", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry(
      { collectEvaluationSummaries: false, contextUploadMode: "none" },
      (client) => {
        observed.set("brand.new.string", client.get("brand.new.string"));
      }
    );
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual(undefined);
  });

  it("shapes only mode reports shapes but not examples", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({ contextUploadMode: "shapes_only" }, (client) => {
      client.get(TELEMETRY_PROBE_KEY, { user: { name: "alice", key: "alice-123" } });
    });
    expect(telemetryPost(posted, "context_shape", observed)).toEqual([
      { name: "user", field_types: { name: 2, key: 2 } },
    ]);
  });

  it("log level evaluations are excluded from telemetry", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set(
        "log-level.prefab.criteria_evaluator",
        client.get("log-level.prefab.criteria_evaluator")
      );
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual(undefined);
  });

  it("empty context produces no context telemetry", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      client.get(TELEMETRY_PROBE_KEY, {});
    });
    expect(telemetryPost(posted, "context_shape", observed)).toEqual(undefined);
  });

  it("confidential plain string is redacted in selectedValue", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("confidential.new.string", client.get("confidential.new.string"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "confidential.new.string",
        type: "CONFIG",
        value: "hello.world",
        value_type: "string",
        count: 1,
        reason: 1,
        selected_value: { string: "*****18aa7" },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });

  it("confidential encrypted string is redacted using ciphertext hash", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      observed.set("a.secret.config", client.get("a.secret.config"));
    });
    expect(telemetryPost(posted, "evaluation_summary", observed)).toEqual([
      {
        key: "a.secret.config",
        type: "CONFIG",
        value: "hello.world",
        value_type: "string",
        count: 1,
        reason: 1,
        selected_value: { string: "*****936c9" },
        summary: { config_row_index: 0, conditional_value_index: 0 },
      },
    ]);
  });
});
