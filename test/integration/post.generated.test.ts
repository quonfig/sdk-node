// Code generated from integration-test-data/tests/eval/post.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";
import { buildAggregator, feedAggregator, aggregatorPost } from "./aggregator-helpers";

describe("post", () => {
  it("reports context shape aggregation", () => {
    const aggregator = buildAggregator("context_shape", { context_upload_mode: ":shape_only" });
    feedAggregator(
      aggregator,
      "context_shape",
      {
        user: { name: "Michael", age: 38, human: true },
        role: { name: "developer", admin: false, salary: 15.75, permissions: ["read", "write"] },
      },
      {}
    );
    expect(aggregatorPost(aggregator, "context_shape", "/api/v1/context-shapes")).toEqual([
      { name: "user", field_types: { name: 2, age: 1, human: 5 } },
      { name: "role", field_types: { name: 2, admin: 5, salary: 4, permissions: 10 } },
    ]);
  });

  it("reports evaluation summary", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      {
        keys: [
          "my-test-key",
          "feature-flag.integer",
          "my-string-list-key",
          "feature-flag.integer",
          "feature-flag.weighted",
        ],
      },
      mergeContexts({ user: { tracking_id: "92a202f2" } } as Contexts)
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("reports example contexts", () => {
    const aggregator = buildAggregator("example_contexts", {});
    feedAggregator(
      aggregator,
      "example_contexts",
      {
        user: { name: "michael", age: 38, key: "michael:1234" },
        device: { mobile: false },
        team: { id: 3.5 },
      },
      {}
    );
    expect(aggregatorPost(aggregator, "example_contexts", "/api/v1/telemetry")).toEqual({
      user: { name: "michael", age: 38, key: "michael:1234" },
      device: { mobile: false },
      team: { id: 3.5 },
    });
  });

  it("example contexts without key are not reported", () => {
    const aggregator = buildAggregator("example_contexts", {});
    feedAggregator(
      aggregator,
      "example_contexts",
      { user: { name: "michael", age: 38 }, device: { mobile: false }, team: { id: 3.5 } },
      {}
    );
    expect(aggregatorPost(aggregator, "example_contexts", "/api/v1/telemetry")).toEqual(undefined);
  });
});
