import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/integrations/winston.ts",
    "src/integrations/pino.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  splitting: false,
  // winston and pino are peer dependencies — never bundle them.
  external: ["winston", "pino"],
});
