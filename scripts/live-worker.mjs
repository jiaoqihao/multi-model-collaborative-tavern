import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

// Full production API -> engine -> provider -> D1 -> SSE, in an ephemeral Worker.
// D1 stores only a fake credential. The authorized real credential is attached
// at the outbound test boundary in host memory, never saved to the Worker/DB.
export async function runWorkerTests(key){
 const built=await build({stdin:{contents:'import {GET,POST} from "./app/api/tavern/route"; export default {fetch(request){return request.method==="POST"?POST(request):GET(request)}};',resolveDir:process.cwd(),sourcefile:"live-worker.ts",loader:"ts"},bundle:true,platform:"browser",format:"esm",external:["cloudflare:workers"],write:false});
 let faultMemory=true,chatCalls=0,providerCalls=0,stage="setup";const checks=[],usage=[],syntheticOutputs=[];
 const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:"2026-05-15",d1Databases:["DB"],d1Persist:false,bindings:{TAVERN_ENCRYPTION_KEY:crypto.randomUUID()},outboundService:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,"https://api.deepseek.com");assert.ok(["/v1/models","/v1/chat/completions"].includes(url.pathname));
  const body=request.method==="POST"?await request.text():undefined;
  if(body){const parsed=JSON.parse(body);const system=parsed.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n");
   if(faultMemory&&system.includes("你负责更新角色卡记忆"))return Response.json({choices:[{message:{content:"invalid-json"},finish_reason:"stop"}]});
   chatCalls++;
  }
  if(++providerCalls>18)throw new Error("Provider budget exceeded");
  const headers=new Headers(request.headers);headers.set("Authorization","Bearer "+key);
  const response=await fetch(url,{method:request.method,headers,body,redirect:"manual",signal:AbortSignal.timeout(65000)});
  assert.equal(response.status,200,"provider-http");const data=await response.clone().json();if(data.usage)usage.push({promptTokens:Number(data.usage.prompt_tokens)||0,completionTokens:Number(data.usage.completion_tokens)||0});if(data.choices?.[0]?.message?.content)syntheticOutputs.push({stage,content:String(data.choices[0].message.content).replaceAll(key,"[REDACTED]"),finish:data.choices[0].finish_reason});
  console.log(JSON.stringify({providerCalls,stage,status:response.status}));return response;
 }});
 const headers={"Content-Type":"application/json",Origin:"http://local","oai-authenticated-user-id":"synthetic-test-user"};
 async function request(body){const response=await mf.dispatchFetch("http://local/api/tavern",{method:"POST",headers,body:JSON.stringify(body)});assert.equal(response.status,200,"route-status");const text=await response.text();return response.headers.get("content-type").includes("text/event-stream")?text:JSON.parse(text);}
 function done(text){const blocks=text.split("\n\n");const item=blocks.find(s=>s.startsWith("event: done"));const error=blocks.find(s=>s.startsWith("event: error"));assert.ok(item,error?error.replaceAll(key,"[REDACTED]").slice(0,600):"sse-done");return JSON.parse(item.split("\ndata: ")[1]);}
 function pass(name){checks.push({name,status:"pass"});console.log("PASS "+name);}
 try{
  const db=await mf.getD1Database("DB");for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort()){const sql=readFileSync("drizzle/"+file,"utf8").replaceAll("--> statement-breakpoint","");for(const part of sql.split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(part).run();}
  let ws=await request({action:"createStory"});const storyId=ws.id;
  const models=await request({action:"listModels",connection:{provider:"compatible",baseUrl:"https://api.deepseek.com/v1",apiKey:"fake-live-worker-only"}});
  const model=models.models.find(m=>m.id==="deepseek-flash")?.id;assert.ok(model);
  ws=await request({action:"saveProfile",storyId,profile:{id:"",name:"synthetic-test",provider:"compatible",baseUrl:"https://api.deepseek.com/v1",model,structuredOutput:true,apiKey:"fake-live-worker-only"}});const profileId=ws.profiles[0].id;
  assert.ok(!JSON.stringify(ws).includes("fake-live-worker-only"));pass("profile-key-redacted");
  const character={id:"recorder",name:"记录员",role:"测试记录员",persona:"配合测试，如实记录并在被问及时准确复述信息，不猜测提问动机。",secret:"",color:"gray",modelId:"default",presetId:"inherit",state:{location:"安静的记录室",clothing:"制服",condition:"健康",emotion:"平静",thought:"",goal:"记录事实",relationship:"合作"},memories:[]};
  ws=await request({action:"saveStory",storyId,revision:ws.revision,story:{...ws.story,world:"只有玩家和记录员的安静记录室。",style:"简洁，不超过100字。",characters:[character]}});
  const root=structuredClone(ws.story);ws=await request({action:"configure",storyId,revision:ws.revision,demo:false,directorId:profileId});
  stage="failure-cache";const id=crypto.randomUUID();const generation={action:"generate",turn:{storyId,revision:ws.revision,input:"请记住合成测试编号：青松七十二。",mode:"roleplay",requestId:id}};
  const failed=await request(generation);const errorBlock=failed.split("\n\n").find(b=>b.startsWith("event: error"));if(errorBlock)console.log(errorBlock.replaceAll(key,"[REDACTED]").slice(0,600));assert.ok(failed.includes("event: error"),"injected-memory-error-expected");assert.ok(!failed.includes("event: done"),"unexpected-commit");
  const persisted=await db.prepare("SELECT head_id,revision FROM stories WHERE id=?").bind(storyId).first();assert.equal(persisted.head_id,null);assert.equal(persisted.revision,ws.revision);assert.equal((await db.prepare("SELECT count(*) AS n FROM turns").first()).n,0);
  const cached=(await db.prepare("SELECT stage_key FROM generation_stages WHERE request_id=?").bind(id).all()).results.map(r=>r.stage_key);console.log(JSON.stringify({cached}));assert.ok(["director","actor:recorder","settlement","narrator"].every(k=>cached.includes(k)),"all-pre-memory-stages-cached");pass("memory-failure-no-partial-commit");
  faultMemory=false;stage="retry-cached-stages";const before=chatCalls;ws=done(await request(generation));assert.ok(chatCalls-before<=2);assert.ok(ws.turns[0].trace.stages.filter(s=>s.cached).length>=4);assert.equal(ws.headId,id);assert.ok(ws.story.characters[0].card.source.includes("青松七十二"));
  assert.ok((await db.prepare("SELECT count(*) AS n FROM story_events WHERE turn_id=?").bind(id).first()).n>0);assert.equal((await db.prepare("SELECT count(*) AS n FROM generation_stages WHERE request_id=?").bind(id).first()).n,0);pass("retry-resumes-and-atomically-persists");
  stage="request-replay";const beforeReplay=chatCalls;await request(generation);assert.equal(chatCalls,beforeReplay);pass("replay-no-provider-calls");
  stage="cooperative-memory-recall";const second=crypto.randomUUID();let turnCount=1;
  try{ws=done(await request({action:"generate",turn:{storyId,revision:ws.revision,input:"请准确复述刚才记录的测试编号。",mode:"roleplay",requestId:second}}));turnCount=2;assert.ok(ws.turns.find(t=>t.id===second).trace.events.join(" ").includes("青松七十二"),"literal-recall-in-events");pass("cooperative-memory-recall");}
  catch(error){checks.push({name:stage,status:"fail",detail:String(error.message).replaceAll(key,"[REDACTED]").slice(0,600)});console.log(checks.at(-1));process.exitCode=1;}
  stage="rollback";ws=await request({action:"switchHead",storyId,revision:ws.revision,headId:null});assert.deepEqual(ws.story,root);assert.equal(ws.turns.length,turnCount);pass("rollback-restores-state-and-keeps-history");
 }catch(error){const detail=String(error.message).replaceAll(key,"[REDACTED]").slice(0,600);checks.push({name:stage,status:"fail",detail});console.log("FAIL "+stage+" "+detail);process.exitCode=1;}
 finally{await mf.dispose();const report={timestamp:new Date().toISOString(),scope:"Production route and engine, ephemeral Workers/D1, real DeepSeek; injected invalid memory response explicitly simulated",providerCalls,chatCalls,promptTokens:usage.reduce((s,r)=>s+r.promptTokens,0),completionTokens:usage.reduce((s,r)=>s+r.completionTokens,0),checks};mkdirSync("outputs/live-tests",{recursive:true});const stamp=Date.now();writeFileSync(`outputs/live-tests/worker-${stamp}.json`,JSON.stringify(report,null,2)+"\n");writeFileSync(`outputs/live-tests/worker-${stamp}.synthetic-diagnostics.json`,JSON.stringify(syntheticOutputs,null,2)+"\n");console.log(JSON.stringify(report));}
}
