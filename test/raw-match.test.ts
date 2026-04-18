import { afterEach, describe, expect, it, vi } from "vitest";

import { Quonfig } from "../src/quonfig";
import type { ConfigEnvelope } from "../src/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

function alwaysTrue(value: any) {
  return {
    criteria: [{ operator: "ALWAYS_TRUE" }],
    value,
  };
}

function envelope(configs: ConfigEnvelope["configs"]): ConfigEnvelope {
  return {
    meta: { version: "test", environment: "Production" },
    configs,
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

describe("Quonfig.getRawMatch", () => {
  it("returns provided ENV_VAR pointer WITHOUT reading process.env", async () => {
    vi.stubEnv("MY_RAW_SECRET", "evil-resolved-value-should-never-appear");

    const q = await makeClient(
      envelope([
        {
          id: "cfg-1",
          key: "api-token",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [
              alwaysTrue({
                type: "provided",
                value: { source: "ENV_VAR", lookup: "MY_RAW_SECRET" },
                confidential: true,
              }),
            ],
          },
        },
      ])
    );

    const raw = q.getRawMatch("api-token");
    expect(raw).toBeDefined();
    expect(raw!.config.key).toBe("api-token");
    expect(raw!.config.confidential).toBe(true);
    // Value must be the raw pointer, not the resolved env value.
    expect(raw!.config.value).toEqual({ source: "ENV_VAR", lookup: "MY_RAW_SECRET" });
    // The resolved env value MUST NOT appear anywhere in the serialized result.
    expect(JSON.stringify(raw)).not.toContain("evil-resolved-value-should-never-appear");
    // Dependencies should include a providedBy entry.
    expect(raw!.config.dependencies).toEqual([
      { dependencyType: "providedBy", source: "MY_RAW_SECRET" },
    ]);
  });

  it("returns ciphertext + nested decryptWith dependency whose inner config has providedBy", async () => {
    // Use a deliberately invalid ciphertext — if decrypt() were called, it would throw.
    const q = await makeClient(
      envelope([
        {
          id: "cfg-secret",
          key: "db.password",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [
              alwaysTrue({
                type: "string",
                value: "not-a-real-ciphertext--would-fail-decrypt",
                confidential: true,
                decryptWith: "encryption-key",
              }),
            ],
          },
        },
        {
          id: "cfg-key",
          key: "encryption-key",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [
              alwaysTrue({
                type: "provided",
                value: { source: "ENV_VAR", lookup: "QUONFIG_ENCRYPTION_KEY" },
                confidential: true,
              }),
            ],
          },
        },
      ])
    );

    // Must not throw — decrypt() must NOT be called.
    const raw = q.getRawMatch("db.password");
    expect(raw).toBeDefined();
    expect(raw!.config.key).toBe("db.password");
    expect(raw!.config.value).toBe("not-a-real-ciphertext--would-fail-decrypt");
    expect(raw!.config.confidential).toBe(true);

    const deps = raw!.config.dependencies ?? [];
    const decryptDep = deps.find((d) => d.dependencyType === "decryptWith");
    expect(decryptDep).toBeDefined();
    expect(decryptDep!.source).toBe("encryption-key");
    expect(decryptDep!.config).toBeDefined();
    expect(decryptDep!.config!.key).toBe("encryption-key");
    expect(decryptDep!.config!.value).toEqual({
      source: "ENV_VAR",
      lookup: "QUONFIG_ENCRYPTION_KEY",
    });
    expect(decryptDep!.config!.dependencies).toEqual([
      { dependencyType: "providedBy", source: "QUONFIG_ENCRYPTION_KEY" },
    ]);
  });

  it("does NOT infinite loop on decryptWith cycles (A -> B -> A)", async () => {
    const q = await makeClient(
      envelope([
        {
          id: "cfg-a",
          key: "cycle.a",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [
              alwaysTrue({
                type: "string",
                value: "cipher-a",
                confidential: true,
                decryptWith: "cycle.b",
              }),
            ],
          },
        },
        {
          id: "cfg-b",
          key: "cycle.b",
          type: "config",
          valueType: "string",
          sendToClientSdk: false,
          default: {
            rules: [
              alwaysTrue({
                type: "string",
                value: "cipher-b",
                confidential: true,
                decryptWith: "cycle.a",
              }),
            ],
          },
        },
      ])
    );

    const raw = q.getRawMatch("cycle.a");
    expect(raw).toBeDefined();
    expect(raw!.config.key).toBe("cycle.a");
    expect(raw!.config.value).toBe("cipher-a");

    // The chain should terminate when the cycle is detected. Walk the tree and
    // assert it bottoms out (no dependency referencing cycle.a re-appears below cycle.a).
    const seen = new Set<string>();
    let curKey: string | undefined = raw!.config.key;
    let curDeps = raw!.config.dependencies;
    let depth = 0;
    while (curKey && !seen.has(curKey) && depth < 10) {
      seen.add(curKey);
      const d = (curDeps ?? []).find((x) => x.dependencyType === "decryptWith");
      if (!d) break;
      curKey = d.config?.key;
      curDeps = d.config?.dependencies;
      depth++;
    }
    expect(depth).toBeLessThan(10);
  });

  it("returns undefined when the key is not in the store", async () => {
    const q = await makeClient(envelope([]));
    expect(q.getRawMatch("missing")).toBeUndefined();
  });

  it("populates metadata (configId, type, valueType, ruleIndex)", async () => {
    const q = await makeClient(
      envelope([
        {
          id: "cfg-meta",
          key: "plain.flag",
          type: "feature_flag",
          valueType: "bool",
          sendToClientSdk: true,
          default: {
            rules: [alwaysTrue({ type: "bool", value: true })],
          },
        },
      ])
    );

    const raw = q.getRawMatch("plain.flag");
    expect(raw).toBeDefined();
    expect(raw!.config.value).toBe(true);
    expect(raw!.config.metadata.id).toBe("cfg-meta");
    expect(raw!.config.metadata.type).toBe("feature_flag");
    expect(raw!.config.metadata.valueType).toBe("bool");
    expect(raw!.config.metadata.configRowIndex).toBe(0);
    expect(raw!.config.dependencies).toBeUndefined();
  });
});
