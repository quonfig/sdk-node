// Code generated from integration-test-data/tests/eval/telemetry.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import {
  store,
  evaluator,
  resolver,
  envID,
  evaluateForTelemetry,
  EvaluationSummaryCollector,
  ContextShapeCollector,
  ExampleContextCollector,
} from "./setup";
import type { Contexts } from "./setup";

/**
 * Helper to map YAML type strings (CONFIG, FEATURE_FLAG) to ConfigTypeString values.
 */
function mapType(yamlType: string): string {
  switch (yamlType) {
    case "CONFIG":
      return "config";
    case "FEATURE_FLAG":
      return "feature_flag";
    case "LOG_LEVEL":
      return "log_level";
    case "SEGMENT":
      return "segment";
    default:
      return yamlType.toLowerCase();
  }
}

describe("telemetry", () => {
  // ──────────────────────────────────────────────────
  // Category 1: Evaluation Reason Reporting
  // ──────────────────────────────────────────────────

  it("reason is STATIC for config with no targeting rules", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("brand.new.string", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "brand.new.string");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("CONFIG"));

    const counter = summary!.counters[0];
    expect(counter.count).toBe(1);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
    // NOTE: reason assertions skipped -- the Node SDK does not yet support reason in evaluation summaries
  });

  it("reason is STATIC for feature flag with only ALWAYS_TRUE rules", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("always.true", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "always.true");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("FEATURE_FLAG"));

    const counter = summary!.counters[0];
    expect(counter.count).toBe(1);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
    // NOTE: reason assertions skipped -- the Node SDK does not yet support reason in evaluation summaries
  });

  it("reason is TARGETING_MATCH when config has targeting rules but evaluation falls through", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("my-test-key", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "my-test-key");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("CONFIG"));

    const counter = summary!.counters[0];
    expect(counter.count).toBe(1);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(1);
    // NOTE: reason assertions skipped -- the Node SDK does not yet support reason in evaluation summaries
  });

  it("reason is TARGETING_MATCH when a targeting rule matches", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = { user: { key: "michael" } };

    const eval1 = evaluateForTelemetry("feature-flag.integer", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "feature-flag.integer");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("FEATURE_FLAG"));

    const counter = summary!.counters[0];
    expect(counter.count).toBe(1);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
    // NOTE: reason assertions skipped -- the Node SDK does not yet support reason in evaluation summaries
  });

  it("reason is SPLIT for weighted value evaluation", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = { user: { tracking_id: "92a202f2" } };

    const eval1 = evaluateForTelemetry("feature-flag.weighted", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "feature-flag.weighted");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("FEATURE_FLAG"));

    const counter = summary!.counters[0];
    expect(counter.count).toBe(1);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
    expect(counter.weightedValueIndex).toBe(2);
    // NOTE: reason assertions skipped -- the Node SDK does not yet support reason in evaluation summaries
  });

  it("reason is TARGETING_MATCH for feature flag fallthrough with targeting rules", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("feature-flag.integer", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "feature-flag.integer");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("FEATURE_FLAG"));

    const counter = summary!.counters[0];
    expect(counter.count).toBe(1);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(1);
    // NOTE: reason assertions skipped -- the Node SDK does not yet support reason in evaluation summaries
  });

  // ──────────────────────────────────────────────────
  // Category 2: Counting & Grouping
  // ──────────────────────────────────────────────────

  it("evaluation summary deduplicates identical evaluations", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const keys = [
      "brand.new.string",
      "brand.new.string",
      "brand.new.string",
      "brand.new.string",
      "brand.new.string",
    ];
    for (const key of keys) {
      const ev = evaluateForTelemetry(key, contexts);
      expect(ev).toBeDefined();
      collector.push(ev!);
    }

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "brand.new.string");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("CONFIG"));
    expect(summary!.counters).toHaveLength(1);

    const counter = summary!.counters[0];
    expect(counter.count).toBe(5);
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
  });

  it("evaluation summary creates separate counters for different rules of same config", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = { user: { key: "michael" } };

    // Evaluate with context
    const eval1 = evaluateForTelemetry("feature-flag.integer", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    // Evaluate without context
    const eval2 = evaluateForTelemetry("feature-flag.integer", {});
    expect(eval2).toBeDefined();
    collector.push(eval2!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "feature-flag.integer");
    expect(summary).toBeDefined();
    expect(summary!.type).toBe(mapType("FEATURE_FLAG"));
    expect(summary!.counters).toHaveLength(2);

    // Counter for rule match (conditionalValueIndex 0, value 5)
    const counter0 = summary!.counters.find(
      (c) => c.conditionalValueIndex === 0
    );
    expect(counter0).toBeDefined();
    expect(counter0!.count).toBe(1);
    expect(counter0!.configRowIndex).toBe(0);

    // Counter for fallthrough (conditionalValueIndex 1, value 3)
    const counter1 = summary!.counters.find(
      (c) => c.conditionalValueIndex === 1
    );
    expect(counter1).toBeDefined();
    expect(counter1!.count).toBe(1);
    expect(counter1!.configRowIndex).toBe(0);
  });

  it("evaluation summary groups by config key", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("brand.new.string", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const eval2 = evaluateForTelemetry("always.true", contexts);
    expect(eval2).toBeDefined();
    collector.push(eval2!);

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;
    expect(summaries).toHaveLength(2);

    const stringSummary = summaries.find((s) => s.key === "brand.new.string");
    expect(stringSummary).toBeDefined();
    expect(stringSummary!.type).toBe(mapType("CONFIG"));
    expect(stringSummary!.counters[0].count).toBe(1);
    expect(stringSummary!.counters[0].configRowIndex).toBe(0);
    expect(stringSummary!.counters[0].conditionalValueIndex).toBe(0);

    const flagSummary = summaries.find((s) => s.key === "always.true");
    expect(flagSummary).toBeDefined();
    expect(flagSummary!.type).toBe(mapType("FEATURE_FLAG"));
    expect(flagSummary!.counters[0].count).toBe(1);
    expect(flagSummary!.counters[0].configRowIndex).toBe(0);
    expect(flagSummary!.counters[0].conditionalValueIndex).toBe(0);
  });

  // ──────────────────────────────────────────────────
  // Category 3: selectedValue Type Wrapping
  // ──────────────────────────────────────────────────

  it("selectedValue wraps string correctly", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("brand.new.string", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "brand.new.string");
    expect(summary).toBeDefined();

    const counter = summary!.counters[0];
    expect(counter.selectedValue).toEqual({ string: "hello.world" });
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
  });

  it("selectedValue wraps boolean correctly", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("brand.new.boolean", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "brand.new.boolean");
    expect(summary).toBeDefined();

    const counter = summary!.counters[0];
    expect(counter.selectedValue).toEqual({ boolean: false });
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
  });

  it("selectedValue wraps int correctly", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("brand.new.int", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "brand.new.int");
    expect(summary).toBeDefined();

    const counter = summary!.counters[0];
    expect(counter.selectedValue).toEqual({ number: 123 });
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
  });

  it("selectedValue wraps double correctly", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("brand.new.double", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "brand.new.double");
    expect(summary).toBeDefined();

    const counter = summary!.counters[0];
    expect(counter.selectedValue).toEqual({ number: 123.99 });
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
  });

  it("selectedValue wraps string list correctly", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = {};

    const eval1 = evaluateForTelemetry("my-string-list-key", contexts);
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeDefined();

    const summaries = event!.summaries!.summaries;
    const summary = summaries.find((s) => s.key === "my-string-list-key");
    expect(summary).toBeDefined();

    const counter = summary!.counters[0];
    expect(counter.selectedValue).toEqual({ object: ["a", "b", "c"] });
    expect(counter.configRowIndex).toBe(0);
    expect(counter.conditionalValueIndex).toBe(0);
  });

  // ──────────────────────────────────────────────────
  // Category 4: Context Telemetry
  // ──────────────────────────────────────────────────

  it("context shape merges fields across multiple records", () => {
    const collector = new ContextShapeCollector("periodic_example");

    collector.push({ user: { name: "alice", age: 30 } });
    collector.push({ user: { name: "bob", score: 9.5 }, team: { name: "engineering" } });

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.contextShapes).toBeDefined();

    const shapes = event!.contextShapes!.shapes;

    const userShape = shapes.find((s) => s.name === "user");
    expect(userShape).toBeDefined();
    expect(userShape!.fieldTypes.name).toBe(2); // string
    expect(userShape!.fieldTypes.age).toBe(1); // int
    expect(userShape!.fieldTypes.score).toBe(4); // double

    const teamShape = shapes.find((s) => s.name === "team");
    expect(teamShape).toBeDefined();
    expect(teamShape!.fieldTypes.name).toBe(2); // string
  });

  it("example contexts deduplicates by key value", () => {
    const collector = new ExampleContextCollector("periodic_example", 10000, 0);

    collector.push({ user: { key: "user-123", name: "alice" } });
    collector.push({ user: { key: "user-123", name: "bob" } });

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.exampleContexts).toBeDefined();

    const examples = event!.exampleContexts!.examples;
    // Should deduplicate: only 1 example for key "user-123"
    expect(examples).toHaveLength(1);

    const userCtx = examples[0].contextSet.contexts.find((c) => c.type === "user");
    expect(userCtx).toBeDefined();
    expect(userCtx!.values.key).toBe("user-123");
    expect(userCtx!.values.name).toBe("alice");
  });

  // ──────────────────────────────────────────────────
  // Category 5: Configuration Modes
  // ──────────────────────────────────────────────────

  it("telemetry disabled emits nothing", () => {
    // Evaluation summaries disabled
    const collector = new EvaluationSummaryCollector(false);

    const eval1 = evaluateForTelemetry("brand.new.string", {});
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    expect(event).toBeUndefined();

    // Context upload mode "none" disables both shape and example collectors
    const shapeCollector = new ContextShapeCollector("none");
    shapeCollector.push({ user: { name: "alice" } });
    expect(shapeCollector.drain()).toBeUndefined();

    const exampleCollector = new ExampleContextCollector("none", 10000, 0);
    exampleCollector.push({ user: { key: "test", name: "alice" } });
    expect(exampleCollector.drain()).toBeUndefined();
  });

  it("shapes only mode reports shapes but not examples", () => {
    const shapeCollector = new ContextShapeCollector("shapes_only");
    shapeCollector.push({ user: { name: "alice", key: "alice-123" } });

    const shapeEvent = shapeCollector.drain();
    expect(shapeEvent).toBeDefined();
    expect(shapeEvent!.contextShapes).toBeDefined();

    const shapes = shapeEvent!.contextShapes!.shapes;
    const userShape = shapes.find((s) => s.name === "user");
    expect(userShape).toBeDefined();
    expect(userShape!.fieldTypes.name).toBe(2); // string
    expect(userShape!.fieldTypes.key).toBe(2); // string

    // Example contexts should be disabled in shapes_only mode
    const exampleCollector = new ExampleContextCollector("shapes_only" as any, 10000, 0);
    exampleCollector.push({ user: { key: "alice-123", name: "alice" } });
    expect(exampleCollector.drain()).toBeUndefined();
  });

  // ──────────────────────────────────────────────────
  // Category 6: Edge Cases
  // ──────────────────────────────────────────────────

  it("log level evaluations are excluded from telemetry", () => {
    const collector = new EvaluationSummaryCollector(true);

    const eval1 = evaluateForTelemetry("log-level.prefab.criteria_evaluator", {});
    expect(eval1).toBeDefined();
    collector.push(eval1!);

    const event = collector.drain();
    // log_level evaluations should be filtered out, so drain returns undefined
    expect(event).toBeUndefined();
  });

  it("empty context produces no context telemetry", () => {
    const collector = new ContextShapeCollector("periodic_example");
    collector.push({});

    const event = collector.drain();
    expect(event).toBeUndefined();
  });
});
