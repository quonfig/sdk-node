// Code generated from integration-test-data/tests/eval/get_weighted_values.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import { withClient } from "./setup";

describe("get_weighted_values", () => {
  it("weighted value is consistent 1", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("feature-flag.weighted", { user: { tracking_id: "a72c15f5" } })).toBe(
        1
      );
    });
  });

  it("weighted value is consistent 2", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("feature-flag.weighted", { user: { tracking_id: "92a202f2" } })).toBe(
        2
      );
    });
  });

  it("weighted value is consistent 3", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("feature-flag.weighted", { user: { tracking_id: "8f414100" } })).toBe(
        3
      );
    });
  });

  it("even split ones serves first variant at low hash fraction", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "b7ff78c8" },
        })
      ).toBe("a");
    });
  });

  it("even split ones serves first variant at low hash fraction 2", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "289f4748" },
        })
      ).toBe("a");
    });
  });

  it("even split ones serves second variant at high hash fraction", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "d60b2cb6" },
        })
      ).toBe("b");
    });
  });

  it("even split ones serves second variant at high hash fraction 2", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "21bcfd13" },
        })
      ).toBe("b");
    });
  });

  it("non-ascii tracking_id emoji hashes utf-8 bytes", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "🚀-rocket" },
        })
      ).toBe("a");
    });
  });

  it("non-ascii tracking_id latin hashes utf-8 bytes", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "münchen-7" },
        })
      ).toBe("a");
    });
  });

  it("non-ascii tracking_id cjk hashes utf-8 bytes", async () => {
    await withClient({}, (client) => {
      expect(
        client.getString("feature-flag.weighted.even-split-ones", {
          user: { tracking_id: "ユーザー1" },
        })
      ).toBe("b");
    });
  });

  it("non-standard sum still serves normalized true bucket", async () => {
    await withClient({}, (client) => {
      expect(
        client.getBool("feature-flag.weighted.non-standard", { user: { tracking_id: "ff8adf17" } })
      ).toBe(true);
    });
  });

  it("non-standard sum still serves normalized true bucket 2", async () => {
    await withClient({}, (client) => {
      expect(
        client.getBool("feature-flag.weighted.non-standard", { user: { tracking_id: "36ef1a7a" } })
      ).toBe(true);
    });
  });

  it("non-standard sum still serves normalized false bucket", async () => {
    await withClient({}, (client) => {
      expect(
        client.getBool("feature-flag.weighted.non-standard", { user: { tracking_id: "f667c76a" } })
      ).toBe(false);
    });
  });

  it("non-standard sum still serves normalized false bucket 2", async () => {
    await withClient({}, (client) => {
      expect(
        client.getBool("feature-flag.weighted.non-standard", { user: { tracking_id: "7467ca21" } })
      ).toBe(false);
    });
  });

  it("weighted value with hash property missing from context hashes empty string", async () => {
    await withClient({}, (client) => {
      expect(
        client.getNumber("feature-flag.weighted.missing-hash", {
          user: { key: "no-tracking-id-user" },
        })
      ).toBe(2);
    });
  });

  it("weighted value with no context hashes empty string", async () => {
    await withClient({}, (client) => {
      expect(client.getNumber("feature-flag.weighted.missing-hash")).toBe(2);
    });
  });

  it("weighted value with hash property empty string hashes empty string", async () => {
    await withClient({}, (client) => {
      expect(
        client.getNumber("feature-flag.weighted.missing-hash", {
          user: { key: "empty-tracking-id-user", tracking_id: "" },
        })
      ).toBe(2);
    });
  });

  it("weighted value with zero-weight first variant and hash property missing never serves zero-weight variant", async () => {
    await withClient({}, (client) => {
      expect(
        client.getNumber("feature-flag.weighted.zero-first", {
          user: { key: "no-tracking-id-user" },
        })
      ).toBe(2);
    });
  });

  it("weighted value with no hash property is random on every evaluation", async () => {
    await withClient({}, (client) => {
      const seen = new Set<unknown>();
      for (let i = 0; i < 200; i++) seen.add(client.getNumber("feature-flag.weighted.no-hash"));
      expect(seen).toEqual(new Set([1, 2]));
    });
  });

  it("weighted value with no hash property is random on every evaluation with context", async () => {
    await withClient({}, (client) => {
      const seen = new Set<unknown>();
      for (let i = 0; i < 200; i++)
        seen.add(
          client.getNumber("feature-flag.weighted.no-hash", {
            user: { key: "same-user-every-time", tracking_id: "same-tracking-id" },
          })
        );
      expect(seen).toEqual(new Set([1, 2]));
    });
  });
});
