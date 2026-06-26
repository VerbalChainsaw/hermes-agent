// scripts/clean.mjs
//
// Remove the dist/ directory + tsc incremental build metadata.
// Pure ESM so it plays nicely with the rest of the package's
// `"type": "module"` config (the previous `node -e "require('fs')"`
// approach worked but mixed CJS require into an ESM-typed package,
// which fails on stricter Node configs and is generally ugly).

import { rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

const targets = [
  resolve(packageRoot, "dist"),
  resolve(packageRoot, "tsconfig.tsbuildinfo"),
  resolve(packageRoot, ".tsbuildinfo"),
];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
  console.log(`removed: ${target}`);
}
