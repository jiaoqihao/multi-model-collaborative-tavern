import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync(".tmp",{recursive:true});
await build({entryPoints:["tests/core.test.ts"],bundle:true,platform:"node",format:"esm",outfile:".tmp/core.test.mjs",packages:"external"});
const result=spawnSync(process.execPath,["--test",".tmp/core.test.mjs"],{stdio:"inherit"});
process.exitCode=result.status??1;
