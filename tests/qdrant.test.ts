import test from "node:test";
import assert from "node:assert/strict";
import { collectionName, ensureQdrantCollection, qdrantPointId, queryQdrantPoints, retrieveQdrantPoints, testQdrantConnection, upsertQdrantPoints, validateQdrantUrl } from "../lib/tavern/qdrant";
import { rankHybridHits } from "../lib/tavern/vector-retrieval";
import type { Character } from "../lib/tavern/types";

const connection={baseUrl:"https://tenant.cloud.qdrant.io:6333",apiKey:"test-only-secret"};
const vector=Array.from({length:32},(_,index)=>index===0?1:0);
const scope={owner:"user",storyId:"story",characterId:"actor",modelKey:"model"};

test("Qdrant 地址仅接受公开 HTTPS，点 ID 稳定且集合按维度隔离",async()=>{
 for(const url of ["http://tenant.cloud.qdrant.io:6333","https://localhost:6333","https://127.0.0.1:6333","https://user:pass@tenant.cloud.qdrant.io:6333","https://tenant.cloud.qdrant.io/private","https://tenant.cloud.qdrant.io:9999"]){assert.throws(()=>validateQdrantUrl(url))}
 assert.equal(validateQdrantUrl(connection.baseUrl),connection.baseUrl);
 assert.equal(collectionName(32),"mytavern_memory_32");
 assert.equal(await qdrantPointId(["a","b"]),await qdrantPointId(["a","b"]));
 assert.notEqual(await qdrantPointId(["a","b"]),await qdrantPointId(["b","a"]));
});

test("Qdrant 连接、集合、写入和查询使用密钥并限制权限与候选 ID",async()=>{
 const saved=globalThis.fetch;const calls:{url:string;method:string;body:unknown}[]=[];
 const pointId=await qdrantPointId(["user","story","actor","model","memory"]);
 try{
  globalThis.fetch=async(input,init)=>{
   const url=String(input);const method=init?.method||"GET";const body=init?.body?JSON.parse(String(init.body)):undefined;
   assert.equal((init?.headers as Record<string,string>)["api-key"],connection.apiKey);
   assert.equal(init?.redirect,"manual");assert.ok(!url.includes(connection.apiKey));calls.push({url,method,body});
   if(url.endsWith("/collections"))return Response.json({result:{collections:[]}});
   if(method==="GET")return Response.json({result:{config:{params:{vectors:{size:32,distance:"Cosine"}}}}});
   if(method==="PUT")return Response.json({result:{status:"completed"}});
   if(url.endsWith("/points"))return Response.json({result:[{id:pointId,payload:{...scope,memoryId:"memory",contentHash:"hash"}}]});
   return Response.json({result:{points:[{id:pointId,score:0.9,payload:{...scope,memoryId:"memory",contentHash:"hash"}},{id:"foreign",score:1,payload:{...scope}},{id:pointId,score:1,payload:{...scope,owner:"other"}}]}});
  };
  await testQdrantConnection(connection);
  await ensureQdrantCollection(connection,32);
  await upsertQdrantPoints(connection,[{id:pointId,vector,payload:{...scope,memoryId:"memory",contentHash:"hash"}}]);
  assert.equal((await retrieveQdrantPoints(connection,32,[pointId])).get(pointId)?.memoryId,"memory");
  const hits=await queryQdrantPoints(connection,vector,[pointId],scope);
  assert.deepEqual(hits.map(hit=>hit.id),[pointId]);
  const query=calls.find(call=>call.url.endsWith("/points/query"));assert.ok(query);
  const filter=(query.body as {filter:{must:unknown[]}}).filter.must;
  assert.deepEqual(filter.at(-1),{has_id:[pointId]});
  for(const key of ["owner","storyId","characterId","modelKey"])assert.ok(filter.some(item=>(item as {key?:string}).key===key));
 }finally{globalThis.fetch=saved}
});

test("Qdrant 维度不符时拒绝，索引不足时保持关键词结果",async()=>{
 const saved=globalThis.fetch;
 try{globalThis.fetch=async()=>Response.json({result:{config:{params:{vectors:{size:64,distance:"Cosine"}}}}});await assert.rejects(ensureQdrantCollection(connection,32),/维度/)}finally{globalThis.fetch=saved}
 const memories=[{id:"a",turnId:"one",content:"旧地点",kind:"observation" as const,importance:3},{id:"b",turnId:"two",content:"新线索",kind:"observation" as const,importance:3}];
 const character={id:"actor",name:"甲",role:"",persona:"",secret:"",color:"gray",modelId:"default",state:{location:"",clothing:"",condition:"",emotion:"",thought:"",goal:"",relationship:""},memories} satisfies Character;
 const partial=rankHybridHits(character,"地点",1000,["b"],["b"]);assert.equal(partial.usedVector,false);assert.equal(partial.indexed,1);
 const complete=rankHybridHits(character,"地点",1000,["b","a"],["a","b"]);assert.equal(complete.usedVector,true);
});
