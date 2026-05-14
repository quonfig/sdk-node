import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wrapFetchWithReadDeadline } from "../src/sse";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Layer 1 — SSE read deadline (AbortController wrap)", () => {
  it("aborts the stream when no chunk arrives within the deadline", async () => {
    let abortReason: any = null;

    // Fake fetch: returns a body whose reader never resolves until aborted.
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => {
            abortReason = (signal as any).reason ?? new Error("aborted");
            controller.error(abortReason);
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const wrapped = wrapFetchWithReadDeadline(fakeFetch as unknown as typeof fetch, 1000);

    const response = await wrapped("https://example.com/sse", { method: "GET" });
    const reader = response.body!.getReader();

    // Before the deadline, nothing should have happened.
    await vi.advanceTimersByTimeAsync(900);
    expect(abortReason).toBeNull();

    // Cross the deadline — abort fires.
    await vi.advanceTimersByTimeAsync(200);
    expect(abortReason).not.toBeNull();

    // Reader rejects with the abort reason.
    await expect(reader.read()).rejects.toBeTruthy();
  });

  it("does not abort when chunks keep arriving within the deadline", async () => {
    let aborted = false;
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      let controllerRef: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          signal.addEventListener("abort", () => {
            aborted = true;
            controller.error(new Error("aborted"));
          });
        },
      });
      // Expose the controller for the test to push chunks.
      (fakeFetch as any).pushChunk = (chunk: Uint8Array) => controllerRef!.enqueue(chunk);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const wrapped = wrapFetchWithReadDeadline(fakeFetch as unknown as typeof fetch, 1000);

    const response = await wrapped("https://example.com/sse", { method: "GET" });
    const reader = response.body!.getReader();
    const consumer = (async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    })();
    void consumer.catch(() => {});

    // Push a chunk every 500ms for 5 seconds — never crosses the 1000ms
    // deadline because each chunk resets it.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500);
      (fakeFetch as any).pushChunk(new Uint8Array([0x3a, 0x20, 0x68, 0x69, 0x0a, 0x0a])); // ": hi\n\n"
    }

    expect(aborted).toBe(false);

    // Now stop pushing chunks; after the deadline, abort should fire.
    await vi.advanceTimersByTimeAsync(1100);
    expect(aborted).toBe(true);

    await consumer.catch(() => {});
  });
});
