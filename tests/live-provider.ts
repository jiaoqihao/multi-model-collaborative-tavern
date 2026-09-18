import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { runTurn, type CallModel } from "../lib/tavern/engine";
import { complete } from "../lib/tavern/models";
import { listAvailableModels } from "../lib/tavern/model-discovery";
import { initialStory, sampleStory } from "../lib/tavern/seed";
import { readCardMemory } from "../lib/tavern/cards";
import { isolateCreativeMessages, PROTOCOL_VERSION } from "../lib/tavern/protocols";
import { AppError, storySchema } from "../lib/tavern/validation";
import type { Profile, StoryState, Turn } from "../lib/tavern/types";
import { eligibleEvidence, type Evidence } from "../experiments/retrieval/hybrid";

// Deliberately excluded from the default, offline *.test.ts suite.
// Reports contain only test labels, numeric usage, and aggregate diagnostics.
export async function runLiveTests(key:string){
 const recheck=process.argv.includes("--recheck");
 const baseUrl="https://api.deepseek.com/v1";
 const originalFetch=globalThis.fetch;
 const requests:{status:number;ms:number;promptTokens:number;completionTokens:number}[]=[];
 const cases:{name:string;status:"pass"|"fail";ms:number;check?:string;error?:string;stages?:unknown}[]=[];
 const syntheticDiagnostics:{test:string;stage:string;output:string}[]=[];let testName="";
 let requestCount=0;
 let currentCheck="";
 function check(label:string,value:unknown){currentCheck=label;assert.ok(value);}
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  if(url.origin!=="https://api.deepseek.com"||!['/v1/models','/v1/chat/completions'].includes(url.pathname))throw new Error("Destination not allowed");
  if(++requestCount>40)throw new Error("Request budget reached");
  const started=Date.now();const response=await originalFetch(input,init);
  const row={status:response.status,ms:0,promptTokens:0,completionTokens:0};
  if(response.ok){const data=await response.clone().json() as {usage?:{prompt_tokens?:number;completion_tokens?:number}};row.promptTokens=Number(data.usage?.prompt_tokens)||0;row.completionTokens=Number(data.usage?.completion_tokens)||0;}
  row.ms=Date.now()-started;requests.push(row);console.log(JSON.stringify({http:requests.length,...row}));return response;
 };
 async function test(name:string,run:()=>Promise<unknown>){
  if(recheck&&!['model-discovery','structured-json','balanced-private-memory','followup-recalls-memory','precise-state-review'].includes(name))return false;
  testName=name;
  console.log("START "+name);const start=Date.now();currentCheck="request-or-schema";
  try{const stages=await run();cases.push({name,status:"pass",ms:Date.now()-start,...(stages?{stages}:{})});console.log("PASS "+name);return true;}
  catch(error){const message=error instanceof AppError?error.message.replaceAll(key,"[REDACTED]").slice(0,500):"Assertion or runner failure";cases.push({name,status:"fail",ms:Date.now()-start,check:currentCheck,error:message});console.log("FAIL "+name+" ["+currentCheck+"] "+message);return false;}
 }
 const profile:Profile={id:"live-test",name:"live-test",provider:"compatible",baseUrl,model:"deepseek-chat",contextWindow:65536,structuredOutput:true};
 const call:CallModel=async(_id,system,prompt,context)=>{const result=await complete(profile,key,system,prompt,{
  structured:true,sampling:{temperature:0,maxTokens:recheck?5000:2400},
  messages:[...(context?.history||[]),...isolateCreativeMessages([{role:"system",content:"文风简洁。旁白不超过100字，事件描述不超过100字。"}],context?.stage||"director")],
 });syntheticDiagnostics.push({test:testName,stage:context?.stage||"unknown",output:result.replaceAll(key,"[REDACTED]")});return result;};
 function fixture():StoryState{const story=sampleStory();story.style="简洁，旁白不超过100字。";story.characters[1].state.location="远处的隔音档案室，门已关闭，无法听见柜台交谈";return story;}
 async function turn(story:StoryState,input:string,id:string,history:Turn[]=[],regenerate=false){
  const before=JSON.stringify(story);const result=await runTurn({story,input,turnId:id,history,regenerate,mode:"roleplay",directorId:profile.id,call,progress:stage=>console.log("STAGE "+stage)});
  check("source-immutable",JSON.stringify(story)===before);currentCheck="snapshot-schema";storySchema.parse(result.snapshot);check("nonempty-narrative",!!result.narrative.trim());
  check("stage-protocol",result.trace.stages?.every(stage=>stage.protocolVersion===PROTOCOL_VERSION));return result;
 }
 const stages=(result:Awaited<ReturnType<typeof runTurn>>)=>result.trace.stages?.map(({stage,attempts,durationMs,cached})=>({stage,attempts,durationMs,cached}));
 try{
  const connected=await test("model-discovery",async()=>{const models=await listAvailableModels(profile,key);const ids=models.models.map(m=>m.id).filter(id=>/^[a-zA-Z0-9._/-]{1,100}$/.test(id));console.log(JSON.stringify({availableModels:ids}));const selected=ids.find(id=>id==="deepseek-chat")||ids.find(id=>/flash|chat/i.test(id))||ids.find(id=>! /reasoner|embedding/i.test(id));check("chat-model-available",selected);profile.model=selected!;console.log(JSON.stringify({selectedModel:profile.model}));});
  if(!connected)return;
  if(!await test("structured-json",async()=>{const raw=await complete(profile,key,'Return JSON only: {"ok":true}',"Connection test",{messages:[],sampling:{temperature:0,maxTokens:64},structured:true});check("json-boolean",JSON.parse(raw).ok===true);}))return;
  await test("empty-story",async()=>{const result=await turn(initialStory(),"雨落在空无一人的广场上。不引入任何人物。","live-empty");check("no-default-characters",result.snapshot.characters.length===0&&result.trace.selected.length===0);return stages(result);});
  let first:Awaited<ReturnType<typeof runTurn>>|undefined;
  const privateInput="我在柜台仅对林晚耳语：测试口令是蓝鹭四十七，请保密。沈砚在远处隔音档案室内，无法看见或听见这次交谈。";
  await test("balanced-private-memory",async()=>{
   first=await turn(fixture(),privateInput,"live-private");
   check("recipient-selected",first.trace.selected.includes("lin"));
   check("recipient-memory",JSON.stringify(first.snapshot.characters[0]).includes("蓝鹭四十七"));
   check("private-delivery-isolation",!first.trace.deliveries.some(d=>d.characterId==="shen"&&d.visible.includes("蓝鹭四十七")));
   check("private-memory-isolation",!JSON.stringify(first.snapshot.characters[1]).includes("蓝鹭四十七"));
   check("card-memory-written",!!readCardMemory(first.snapshot.characters[0].card!));return stages(first);
  });
  if(first){const parent=first;
   await test("followup-recalls-memory",async()=>{
    const history:Turn[]=[{...parent,id:"live-private",parentId:null,input:privateInput,mode:"roleplay",createdAt:new Date(0).toISOString(),demo:false}];
    const result=await turn(parent.snapshot,"我仅向林晚耳语：刚才告诉你的测试口令是什么？请低声重复，别让远处的人听见。","live-followup",history);
    check("recall-in-events",result.trace.events.join(" ").includes("蓝鹭四十七"));check("followup-isolation",!JSON.stringify(result.snapshot.characters[1]).includes("蓝鹭四十七"));return stages(result);
   });
  }
  await test("economy-parallel-actors",async()=>{const story=fixture();story.collaborationMode="economy";story.characters[1].state.location=story.characters[0].state.location;const result=await turn(story,"我向同在柜台的林晚和沈砚挥手，请两人各回应一句问候。","live-economy");check("two-actors",result.trace.selected.length===2);check("no-memory-model",!result.trace.stages?.some(s=>s.stage.includes("记忆更新")));return stages(result);});
  await test("precise-state-review",async()=>{const story=fixture();story.characters=[story.characters[0]];story.collaborationMode="precise";const result=await turn(story,"我把手中的信件交给林晚，同时约定明天来取回，请她把信收进围裙口袋并保密。","live-precise");check("review-executed",result.trace.stages?.some(s=>s.stage==="一致性复核"));check("memory-written",!!readCardMemory(result.snapshot.characters[0].card!));return stages(result);});
  await test("regeneration-clean-parent",async()=>{const story=fixture();story.collaborationMode="economy";const result=await turn(story,"我仅向林晚点头，暂时不说话。","live-sibling",[],true);check("no-sibling-secret",!JSON.stringify(result).includes("蓝鹭四十七"));return stages(result);});
  await test("scoped-rerank-smoke",async()=>{
   const row=(id:string,content:string,characterId="lin"):Evidence=>({ownerId:"synthetic",storyId:"test",characterId,memory:{id,content,turnId:"t1",importance:3,kind:"observation"}});
   const rows=[row("noise","木匠正在修理木椅。"),row("debt","摆渡人替我垫付了三十银币，我约定月底归还。"),row("foreign","我欠药师一百银币。","shen")];
   const eligible=eligibleEvidence(rows,{ownerId:"synthetic",storyId:"test",characterId:"lin",ancestorTurnIds:new Set(["t1"]),historical:false});
   const raw=await complete(profile,key,'按问题相关性排序候选记忆。只返回 JSON {"ids":["候选id"]}，不得添加候选之外的 ID。',JSON.stringify({query:"我还欠谁的钱？",candidates:eligible.map(r=>({id:r.memory.id,text:r.memory.content}))}),{structured:true,messages:[],sampling:{temperature:0,maxTokens:128}});
   const ids=JSON.parse(raw).ids;check("rerank-valid-ids",Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>eligible.some(r=>r.memory.id===id)));check("relevant-first",ids[0]==="debt");
  });
 }finally{
  globalThis.fetch=originalFetch;
  const report={timestamp:new Date().toISOString(),provider:"DeepSeek",model:profile.model,maxOutputTokens:recheck?5000:2400,scope:"Node engine + real provider; synthetic data; no database or browser assertions",requestLimit:40,attemptedRequests:requestCount,completedRequests:requests.length,promptTokens:requests.reduce((s,r)=>s+r.promptTokens,0),completionTokens:requests.reduce((s,r)=>s+r.completionTokens,0),cases,requests};
  mkdirSync("outputs/live-tests",{recursive:true});const suffix=recheck?"recheck":"report";writeFileSync(`outputs/live-tests/${suffix}.json`,JSON.stringify(report,null,2)+"\n");
  writeFileSync(`outputs/live-tests/${suffix}.synthetic-diagnostics.json`,JSON.stringify(syntheticDiagnostics,null,2)+"\n");
  console.log(JSON.stringify({summary:cases.map(c=>({name:c.name,status:c.status})),requests:requests.length,promptTokens:report.promptTokens,completionTokens:report.completionTokens}));
  if(cases.some(c=>c.status==="fail"))process.exitCode=1;
 }
}
