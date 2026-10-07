/**
 * qfg-goi1.2.5 (2): the init() timeout timer must be cleared once init()
 * settles. Before, setTimeout(reject, initTimeout) stayed armed after a
 * successful init and kept the event loop alive, so CLIs, cron jobs and test
 * runners exited initTimeout ms (default 10s) late, even after close().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import { Transport } from "../src/transport";
import type { ConfigEnvelope } from "../src/types";

const ENVELOPE: ConfigEnvelope = {
  meta: { version: "v1", environment: "Production" },
  configs: [],
};

function quiet(): Quonfig {
  // No SSE, no poller, no telemetry: the init timeout is the only timer init()
  // could leave behind.
  return new Quonfig({
    sdkKey: "test-sdk-key",
    enableSSE: false,
    fallbackPollEnabled: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    enableQuonfigUserContext: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("init() timeout timer (qfg-goi1.2.5)", () => {
  it("leaves no pending timer after a successful init()", async () => {
    vi.spyOn(Transport.prototype, "fetchFromUrlAt").mockResolvedValue({
      result: { envelope: ENVELOPE, notChanged: false },
      sourceIndex: 0,
    });
    const quonfig = quiet();
    await quonfig.init();

    expect(vi.getTimerCount()).toBe(0);
    await quonfig.close();
  });
});
