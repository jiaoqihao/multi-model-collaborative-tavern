import test from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../lib/tavern/engine";
import { sampleStory } from "../lib/tavern/seed";
import { cardMemoryUpdateSchema, readCardMemory, characterCard, writeCardMemory } from "../lib/tavern/cards";
import { economyMemoryUpdate, memoryExcerpt } from "../lib/tavern/economy-memory";
import type { StoryThread } from "../lib/tavern/types";

for(const mode of ["roleplay","director"] as const)test(`${mode} 模式只按授权传递幕后指导`,async()=>{
 const story=sampleStory();story.collaborationMode="economy";let actorCalled=false;
 await runTurn({story,history:[],input:"请回应",mode,directorId:"m",turnId:"t",call:async(_id,system,prompt)=>{
  if(system.includes("信息分发"))return '{"deliveries":[{"characterId":"lin","visible":"听见问候","direction":"拒绝回答"}]}';
  if(system.includes("只扮演")){actorCalled=true;assert.equal(JSON.parse(prompt).direction,mode==="director"?"拒绝回答":"");return '{"speech":"你好","actionIntent":"点头","emotion":"平静","thought":"","goal":"回应","relationship":"中立"}';}
  if(system.includes("协调实际事件"))return '{"events":[{"description":"林晚点头。","visibleTo":["lin"],"visibleToPlayer":true}],"changes":[],"threads":[]}';
  return '{"narrative":"林晚点头。"}';
 }});assert.ok(actorCalled);
});

for(const [length,count] of [[400,1],[401,1],[400,3],[2000,12]])test(`经济模式 ${count} 条 ${length} 字事件可提交且保留全部原文`,async()=>{
 const story=sampleStory();story.characters=[story.characters[0]];story.collaborationMode="economy";const before=structuredClone(story);
 const descriptions=Array.from({length:count},(_,i)=>`${i}`+"事".repeat(length-String(i).length));
 const result=await runTurn({story,history:[],input:"继续",mode:"roleplay",directorId:"m",turnId:"t",call:async(_id,system)=>{
  if(system.includes("信息分发"))return '{"deliveries":[]}';
  if(system.includes("协调实际事件"))return JSON.stringify({events:descriptions.map(description=>({description,visibleTo:["lin"],visibleToPlayer:true})),changes:[],threads:[]});
  return '{"narrative":"事件已发生。"}';
 }});
 assert.deepEqual(story,before);assert.deepEqual(result.trace.events,descriptions);
 assert.deepEqual(result.snapshot.characters[0].memories.map(m=>m.content),descriptions);
 const {summary,facts,beliefs,openThreads}=readCardMemory(result.snapshot.characters[0].card!)!;
 cardMemoryUpdateSchema.parse({summary,facts,beliefs,openThreads});if(length>400)assert.match(facts[0],/节选/);
});

test("经济模式长线索用稳定标识关闭，不误删同前缀线索，且不接收他人线索",()=>{
 const c=sampleStory().characters[0];const a:StoryThread={id:"a",description:"约定"+"事".repeat(990)+"甲",characterIds:["lin"],status:"open",openedTurnId:"t1"};
 const b={...a,id:"b",description:a.description.slice(0,-1)+"乙"};const foreign={...a,id:"foreign",characterIds:["shen"]};
 const first=economyMemoryUpdate(undefined,[],[a,b,foreign],"lin");assert.equal(first.openThreads.length,2);assert.ok(first.openThreads.every(s=>s.length<=400));
 const previous=readCardMemory(writeCardMemory(characterCard(c),first,c.state,"t1","model"));
 const next=economyMemoryUpdate(previous,[],[{...a,status:"resolved",resolvedTurnId:"t2"}],"lin");
 assert.equal(next.openThreads.length,1);assert.match(next.openThreads[0],/^\[线索 b\]/);assert.equal(previous!.openThreads.length,2);
});

