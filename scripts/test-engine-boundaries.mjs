import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({entryPoints:["tests/engine-boundaries.probe.ts"],bundle:true,platform:"node",format:"esm",outfile:".tmp/engine-boundaries.mjs",packages:"external"});
const result=spawnSync(process.execPath,[".tmp/engine-boundaries.mjs"],{stdio:"inherit"});
process.exitCode=result.status??1;
