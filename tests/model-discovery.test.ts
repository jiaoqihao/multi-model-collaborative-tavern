import test from "node:test";
import assert from "node:assert/strict";
import { listAvailableModels, discoveryKey, modelDiscoverySchema } from "../lib/tavern/model-discovery";
import { cryptKey } from "../lib/tavern/models";

test("获取模型只需连接信息，不要求配置名或模型 ID",()=>{
 assert.ok(modelDiscoverySchema.safeParse({provider:"compatible",baseUrl:"https://api.example.com/v1",apiKey:"test-key"}).success);
 assert.equal(modelDiscoverySchema.safeParse({provider:"unknown",baseUrl:"https://api.example.com"}).success,false);
});
test("OpenAI 与兼容接口读取标准模型列表并排序去重，密钥只在请求头中",async()=>{
 const saved=globalThis.fetch;
 try{for(const provider of ["openai","compatible"] as const){
  globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith("/v1/models"));assert.equal(init?.method,"GET");assert.equal(init?.redirect,"manual");assert.equal(init?.body,undefined);assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer private-test-key");assert.ok(!String(url).includes("private-test-key"));return Response.json({data:[{id:"z-model"},{id:"a-model"},{id:"z-model"},{id:null}]})};
  assert.deepEqual((await listAvailableModels({provider,baseUrl:provider==="openai"?"https://api.openai.com/v1/":"https://api.example.com/v1/"},"private-test-key")).models,[{id:"a-model",name:"a-model"},{id:"z-model",name:"z-model"}]);
 }}finally{globalThis.fetch=saved}
});
test("Anthropic 遍历 after_id 分页并保留模型显示名",async()=>{
 const saved=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,init)=>{
  const u=new URL(String(url));assert.equal(u.pathname,"/v1/models");assert.equal((init?.headers as Record<string,string>)["x-api-key"],"key");assert.equal((init?.headers as Record<string,string>)["anthropic-version"],"2023-06-01");calls++;
  if(calls===1){assert.equal(u.searchParams.get("after_id"),null);return Response.json({data:[{id:"claude-a",display_name:"Claude A"}],has_more:true,last_id:"claude-a"})}
  assert.equal(u.searchParams.get("after_id"),"claude-a");return Response.json({data:[{id:"claude-b",display_name:"Claude B"}],has_more:false});
 };const data=await listAvailableModels({provider:"anthropic",baseUrl:"https://api.anthropic.com/v1"},"key");assert.equal(calls,2);assert.deepEqual(data.models,[{id:"claude-a",name:"Claude A"},{id:"claude-b",name:"Claude B"}]);}finally{globalThis.fetch=saved}
});
test("Gemini 遍历 pageToken，移除 models 前缀并过滤不支持生成的模型",async()=>{
 const saved=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,init)=>{const u=new URL(String(url));assert.equal((init?.headers as Record<string,string>)["x-goog-api-key"],"private-key");assert.ok(!u.search.includes("private-key"));calls++;
  if(calls===1)return Response.json({models:[{name:"models/text-a",displayName:"Text A",supportedGenerationMethods:["generateContent"]},{name:"models/embed",supportedGenerationMethods:["embedContent"]}],nextPageToken:"token/+=?"});
  assert.equal(u.searchParams.get("pageToken"),"token/+=?");return Response.json({models:[{name:"models/text-b",displayName:"Text B",supportedGenerationMethods:["generateContent"]}]});
 };assert.deepEqual((await listAvailableModels({provider:"gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta"},"private-key")).models.map(m=>m.id),["text-a","text-b"]);assert.equal(calls,2);}finally{globalThis.fetch=saved}
});
test("兼容分页不截断，重复游标、错误结构和超长响应明确报错",async()=>{
 const saved=globalThis.fetch;const connection={provider:"compatible" as const,baseUrl:"https://api.example.com/v1"};
 try{
  let n=0;globalThis.fetch=async(url)=>{n++;if(n===1)return Response.json({data:[{id:"first"}],has_more:true});assert.equal(new URL(String(url)).searchParams.get("after"),"first");return Response.json({data:[{id:"second"}],has_more:false})};assert.equal((await listAvailableModels(connection,"key")).models.length,2);
  globalThis.fetch=async()=>Response.json({data:[{id:"loop"}],has_more:true});await assert.rejects(listAvailableModels(connection,"key"),/重复/);
  globalThis.fetch=async()=>Response.json({unexpected:[]});await assert.rejects(listAvailableModels(connection,"key"),/数组/);
  globalThis.fetch=async()=>new Response("not json");await assert.rejects(listAvailableModels(connection,"key"),/JSON/);
  globalThis.fetch=async()=>new Response(" ".repeat(2*1024*1024+1));await assert.rejects(listAvailableModels(connection,"key"),/2 MB/);
  globalThis.fetch=async()=>Response.json({data:[]});assert.deepEqual(await listAvailableModels(connection,"key"),{models:[]});
 }finally{globalThis.fetch=saved}
});
test("认证失败与不支持列表接口时不泄漏服务商响应和密钥",async()=>{
 const saved=globalThis.fetch;const connection={provider:"compatible" as const,baseUrl:"https://api.example.com/v1"};
 try{for(const [status,pattern] of [[401,/密钥/],[403,/权限/],[404,/不支持/],[429,/频繁/],[500,/HTTP 500/]] as const){globalThis.fetch=async()=>new Response("sensitive-key-in-upstream-error",{status});await assert.rejects(listAvailableModels(connection,"private-key"),(e:Error)=>{assert.match(e.message,pattern);assert.ok(!e.message.includes("private-key"));assert.ok(!e.message.includes("sensitive-key"));return true})}
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({data:[]})};await assert.rejects(listAvailableModels({...connection,baseUrl:"http://localhost"},"key"));assert.equal(calls,0);
 }finally{globalThis.fetch=saved}
});
test("已保存密钥仅复用于相同地址和协议，草稿新密钥不需要解密或保存",async()=>{
 const secret="x".repeat(64);const connection={id:"owned",provider:"compatible" as const,baseUrl:"https://api.example.com/v1"};
 const stored={data:JSON.stringify({...connection,name:"stored",model:"stored-model"}),encrypted_key:await cryptKey("stored-key",secret)};
 assert.equal(await discoveryKey(connection,stored,()=>secret),"stored-key");
 assert.equal(await discoveryKey({...connection,baseUrl:connection.baseUrl+"/"},stored,()=>secret),"stored-key");
 await assert.rejects(discoveryKey({...connection,baseUrl:"https://another.example.com/v1"},stored,()=>secret),/重新填写/);
 await assert.rejects(discoveryKey({...connection,clearKey:true},stored,()=>secret),/填写/);
 await assert.rejects(discoveryKey({...connection,id:""},undefined,()=>secret),/填写/);
 assert.equal(await discoveryKey({...connection,baseUrl:"https://another.example.com/v1",apiKey:" new-key "},stored,()=>{throw Error("must not decrypt")}),"new-key");
});
