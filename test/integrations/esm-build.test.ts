import { describe, expect, it, beforeAll } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

// When app-quonfig or test-node consume the subpath integration exports
// (`@quonfig/node/winston`, `@quonfig/node/pino`) through Next.js 15's
// true-ESM server runtime, the published ESM bundle must be able to pull
// in its peer dep without relying on a global `require`. Without the fix,
// esbuild's `__require` proxy throws `Dynamic require of "winston" is not
// supported`, and the adapter's outer catch reports it as
// `createWinstonFormat requires winston`.
describe("ESM subpath integrations load in pure-Node ESM", () => {
  beforeAll(() => {
    const distWinston = join(repoRoot, "dist", "integrations", "winston.js");
    if (!existsSync(distWinston)) {
      execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
    }
  });

  it("createWinstonFormat loads when the bundle is imported as ESM", () => {
    const script = `
      import { createWinstonFormat } from "${join(repoRoot, "dist/integrations/winston.js")}";
      createWinstonFormat({ shouldLog: () => true }, "test.path");
      console.log("__ESM_OK__");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("__ESM_OK__");
  });

  it("createPinoLogger loads when the bundle is imported as ESM", () => {
    const script = `
      import { createPinoLogger } from "${join(repoRoot, "dist/integrations/pino.js")}";
      createPinoLogger({ shouldLog: () => true }, "test.path");
      console.log("__ESM_OK__");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("__ESM_OK__");
  });
});
