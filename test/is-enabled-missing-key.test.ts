// isEnabled() on a flag key that does not exist returns false under every
// onNoDefault policy (qfg-goi1.3). get() and the typed getters keep their
// missing-key behavior: onNoDefault still decides throw / warn / undefined.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Quonfig } from "../src/quonfig";
import type { QuonfigOptions } from "../src/types";
import { DATA_DIR, ENVIRONMENT } from "./integration/setup";

const MISSING = "my-missing-key";
const CTX = { user: { key: "michael", email: "michael@example.com" } };

const clients: Quonfig[] = [];

async function makeClient(options: Partial<QuonfigOptions> = {}): Promise<Quonfig> {
  const client = new Quonfig({
    sdkKey: "test-unused",
    datadir: DATA_DIR,
    environment: ENVIRONMENT,
    enableSSE: false,
    enablePolling: false,
    enableQuonfigUserContext: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    ...options,
  });
  await client.init();
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("isEnabled on a missing flag key", () => {
  it("returns false under the default onNoDefault ('error'), with and without a context", async () => {
    const client = await makeClient();
    expect(client.isEnabled(MISSING)).toBe(false);
    expect(client.isEnabled(MISSING, CTX)).toBe(false);
    expect(client.isFeatureEnabled(MISSING)).toBe(false);
    expect(client.withContext(CTX).isEnabled(MISSING)).toBe(false);
  });

  it("returns false under onNoDefault 'warn' and still logs the warning", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const client = await makeClient({ onNoDefault: "warn", logger });
    expect(client.isEnabled(MISSING)).toBe(false);
    expect(client.isEnabled(MISSING, CTX)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(`No value found for key "${MISSING}"`);
  });

  it("returns false under onNoDefault 'ignore'", async () => {
    const client = await makeClient({ onNoDefault: "ignore" });
    expect(client.isEnabled(MISSING)).toBe(false);
    expect(client.isEnabled(MISSING, CTX)).toBe(false);
  });

  it("leaves get() and the typed getters unchanged: they still throw under 'error'", async () => {
    const client = await makeClient();
    expect(() => client.get(MISSING)).toThrow(`No value found for key "${MISSING}"`);
    expect(() => client.getBool(MISSING)).toThrow(`No value found for key "${MISSING}"`);
    expect(() => client.getString(MISSING)).toThrow(`No value found for key "${MISSING}"`);
  });

  it("still throws when called before init()", () => {
    const client = new Quonfig({
      sdkKey: "test-unused",
      datadir: DATA_DIR,
      environment: ENVIRONMENT,
    });
    expect(() => client.isEnabled(MISSING)).toThrow();
  });
});
