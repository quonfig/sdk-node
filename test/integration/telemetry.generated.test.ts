// Code generated from integration-test-data/tests/eval/telemetry.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver, envID } from "./setup";
import { mergeContexts } from "../../src/context";
import type { Contexts } from "../../src/types";
import { buildAggregator, feedAggregator, aggregatorPost } from "./aggregator-helpers";

describe("telemetry", () => {
  it("reason is STATIC for config with no targeting rules", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["brand.new.string"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("reason is STATIC for feature flag with only ALWAYS_TRUE rules", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["always.true"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("reason is TARGETING_MATCH when config has targeting rules but evaluation falls through", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["my-test-key"] }, {});
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
    ]);
  });

  it("reason is TARGETING_MATCH when a targeting rule matches", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      { keys: ["feature-flag.integer"] },
      mergeContexts({ user: { key: "michael" } } as Contexts)
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("reason is SPLIT for weighted value evaluation", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      { keys: ["feature-flag.weighted"] },
      mergeContexts({ user: { tracking_id: "92a202f2" } } as Contexts)
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("reason is TARGETING_MATCH for feature flag fallthrough with targeting rules", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["feature-flag.integer"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("evaluation summary deduplicates identical evaluations", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      {
        keys: [
          "brand.new.string",
          "brand.new.string",
          "brand.new.string",
          "brand.new.string",
          "brand.new.string",
        ],
      },
      {}
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("evaluation summary creates separate counters for different rules of same config", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      { keys: ["feature-flag.integer"], keys_without_context: ["feature-flag.integer"] },
      mergeContexts({ user: { key: "michael" } } as Contexts)
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("evaluation summary groups by config key", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      { keys: ["brand.new.string", "always.true"] },
      {}
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("selectedValue wraps string correctly", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["brand.new.string"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("selectedValue wraps boolean correctly", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["brand.new.boolean"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("selectedValue wraps int correctly", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["brand.new.int"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("selectedValue wraps double correctly", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["brand.new.double"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("selectedValue wraps string list correctly", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["my-string-list-key"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("context shape merges fields across multiple records", () => {
    const aggregator = buildAggregator("context_shape", {});
    feedAggregator(
      aggregator,
      "context_shape",
      [
        { user: { name: "alice", age: 30 } },
        { user: { name: "bob", score: 9.5 }, team: { name: "engineering" } },
      ],
      {}
    );
    expect(aggregatorPost(aggregator, "context_shape", "/api/v1/context-shapes")).toEqual([
      { name: "user", field_types: { name: 2, age: 1, score: 4 } },
      { name: "team", field_types: { name: 2 } },
    ]);
  });

  it("example contexts deduplicates by key value", () => {
    const aggregator = buildAggregator("example_contexts", {});
    feedAggregator(
      aggregator,
      "example_contexts",
      [{ user: { key: "user-123", name: "alice" } }, { user: { key: "user-123", name: "bob" } }],
      {}
    );
    expect(aggregatorPost(aggregator, "example_contexts", "/api/v1/telemetry")).toEqual({
      user: { key: "user-123", name: "alice" },
    });
  });

  it("telemetry disabled emits nothing", () => {
    const aggregator = buildAggregator("evaluation_summary", {
      collect_evaluation_summaries: false,
      context_upload_mode: ":none",
    });
    feedAggregator(aggregator, "evaluation_summary", { keys: ["brand.new.string"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual(
      undefined
    );
  });

  it("shapes only mode reports shapes but not examples", () => {
    const aggregator = buildAggregator("context_shape", { context_upload_mode: ":shape_only" });
    feedAggregator(aggregator, "context_shape", { user: { name: "alice", key: "alice-123" } }, {});
    expect(aggregatorPost(aggregator, "context_shape", "/api/v1/context-shapes")).toEqual([
      { name: "user", field_types: { name: 2, key: 2 } },
    ]);
  });

  it("log level evaluations are excluded from telemetry", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(
      aggregator,
      "evaluation_summary",
      { keys: ["log-level.prefab.criteria_evaluator"] },
      {}
    );
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual(
      undefined
    );
  });

  it("empty context produces no context telemetry", () => {
    const aggregator = buildAggregator("context_shape", {});
    feedAggregator(aggregator, "context_shape", {}, {});
    expect(aggregatorPost(aggregator, "context_shape", "/api/v1/context-shapes")).toEqual(
      undefined
    );
  });

  it("confidential plain string is redacted in selectedValue", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["confidential.new.string"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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

  it("confidential encrypted string is redacted using ciphertext hash", () => {
    const aggregator = buildAggregator("evaluation_summary", {});
    feedAggregator(aggregator, "evaluation_summary", { keys: ["a.secret.config"] }, {});
    expect(aggregatorPost(aggregator, "evaluation_summary", "/api/v1/telemetry")).toEqual([
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
