// The ENV_VAR coercion error must never echo the env var's contents
// (qfg-goi1.2.31). It names the env var, the target type and the config key
// only, in the template pinned across SDKs (sdk-go 4178377, sdk-net 0402468):
//   environment variable "<NAME>" cannot be converted to <type> for config "<key>"
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { resolve } from "path";
import { Quonfig } from "../src/quonfig";
import { Resolver } from "../src/resolver";
import { ConfigStore } from "../src/store";
import { Evaluator } from "../src/evaluator";
import type { Value, ValueType } from "../src/types";

const SECRET = "postgres://admin:hunter2@db";
const VAR = "QUONFIG_TEST_COERCION_ERROR_MESSAGE";
const DATADIR = resolve(__dirname, "../../integration-test-data/data/integration-tests");

describe("ENV_VAR coercion error message", () => {
  const store = new ConfigStore();
  const resolver = new Resolver(store, new Evaluator(store));
  const provided: Value = { type: "provided", value: { source: "ENV_VAR", lookup: VAR } } as Value;

  afterEach(() => {
    delete process.env[VAR];
  });

  function errorFor(valueType: ValueType): string {
    process.env[VAR] = SECRET;
    try {
      resolver.resolveValue(provided, "db.pool.size", valueType, "env", {});
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected coercion to fail");
  }

  it.each(["int", "double", "duration"] as ValueType[])(
    "%s: names the env var, type and key, never the value",
    (valueType) => {
      const message = errorFor(valueType);
      expect(message).not.toContain("hunter2");
      expect(message).toBe(
        `environment variable "${VAR}" cannot be converted to ${valueType} for config "db.pool.size"`
      );
    }
  );

  describe("through the client", () => {
    let quonfig: Quonfig;
    const saved = process.env.NOT_A_NUMBER;

    beforeAll(async () => {
      process.env.NOT_A_NUMBER = SECRET;
      quonfig = new Quonfig({
        sdkKey: "test-sdk-key",
        datadir: DATADIR,
        environment: "Production",
        enableSSE: false,
      });
      await quonfig.init();
    });
    afterAll(() => {
      if (saved === undefined) delete process.env.NOT_A_NUMBER;
      else process.env.NOT_A_NUMBER = saved;
    });

    it("getNumberDetails errorMessage omits the value", () => {
      const details = quonfig.getNumberDetails("provided.not.a.number");
      expect(details.reason).toBe("ERROR");
      expect(details.errorMessage).not.toContain("hunter2");
      expect(details.errorMessage).toContain('"NOT_A_NUMBER"');
      expect(details.errorMessage).toContain('"provided.not.a.number"');
    });

    it("getNumber's thrown error omits the value", () => {
      expect(() => quonfig.getNumber("provided.not.a.number")).toThrow(
        'environment variable "NOT_A_NUMBER" cannot be converted to int for config "provided.not.a.number"'
      );
    });
  });
});
