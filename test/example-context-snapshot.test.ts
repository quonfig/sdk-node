// Example-context telemetry snapshots the context when it is recorded
// (qfg-goi1.2.34 item A, port of sdk-go qfg-goi1.2.4 / qfg-goi1.2.44 /
// qfg-goi1.2.46). The collector used to keep the caller's objects, so a
// mutation after get() changed what the next flush sent, and a cyclic value
// made the whole example-contexts event fail to serialize.
import { describe, it, expect } from "vitest";
import { ExampleContextCollector } from "../src/telemetry/exampleContexts";

function drainValues(c: ExampleContextCollector): Array<Record<string, Record<string, unknown>>> {
  const event = c.drain();
  return (event?.exampleContexts?.examples ?? []).map((e) =>
    Object.fromEntries(e.contextSet.contexts.map((ctx) => [ctx.type, ctx.values]))
  );
}

describe("ExampleContextCollector snapshots at record time", () => {
  it("a nested object or list mutated after the call reports the call-time value", () => {
    const c = new ExampleContextCollector("periodic_example");
    const meta = { plan: "pro", tags: ["a", "b"], deep: { n: 1 } };
    const ctx = { user: { key: "u1", meta } };
    c.push(ctx);

    meta.plan = "free";
    meta.tags.push("c");
    meta.deep.n = 2;
    (ctx.user as Record<string, unknown>).email = "late@example.test";

    expect(drainValues(c)).toEqual([
      { user: { key: "u1", meta: { plan: "pro", tags: ["a", "b"], deep: { n: 1 } } } },
    ]);
  });

  it("renders a toJSON value type (UUID/ObjectId-like key) to its JSON form, keeping the example", () => {
    class Id {
      constructor(private hex: string) {}
      toJSON(): string {
        return this.hex;
      }
    }
    const c = new ExampleContextCollector("periodic_example");
    c.push({ user: { key: new Id("6f1c"), ids: [new Id("aa"), 2], at: new Date(0) } });

    expect(drainValues(c)).toEqual([
      { user: { key: "6f1c", ids: ["aa", 2], at: "1970-01-01T00:00:00.000Z" } },
    ]);
  });

  it("drops the edge that closes a cycle instead of losing the whole event", () => {
    const c = new ExampleContextCollector("periodic_example");
    const loop: Record<string, unknown> = { name: "x" };
    loop.self = loop;
    const shared = { v: 1 };
    c.push({ user: { key: "u1", loop, a: shared, b: shared } });

    const out = drainValues(c);
    expect(out).toEqual([{ user: { key: "u1", loop: { name: "x" }, a: { v: 1 }, b: { v: 1 } } }]);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("drops values nested deeper than the depth cap", () => {
    const c = new ExampleContextCollector("periodic_example");
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 200; i++) deep = { d: deep };
    c.push({ user: { key: "u1", deep } });

    const out = drainValues(c);
    expect(out[0].user.key).toBe("u1");
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.stringify(out)).not.toContain("leaf");
  });
});
