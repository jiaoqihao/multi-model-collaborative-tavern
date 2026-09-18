import test from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../lib/tavern/engine";
import { sampleStory } from "../lib/tavern/seed";

const valid={events:[{description:"林晚点头。",visibleTo:["lin"],visibleToPlayer:true}],changes:[],threads:[]};
const invalidCases=[
 {name:"玩家误作角色",value:{...valid,events:[{...valid.events[0],visibleTo:["lin","player"]}]}},
 {name:"未知状态角色",value:{...valid,changes:[{characterId:"unknown",location:"门外"}]}},
 {name:"重复状态变更",value:{...valid,changes:[{characterId:"lin"},{characterId:"lin"}]}},
 {name:"线索未知角色",value:{...valid,threads:[{action:"open",description:"约定",characterIds:["player"]}]}},
 {name:"线索越界索引",value:{...valid,threads:[{action:"open",description:"约定",characterIds:["lin"],sourceEventIndex:9}]}},
 {name:"混用持久化字段",value:{...valid,threads:[{action:"open",description:"约定",characterIds:["lin"],status:"open"}]}},
];
for(const spec of invalidCases)test(`${spec.name} 在缓存前重试校验，不复用旧无效缓存`,async()=>{
 const story=sampleStory();story.collaborationMode="economy";const before=structuredClone(story);
 const saved=new Map<string,unknown>([["settlement",spec.value]]);const writes:string[]=[];let calls=0;
 const result=await runTurn({story,history:[],input:"你好",mode:"roleplay",directorId:"m",turnId:"t",cache:{load:async k=>saved.get(k),save:async(k,v)=>{writes.push(k);saved.set(k,v);}},call:async(_id,system)=>{
  if(system.includes("信息分发"))return '{"deliveries":[]}';
  if(system.includes("协调实际事件")){calls++;assert.match(system,/"enum":\["lin","shen"\]/);if(calls===1)return JSON.stringify(spec.value);assert.match(system,/上次输出校验失败/);return JSON.stringify(valid);}
  return '{"narrative":"林晚点头。"}';
 }});
 assert.equal(calls,2);assert.equal(writes.filter(k=>k==="settlement").length,1);assert.deepEqual(saved.get("settlement"),valid);assert.deepEqual(story,before);
 assert.equal(result.trace.stages?.find(s=>s.stage==="协调事件与状态")?.attempts,2);
});

test("无效裁决连续失败不写缓存、不调用旁白、不修改源故事",async()=>{
 const story=sampleStory();const before=structuredClone(story),saved=new Map<string,unknown>();let settlementCalls=0;
 await assert.rejects(runTurn({story,history:[],input:"你好",mode:"roleplay",directorId:"m",turnId:"t",cache:{load:async k=>saved.get(k),save:async(k,v)=>{saved.set(k,v);}},call:async(_id,system)=>{
  if(system.includes("信息分发"))return '{"deliveries":[]}';
  assert.match(system,/协调实际事件/);settlementCalls++;return JSON.stringify(invalidCases[0].value);
 }}),/visibleTo/);
 assert.equal(settlementCalls,2);assert.equal(saved.has("settlement"),false);assert.deepEqual(story,before);
});

test("精细复核返回非法角色时先重试再缓存",async()=>{
 const story=sampleStory();story.characters=[];story.collaborationMode="precise";let attempts=0;const saved=new Map<string,unknown>();
 const candidate={events:[{description:"秘密钥匙仍在原处。",visibleTo:[],visibleToPlayer:true}],changes:[],threads:[]};
 await runTurn({story,history:[],input:"同时争抢秘密钥匙并作出承诺",mode:"director",directorId:"m",turnId:"t",cache:{load:async k=>saved.get(k),save:async(k,v)=>{saved.set(k,v);}},call:async(_id,system)=>{
  if(system.includes("信息分发"))return '{"deliveries":[]}';
  if(system.includes("协调实际事件"))return JSON.stringify(candidate);
  if(system.includes("一致性复核器")){attempts++;return JSON.stringify(attempts===1?{...candidate,changes:[{characterId:"player"}]}:candidate);}
  return '{"narrative":"钥匙仍在原处。"}';
 }});assert.equal(attempts,2);assert.deepEqual(saved.get("review"),candidate);
});
