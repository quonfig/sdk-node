# Changelog

## 0.0.3 - 2026-04-02

- Added `quonfig.flush()` and `boundQuonfig.flush()` to force pending telemetry delivery in short-lived serverless runtimes.
- Fixed dynamic log level resolution so string config values like `"info"` and `"warn"` are parsed correctly by `shouldLog()`.
- Exposed telemetry reporter syncing internally to support manual flushes.
- Added tests covering string log level parsing and telemetry flush behavior.
