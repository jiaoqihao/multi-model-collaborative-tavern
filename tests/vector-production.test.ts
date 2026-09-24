import test from "node:test";
import assert from "node:assert/strict";
import { branchMemories, rankHybridMemories } from "../lib/tavern/vector-retrieval";
import { embedTexts } from "../lib/tavern/embeddings";
import { runTurn } from "../lib/tavern/engine";
import { sampleStory } from "../lib/tavern/seed";
import type { Character, Memory, Profile } from "../lib/tavern/types";

const memory=(id:string,turnId:string,content:string,importance=3):Memory=>({id,turnId,content,kind:"observation",importance});
const character=(memories:Memory[]):Character=>({id:"actor",name:"甲",role:"",persona:"",secret:"",color:"gray",modelId:"default",state:{location:"",clothing:"",condition:"",emotion:"",thought:"",goal:"",relationship:""},memories});
const vector=(first:number)=>[first,...Array.from({length:31},(_,index)=>index===0?1:0)];

test("生产向量检索只使用当前分支快照中的祖先记忆",()=>{
 const cast=character([memory("ancestor","parent","旧承诺"),memory("sibling","other-branch","旁支秘密"),memory("future","future","未来事件")]);
 const scoped=branchMemories(cast,new Set(["parent"]));
 assert.deepEqual(scoped.map(item=>item.id),["ancestor"]);
 const ranked=rankHybridMemories({...cast,memories:scoped},"承诺",900,new Map([["ancestor",vector(1)],["sibling",vector(100)]]),vector(1));
 assert.deepEqual(ranked.items.map(item=>item.id),["ancestor"]);
});

test("索引覆盖不足回退关键词，覆盖足够时参与排序且遵守预算",()=>{
 const cast=character([memory("old","a","旧地点",5),memory("new","b","新的线索",1)]);
 const partial=rankHybridMemories(cast,"在哪里",900,new Map([["new",vector(1)]]),vector(1));
 assert.equal(partial.usedVector,false);
 const complete=rankHybridMemories(cast,"在哪里",900,new Map([["old",vector(-1)],["new",vector(1)]]),vector(1));
 assert.equal(complete.usedVector,true);
 assert.equal(complete.indexed,2);
 assert.equal(rankHybridMemories(cast,"在哪里",0,new Map(),undefined).items.length,0);
});

test("OpenAI 兼容向量接口批量请求并验证维度",async()=>{
 const original=globalThis.fetch;
 const profile:Profile={id:"p",name:"embedding",provider:"compatible",baseUrl:"https://embeddings.example.com/v1",model:"chat"};
 let seen="";
 globalThis.fetch=async(input,init)=>{seen=String(input);assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer test-key");assert.equal(init?.redirect,"manual");return Response.json({data:[{index:1,embedding:vector(2)},{index:0,embedding:vector(1)}]})};
 try{const values=await embedTexts(profile,"test-key","embed-model",["甲","乙"]);assert.match(seen,/\/embeddings$/);assert.equal(values[0][0],1);assert.equal(values[1][0],2)}finally{globalThis.fetch=original}
});

test("Gemini 查询与文档使用不同嵌入任务，拒绝损坏向量",async()=>{
 const original=globalThis.fetch;const profile:Profile={id:"g",name:"gemini",provider:"gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta",model:"chat"};
 let task="";
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));task=body.requests[0].taskType;return Response.json({embeddings:[{values:vector(1)}]})};
 try{assert.equal((await embedTexts(profile,"test-key","gemini-embedding-001",["提问"],"query")).length,1);assert.equal(task,"RETRIEVAL_QUERY");await embedTexts(profile,"test-key","gemini-embedding-001",["经历"]);assert.equal(task,"RETRIEVAL_DOCUMENT");globalThis.fetch=async()=>Response.json({embeddings:[{values:[0,0]}]});await assert.rejects(embedTexts(profile,"test-key","gemini-embedding-001",["损坏"]),/无效/)}finally{globalThis.fetch=original}
});

test("真实生成路径把混合检索证据送入角色阶段并记录使用情况",async()=>{
 const story=sampleStory();const evidence=memory("m1","prior","向量找到的旧约定");story.characters[0].memories=[evidence];let actorPrompt="";
 const result=await runTurn({story,history:[],input:"接下来怎么办",mode:"roleplay",directorId:"main",turnId:"now",memorySearch:async()=>({items:[evidence],usedVector:true,indexed:1,total:1}),call:async(_id,system,prompt)=>{
  if(system.includes("你负责信息分发"))return JSON.stringify({deliveries:[{characterId:"lin",visible:"玩家询问下一步",direction:""}]});
  if(system.includes("只扮演给定角色")){actorPrompt=prompt;return JSON.stringify({speech:"先等一等。",actionIntent:"停下",emotion:"平静",thought:"要记得承诺",goal:"守约",relationship:"信任"})}
  if(system.includes("你协调实际事件"))return JSON.stringify({events:[{description:"林晚说先等一等。",visibleTo:["lin"],visibleToPlayer:true}],changes:[]});
  if(system.includes("你负责更新角色卡记忆"))return JSON.stringify({summary:"记得约定",facts:[],beliefs:[],openThreads:[]});
  return JSON.stringify({narrative:"林晚说先等一等。"});
 }});
 assert.match(actorPrompt,/向量找到的旧约定/);
 assert.deepEqual(result.trace.retrievals,[{characterId:"lin",usedVector:true,indexed:1,total:1}]);
});
