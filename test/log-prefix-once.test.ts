// qfg-nsqn: the default console logger adds the "[quonfig]" prefix, and most
// SDK messages already start with it, so console lines read
// "[quonfig] [quonfig] read of ...". The prefix must appear exactly once.

import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src";
import { normalizeLogger } from "../src/sdkLogger";
import type { ConfigResponse, QuonfigOptions } from "../src/types";

const clients: Quonfig[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()!.close();
  vi.restoreAllMocks();
});

function line(args: unknown[]): string {
  return args.map(String).join(" ");
}

describe("[quonfig] log prefix (qfg-nsqn)", () => {
  it("the once-per-key read-failure warning has a single [quonfig] prefix on console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = [
      {
        id: "id-s",
        key: "s",
        type: "config",
        valueType: "string",
        sendToClientSdk: false,
        default: {
          rules: [
            { criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "string", value: "x" } },
          ],
        },
      } as ConfigResponse,
    ];
    const q = new Quonfig({
      sdkKey: "test-unused",
      enableSSE: false,
      enablePolling: false,
      enableQuonfigUserContext: false,
      contextUploadMode: "none",
      collectEvaluationSummaries: false,
      onNoDefault: "ignore",
      environment: "Production",
      datafile: { meta: { version: "test", environment: "Production" }, configs },
    } as QuonfigOptions);
    await q.init();
    clients.push(q);

    expect(q.getBool("s", undefined, false)).toBe(false);

    const lines = warn.mock.calls.map(line).filter((l) => l.includes('read of "s"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[quonfig\] read of "s"/);
    expect(lines[0]).not.toContain("[quonfig] [quonfig]");
  });

  it("the default logger prefixes an unprefixed message and leaves a prefixed one alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = normalizeLogger(undefined);

    logger.warn("SSE error:", "boom");
    logger.warn("[quonfig] already prefixed");
    logger.info("[quonfig] info line");
    logger.error("[quonfig] error line");

    expect(line(warn.mock.calls[0])).toBe("[quonfig] SSE error: boom");
    expect(line(warn.mock.calls[1])).toBe("[quonfig] already prefixed");
    expect(line(info.mock.calls[0])).toBe("[quonfig] info line");
    expect(line(error.mock.calls[0])).toBe("[quonfig] error line");
  });
});
