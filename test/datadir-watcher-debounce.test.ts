import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatadirWatcher } from "../src/datadirWatcher";

// Capture the listener DatadirWatcher hands to fs.watch so the test can fire
// change events itself. With fake timers this makes the debounce timing exact,
// whatever the speed of the machine (qfg-vnjw). The real-filesystem behavior is
// covered in datadir-auto-reload.test.ts.
const watchListeners: Array<() => void> = [];

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    watch: vi.fn((_path: string, _opts: unknown, listener: () => void) => {
      watchListeners.push(listener);
      return { on: vi.fn(), close: vi.fn() };
    }),
  };
});

const DEBOUNCE_MS = 80;

let datadir: string;

beforeEach(() => {
  datadir = mkdtempSync(join(tmpdir(), "quonfig-sdk-node-debounce-"));
  watchListeners.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(datadir, { recursive: true, force: true });
});

function startWatcher(onChange: () => void): { watcher: DatadirWatcher; fire: () => void } {
  const watcher = new DatadirWatcher({
    datadir,
    debounceMs: DEBOUNCE_MS,
    onChange,
    onError: (err) => {
      throw err;
    },
  });
  expect(watcher.start()).toBe(true);
  expect(watchListeners).toHaveLength(1);
  return { watcher, fire: watchListeners[0] };
}

describe("DatadirWatcher debounce", () => {
  it("coalesces events spread across the window into one onChange, fired a full window after the last event", () => {
    const onChange = vi.fn();
    const { watcher, fire } = startWatcher(onChange);

    // Five events 20ms apart: each lands inside the window opened by the one before.
    for (let i = 0; i < 5; i++) {
      fire();
      vi.advanceTimersByTime(20);
    }
    // 100ms since the first event (> one window), but only 20ms since the last.
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS - 20 - 1);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DEBOUNCE_MS * 10);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("fires again for an event that arrives after the window has gone quiet", () => {
    const onChange = vi.fn();
    const { watcher, fire } = startWatcher(onChange);

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(1);

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(2);
    watcher.close();
  });

  it("close() cancels a pending reload and ignores later events", () => {
    const onChange = vi.fn();
    const { watcher, fire } = startWatcher(onChange);

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    watcher.close();
    vi.advanceTimersByTime(DEBOUNCE_MS * 10);
    expect(onChange).not.toHaveBeenCalled();

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS * 10);
    expect(onChange).not.toHaveBeenCalled();
  });
});
