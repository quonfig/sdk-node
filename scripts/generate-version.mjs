#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const out = `// AUTO-GENERATED from package.json by scripts/generate-version.mjs — do not edit.\nexport default "${pkg.version}";\n`;
writeFileSync(resolve(root, "src/version.ts"), out);
