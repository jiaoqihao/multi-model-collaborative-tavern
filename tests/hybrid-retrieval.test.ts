import test from "node:test";
import assert from "node:assert/strict";
import { character, corpus, queries, scopeFor } from "../experiments/retrieval/fixtures";
import { eligibleEvidence, evidenceKey, retrieve, type Vector } from "../experiments/retrieval/hybrid";

test("混合检索先隔离用户、故事、角色、祖先与生命周期，再排序",()=>{
 const query=queries[0],scope=scopeFor(query);
 const vectors=new Map(corpus.map(row=>[evidenceKey(row),{model:"mock",values:[1,0]}]));
 for(const method of ["lexical","vector","hybrid"] as const){
  const result=retrieve({rows:corpus,scope,character,query:query.text,method,vectors,queryVector:{model:"mock",values:[1,0]},budgetTokens:100000,limit:1000});
  assert.equal(result.items.length,49);
  assert.ok(result.items.every(row=>row.ownerId===scope.ownerId&&row.storyId===scope.storyId&&row.characterId===scope.characterId&&scope.ancestorTurnIds.has(row.memory.turnId)&&row.memory.status==="active"));
 }
 assert.equal(eligibleEvidence(corpus,{...scope,historical:true}).length,51);
 const futureValid={...corpus[0],memory:{...corpus[0].memory,validFromTurnId:"future"}};
 assert.equal(eligibleEvidence([futureValid],{...scope,historical:true}).length,0);
 const expired={...corpus[0],memory:{...corpus[0].memory,validUntilTurnId:"t2"}};
 assert.equal(eligibleEvidence([expired],scope).length,0);assert.equal(eligibleEvidence([expired],{...scope,historical:true}).length,1);
});
test("缺失、损坏、零向量与模型版本不匹配均回退关键词结果",()=>{
 const args={rows:corpus,scope:scopeFor(queries[0]),character,query:queries[0].text,budgetTokens:900,limit:3};
 const baseline=retrieve({...args,method:"lexical"});
 for(const invalid of [undefined,{model:"wrong",values:[1,0]},{model:"mock",values:[0,0]},{model:"mock",values:[NaN,1]},{model:"mock",values:[1]}] as (Vector|undefined)[]){
  const vectors=new Map(corpus.map(row=>[evidenceKey(row),{model:"mock",values:[1,0]}]));
  if(invalid)vectors.set(evidenceKey(corpus[0]),invalid as {model:string;values:number[]});else vectors.delete(evidenceKey(corpus[0]));
  const result=retrieve({...args,method:"hybrid",vectors,queryVector:{model:"mock",values:[1,0]}});
  assert.equal(result.fallback,true);assert.deepEqual(result.items,baseline.items);
 }
});
test("混合检索计算完整记忆元数据预算，且不能跨命名空间复用索引",()=>{
 const query=queries[0];const args={rows:corpus,scope:scopeFor(query),character,query:query.text,method:"hybrid" as const,limit:3};
 for(const budgetTokens of [0,20,180,450,900]){const result=retrieve({...args,budgetTokens});assert.ok(result.usedTokens<=budgetTokens);assert.ok(result.items.length<=3);}
 assert.notEqual(evidenceKey(corpus[0]),evidenceKey({...corpus[0],ownerId:"different"}));
 assert.throws(()=>retrieve({...args,budgetTokens:NaN}),/limits/);
 assert.throws(()=>retrieve({...args,rows:[corpus[0],corpus[0]],budgetTokens:900}),/Duplicate/);
});
