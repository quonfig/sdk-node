// Code generated from integration-test-data/tests/eval/delivery_environment.yaml. DO NOT EDIT.
// Regenerate with:
//   cd integration-test-data/generators && npm run generate -- --target=node
// Source: integration-test-data/generators/src/targets/node.ts

import { describe, it, expect } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { Quonfig } from "../../src/quonfig";

// Stand up a mock api-delivery returning the literal wire envelope on
// /api/v2/configs (the exact shape api-delivery emits in SDK-key mode).
function startDeliveryServer(envelopeJson: string): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/v2/configs")) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          ETag: '"v1"',
        });
        res.end(envelopeJson);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe("delivery_environment", () => {
  it("singular environment override wins over default when env not pinned", async () => {
    const __envelope =
      '{"meta":{"version":"v1","environment":"development"},"configs":[{"id":"c-env","key":"flag.env-scoped","type":"bool","valueType":"bool","sendToClientSdk":false,"default":{"rules":[{"criteria":[{"operator":"ALWAYS_TRUE"}],"value":{"type":"bool","value":true}}]},"environment":{"id":"development","rules":[{"criteria":[{"operator":"ALWAYS_TRUE"}],"value":{"type":"bool","value":false}}]}}]}';
    const { server: __server, port: __port } = await startDeliveryServer(__envelope);
    try {
      const client = new Quonfig({
        sdkKey: "sdk-test",
        apiUrls: [`http://127.0.0.1:${__port}`],
        enableSSE: false,
        fallbackPollEnabled: false,
        collectEvaluationSummaries: false,
        contextUploadMode: "none",
        initTimeout: 5000,
      });
      await client.init();
      try {
        expect(client.getBool("flag.env-scoped")).toBe(false);
      } finally {
        await client.close();
      }
    } finally {
      await new Promise<void>((res) => __server.close(() => res()));
    }
  });

  it("explicit environment pin is ignored in delivery mode (meta.environment authoritative)", async () => {
    const __envelope =
      '{"meta":{"version":"v1","environment":"development"},"configs":[{"id":"c-env","key":"flag.env-scoped","type":"bool","valueType":"bool","sendToClientSdk":false,"default":{"rules":[{"criteria":[{"operator":"ALWAYS_TRUE"}],"value":{"type":"bool","value":true}}]},"environment":{"id":"development","rules":[{"criteria":[{"operator":"ALWAYS_TRUE"}],"value":{"type":"bool","value":false}}]}}]}';
    const { server: __server, port: __port } = await startDeliveryServer(__envelope);
    try {
      const client = new Quonfig({
        sdkKey: "sdk-test",
        apiUrls: [`http://127.0.0.1:${__port}`],
        enableSSE: false,
        fallbackPollEnabled: false,
        collectEvaluationSummaries: false,
        contextUploadMode: "none",
        initTimeout: 5000,
        environment: "staging",
      });
      await client.init();
      try {
        expect(client.getBool("flag.env-scoped")).toBe(false);
      } finally {
        await client.close();
      }
    } finally {
      await new Promise<void>((res) => __server.close(() => res()));
    }
  });

  it("config without environment block falls back to default in delivery mode", async () => {
    const __envelope =
      '{"meta":{"version":"v1","environment":"development"},"configs":[{"id":"c-def","key":"flag.default-only","type":"bool","valueType":"bool","sendToClientSdk":false,"default":{"rules":[{"criteria":[{"operator":"ALWAYS_TRUE"}],"value":{"type":"bool","value":true}}]}}]}';
    const { server: __server, port: __port } = await startDeliveryServer(__envelope);
    try {
      const client = new Quonfig({
        sdkKey: "sdk-test",
        apiUrls: [`http://127.0.0.1:${__port}`],
        enableSSE: false,
        fallbackPollEnabled: false,
        collectEvaluationSummaries: false,
        contextUploadMode: "none",
        initTimeout: 5000,
      });
      await client.init();
      try {
        expect(client.getBool("flag.default-only")).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await new Promise<void>((res) => __server.close(() => res()));
    }
  });
});
