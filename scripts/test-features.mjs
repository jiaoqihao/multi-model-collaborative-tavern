import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({entryPoints:["tests/features.integration.ts"],bundle:true,platform:"node",format:"esm",outfile:".tmp/features.integration.mjs",packages:"external"});
const result=spawnSync(process.execPath,[".tmp/features.integration.mjs",...process.argv.slice(2)],{stdio:"inherit"});
process.exitCode=result.status??1;
