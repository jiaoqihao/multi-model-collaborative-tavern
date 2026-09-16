import test from "node:test";
import assert from "node:assert/strict";
import { actorContext, demoTurn, runTurn } from "../lib/tavern/engine";
import { initialStory, sampleStory } from "../lib/tavern/seed";
import { ancestry } from "../lib/tavern/validation";
import { complete, cryptKey, validateEndpoint } from "../lib/tavern/models";
import type { Profile } from "../lib/tavern/types";

test("角色上下文只包含自己的秘密与记忆",()=>{
 const s=sampleStory();s.characters[1].secret="OTHER_CHARACTER_SECRET";
 const ctx=JSON.stringify(actorContext(s.characters[0],"听见敲门声",""));
 assert.ok(ctx.includes(s.characters[0].secret));assert.ok(!ctx.includes("OTHER_CHARACTER_SECRET"));assert.ok(!ctx.includes(s.characters[1].state.thought));
});
test("私下事件不会传给旁白或无关角色；客观状态只接受裁决结果",async()=>{
 const s=sampleStory();const original=structuredClone(s);const calls:{id:string;data:Record<string,unknown>}[]=[];
 const result=await runTurn({story:s,history:[],input:"PRIVATE_RAW_INPUT",mode:"roleplay",directorId:"master",turnId:"t1",call:async(id,system,prompt)=>{
  const data=JSON.parse(prompt);calls.push({id,data});
  if(system.includes("你负责信息分发"))return JSON.stringify({deliveries:[{characterId:"lin",visible:"玩家低声询问信件的来历",direction:""}]});
  if(system.includes("只扮演给定角色"))return JSON.stringify({speech:"稍后再谈。",actionIntent:"尝试拿起信",emotion:"谨慎",thought:"ACTOR_PRIVATE_THOUGHT",goal:"保护秘密",relationship:"保持距离",clothing:"不允许角色自行换装"});
  if(system.includes("你协调实际事件"))return JSON.stringify({events:[{description:"PUBLIC_EVENT",visibleTo:["lin","shen"],visibleToPlayer:true},{description:"HIDDEN_EVENT",visibleTo:["lin"],visibleToPlayer:false}],changes:[{characterId:"lin",clothing:"原衬衫，围裙已取下"}]});
  if(system.includes("你负责更新角色卡记忆")){if(data.characterId==="shen"){assert.ok(!prompt.includes("ACTOR_PRIVATE_THOUGHT"));assert.ok(!prompt.includes("HIDDEN_EVENT"));}return JSON.stringify({summary:"本轮交谈",facts:["PUBLIC_EVENT"],beliefs:[],openThreads:[]});}
  assert.ok(!prompt.includes("ACTOR_PRIVATE_THOUGHT"));assert.ok(!prompt.includes("HIDDEN_EVENT"));return JSON.stringify({narrative:"林晚略微停顿。“稍后再谈。”"});
 }});
 assert.deepEqual(s,original);assert.equal(result.snapshot.characters[0].state.clothing,"原衬衫，围裙已取下");
 assert.ok(!JSON.stringify(calls[1].data).includes("PRIVATE_RAW_INPUT"));
 assert.equal(result.snapshot.characters[1].memories.length,1);assert.equal(result.snapshot.characters[1].memories[0].content,"PUBLIC_EVENT");
 assert.ok(!JSON.stringify(result.snapshot.characters[1].memories).includes("HIDDEN_EVENT"));
});
test("结构无效只重试一次，失败不修改状态",async()=>{
 const story=sampleStory();const before=JSON.stringify(story);let calls=0;
 await assert.rejects(runTurn({story,history:[],input:"hi",mode:"roleplay",directorId:"m",turnId:"t",call:async()=>{calls++;return "not json"}}),/无效结构/);
 assert.equal(calls,2);assert.equal(JSON.stringify(story),before);
});
test("未知角色在调用角色模型之前被拒绝",async()=>{
 let count=0;await assert.rejects(runTurn({story:sampleStory(),history:[],input:"hi",mode:"roleplay",directorId:"m",turnId:"t",call:async()=>{count++;return '{"deliveries":[{"characterId":"intruder","visible":"x","direction":""}]}'}}),/不存在的角色/);assert.equal(count,1);
});
test("分支上下文只包含祖先，循环与缺失节点被拒绝",()=>{
 const turns=[{id:"a",parentId:null},{id:"b",parentId:"a"},{id:"c",parentId:"a"}];assert.deepEqual(ancestry(turns,"c").map(t=>t.id),["a","c"]);assert.throws(()=>ancestry([{id:"a",parentId:"a"}],"a"),/循环/);assert.throws(()=>ancestry(turns,"missing"),/缺少/);
});
test("演示私聊只改变接收人，新快照不会改变原始状态",()=>{
 const story=sampleStory();const result=demoTurn(story,"低声告诉林晚一个秘密","roleplay","t1");assert.deepEqual(result.trace.selected,["lin"]);assert.equal(story.characters[0].memories.length,0);assert.equal(result.snapshot.characters[1].memories.length,0);
});
test("新故事默认没有任何角色，演示模式也可继续纯旁白",()=>{const story=initialStory();assert.deepEqual(story.characters,[]);const result=demoTurn(story,"走进空旷的房间","roleplay","empty");assert.deepEqual(result.trace.selected,[]);assert.equal(result.snapshot.characters.length,0)});
test("各生成阶段使用独立模型，并记录可审计的运行信息",async()=>{
 const story=initialStory();story.stageModels={settlement:"judge",narrator:"writer",memory:"archivist"};const ids:string[]=[];
 const result=await runTurn({story,history:[],input:"推开门",mode:"roleplay",directorId:"director",turnId:"stages",describeModel:id=>`配置 ${id}`,call:async(id,system)=>{ids.push(id);if(system.includes("信息分发"))return '{"deliveries":[]}';if(system.includes("协调实际事件"))return '{"events":[{"description":"门被推开。","visibleTo":[],"visibleToPlayer":true}],"changes":[]}';return '{"narrative":"门缓缓打开。"}'}});
 assert.deepEqual(ids,["director","judge","writer"]);assert.deepEqual(result.trace.stages?.map(s=>s.modelId),ids);assert.ok(result.trace.stages?.every(s=>s.modelLabel.startsWith("配置 ")&&s.attempts===1));
});
test("阶段缓存会跳过已经成功的模型调用",async()=>{
 const story=initialStory();const saved=new Map<string,unknown>();let calls=0;const cache={load:async(key:string)=>saved.get(key),save:async(key:string,value:unknown)=>{saved.set(key,value)}};
 const call=async(_id:string,system:string)=>{calls++;if(system.includes("信息分发"))return '{"deliveries":[]}';if(system.includes("协调实际事件"))return '{"events":[{"description":"雨落下来。","visibleTo":[],"visibleToPlayer":true}],"changes":[]}';return '{"narrative":"雨落下来。"}'};
 await runTurn({story,history:[],input:"看雨",mode:"roleplay",directorId:"m",turnId:"cache-a",call,cache});assert.equal(calls,3);
 const second=await runTurn({story,history:[],input:"看雨",mode:"roleplay",directorId:"m",turnId:"cache-a",call,cache});assert.equal(calls,3);assert.ok(second.trace.stages?.every(s=>s.cached));
});
test("API 密钥加密可恢复，错误密钥不能解密",async()=>{
 const secret="a".repeat(64);const encrypted=await cryptKey("sk-test-not-real",secret);assert.ok(!encrypted.includes("sk-test"));assert.equal(await cryptKey(encrypted,secret,true),"sk-test-not-real");await assert.rejects(cryptKey(encrypted,"b".repeat(64),true));
});
test("拒绝不安全地址、官方协议使用错误服务商",()=>{
 const p:Profile={id:"a",name:"test",provider:"compatible",baseUrl:"https://api.example.com/v1",model:"test"};
 for(const baseUrl of ["http://api.example.com","https://127.0.0.1","https://localhost","https://user:pass@example.com","https://example.com:8080","https://host.internal","https://[::1]"]){assert.throws(()=>validateEndpoint({...p,baseUrl}));}
 assert.throws(()=>validateEndpoint({...p,provider:"openai"}));assert.equal(validateEndpoint(p),p.baseUrl);
});
test("四种模型适配的请求与文本提取（模拟响应，无外部费用）",async()=>{
 const saved=globalThis.fetch;
 try{for(const provider of ["openai","compatible","anthropic","gemini"] as const){
  const bases={openai:"https://api.openai.com/v1",compatible:"https://api.example.com/v1",anthropic:"https://api.anthropic.com/v1",gemini:"https://generativelanguage.googleapis.com/v1beta"};
  globalThis.fetch=async(url,init)=>{const headers=init!.headers as Record<string,string>;const body=JSON.parse(init!.body as string);assert.equal(init?.redirect,"manual");assert.ok(!String(url).includes("private-key"));
   if(provider==="anthropic"){assert.equal(headers["x-api-key"],"private-key");assert.equal(body.system,"system");return Response.json({content:[{type:"text",text:"ok"}]});}
   if(provider==="gemini"){assert.equal(headers["x-goog-api-key"],"private-key");assert.equal(body.systemInstruction.parts[0].text,"system");return Response.json({candidates:[{content:{parts:[{text:"private reasoning",thought:true},{text:"ok"}]}}]});}
   assert.equal(headers.Authorization,"Bearer private-key");assert.equal(body.messages[0].content,"system");return Response.json({choices:[{message:{content:"ok"}}]});
  };
  assert.equal(await complete({id:"x",name:"test",provider,baseUrl:bases[provider],model:"example-model"},"private-key","system","user"),"ok");
 }}finally{globalThis.fetch=saved;}
});
