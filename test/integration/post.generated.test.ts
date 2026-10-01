// Code generated from integration-test-data/tests/eval/post.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { collectTelemetry, telemetryPost, TELEMETRY_PROBE_KEY } from "./setup";

describe("post", () => {
  it("reports context shape aggregation", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({ contextUploadMode: "shapes_only" }, (client) => {
      client.get(TELEMETRY_PROBE_KEY, {
        user: { name: "Michael", age: 38, human: true },
        role: { name: "developer", admin: false, salary: 15.75, permissions: ["read", "write"] },
      });
    });
    expect(telemetryPost(posted, "context_shape", observed)).toEqual([
      { name: "user", field_types: { name: 2, age: 1, human: 5 } },
      { name: "role", field_types: { name: 2, admin: 5, salary: 4, permissions: 10 } },
    ]);
  });

  it("reports evaluation summary", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      const scope = client.withContext({ user: { tracking_id: "92a202f2" } });
      observed.set("my-test-key", scope.get("my-test-key"));
      observed.set("feature-flag.integer", scope.get("feature-flag.integer"));
      observed.set("my-string-list-key", scope.get("my-string-list-key"));
      observed.set("feature-flag.integer", scope.get("feature-flag.integer"));
      observed.set("feature-flag.weighted", scope.get("feature-flag.weighted"));
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
      {
        key: "feature-flag.integer",
        type: "FEATURE_FLAG",
        value: 3,
        value_type: "int",
        count: 2,
        reason: 2,
        selected_value: { int: 3 },
        summary: { config_row_index: 0, conditional_value_index: 1 },
      },
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

  it("reports example contexts", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      client.get(TELEMETRY_PROBE_KEY, {
        user: { name: "michael", age: 38, key: "michael:1234" },
        device: { mobile: false },
        team: { id: 3.5 },
      });
    });
    expect(telemetryPost(posted, "example_contexts", observed)).toEqual({
      user: { name: "michael", age: 38, key: "michael:1234" },
      device: { mobile: false },
      team: { id: 3.5 },
    });
  });

  it("example contexts without key are not reported", async () => {
    const observed = new Map<string, unknown>();
    const posted = await collectTelemetry({}, (client) => {
      client.get(TELEMETRY_PROBE_KEY, {
        user: { name: "michael", age: 38 },
        device: { mobile: false },
        team: { id: 3.5 },
      });
    });
    expect(telemetryPost(posted, "example_contexts", observed)).toEqual(undefined);
  });
});
