import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";

/**
 * Non-envelope rejection + held-generation monotonicity (qfg-9dxb.3 Fix A/B,
 * qfg-4k7d).
 *
 * A config payload must be an envelope: a `meta` object with a non-empty
 * `version`. Anything else (a misbehaving proxy/WAF answering 200 `{}` or
 * `{"error":"x"}`) is a failed leg on HTTP — so hedge/failover proceed and its
 * ETag is never stored — and a dropped event on SSE. It must never wipe the
 * held config, lower the held generation, or wedge the refresh machinery.
 */

function flagEnvelope(value: boolean, meta: Record<string, unknown>): Record<string, unknown> {
  return {
    meta,
    configs: [
      {
        id: "flag-1",
        key: "build.dark-mode",
        type: "feature_flag",
        valueType: "bool",
        sendToClientSdk: false,
        default: {
          rules: [{ criteria: [{ operator: "ALWAYS_TRUE" }], value: { type: "bool", value } }],
        },
      },
    ],
  };
}

function versioned(value: boolean, generation: number): string {
  return JSON.stringify(
    flagEnvelope(value, { version: `gen-${generation}`, environment: "Production", generation })
  );
}

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function makeClient(apiUrls: string[], extra: Record<string, unknown> = {}): Quonfig {
  return new Quonfig({
    sdkKey: "test-backend-key",
    apiUrls,
    enableSSE: false,
    fallbackPollEnabled: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "ignore",
    initTimeout: 5000,
    ...extra,
  } as any);
}

/** Force one refresh through the real fetch+guard install path, bounded so a
 *  wedged (never-settling) refresh fails the test instead of hanging it. */
async function refresh(client: Quonfig): Promise<"settled" | "rejected" | "wedged"> {
  const p = (client as unknown as { fetchAndInstall(): Promise<void> }).fetchAndInstall();
  const wedge = new Promise<"wedged">((r) => setTimeout(() => r("wedged"), 2000));
  return Promise.race([
    p.then(
      () => "settled" as const,
      () => "rejected" as const
    ),
    wedge,
  ]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("HTTP: a non-envelope 200 on an established client", () => {
  for (const junk of ["{}", '{"error":"x"}', '{"meta":{}}', '{"meta":{"version":""}}', "[]"]) {
    it(`keeps keys + held generation for ${junk}, does not wedge, and a later good payload installs`, async () => {
      let body = versioned(true, 42);
      let etag = '"gen-42"';
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
        res.end(body);
      });
      const url = await listen(server);

      const client = makeClient([url]);
      try {
        await client.init();
        expect(client.heldGeneration()).toBe(42);
        expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
        const installs = client.configInstallCount();

        body = junk;
        etag = '"junk"';
        const outcome = await refresh(client);
        // A bad leg is a leg error: every fired leg failed → the refresh rejects
        // (never wedges).
        expect(outcome).toBe("rejected");
        expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
        expect(client.heldGeneration()).toBe(42);
        expect(client.configInstallCount()).toBe(installs);

        // The refresh machinery is still alive: a newer good payload installs.
        body = versioned(false, 43);
        etag = '"gen-43"';
        expect(await refresh(client)).toBe("settled");
        expect(client.heldGeneration()).toBe(43);
        expect(client.isFeatureEnabled("build.dark-mode")).toBe(false);
      } finally {
        await client.close().catch(() => {});
      }
    });
  }

  it("never stores the ETag of a rejected non-envelope 200", async () => {
    const seenIfNoneMatch: (string | undefined)[] = [];
    let body = versioned(true, 42);
    let etag = '"gen-42"';
    const server = http.createServer((req, res) => {
      seenIfNoneMatch.push(req.headers["if-none-match"] as string | undefined);
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      res.end(body);
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      body = "{}";
      etag = '"junk"';
      await refresh(client);
      await refresh(client);
      // The junk body's ETag must not be echoed back — otherwise a later 304
      // would "confirm" junk. The last good ETag stays in the slot.
      expect(seenIfNoneMatch.slice(1)).toEqual(['"gen-42"', '"gen-42"']);
    } finally {
      await client.close().catch(() => {});
    }
  });

  it("fails over to the secondary when the primary answers a non-envelope 200", async () => {
    const primary = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"error":"blocked by waf"}');
    });
    const secondary = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"s-7"', "Content-Type": "application/json" });
      res.end(versioned(true, 7));
    });
    const primaryUrl = await listen(primary);
    const secondaryUrl = await listen(secondary);

    const client = makeClient([primaryUrl, secondaryUrl]);
    try {
      await client.init();
      expect(client.heldGeneration()).toBe(7);
      expect(client.resolvedFrom()).toBe("secondary");
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
    } finally {
      await client.close().catch(() => {});
    }
  });
});

