import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/integrations/winston.ts", "src/integrations/pino.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  // winston and pino are peer dependencies — never bundle them.
  external: ["winston", "pino"],
  // In ESM output, esbuild rewrites the integrations' synchronous
  // `require("winston" | "pino")` calls to its `__require` proxy, which
  // throws 'Dynamic require of "winston" is not supported' when the bundle
  // is loaded by a true-ESM runtime (e.g. Next.js 15 server). The proxy
  // defers to the module-scope `require` binding when one exists, so we
  // inject a real `createRequire(import.meta.url)` at the top of each ESM
  // chunk. CJS chunks already have a native `require`, so the banner is
  // ESM-only.
  banner: ({ format }) =>
    format === "esm"
      ? {
          js: "import { createRequire as __quonfigCreateRequire } from 'node:module'; var require = __quonfigCreateRequire(import.meta.url);",
        }
      : {},
});
