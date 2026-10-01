// Verifies the JSON wire format of the telemetry payload the real reporter
// POSTs matches what api-telemetry expects. Drives a public client over the
// integration fixtures (qfg-2agi.32); no hand-built Evaluation records.

import { describe, it, expect } from "vitest";
import { collectTelemetry } from "./setup";

async function postedFor(...keys: string[]): Promise<any> {
  const posted = await collectTelemetry({}, (client) => {
    for (const key of keys) client.get(key);
  });
  expect(posted).toHaveLength(1);
  return posted[0];
}

function counterFor(payload: any, key: string): any {
  const summaries = payload.events.flatMap((e: any) => e.summaries?.summaries ?? []);
  const summary = summaries.find((s: any) => s.key === key);
  expect(summary, `no summary for ${key}`).toBeDefined();
  return summary.counters[0];
}

describe("telemetry wire format", () => {
  it("evaluation summary JSON contains all required fields including reason", async () => {
    const counter = counterFor(await postedFor("brand.new.string"), "brand.new.string");
    expect(counter).toHaveProperty("configId");
    expect(counter).toHaveProperty("conditionalValueIndex");
    expect(counter).toHaveProperty("configRowIndex");
    expect(counter).toHaveProperty("selectedValue");
    expect(counter).toHaveProperty("count");
    expect(counter).toHaveProperty("reason");
    expect(typeof counter.reason).toBe("number");
    expect(counter.reason).toBe(1); // STATIC
  });

  it("selectedValue uses correct type wrapper keys in JSON", async () => {
    // Cross-SDK contract: the proto-style wrapper keys are bool / int /
    // double / string / stringList — must match sdk-go (marshalSelectedValue)
    // and sdk-ruby (wrap_selected_value) so api-telemetry sees a consistent
    // shape across SDKs.
    const payload = await postedFor(
      "brand.new.string",
      "brand.new.boolean",
      "brand.new.int",
      "my-string-list-key"
    );
    expect(counterFor(payload, "brand.new.string").selectedValue).toHaveProperty("string");
    expect(counterFor(payload, "brand.new.boolean").selectedValue).toHaveProperty("bool");
    expect(counterFor(payload, "brand.new.int").selectedValue).toHaveProperty("int");
    expect(counterFor(payload, "my-string-list-key").selectedValue).toHaveProperty("stringList");
  });

  it("evaluation summary JSON structure matches TelemetryPayload envelope shape", async () => {
    const payload = await postedFor("always.true");
    expect(payload).toHaveProperty("instanceHash");
    const event = payload.events.find((e: any) => e.summaries);
    expect(event).toBeDefined();
    expect(event.summaries).toHaveProperty("start");
    expect(event.summaries).toHaveProperty("end");
    expect(Array.isArray(event.summaries.summaries)).toBe(true);

    const summary = event.summaries.summaries[0];
    expect(summary).toHaveProperty("key");
    expect(summary).toHaveProperty("type");
    expect(Array.isArray(summary.counters)).toBe(true);
  });
});
