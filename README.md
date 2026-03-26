# @quonfig/node

Node.js SDK for [Quonfig](https://quonfig.com) — Feature Flags, Live Config, and Dynamic Log Levels.

> **Note:** This SDK is pre-1.0 and the API is not yet stable.

## Installation

```bash
npm install @quonfig/node
```

## Quick Start

```typescript
import { Quonfig } from "@quonfig/node";

const quonfig = new Quonfig({ sdkKey: "your-sdk-key" });
await quonfig.init();

// Feature flags
if (quonfig.isFeatureEnabled("new-dashboard")) {
  // show new dashboard
}

// Config values
const limit = quonfig.getNumber("rate-limit");
const regions = quonfig.getStringList("allowed-regions");

// Context-aware evaluation
const value = quonfig.get("homepage-hero", {
  user: { key: "user-123", country: "US" },
});

// Bound context for repeated lookups
const userClient = quonfig.inContext({
  user: { key: "user-123", plan: "pro" },
});
userClient.get("feature-x");
userClient.isFeatureEnabled("beta-feature");

// Clean up when done
quonfig.close();
```

## Options

```typescript
new Quonfig({
  sdkKey: "your-sdk-key",       // Required
  apiUrl: "https://api.quonfig.com", // API endpoint (default)
  enableSSE: true,               // Real-time updates via SSE (default: true)
  enablePolling: false,          // Polling fallback (default: false)
  pollInterval: 60000,           // Polling interval in ms (default: 60000)
  initTimeout: 10000,            // Init timeout in ms (default: 10000)
  onNoDefault: "error",          // "error" | "warn" | "ignore" (default: "error")
  globalContext: { ... },        // Context applied to all evaluations
  datadir: "./workspace-data",   // Load local workspace directories instead of API
  datafile: "./config.json",     // Legacy local envelope path
});
```

## License

MIT
