// Code generated from integration-test-data/tests/eval/get_or_raise.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient, withEnv } from "./setup";

async function initFailureClient(
  onInitFailure: string | undefined,
  apiUrls: string[],
  apiStatuses: number[],
  apiBody: string | undefined,
  initTimeoutMs: number
): Promise<{ client: any; error: unknown; elapsedMs: number; close: () => Promise<void> }> {
  const { Quonfig } = await import("../../src/quonfig");
  const http = await import("node:http");
  const servers: import("node:http").Server[] = [];
  let urls = apiUrls;
  if (apiStatuses.length > 0) {
    urls = [];
    for (const [i, status] of apiStatuses.entries()) {
      if (status === 0) {
        urls.push(apiUrls[i]);
        continue;
      }
      const server = http.createServer((_req, res) => {
        res.writeHead(status);
        res.end(apiBody);
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      servers.push(server);
      urls.push(`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`);
    }
  }
  const opts: Record<string, unknown> = {
    sdkKey: "itd-init-failure",
    apiUrls: urls,
    initTimeout: initTimeoutMs,
    enableSSE: false,
    enablePolling: false,
    collectEvaluationSummaries: false,
    contextUploadMode: "none",
    onNoDefault: "error",
  };
  if (onInitFailure !== undefined) opts.onInitFailure = onInitFailure;
  const client = new Quonfig(opts as ConstructorParameters<typeof Quonfig>[0]);
  const start = Date.now();
  let error: unknown;
  try {
    await client.init();
  } catch (e) {
    error = e;
  }
  const elapsedMs = Date.now() - start;
  const close = async (): Promise<void> => {
    await client.close();
    for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  };
  return { client, error, elapsedMs, close };
}

describe("get_or_raise", () => {
  it("get_or_raise can raise an error if value not found", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("my-missing-key")).toThrow(/^No value found for key "/);
    });
  });

  it("get_or_raise returns a default value instead of raising", async () => {
    await withClient({}, (client) => {
      expect(client.get("my-missing-key", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("init fails by default when every delivery leg refuses the connection", async () => {
    const init = await initFailureClient(
      undefined,
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      0
    );
    try {
      expect(init.error, "init() must reject (on_init_failure default = fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(8000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises the init timeout when every delivery leg hangs", async () => {
    const init = await initFailureClient(
      "fail",
      ["http://192.0.2.1:8001", "http://192.0.2.1:8002"],
      [],
      undefined,
      200
    );
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("timeout");
      expect(init.elapsedMs).toBeLessThan(2000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises at once when every delivery leg answers 401", async () => {
    const init = await initFailureClient("fail", [], [401, 401], undefined, 8000);
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unauthorized");
      expect(init.elapsedMs).toBeLessThan(4000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("get_or_raise returns the default after init continues past refused delivery legs", async () => {
    const init = await initFailureClient(
      "continue",
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      500
    );
    try {
      expect(init.error, "on_init_failure continue: init() must resolve").toBeUndefined();
      const client = init.client;
      expect(client.get("any-key", undefined, "DEFAULT")).toBe("DEFAULT");
    } finally {
      await init.close();
    }
  }, 20000);

  it("get_or_raise raises missing_default after init continues past refused delivery legs", async () => {
    const init = await initFailureClient(
      "continue",
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      500
    );
    try {
      expect(init.error, "on_init_failure continue: init() must resolve").toBeUndefined();
      const client = init.client;
      expect(() => client.getString("any-key")).toThrow(/^No value found for key "/);
    } finally {
      await init.close();
    }
  }, 20000);

  // unsupported by sdk-node: sdk-node has no legacy on_init_failure spellings to keep as aliases (init-failure design B.2: "node: none")
  it.skip("deprecated on_init_failure raise behaves as fail when every delivery leg refuses the connection", async () => {
    const init = await initFailureClient(
      "raise",
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      0
    );
    try {
      expect(init.error, "init() must reject (on_init_failure raise)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(8000);
    } finally {
      await init.close();
    }
  }, 20000);

  // unsupported by sdk-node: sdk-node has no legacy on_init_failure spellings to keep as aliases (init-failure design B.2: "node: none")
  it.skip("deprecated on_init_failure return behaves as continue when every delivery leg refuses the connection", async () => {
    const init = await initFailureClient(
      "return",
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      500
    );
    try {
      expect(init.error, "on_init_failure continue: init() must resolve").toBeUndefined();
      const client = init.client;
      expect(() => client.getString("any-key")).toThrow(/^No value found for key "/);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises at once when every delivery leg answers 404", async () => {
    const init = await initFailureClient("fail", [], [404, 404], undefined, 8000);
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unauthorized");
      expect(init.elapsedMs).toBeLessThan(4000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises at once when every delivery leg answers 410", async () => {
    const init = await initFailureClient("fail", [], [410, 410], undefined, 8000);
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unauthorized");
      expect(init.elapsedMs).toBeLessThan(4000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises unavailable after one attempt when only the primary answers 401 and the secondary 503", async () => {
    const init = await initFailureClient("fail", [], [401, 503], undefined, 0);
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(5000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises unavailable at the deadline when the primary answers 401 and the secondary hangs", async () => {
    const init = await initFailureClient(
      "fail",
      ["", "http://192.0.2.1:8002"],
      [401, 0],
      undefined,
      9000
    );
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(12000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with init_timeout_ms 0 and on_init_failure fail raises after one attempt when every delivery leg refuses the connection", async () => {
    const init = await initFailureClient(
      "fail",
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      0
    );
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(8000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("get_or_raise returns the default after init with init_timeout_ms 0 continues past refused delivery legs", async () => {
    const init = await initFailureClient(
      "continue",
      ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      [],
      undefined,
      0
    );
    try {
      expect(init.error, "on_init_failure continue: init() must resolve").toBeUndefined();
      const client = init.client;
      expect(client.get("any-key", undefined, "DEFAULT")).toBe("DEFAULT");
    } finally {
      await init.close();
    }
  }, 20000);

  it("init with on_init_failure fail raises the init timeout when every delivery leg hangs past its per-leg abort", async () => {
    const init = await initFailureClient(
      "fail",
      ["http://192.0.2.1:8001", "http://192.0.2.1:8002"],
      [],
      undefined,
      10000
    );
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("timeout");
      expect(init.elapsedMs).toBeLessThan(14000);
    } finally {
      await init.close();
    }
  }, 20000);

  it("init error never carries the userinfo of a delivery URL", async () => {
    const init = await initFailureClient(
      "fail",
      ["http://qfguser:qfgsecret@127.0.0.1:1", "http://qfguser:qfgsecret@127.0.0.1:2"],
      [],
      undefined,
      0
    );
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(8000);
      const messages: string[] = [];
      for (
        let e: unknown = init.error;
        e !== undefined && e !== null;
        e = (e as { cause?: unknown }).cause
      ) {
        messages.push(e instanceof Error ? e.message : String(e));
        if (messages.length > 20) break;
      }
      for (const m of messages) {
        expect(m).not.toContain("qfgsecret");
        expect(m).not.toContain("qfguser");
      }
    } finally {
      await init.close();
    }
  }, 20000);

  it("init error never carries an upstream response body", async () => {
    const init = await initFailureClient(
      "fail",
      [],
      [503, 503],
      "upstream exploded: qfg-upstream-body-marker",
      0
    );
    try {
      expect(init.error, "init() must reject (on_init_failure fail)").toBeDefined();
      expect((init.error as Error).name).toBe("QuonfigInitError");
      expect((init.error as { reason?: unknown }).reason).toBe("unavailable");
      expect(init.elapsedMs).toBeLessThan(5000);
      const messages: string[] = [];
      for (
        let e: unknown = init.error;
        e !== undefined && e !== null;
        e = (e as { cause?: unknown }).cause
      ) {
        messages.push(e instanceof Error ? e.message : String(e));
        if (messages.length > 20) break;
      }
      for (const m of messages) {
        expect(m).not.toContain("qfg-upstream-body-marker");
      }
    } finally {
      await init.close();
    }
  }, 20000);

  it("raises an error if a config is provided by a missing environment variable", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("provided.by.missing.env.var")).toThrow(
        /^Environment variable ".*" not set for config "/
      );
    });
  });

  it("raises an error if an env-var-provided config cannot be coerced to configured type", async () => {
    await withClient({}, (client) => {
      expect(() => client.getNumber("provided.not.a.number")).toThrow(
        /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("coercion error for an int env var names the variable and never its value", async () => {
    await withEnv({ QUONFIG_ITD_SECRET_ENV: "postgres://admin:hunter2@db" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getNumber("provided.secret.not.an.int")).toThrow(
          /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
        let raised: unknown;
        try {
          client.getNumber("provided.secret.not.an.int");
        } catch (e) {
          raised = e;
        }
        const raisedMessage = String((raised as Error | undefined)?.message);
        expect(raisedMessage).toContain(
          'environment variable "QUONFIG_ITD_SECRET_ENV" cannot be converted to int for config "provided.secret.not.an.int"'
        );
        expect(raisedMessage).not.toContain("hunter2");
        expect(raisedMessage).not.toContain("postgres://");
      });
    });
  });

  it("coercion error for a double env var names the variable and never its value", async () => {
    await withEnv({ QUONFIG_ITD_SECRET_ENV: "postgres://admin:hunter2@db" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getNumber("provided.secret.not.a.double")).toThrow(
          /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
        let raised: unknown;
        try {
          client.getNumber("provided.secret.not.a.double");
        } catch (e) {
          raised = e;
        }
        const raisedMessage = String((raised as Error | undefined)?.message);
        expect(raisedMessage).toContain(
          'environment variable "QUONFIG_ITD_SECRET_ENV" cannot be converted to double for config "provided.secret.not.a.double"'
        );
        expect(raisedMessage).not.toContain("hunter2");
        expect(raisedMessage).not.toContain("postgres://");
      });
    });
  });

  it("raises an error for decryption failure", async () => {
    await withClient({}, (client) => {
      expect(() => client.getString("a.broken.secret.config")).toThrow(
        /^(Invalid key length|Invalid encrypted string|Unsupported state or unable to authenticate data)/
      );
    });
  });

  it("raises an error if an env-var-provided duration 30s cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_30S: "30s" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.30s")).toThrow(
          /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if an env-var-provided duration PT0.5H cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_PT0_5H: "PT0.5H" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.PT0.5H")).toThrow(
          /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if an env-var-provided duration P1DT cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_P1DT: "P1DT" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.P1DT")).toThrow(
          /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if an env-var-provided duration garbage cannot be coerced", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_GARBAGE: "garbage" }, async () => {
      await withClient({}, (client) => {
        expect(() => client.getDuration("provided.duration.malformed.garbage")).toThrow(
          /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
        );
      });
    });
  });

  it("raises an error if a stored duration 30s cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.30s")).toThrow(
        /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration PT0.5H cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.PT0.5H")).toThrow(
        /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration P1DT cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.P1DT")).toThrow(
        /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration garbage cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.garbage")).toThrow(
        /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });

  it("raises an error if a stored duration empty cannot be coerced", async () => {
    await withClient({}, (client) => {
      expect(() => client.getDuration("test.duration.malformed.empty")).toThrow(
        /^(environment variable ".*" cannot be converted to (int|double|duration) for config ".*"|\[quonfig\] Config ".*" has a malformed duration value)$/
      );
    });
  });
});
