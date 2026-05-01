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
  sdkKey: "your-sdk-key",        // Required (or set QUONFIG_BACKEND_SDK_KEY)
  apiUrls: ["https://primary.quonfig.com", "https://secondary.quonfig.com"],
                                 // Ordered failover list. Defaults are derived
                                 // from QUONFIG_DOMAIN (see below).
  telemetryUrl: "https://telemetry.quonfig.com",
                                 // Default derived from QUONFIG_DOMAIN.
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

## Environment variables

| Variable                    | Purpose                                                                        |
|-----------------------------|--------------------------------------------------------------------------------|
| `QUONFIG_BACKEND_SDK_KEY`   | Fallback for `sdkKey` when omitted from options.                               |
| `QUONFIG_DOMAIN`            | Domain used to derive default `apiUrls` and `telemetryUrl`. Defaults to `quonfig.com`. Set to `quonfig-staging.com` to point everything at staging. |
| `QUONFIG_ENVIRONMENT`       | Environment name to use in datadir mode (overridden by the `environment` option). |
| `QUONFIG_DEV_CONTEXT`       | When `true`, injects `quonfig-user.email` from `~/.quonfig/tokens.json`.       |

Resolution order for URLs (highest wins):

1. Explicit `apiUrls` / `telemetryUrl` option.
2. `QUONFIG_DOMAIN` env var (derives `https://primary.${DOMAIN}`, `https://secondary.${DOMAIN}`, `https://telemetry.${DOMAIN}`).
3. Hardcoded default `quonfig.com`.

## Dynamic log levels with Winston

`winston` is an optional peer dependency. Install it alongside `@quonfig/node`, then compose the format:

```typescript
import winston from "winston";
import { Quonfig } from "@quonfig/node";
import { createWinstonFormat } from "@quonfig/node/winston";

const quonfig = new Quonfig({
  sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
  loggerKey: "log-level.my-app",
});
await quonfig.init();

const logger = winston.createLogger({
  level: "silly", // let Winston emit everything; Quonfig decides.
  format: winston.format.combine(
    createWinstonFormat(quonfig, "myapp.services.auth"),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

logger.info("live-controlled");  // emits iff shouldLog says so.
```

The `loggerPath` (second arg) is forwarded to `quonfig.shouldLog` verbatim — no normalization — so rules can key on whatever identifier shape you actually log (`"com.app.Auth"`, `"MyApp::Services::Auth"`, etc.).

## Dynamic log levels with Pino

`pino` is an optional peer dependency. Install it alongside `@quonfig/node`, then wire the hook:

```typescript
import pino from "pino";
import { Quonfig } from "@quonfig/node";
import { createPinoHooks } from "@quonfig/node/pino";

const quonfig = new Quonfig({
  sdkKey: process.env.QUONFIG_BACKEND_SDK_KEY!,
  loggerKey: "log-level.my-app",
});
await quonfig.init();

const logger = pino({
  level: "trace", // let Pino emit everything; Quonfig decides.
  hooks: createPinoHooks(quonfig, "myapp.services.auth"),
});

logger.debug("live-controlled");
```

Both adapters also ship convenience constructors — `createWinstonLogger` and `createPinoLogger` — that return a ready-to-use logger with the Quonfig gate already attached.

## License

MIT
