import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

// Exercise the real Workers fetch implementation with a local simulated provider.
// No external service or real API key is used.
const built=await build({stdin:{contents:`
import {listAvailableModels} from "./lib/tavern/model-discovery";
import {complete} from "./lib/tavern/models";
export default {async fetch(request){
 const path=new URL(request.url).pathname;
 const baseUrl="https://provider.example.com"+(path.includes("redirect")?"/redirect":"/v1");
 try {
  if(path==="/legacy"){await fetch(baseUrl+"/models",{redirect:"error"});return Response.json({unexpected:true});}
  const result=path.includes("chat")?await complete({id:"test",name:"runtime",provider:"compatible",baseUrl,model:"test-model"},"fake-runtime-key","system","user"):await listAvailableModels({provider:"compatible",baseUrl},"fake-runtime-key",request.signal);
  return Response.json({result});
 }catch(error){return Response.json({error:error.message},{status:502})}
}};`,resolveDir:process.cwd(),sourcefile:"model-runtime-worker.ts",loader:"ts"},bundle:true,platform:"browser",format:"esm",write:false});
const requests=[];
const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:"2026-05-15",outboundService:async request=>{
 const url=new URL(request.url);requests.push({host:url.host,path:url.pathname});
 assert.equal(request.headers.get("Authorization"),"Bearer fake-runtime-key");
 if(url.pathname.startsWith("/redirect"))return new Response(null,{status:302,headers:{Location:"https://must-not-receive-key.example.com/models"}});
 if(url.pathname.endsWith("/chat/completions")){assert.equal(request.method,"POST");return Response.json({choices:[{message:{content:"ok"}}]})}
 assert.equal(request.method,"GET");return Response.json({data:[{id:"test-model"}]});
}});
try{
 const legacy=await mf.dispatchFetch("http://local/legacy");assert.equal(legacy.status,502);assert.match((await legacy.json()).error,/Invalid redirect value/);assert.equal(requests.length,0);
 const list=await mf.dispatchFetch("http://local/list");assert.equal(list.status,200);assert.deepEqual((await list.json()).result.models,[{id:"test-model",name:"test-model"}]);
 const chat=await mf.dispatchFetch("http://local/chat");assert.equal(chat.status,200);assert.equal((await chat.json()).result,"ok");
 for(const path of ["/redirect-list","/redirect-chat"]){const before=requests.length;const response=await mf.dispatchFetch("http://local"+path);assert.equal(response.status,502);assert.match((await response.json()).error,/重定向/);assert.equal(requests.length,before+1)}
 assert.ok(requests.every(r=>r.host==="provider.example.com"));
 console.log("PASS: real Workers runtime reproduces legacy redirect failure; model discovery and chat succeed; redirects never receive credentials.");
}finally{await mf.dispose()}
