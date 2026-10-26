// Code generated from integration-test-data/tests/eval/get.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient, withEnv } from "./setup";

describe("get", () => {
  it("get returns a found value for key", async () => {
    await withClient({}, (client) => {
      expect(client.getString("my-test-key")).toBe("my-test-value");
    });
  });

  it("get returns nil if value not found", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("my-missing-key")).toBe(undefined);
    });
  });

  it("get returns a default for a missing value if a default is given", async () => {
    await withClient({}, (client) => {
      expect(client.getString("my-missing-key", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("get ignores a provided default if the key is found", async () => {
    await withClient({}, (client) => {
      expect(client.getString("my-test-key", undefined, "DEFAULT")).toBe("my-test-value");
    });
  });

  it("get can return a double", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("my-double-key")).toBe(9.95);
    });
  });

  it("get can return a string list", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("my-string-list-key")).toEqual(["a", "b", "c"]);
    });
  });

  it("can return a value provided by an environment variable", async () => {
    await withClient({}, (client) => {
      expect(client.getString("prefab.secrets.encryption.key")).toBe(
        "c87ba22d8662282abe8a0e4651327b579cb64a454ab0f4c170b45b15f049a221"
      );
    });
  });

  it("can return a value provided by an environment variable after type coercion", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("provided.a.number")).toBe(1234);
    });
  });

  it("can decrypt and return a secret value (with decryption key in in env var)", async () => {
    await withClient({}, (client) => {
      expect(client.getString("a.secret.config")).toBe("hello.world");
    });
  });

  it("decrypts a secret whose key config has an environment rule", async () => {
    await withClient({}, (client) => {
      expect(client.getString("env.scoped.secret")).toBe("hello.world");
    });
  });

  it("duration 200 ms", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT0.2S")).toBe(200);
    });
  });

  it("duration 90S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT90S")).toBe(90000);
    });
  });

  it("duration 30M", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT30M")).toBe(1800000);
    });
  });

  it("duration test.duration.P1DT6H2M1.5S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.P1DT6H2M1.5S")).toBe(108121500);
    });
  });

  it("duration zero PT0S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT0S")).toBe(0);
    });
  });

  it("duration zero P0D", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.P0D")).toBe(0);
    });
  });

  it("duration days only P2D", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.P2D")).toBe(172800000);
    });
  });

  it("duration hours only PT1H", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT1H")).toBe(3600000);
    });
  });

  it("duration minutes only PT1M", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT1M")).toBe(60000);
    });
  });

  it("duration seconds only PT1S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT1S")).toBe(1000);
    });
  });

  it("duration leading zero PT05S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT05S")).toBe(5000);
    });
  });

  it("duration hours and minutes PT1H30M", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT1H30M")).toBe(5400000);
    });
  });

  it("duration days and hours P1DT2H", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.P1DT2H")).toBe(93600000);
    });
  });

  it("duration one millisecond PT0.001S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT0.001S")).toBe(1);
    });
  });

  it("duration magnitude ceiling P36500D", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.P36500D")).toBe(3153600000000);
    });
  });

  it("duration rounding PT2.01S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT2.01S")).toBe(2010);
    });
  });

  it("duration rounding PT1.005S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT1.005S")).toBe(1005);
    });
  });

  it("duration rounding half up PT0.0005S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT0.0005S")).toBe(1);
    });
  });

  it("duration rounding down PT0.0004S", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.PT0.0004S")).toBe(0);
    });
  });

  it("json test", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("test.json")).toEqual({ a: 1, b: "c" });
    });
  });

  it("get returns a native json object (not a stringified payload)", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("test.json")).toEqual({ a: 1, b: "c" });
    });
  });

  it("list on left side test (1)", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("left.hand.list.test", {
          user: { name: "james", aka: ["happy", "sleepy"] },
        })
      ).toBe("correct");
    });
  });

  it("list on left side test (2)", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("left.hand.list.test", { user: { name: "james", aka: ["a", "b"] } })
      ).toBe("default");
    });
  });

  it("list on left side test opposite (1)", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("left.hand.test.opposite", {
          user: { name: "james", aka: ["happy", "sleepy"] },
        })
      ).toBe("default");
    });
  });

  it("list on left side test (3)", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("left.hand.test.opposite", { user: { name: "james", aka: ["a", "b"] } })
      ).toBe("correct");
    });
  });

  it("env-var-provided duration PT1.5S via get", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_PT1_5S: "PT1.5S" }, async () => {
      await withClient({}, (client) => {
        expect(client.getDuration("provided.duration.PT1.5S")).toBe(1500);
      });
    });
  });

  it("stored malformed duration 30s returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.malformed.30s", undefined, 7000)).toBe(7000);
    });
  });

  it("stored malformed duration 30s with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("test.duration.malformed.30s")).toBe(undefined);
    });
  });

  it("stored malformed duration PT0.5H returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.malformed.PT0.5H", undefined, 7000)).toBe(7000);
    });
  });

  it("stored malformed duration PT0.5H with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("test.duration.malformed.PT0.5H")).toBe(undefined);
    });
  });

  it("stored malformed duration P1DT returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.malformed.P1DT", undefined, 7000)).toBe(7000);
    });
  });

  it("stored malformed duration P1DT with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("test.duration.malformed.P1DT")).toBe(undefined);
    });
  });

  it("stored malformed duration garbage returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.malformed.garbage", undefined, 7000)).toBe(7000);
    });
  });

  it("stored malformed duration garbage with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("test.duration.malformed.garbage")).toBe(undefined);
    });
  });

  it("stored malformed duration empty returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("test.duration.malformed.empty", undefined, 7000)).toBe(7000);
    });
  });

  it("stored malformed duration empty with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("test.duration.malformed.empty")).toBe(undefined);
    });
  });

  it("env-var-provided malformed duration 30s returns the default", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_30S: "30s" }, async () => {
      await withClient({}, (client) => {
        expect(client.getDuration("provided.duration.malformed.30s", undefined, 7000)).toBe(7000);
      });
    });
  });

  it("env-var-provided malformed duration 30s with no default returns nil", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_30S: "30s" }, async () => {
      await withClient({ onNoDefault: "warn" }, (client) => {
        expect(client.getDuration("provided.duration.malformed.30s")).toBe(undefined);
      });
    });
  });

  it("env-var-provided malformed duration PT0.5H returns the default", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_PT0_5H: "PT0.5H" }, async () => {
      await withClient({}, (client) => {
        expect(client.getDuration("provided.duration.malformed.PT0.5H", undefined, 7000)).toBe(
          7000
        );
      });
    });
  });

  it("env-var-provided malformed duration PT0.5H with no default returns nil", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_PT0_5H: "PT0.5H" }, async () => {
      await withClient({ onNoDefault: "warn" }, (client) => {
        expect(client.getDuration("provided.duration.malformed.PT0.5H")).toBe(undefined);
      });
    });
  });

  it("env-var-provided malformed duration P1DT returns the default", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_P1DT: "P1DT" }, async () => {
      await withClient({}, (client) => {
        expect(client.getDuration("provided.duration.malformed.P1DT", undefined, 7000)).toBe(7000);
      });
    });
  });

  it("env-var-provided malformed duration P1DT with no default returns nil", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_P1DT: "P1DT" }, async () => {
      await withClient({ onNoDefault: "warn" }, (client) => {
        expect(client.getDuration("provided.duration.malformed.P1DT")).toBe(undefined);
      });
    });
  });

  it("env-var-provided malformed duration garbage returns the default", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_GARBAGE: "garbage" }, async () => {
      await withClient({}, (client) => {
        expect(client.getDuration("provided.duration.malformed.garbage", undefined, 7000)).toBe(
          7000
        );
      });
    });
  });

  it("env-var-provided malformed duration garbage with no default returns nil", async () => {
    await withEnv({ QUONFIG_ITD_DURATION_GARBAGE: "garbage" }, async () => {
      await withClient({ onNoDefault: "warn" }, (client) => {
        expect(client.getDuration("provided.duration.malformed.garbage")).toBe(undefined);
      });
    });
  });

  it("STRING getter on stored int returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("getter.contract.int", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on stored int with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("getter.contract.int")).toBe(undefined);
    });
  });

  it("STRING getter on stored double returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("getter.contract.double", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on stored double with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("getter.contract.double")).toBe(undefined);
    });
  });

  it("STRING getter on stored bool returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("getter.contract.bool", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on stored bool with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("getter.contract.bool")).toBe(undefined);
    });
  });

  it("STRING getter on stored string_list returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("getter.contract.string_list", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on stored string_list with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("getter.contract.string_list")).toBe(undefined);
    });
  });

  it("STRING getter on stored json returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("getter.contract.json", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on stored json with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("getter.contract.json")).toBe(undefined);
    });
  });

  it("STRING getter on stored duration returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("getter.contract.duration", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on stored duration with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("getter.contract.duration")).toBe(undefined);
    });
  });

  it("INT getter on stored string returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.string", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored string with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.string")).toBe(undefined);
    });
  });

  it("INT getter on stored double 3.9 returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.double", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored double 3.9 with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.double")).toBe(undefined);
    });
  });

  it("INT getter on stored bool returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.bool", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored bool with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.bool")).toBe(undefined);
    });
  });

  it("INT getter on stored string_list returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.string_list", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored string_list with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.string_list")).toBe(undefined);
    });
  });

  it("INT getter on stored json returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.json", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored json with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.json")).toBe(undefined);
    });
  });

  it("INT getter on stored duration returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.duration", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored duration with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.duration")).toBe(undefined);
    });
  });

  it("DOUBLE getter on stored string returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.string", undefined, 7.5)).toBe(7.5);
    });
  });

  it("DOUBLE getter on stored string with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.string")).toBe(undefined);
    });
  });

  it("DOUBLE getter on stored bool returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.bool", undefined, 7.5)).toBe(7.5);
    });
  });

  it("DOUBLE getter on stored bool with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.bool")).toBe(undefined);
    });
  });

  it("DOUBLE getter on stored string_list returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.string_list", undefined, 7.5)).toBe(7.5);
    });
  });

  it("DOUBLE getter on stored string_list with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.string_list")).toBe(undefined);
    });
  });

  it("DOUBLE getter on stored json returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.json", undefined, 7.5)).toBe(7.5);
    });
  });

  it("DOUBLE getter on stored json with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.json")).toBe(undefined);
    });
  });

  it("DOUBLE getter on stored duration returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.duration", undefined, 7.5)).toBe(7.5);
    });
  });

  it("DOUBLE getter on stored duration with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.duration")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on stored string returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.string", undefined, false)).toBe(false);
    });
  });

  it("BOOLEAN getter on stored string with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.string")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on stored int returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.int", undefined, false)).toBe(false);
    });
  });

  it("BOOLEAN getter on stored int with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.int")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on stored double returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.double", undefined, false)).toBe(false);
    });
  });

  it("BOOLEAN getter on stored double with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.double")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on stored string_list returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.string_list", undefined, false)).toBe(false);
    });
  });

  it("BOOLEAN getter on stored string_list with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.string_list")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on stored json returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.json", undefined, false)).toBe(false);
    });
  });

  it("BOOLEAN getter on stored json with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.json")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on stored duration returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.duration", undefined, false)).toBe(false);
    });
  });

  it("BOOLEAN getter on stored duration with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.duration")).toBe(undefined);
    });
  });

  it("STRING_LIST getter on stored string returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("getter.contract.string", undefined, ["DEFAULT"])).toEqual([
        "DEFAULT",
      ]);
    });
  });

  it("STRING_LIST getter on stored string with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getStringList("getter.contract.string")).toBe(undefined);
    });
  });

  it("STRING_LIST getter on stored int returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("getter.contract.int", undefined, ["DEFAULT"])).toEqual([
        "DEFAULT",
      ]);
    });
  });

  it("STRING_LIST getter on stored int with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getStringList("getter.contract.int")).toBe(undefined);
    });
  });

  it("STRING_LIST getter on stored double returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("getter.contract.double", undefined, ["DEFAULT"])).toEqual([
        "DEFAULT",
      ]);
    });
  });

  it("STRING_LIST getter on stored double with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getStringList("getter.contract.double")).toBe(undefined);
    });
  });

  it("STRING_LIST getter on stored bool returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("getter.contract.bool", undefined, ["DEFAULT"])).toEqual([
        "DEFAULT",
      ]);
    });
  });

  it("STRING_LIST getter on stored bool with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getStringList("getter.contract.bool")).toBe(undefined);
    });
  });

  it("STRING_LIST getter on stored json returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("getter.contract.json", undefined, ["DEFAULT"])).toEqual([
        "DEFAULT",
      ]);
    });
  });

  it("STRING_LIST getter on stored json with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getStringList("getter.contract.json")).toBe(undefined);
    });
  });

  it("STRING_LIST getter on stored duration returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getStringList("getter.contract.duration", undefined, ["DEFAULT"])).toEqual([
        "DEFAULT",
      ]);
    });
  });

  it("STRING_LIST getter on stored duration with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getStringList("getter.contract.duration")).toBe(undefined);
    });
  });

  it("JSON getter on stored string returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("getter.contract.string", undefined, { default: true })).toEqual({
        default: true,
      });
    });
  });

  it("JSON getter on stored string with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getJSON("getter.contract.string")).toBe(undefined);
    });
  });

  it("JSON getter on stored int returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("getter.contract.int", undefined, { default: true })).toEqual({
        default: true,
      });
    });
  });

  it("JSON getter on stored int with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getJSON("getter.contract.int")).toBe(undefined);
    });
  });

  it("JSON getter on stored double returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("getter.contract.double", undefined, { default: true })).toEqual({
        default: true,
      });
    });
  });

  it("JSON getter on stored double with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getJSON("getter.contract.double")).toBe(undefined);
    });
  });

  it("JSON getter on stored bool returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("getter.contract.bool", undefined, { default: true })).toEqual({
        default: true,
      });
    });
  });

  it("JSON getter on stored bool with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getJSON("getter.contract.bool")).toBe(undefined);
    });
  });

  it("JSON getter on stored string_list returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("getter.contract.string_list", undefined, { default: true })).toEqual({
        default: true,
      });
    });
  });

  it("JSON getter on stored string_list with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getJSON("getter.contract.string_list")).toBe(undefined);
    });
  });

  it("JSON getter on stored duration returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getJSON("getter.contract.duration", undefined, { default: true })).toEqual({
        default: true,
      });
    });
  });

  it("JSON getter on stored duration with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getJSON("getter.contract.duration")).toBe(undefined);
    });
  });

  it("DURATION getter on stored string returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.string", undefined, 7000)).toBe(7000);
    });
  });

  it("DURATION getter on stored string with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.string")).toBe(undefined);
    });
  });

  it("DURATION getter on stored int returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.int", undefined, 7000)).toBe(7000);
    });
  });

  it("DURATION getter on stored int with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.int")).toBe(undefined);
    });
  });

  it("DURATION getter on stored double returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.double", undefined, 7000)).toBe(7000);
    });
  });

  it("DURATION getter on stored double with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.double")).toBe(undefined);
    });
  });

  it("DURATION getter on stored bool returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.bool", undefined, 7000)).toBe(7000);
    });
  });

  it("DURATION getter on stored bool with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.bool")).toBe(undefined);
    });
  });

  it("DURATION getter on stored string_list returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.string_list", undefined, 7000)).toBe(7000);
    });
  });

  it("DURATION getter on stored string_list with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.string_list")).toBe(undefined);
    });
  });

  it("DURATION getter on stored json returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.json", undefined, 7000)).toBe(7000);
    });
  });

  it("DURATION getter on stored json with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.json")).toBe(undefined);
    });
  });

  it('BOOLEAN getter on stored string "false" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.string.false", undefined, false)).toBe(false);
    });
  });

  it('BOOLEAN getter on stored string "false" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.string.false")).toBe(undefined);
    });
  });

  it('BOOLEAN getter on stored string "false" returns a true default', async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.string.false", undefined, true)).toBe(true);
    });
  });

  it('BOOLEAN getter on stored string "true" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.string.true", undefined, false)).toBe(false);
    });
  });

  it('BOOLEAN getter on stored string "true" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.string.true")).toBe(undefined);
    });
  });

  it('INT getter on stored string "3" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.string.number", undefined, 7)).toBe(7);
    });
  });

  it('INT getter on stored string "3" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.string.number")).toBe(undefined);
    });
  });

  it('DOUBLE getter on stored string "3" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.string.number", undefined, 7.5)).toBe(7.5);
    });
  });

  it('DOUBLE getter on stored string "3" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.string.number")).toBe(undefined);
    });
  });

  it('DURATION getter on stored string "PT1S" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getDuration("getter.contract.string.duration", undefined, 7000)).toBe(7000);
    });
  });

  it('DURATION getter on stored string "PT1S" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getDuration("getter.contract.string.duration")).toBe(undefined);
    });
  });

  it("DOUBLE get on stored int 30 returns 30.0", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.int")).toBe(30);
    });
  });

  it("INT get on stored whole double 3.0 returns 3", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.double.whole")).toBe(3);
    });
  });

  it("DOUBLE getter on stored int 30 ignores the default", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.int", undefined, 7.5)).toBe(30);
    });
  });

  it("INT getter on stored whole double 3.0 ignores the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.double.whole", undefined, 7)).toBe(3);
    });
  });

  it("INT getter on stored double 1e300 returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.double.huge", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored double 1e300 with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.double.huge")).toBe(undefined);
    });
  });

  it("INT getter on stored double 2^53 (outside the safe int range) returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.double.unsafe", undefined, 7)).toBe(7);
    });
  });

  it("INT getter on stored double 2^53 (outside the safe int range) with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.double.unsafe")).toBe(undefined);
    });
  });

  it('INT getter on stored malformed int "twelve" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getInt("getter.contract.int.malformed", undefined, 7)).toBe(7);
    });
  });

  it('INT getter on stored malformed int "twelve" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getInt("getter.contract.int.malformed")).toBe(undefined);
    });
  });

  it('DOUBLE getter on stored malformed double "abc" returns the default', async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("getter.contract.double.malformed", undefined, 7.5)).toBe(7.5);
    });
  });

  it('DOUBLE getter on stored malformed double "abc" with no default returns nil', async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getNumber("getter.contract.double.malformed")).toBe(undefined);
    });
  });

  it('INT getter on env-var-provided malformed int "twelve" returns the default', async () => {
    await withEnv({ QUONFIG_ITD_GETTER_INT: "twelve" }, async () => {
      await withClient({}, (client) => {
        expect(client.getInt("getter.contract.provided.int.malformed", undefined, 7)).toBe(7);
      });
    });
  });

  it('INT getter on env-var-provided malformed int "twelve" with no default returns nil', async () => {
    await withEnv({ QUONFIG_ITD_GETTER_INT: "twelve" }, async () => {
      await withClient({ onNoDefault: "warn" }, (client) => {
        expect(client.getInt("getter.contract.provided.int.malformed")).toBe(undefined);
      });
    });
  });

  it('DOUBLE getter on env-var-provided malformed double "abc" returns the default', async () => {
    await withEnv({ QUONFIG_ITD_GETTER_DOUBLE: "abc" }, async () => {
      await withClient({}, (client) => {
        expect(client.getNumber("getter.contract.provided.double.malformed", undefined, 7.5)).toBe(
          7.5
        );
      });
    });
  });

  it('DOUBLE getter on env-var-provided malformed double "abc" with no default returns nil', async () => {
    await withEnv({ QUONFIG_ITD_GETTER_DOUBLE: "abc" }, async () => {
      await withClient({ onNoDefault: "warn" }, (client) => {
        expect(client.getNumber("getter.contract.provided.double.malformed")).toBe(undefined);
      });
    });
  });

  it("STRING getter on a missing env var returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("provided.by.missing.env.var", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on a missing env var with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("provided.by.missing.env.var")).toBe(undefined);
    });
  });

  it("STRING getter on a decryption failure returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getString("a.broken.secret.config", undefined, "DEFAULT")).toBe("DEFAULT");
    });
  });

  it("STRING getter on a decryption failure with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getString("a.broken.secret.config")).toBe(undefined);
    });
  });

  it("BOOLEAN getter on a missing bool env var returns the default", async () => {
    await withClient({}, (client) => {
      expect(client.getBool("getter.contract.provided.bool.missing", undefined, true)).toBe(true);
    });
  });

  it("BOOLEAN getter on a missing bool env var with no default returns nil", async () => {
    await withClient({ onNoDefault: "warn" }, (client) => {
      expect(client.getBool("getter.contract.provided.bool.missing")).toBe(undefined);
    });
  });

  it('BOOLEAN getter on env-var-provided bool "false" returns false', async () => {
    await withEnv({ QUONFIG_ITD_GETTER_BOOL: "false" }, async () => {
      await withClient({}, (client) => {
        expect(client.getBool("getter.contract.provided.bool")).toBe(false);
      });
    });
  });
});
