import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync(".tmp",{recursive:true});
await build({entryPoints:["experiments/retrieval/run.ts"],bundle:true,platform:"node",format:"esm",outfile:".tmp/retrieval-experiment.mjs",packages:"external"});
const result=spawnSync(process.execPath,[".tmp/retrieval-experiment.mjs",...process.argv.slice(2)],{stdio:"inherit"});
process.exitCode=result.status??1;
