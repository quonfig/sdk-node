/**
 * qfg-goi1.10.1 item 1 (WS8, sdk-go 2f6b98b): one config entry that fails to
 * normalize is skipped with a WARN naming its key; the rest of the envelope
 * installs and the bad key reads as not found. An envelope whose every entry
 * fails is still rejected, so it cannot install as an empty workspace.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { ConfigStore } from "../src/store";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

const good = {
  id: "cfg-good",
  key: "good.key",
  type: "config",
  valueType: "string",
  sendToClientSdk: false,
  default: { rules: [{ criteria: [], value: { type: "string", value: "served" } }] },
} as any;

// `default` missing: normalizeConfigResponse throws on `cfg.default.rules`.
const bad = {
  id: "cfg-bad",
  key: "bad.key",
  type: "config",
  valueType: "string",
  sendToClientSdk: false,
} as any;

function envelope(configs: any[]): ConfigEnvelope {
  return { meta: { version: "v1", environment: "Production" }, configs };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("one bad config entry (qfg-goi1.10.1)", () => {
  it("installs the rest of the envelope, WARNs with the key, and the bad key reads as not found", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: { envelope: envelope([bad, good]), notChanged: false },
      sourceIndex: 0,
    });
    const warn = vi.fn();
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      enableSSE: false,
      fallbackPollEnabled: false,
      collectEvaluationSummaries: false,
      contextUploadMode: "none",
      enableQuonfigUserContext: false,
      onNoDefault: "ignore",
      logger: { warn, error: vi.fn() },
    });
    await quonfig.init();

    expect(quonfig.get("good.key")).toBe("served");
    expect(quonfig.get("bad.key", {}, "fallback")).toBe("fallback");
    expect(quonfig.getStringDetails("bad.key").errorCode).toBe("FLAG_NOT_FOUND");
    expect(warn.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(
      /skipping config "bad\.key"/
    );

    await quonfig.close();
  });

  it("rejects an envelope whose every entry fails, keeping the previous configs", () => {
    const store = new ConfigStore();
    store.update(envelope([good]));
    expect(() => store.update(envelope([bad]))).toThrow();
    expect(store.get("good.key")).toBeDefined();
  });

  it("an empty envelope still installs as empty", () => {
    const store = new ConfigStore();
    store.update(envelope([good]));
    store.update(envelope([]));
    expect(store.keys()).toEqual([]);
  });
});
