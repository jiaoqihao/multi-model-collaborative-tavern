import { build } from "esbuild";

// Opt-in, billable test. Credential stays in memory; never accept it in argv.
if (!process.stdin.isTTY) throw new Error("Use an interactive terminal for private credential entry.");
await build({entryPoints:["tests/live-provider.ts"],bundle:true,platform:"node",format:"esm",outfile:".tmp/live-provider.mjs",packages:"external"});
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
console.log("Enter API credential (hidden); Enter submits; Ctrl+C cancels. Maximum 40 HTTP requests.");
let buffer="";
const key=await new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>finish(new Error("Credential entry timed out")),90000);
 function finish(error){clearTimeout(timeout);process.stdin.removeListener("data",receive);process.stdin.setRawMode(false);process.stdin.pause();if(error)reject(error);else resolve(buffer.trim());buffer="";}
 function receive(chunk){if(chunk.includes("\u0003"))return finish(new Error("Cancelled"));for(const char of chunk){if(char==="\r"||char==="\n")return finish();if(char==="\u007f"||char==="\b")buffer=buffer.slice(0,-1);else buffer+=char;}}
 process.stdin.on("data",receive);
});
if(!key)throw new Error("Missing credential");
try{if(process.argv.includes("--worker")){const {runWorkerTests}=await import("./live-worker.mjs");await runWorkerTests(key);}else{const {runLiveTests}=await import("../.tmp/live-provider.mjs");await runLiveTests(key);}}
catch{console.error("Live test runner failed; no provider response or credential was logged.");process.exitCode=1;}
