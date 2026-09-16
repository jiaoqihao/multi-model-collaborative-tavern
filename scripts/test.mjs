import { build } from "esbuild";
import { mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync(".tmp",{recursive:true});
const files=readdirSync("tests").filter(f=>f.endsWith(".test.ts"));
await build({entryPoints:files.map(f=>"tests/"+f),bundle:true,platform:"node",format:"esm",outdir:".tmp/tests",outExtension:{".js":".mjs"},packages:"external"});
const result=spawnSync(process.execPath,["--test",...files.map(f=>".tmp/tests/"+f.replace(/\.ts$/,".mjs"))],{stdio:"inherit"});
process.exitCode=result.status??1;
