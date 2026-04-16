// Verifies the JSON wire format of telemetry payloads matches what api-telemetry expects.
// This catches serialization bugs (dropped fields, wrong keys) that aggregator-only tests miss.

import { describe, it, expect } from "vitest";
import { evaluateForTelemetry, EvaluationSummaryCollector } from "./setup";

describe("telemetry wire format", () => {
  it("evaluation summary JSON contains all required fields including reason", () => {
    const collector = new EvaluationSummaryCollector(true);

    const ev = evaluateForTelemetry("brand.new.string", {});
    expect(ev).toBeDefined();
    collector.push(ev!);

    const event = collector.drain();
    expect(event).toBeDefined();

    const json = JSON.parse(JSON.stringify(event));

    const counter = json.summaries.summaries[0].counters[0];
    expect(counter).toHaveProperty("configId");
    expect(counter).toHaveProperty("conditionalValueIndex");
    expect(counter).toHaveProperty("configRowIndex");
    expect(counter).toHaveProperty("selectedValue");
    expect(counter).toHaveProperty("count");
    expect(counter).toHaveProperty("reason");
    expect(typeof counter.reason).toBe("number");
    expect(counter.reason).toBe(1); // STATIC
  });

  it("selectedValue uses correct type wrapper keys in JSON", () => {
    const collector = new EvaluationSummaryCollector(true);

    const ev = evaluateForTelemetry("brand.new.string", {});
    collector.push(ev!);
    const stringEvent = JSON.parse(JSON.stringify(collector.drain()));
    expect(stringEvent.summaries.summaries[0].counters[0].selectedValue).toHaveProperty("string");

    const collector2 = new EvaluationSummaryCollector(true);
    const ev2 = evaluateForTelemetry("brand.new.boolean", {});
    collector2.push(ev2!);
    const boolEvent = JSON.parse(JSON.stringify(collector2.drain()));
    expect(boolEvent.summaries.summaries[0].counters[0].selectedValue).toHaveProperty("boolean");

    const collector3 = new EvaluationSummaryCollector(true);
    const ev3 = evaluateForTelemetry("brand.new.int", {});
    collector3.push(ev3!);
    const intEvent = JSON.parse(JSON.stringify(collector3.drain()));
    expect(intEvent.summaries.summaries[0].counters[0].selectedValue).toHaveProperty("number");

    const collector4 = new EvaluationSummaryCollector(true);
    const ev4 = evaluateForTelemetry("my-string-list-key", {});
    collector4.push(ev4!);
    const listEvent = JSON.parse(JSON.stringify(collector4.drain()));
    expect(listEvent.summaries.summaries[0].counters[0].selectedValue).toHaveProperty("object");
  });

  it("evaluation summary JSON structure matches TelemetryPayload envelope shape", () => {
    const collector = new EvaluationSummaryCollector(true);
    const ev = evaluateForTelemetry("always.true", {});
    collector.push(ev!);

    const event = collector.drain()!;
    const json = JSON.parse(JSON.stringify(event));

    expect(json).toHaveProperty("summaries");
    expect(json.summaries).toHaveProperty("start");
    expect(json.summaries).toHaveProperty("end");
    expect(json.summaries).toHaveProperty("summaries");
    expect(Array.isArray(json.summaries.summaries)).toBe(true);

    const summary = json.summaries.summaries[0];
    expect(summary).toHaveProperty("key");
    expect(summary).toHaveProperty("type");
    expect(summary).toHaveProperty("counters");
    expect(Array.isArray(summary.counters)).toBe(true);
  });
});
