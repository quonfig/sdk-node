import { describe, expect, it, vi } from "vitest";

import { BoundQuonfig, Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

function envelope(configs: ConfigEnvelope["configs"]): ConfigEnvelope {
  return {
    meta: { version: "test", environment: "Production" },
    configs,
  };
}

function planRuleConfig(): ConfigEnvelope["configs"][number] {
  return {
    id: "cfg-greeting",
    key: "greeting",
    type: "config",
    valueType: "string",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: { type: "string", value: "hello" },
        },
      ],
    },
    environment: {
      id: "Production",
      rules: [
        {
          criteria: [
            {
              propertyName: "user.plan",
              operator: "PROP_IS_ONE_OF",
              valueToMatch: { type: "string_list", value: ["pro"] },
            },
          ],
          value: { type: "string", value: "hello-pro" },
        },
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: { type: "string", value: "hello-free" },
        },
      ],
    },
  };
}

async function makeClient(datafile: ConfigEnvelope): Promise<Quonfig> {
  const q = new Quonfig({
    sdkKey: "test",
    datafile,
    environment: "Production",
  });
  await q.init();
  return q;
}

describe("Quonfig.withContext callback overload", () => {
  it("fluent form returns a BoundQuonfig", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const bound = q.withContext({ user: { plan: "pro" } });
    expect(bound).toBeInstanceOf(BoundQuonfig);
    expect(bound.getString("greeting")).toBe("hello-pro");
  });

  it("callback form invokes fn with a BoundQuonfig that sees the merged context", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const received = q.withContext({ user: { plan: "pro" } }, (rf) => {
      expect(rf).toBeInstanceOf(BoundQuonfig);
      return rf.getString("greeting");
    });
    expect(received).toBe("hello-pro");
  });

  it("callback form propagates the return value", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const result = q.withContext({ user: { plan: "free" } }, (rf) => ({
      greeting: rf.getString("greeting"),
      magic: 42,
    }));
    expect(result).toEqual({ greeting: "hello-free", magic: 42 });
  });

  it("callback form passes through Promise return values", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const result = await q.withContext({ user: { plan: "pro" } }, async (rf) => {
      await Promise.resolve();
      return rf.getString("greeting");
    });
    expect(result).toBe("hello-pro");
  });

  it("BoundQuonfig.withContext callback form merges over the already-bound context", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const outer = q.withContext({ user: { plan: "free" } });
    const inner = outer.withContext({ user: { plan: "pro" } }, (rf) => {
      expect(rf).toBeInstanceOf(BoundQuonfig);
      return rf.getString("greeting");
    });
    expect(inner).toBe("hello-pro");
  });

  it("records evaluation summaries for keys resolved via the callback form", async () => {
    const postTelemetrySpy = vi
      .spyOn(Transport.prototype, "postTelemetry")
      .mockResolvedValue(undefined);
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: {
        envelope: envelope([planRuleConfig()]),
        notChanged: false,
      },
      sourceIndex: 0,
    });

    const q = new Quonfig({
      sdkKey: "test",
      enableSSE: false,
      enablePolling: false,
    });
    await q.init();

    q.withContext({ user: { plan: "pro" } }, (rf) => rf.getString("greeting"));

    await q.flush();

    expect(postTelemetrySpy).toHaveBeenCalledTimes(1);
    expect(postTelemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            summaries: expect.objectContaining({
              summaries: expect.arrayContaining([expect.objectContaining({ key: "greeting" })]),
            }),
          }),
        ]),
      })
    );

    q.close();
  });

  it("inContext on Quonfig delegates to withContext (same returned BoundQuonfig semantics)", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const viaIn = q.inContext({ user: { plan: "pro" } });
    const viaWith = q.withContext({ user: { plan: "pro" } });
    expect(viaIn).toBeInstanceOf(BoundQuonfig);
    expect(viaWith).toBeInstanceOf(BoundQuonfig);
    expect(viaIn.getString("greeting")).toBe(viaWith.getString("greeting"));
  });

  it("inContext on BoundQuonfig delegates to withContext", async () => {
    const q = await makeClient(envelope([planRuleConfig()]));
    const outer = q.withContext({ user: { plan: "free" } });
    const viaIn = outer.inContext({ user: { plan: "pro" } });
    const viaWith = outer.withContext({ user: { plan: "pro" } });
    expect(viaIn.getString("greeting")).toBe("hello-pro");
    expect(viaWith.getString("greeting")).toBe("hello-pro");
  });
});
