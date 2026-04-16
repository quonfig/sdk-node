// Code generated from integration-test-data/tests/eval/post.yaml. DO NOT EDIT.

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

describe("post", () => {
  it("reports context shape aggregation", () => {
    const collector = new ContextShapeCollector("shapes_only");

    collector.push({
      user: { name: "Michael", age: 38, human: true },
      role: {
        name: "developer",
        admin: false,
        salary: 15.75,
        permissions: ["read", "write"],
      },
    });

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.contextShapes).toBeDefined();

    const shapes = event!.contextShapes!.shapes;

    const userShape = shapes.find((s) => s.name === "user");
    expect(userShape).toBeDefined();
    expect(userShape!.fieldTypes.name).toBe(2); // string
    expect(userShape!.fieldTypes.age).toBe(1); // int
    expect(userShape!.fieldTypes.human).toBe(5); // bool

    const roleShape = shapes.find((s) => s.name === "role");
    expect(roleShape).toBeDefined();
    expect(roleShape!.fieldTypes.name).toBe(2); // string
    expect(roleShape!.fieldTypes.admin).toBe(5); // bool
    expect(roleShape!.fieldTypes.salary).toBe(4); // double
    expect(roleShape!.fieldTypes.permissions).toBe(10); // string_list
  });

  it("reports evaluation summary", () => {
    const collector = new EvaluationSummaryCollector(true);
    const contexts: Contexts = { user: { tracking_id: "92a202f2" } };

    // Evaluate keys with context
    const keysWithContext = [
      "my-test-key",
      "feature-flag.integer",
      "my-string-list-key",
      "feature-flag.integer",
      "feature-flag.weighted",
    ];

    for (const key of keysWithContext) {
      const ev = evaluateForTelemetry(key, contexts);
      expect(ev).toBeDefined();
      collector.push(ev!);
    }

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.summaries).toBeDefined();

    const summaries = event!.summaries!.summaries;

    // my-test-key: CONFIG, value "my-test-value", count 1
    const testKeySummary = summaries.find((s) => s.key === "my-test-key");
    expect(testKeySummary).toBeDefined();
    expect(testKeySummary!.type).toBe(mapType("CONFIG"));
    expect(testKeySummary!.counters).toHaveLength(1);
    expect(testKeySummary!.counters[0].count).toBe(1);
    expect(testKeySummary!.counters[0].configRowIndex).toBe(0);
    expect(testKeySummary!.counters[0].conditionalValueIndex).toBe(1);
    expect(testKeySummary!.counters[0].reason).toBe(2); // TARGETING_MATCH

    // my-string-list-key: CONFIG, value ["a","b","c"], count 1
    const stringListSummary = summaries.find(
      (s) => s.key === "my-string-list-key"
    );
    expect(stringListSummary).toBeDefined();
    expect(stringListSummary!.type).toBe(mapType("CONFIG"));
    expect(stringListSummary!.counters).toHaveLength(1);
    expect(stringListSummary!.counters[0].count).toBe(1);
    expect(stringListSummary!.counters[0].configRowIndex).toBe(0);
    expect(stringListSummary!.counters[0].conditionalValueIndex).toBe(0);

    // feature-flag.integer: FEATURE_FLAG, value 3, count 2 (evaluated twice)
    const integerFlagSummary = summaries.find(
      (s) => s.key === "feature-flag.integer"
    );
    expect(integerFlagSummary).toBeDefined();
    expect(integerFlagSummary!.type).toBe(mapType("FEATURE_FLAG"));
    expect(integerFlagSummary!.counters).toHaveLength(1);
    expect(integerFlagSummary!.counters[0].count).toBe(2);
    expect(integerFlagSummary!.counters[0].configRowIndex).toBe(0);
    expect(integerFlagSummary!.counters[0].conditionalValueIndex).toBe(1);

    // feature-flag.weighted: FEATURE_FLAG, value 2, count 1
    const weightedFlagSummary = summaries.find(
      (s) => s.key === "feature-flag.weighted"
    );
    expect(weightedFlagSummary).toBeDefined();
    expect(weightedFlagSummary!.type).toBe(mapType("FEATURE_FLAG"));
    expect(weightedFlagSummary!.counters).toHaveLength(1);
    expect(weightedFlagSummary!.counters[0].count).toBe(1);
    expect(weightedFlagSummary!.counters[0].configRowIndex).toBe(0);
    expect(weightedFlagSummary!.counters[0].conditionalValueIndex).toBe(0);
    expect(weightedFlagSummary!.counters[0].weightedValueIndex).toBe(2);
  });

  it("reports example contexts", () => {
    const collector = new ExampleContextCollector("periodic_example", 10000, 0);

    collector.push({
      user: { name: "michael", age: 38, key: "michael:1234" },
      device: { mobile: false },
      team: { id: 3.5 },
    });

    const event = collector.drain();
    expect(event).toBeDefined();
    expect(event!.exampleContexts).toBeDefined();

    const examples = event!.exampleContexts!.examples;
    expect(examples).toHaveLength(1);

    const contextSet = examples[0].contextSet.contexts;

    const userCtx = contextSet.find((c) => c.type === "user");
    expect(userCtx).toBeDefined();
    expect(userCtx!.values.name).toBe("michael");
    expect(userCtx!.values.age).toBe(38);
    expect(userCtx!.values.key).toBe("michael:1234");

    const deviceCtx = contextSet.find((c) => c.type === "device");
    expect(deviceCtx).toBeDefined();
    expect(deviceCtx!.values.mobile).toBe(false);

    const teamCtx = contextSet.find((c) => c.type === "team");
    expect(teamCtx).toBeDefined();
    expect(teamCtx!.values.id).toBe(3.5);
  });

  it("example contexts without key are not reported", () => {
    const collector = new ExampleContextCollector("periodic_example", 10000, 0);

    // None of these contexts have a "key" or "trackingId" field
    collector.push({
      user: { name: "michael", age: 38 },
      device: { mobile: false },
      team: { id: 3.5 },
    });

    const event = collector.drain();
    // No contexts had a key, so nothing should be collected
    expect(event).toBeUndefined();
  });
});
