import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatadirWatcher } from "../src/datadirWatcher";
import { Quonfig } from "../src/quonfig";
import type { WorkspaceConfigDocument } from "../src/types";

const tempDirs: string[] = [];
const clients: Quonfig[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    try {
      await client.close();
    } catch {
      // swallow — test may have already closed.
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("dataDirAutoReload", () => {
  it("re-reads the envelope and fires onConfigUpdate when a config file is rewritten", async () => {
    const datadir = createDatadirWithGreeting("hola");

    let callbackCount = 0;
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      dataDirAutoReload: true,
      dataDirAutoReloadDebounceMs: 30,
      onConfigUpdate: () => {
        callbackCount++;
      },
    });
    clients.push(quonfig);

    await quonfig.init();
    expect(quonfig.getString("welcome-message")).toBe("hola");
    const callsAfterInit = callbackCount;

    // Rewrite the config file with a new value.
    writeGreetingConfig(datadir, "buenos-dias");

    await waitFor(() => quonfig.getString("welcome-message") === "buenos-dias", 2000);
    expect(callbackCount).toBeGreaterThan(callsAfterInit);
  });

  it("is disabled by default — no reload, no extra callback after file changes", async () => {
    const datadir = createDatadirWithGreeting("hola");

    let callbackCount = 0;
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      onConfigUpdate: () => {
        callbackCount++;
      },
    });
    clients.push(quonfig);

    await quonfig.init();
    const initial = callbackCount;
    expect(quonfig.getString("welcome-message")).toBe("hola");

    writeGreetingConfig(datadir, "ignored");
    // Wait longer than a generous debounce window — nothing should fire.
    await sleep(250);

    expect(callbackCount).toBe(initial);
    expect(quonfig.getString("welcome-message")).toBe("hola");
  });

  it("debounces bursts — a flurry of writes triggers a single reload callback", async () => {
    const datadir = createDatadirWithGreeting("v0");

    let extraCallbacks = 0;
    let initialDone = false;
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      dataDirAutoReload: true,
      dataDirAutoReloadDebounceMs: 80,
      onConfigUpdate: () => {
        if (initialDone) extraCallbacks++;
      },
    });
    clients.push(quonfig);

    await quonfig.init();
    initialDone = true;

    // Five rapid writes inside the debounce window.
    for (let i = 1; i <= 5; i++) {
      writeGreetingConfig(datadir, `v${i}`);
      await sleep(5);
    }

    await waitFor(() => quonfig.getString("welcome-message") === "v5", 2000);
    // Allow any straggler timers to flush before asserting count.
    await sleep(120);

    expect(extraCallbacks).toBe(1);
  });

  it("parse-then-swap: malformed JSON keeps the previous envelope and skips the callback", async () => {
    const datadir = createDatadirWithGreeting("hola");

    let extraCallbacks = 0;
    let initialDone = false;
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      dataDirAutoReload: true,
      dataDirAutoReloadDebounceMs: 30,
      onConfigUpdate: () => {
        if (initialDone) extraCallbacks++;
      },
      logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    });
    clients.push(quonfig);

    await quonfig.init();
    initialDone = true;

    // Write garbage to the same file the loader will try to parse.
    writeFileSync(join(datadir, "configs", "welcome-message.json"), "{not valid json", "utf-8");
    await sleep(200);

    expect(quonfig.getString("welcome-message")).toBe("hola");
    expect(extraCallbacks).toBe(0);
  });

  it("close() stops the watcher — later edits do not fire callbacks", async () => {
    const datadir = createDatadirWithGreeting("hola");

    let extraCallbacks = 0;
    let initialDone = false;
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir,
      environment: "Production",
      dataDirAutoReload: true,
      dataDirAutoReloadDebounceMs: 30,
      onConfigUpdate: () => {
        if (initialDone) extraCallbacks++;
      },
    });
    clients.push(quonfig);

    await quonfig.init();
    initialDone = true;

    await quonfig.close();

    writeGreetingConfig(datadir, "after-close");
    await sleep(200);

    expect(extraCallbacks).toBe(0);
  });

  it("DatadirWatcher.start() returns false and surfaces the error when registration fails", () => {
    const missing = join(createTempDir(), "does-not-exist");
    const errors: unknown[] = [];
    const watcher = new DatadirWatcher({
      datadir: missing,
      debounceMs: 10,
      onChange: () => {
        throw new Error("onChange should not fire");
      },
      onError: (err) => errors.push(err),
    });
    expect(watcher.start()).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    watcher.close();
  });

  it("follows symlinked datadirs by watching the resolved real path", async () => {
    const realDir = createDatadirWithGreeting("hola");
    const linkParent = createTempDir();
    const linkPath = join(linkParent, "datadir-symlink");
    symlinkSync(realDir, linkPath, "dir");

    let extraCallbacks = 0;
    let initialDone = false;
    const quonfig = new Quonfig({
      sdkKey: "test-sdk-key",
      datadir: linkPath,
      environment: "Production",
      dataDirAutoReload: true,
      dataDirAutoReloadDebounceMs: 30,
      onConfigUpdate: () => {
        if (initialDone) extraCallbacks++;
      },
    });
    clients.push(quonfig);

    await quonfig.init();
    initialDone = true;

    writeGreetingConfig(realDir, "via-symlink");

    await waitFor(() => quonfig.getString("welcome-message") === "via-symlink", 2000);
    expect(extraCallbacks).toBeGreaterThan(0);
  });
});

// ---- helpers ----

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "quonfig-sdk-node-watch-"));
  tempDirs.push(dir);
  return dir;
}

function createDatadirWithGreeting(value: string): string {
  const dir = createTempDir();
  writeJson(join(dir, "quonfig.json"), { environments: ["Production"] });
  mkdirSync(join(dir, "configs"), { recursive: true });
  writeGreetingConfig(dir, value);
  return dir;
}

function writeGreetingConfig(datadir: string, value: string): void {
  const doc: WorkspaceConfigDocument = {
    id: "welcome-message",
    key: "welcome-message",
    type: "config",
    valueType: "string",
    sendToClientSdk: false,
    default: {
      rules: [
        {
          criteria: [{ operator: "ALWAYS_TRUE" }],
          value: { type: "string", value },
        },
      ],
    },
    environments: [
      {
        id: "Production",
        rules: [
          {
            criteria: [{ operator: "ALWAYS_TRUE" }],
            value: { type: "string", value },
          },
        ],
      },
    ],
  };
  writeJson(join(datadir, "configs", "welcome-message.json"), doc);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