test("仅线索变化也会更新知情角色卡，原始完整线索保留",async()=>{
 const story=sampleStory();story.collaborationMode="economy";const description="归还"+"书".repeat(998);
 story.context!.threads=[{id:"long",description,characterIds:["lin"],status:"open",openedTurnId:"old"}];
 const c=story.characters[0];c.card=writeCardMemory(characterCard(c),economyMemoryUpdate(undefined,[],story.context!.threads,c.id),c.state,"old","model");
 const result=await runTurn({story,history:[],input:"约定已完成",mode:"director",directorId:"m",turnId:"new",call:async(_id,system)=>{
  if(system.includes("信息分发"))return '{"deliveries":[]}';
  if(system.includes("协调实际事件"))return JSON.stringify({events:[{description:"时间过去。",visibleTo:[],visibleToPlayer:true}],changes:[],threads:[{action:"resolve",description,characterIds:["lin"]}]});
  return '{"narrative":"时间过去。"}';
 }});
 assert.equal(readCardMemory(result.snapshot.characters[0].card!)!.openThreads.length,0);
 assert.equal(result.snapshot.context!.threads[0].description,description);assert.equal(result.snapshot.context!.threads[0].status,"resolved");
 assert.equal(result.snapshot.characters[1].card?.source.includes("线索 long"),false);
});

test("累计记忆预算计算 JSON 转义开销，保留容量提示且不破坏 Unicode",()=>{
 const c=sampleStory().characters[0];const previous=readCardMemory(writeCardMemory(characterCard(c),{summary:"早期承诺：归还借书。",facts:[],beliefs:[],openThreads:[]},c.state,"t0","model"));
 const events=Array.from({length:24},(_,i)=>`${i}`+"\u0001\"\\😀".repeat(200));
 const threads=Array.from({length:8},(_,i):StoryThread=>({id:`thread-${i}`,description:events[i],characterIds:["lin"],status:"open",openedTurnId:"t"}));
 const update=economyMemoryUpdate(previous,events,threads,"lin");cardMemoryUpdateSchema.parse(update);
 assert.ok(JSON.stringify(update).length<=10000);assert.match(update.summary,/容量有限/);assert.match(update.summary,/早期承诺/);
 const excerpt=memoryExcerpt("😀".repeat(1000));assert.ok(excerpt.length<=400);assert.equal(excerpt.isWellFormed(),true);
});

test("精细复核收到实际分发和角色意图，裁决协议包含完整线索字段",async()=>{
 const story=sampleStory();story.collaborationMode="precise";let review=false;
 await runTurn({story,history:[],input:"同时争抢秘密钥匙",mode:"director",directorId:"m",turnId:"t",call:async(_id,system,prompt)=>{
  if(system.includes("信息分发"))return '{"deliveries":[{"characterId":"lin","visible":"有人争抢钥匙","direction":""}]}';
  if(system.includes("只扮演"))return '{"speech":"等等","actionIntent":"伸手阻止","emotion":"警觉","thought":"","goal":"阻止","relationship":"中立"}';
  if(system.includes("协调实际事件")){assert.match(system,/"enum":\["open","resolve"\]/);return '{"events":[{"description":"林晚伸手。","visibleTo":[],"visibleToPlayer":true}],"changes":[],"threads":[]}';}
  if(system.includes("一致性复核器")){review=true;const data=JSON.parse(prompt);assert.equal(data.deliveries[0].characterId,"lin");assert.equal(data.responses[0].actionIntent,"伸手阻止");assert.equal(data.responses[0].thought,undefined);return JSON.stringify(data.candidate);}
  if(system.includes("你负责更新角色卡记忆"))return '{"summaryAppend":"本轮伸手。","factsAdd":[],"factsRemove":[],"beliefsAdd":[],"beliefsRemove":[],"openThreadsAdd":[],"openThreadsResolve":[]}';
  return '{"narrative":"林晚伸出手。"}';
 }});assert.ok(review);
});