describe("qfg serve payloads (version + environment, no generation)", () => {
  it("seed a fresh client and install on an established one via the carve-out, keeping the held max", async () => {
    let body = JSON.stringify(
      flagEnvelope(true, { version: "abc123", environment: "development" })
    );
    let etag = '"serve-1"';
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: etag, "Content-Type": "application/json" });
      res.end(body);
    });
    const url = await listen(server);

    const client = makeClient([url]);
    try {
      await client.init();
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.heldGeneration()).toBe(0);

      body = versioned(true, 42);
      etag = '"gen-42"';
      expect(await refresh(client)).toBe("settled");
      expect(client.heldGeneration()).toBe(42);
      const installs = client.configInstallCount();

      body = JSON.stringify(flagEnvelope(false, { version: "def456", environment: "development" }));
      etag = '"serve-2"';
      expect(await refresh(client)).toBe("settled");
      expect(client.configInstallCount()).toBe(installs + 1);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(false);
      // Fix A: the unversioned install never lowers the positive held generation.
      expect(client.heldGeneration()).toBe(42);
    } finally {
      await client.close().catch(() => {});
    }
  });
});

interface FakeEventSource {
  onopen: ((evt: any) => void) | null;
  onmessage: ((evt: any) => void) | null;
  onerror: ((evt: any) => void) | null;
  close: () => void;
}

describe("SSE: a non-envelope event", () => {
  it("is dropped like malformed JSON: keys, held generation and liveness untouched", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { ETag: '"gen-42"', "Content-Type": "application/json" });
      res.end(versioned(true, 42));
    });
    const url = await listen(server);

    const out: { value: FakeEventSource | null } = { value: null };
    const client = makeClient([url], {
      enableSSE: true,
      __testEventSourceFactory: () => {
        const es: FakeEventSource = {
          onopen: null,
          onmessage: null,
          onerror: null,
          close: () => {},
        };
        out.value = es;
        return es;
      },
    });
    try {
      await client.init();
      for (let i = 0; i < 50 && !out.value; i++) await new Promise((r) => setTimeout(r, 10));
      expect(out.value).not.toBeNull();
      out.value!.onopen?.({});
      const installs = client.configInstallCount();
      const refreshedAt = client.lastSuccessfulRefresh();

      await new Promise((r) => setTimeout(r, 5));
      for (const junk of ["{}", '{"error":"x"}', '{"meta":{"version":""},"configs":[]}']) {
        out.value!.onmessage?.({ data: junk });
      }
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(true);
      expect(client.heldGeneration()).toBe(42);
      expect(client.configInstallCount()).toBe(installs);
      expect(client.lastSuccessfulRefresh()).toEqual(refreshedAt);

      // A good newer event still installs.
      out.value!.onmessage?.({ data: versioned(false, 43) });
      expect(client.heldGeneration()).toBe(43);
      expect(client.isFeatureEnabled("build.dark-mode")).toBe(false);
    } finally {
      await client.close().catch(() => {});
    }
  });
});
