import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const origin=process.argv[2]||"http://localhost:5173";
const localWorker=new URL(origin).port==="8787";
const headers={"Content-Type":"application/json",Cookie:"__sites_local_auth=1",Origin:origin,...(localWorker?{"oai-authenticated-user-id":"local_seedy"}:{})};
let storyId;let profileId;let libraryId;let vectorConnectionId;
async function request(body,status=200){const response=await fetch(origin+"/api/tavern",{method:"POST",headers,body:JSON.stringify(body)});const text=await response.text();assert.equal(response.status,status,text);return response.headers.get("content-type").includes("text/event-stream")?text:JSON.parse(text);}
function done(text){const blocks=text.split("\n\n");const complete=blocks.find(b=>b.startsWith("event: done"));assert.ok(complete,text);return JSON.parse(complete.split("\ndata: ")[1]);}
try{
 assert.equal((await fetch(origin+"/api/tavern")).status,401);
 if(!localWorker){const spoof=await fetch(origin+"/api/tavern",{headers:{"oai-authenticated-user-id":"forged-user"}});assert.equal(spoof.status,401)}
 const cross=await fetch(origin+"/api/tavern",{method:"POST",headers:{...headers,Origin:"https://unrelated.example"},body:'{"action":"createStory"}'});assert.equal(cross.status,403);
 let ws=await request({action:"createStory"});storyId=ws.id;assert.deepEqual(ws.story.characters,[],"新故事必须从空角色列表开始");
 const baseState={location:"夜航酒馆",clothing:"深色外套",condition:"健康",emotion:"平静",thought:"",goal:"观察",relationship:"初次见面"};
 const lin={id:crypto.randomUUID(),name:"林晚",role:"酒馆老板",persona:"谨慎",secret:"旧事",color:"amber",modelId:"default",presetId:"inherit",state:{...baseState,clothing:"衬衫和围裙"},memories:[{id:"old",turnId:"old",content:"不应跨故事导入",kind:"observation",importance:3}]};
 ws=await request({action:"saveLibraryCharacter",storyId,revision:ws.revision,character:lin});libraryId=ws.characterLibrary[0].id;assert.deepEqual(ws.characterLibrary[0].character.memories,[],"角色库不保存故事记忆");
 ws=await request({action:"importLibraryCharacter",storyId,revision:ws.revision,libraryId});assert.equal(ws.story.characters.length,1);assert.notEqual(ws.story.characters[0].id,lin.id);assert.deepEqual(ws.story.characters[0].memories,[]);
 const shen={id:crypto.randomUUID(),name:"沈砚",role:"抄写员",persona:"安静",secret:"寻人",color:"blue",modelId:"default",presetId:"inherit",state:{...baseState},memories:[]};
 ws=await request({action:"saveStory",storyId,revision:ws.revision,story:{...ws.story,title:"__integration_test__",characters:[...ws.story.characters,shen]}});
 const root=structuredClone(ws.story);const firstId=crypto.randomUUID();
 const firstRequest={action:"generate",turn:{storyId,revision:ws.revision,input:"我低声向林晚提问信件的来历",mode:"roleplay",requestId:firstId}};
 ws=done(await request(firstRequest));assert.equal(ws.headId,firstId);assert.equal(ws.story.characters[1].memories.length,0);assert.ok(ws.story.characters[0].memories.length>0);
 const repeat=await request(firstRequest);assert.equal(repeat.turns.length,1,"重放已完成请求不生成新回合");
 const stateAfterFirst=structuredClone(ws.story);
 const secondId=crypto.randomUUID();ws=done(await request({action:"generate",turn:{storyId,revision:ws.revision,input:"让林晚脱下围裙，安排敲门声",mode:"director",requestId:secondId}}));
 assert.ok(ws.story.characters[0].state.clothing.includes("已脱下"));assert.equal(ws.turns.length,2);
 const stale=await request({action:"saveStory",storyId,revision:0,story:root},409);assert.ok(stale.error);
 ws=await request({action:"switchHead",storyId,revision:ws.revision,headId:firstId});assert.deepEqual(ws.story,stateAfterFirst,"回退必须恢复完整状态及记忆");
 const regeneratedId=crypto.randomUUID();ws=done(await request({action:"generate",turn:{storyId,revision:ws.revision,input:"我低声向林晚提问信件的来历",mode:"roleplay",requestId:regeneratedId,regenerate:true}}));
 assert.equal(ws.turns.find(t=>t.id===regeneratedId).parentId,null);assert.equal(ws.story.characters[0].memories.length,stateAfterFirst.characters[0].memories.length,"重新生成不叠加旧记忆");assert.equal(ws.turns.length,3);
 ws=await request({action:"switchHead",storyId,revision:ws.revision,headId:secondId});assert.ok(ws.story.characters[0].state.clothing.includes("已脱下"));
 const concurrentRevision=ws.revision;
 const [a,b]=await Promise.all(["A","B"].map(text=>request({action:"generate",turn:{storyId,revision:concurrentRevision,input:text,mode:"roleplay",requestId:crypto.randomUUID()}}).catch(e=>({error:e.message}))));
 const successes=[a,b].filter(x=>typeof x==="string"&&x.includes("event: done"));assert.equal(successes.length,1,"同一 revision 最多一个回合生效");
 ws=await fetch(origin+"/api/tavern?story="+storyId,{headers}).then(r=>r.json());assert.equal(ws.turns.length,4);
 ws=await request({action:"saveProfile",storyId,profile:{id:"",name:"__test_no_real_api__",provider:"compatible",baseUrl:"https://api.example.com/v1",model:"not-real",apiKey:"FAKE_SECRET_FOR_TEST_ONLY"}});
 const profile=ws.profiles.find(p=>p.name==="__test_no_real_api__");profileId=profile.id;assert.equal(profile.hasKey,true);assert.ok(!JSON.stringify(ws).includes("FAKE_SECRET_FOR_TEST_ONLY"),"密钥不得返回前端");
 const changedAddress=await request({action:"listModels",connection:{id:profileId,provider:"compatible",baseUrl:"https://other.example.com/v1"}},400);assert.match(changedAddress.error,/重新填写 API 密钥/);
 const missingKey=await request({action:"listModels",connection:{provider:"compatible",baseUrl:"https://api.example.com/v1"}},400);assert.match(missingKey.error,/填写 API 密钥/);
 await request({action:"listModels",connection:{id:crypto.randomUUID(),provider:"compatible",baseUrl:"https://api.example.com/v1",apiKey:"FAKE_SECRET_FOR_TEST_ONLY"}},404);
 ws=await request({action:"saveVectorConnection",storyId,connection:{name:"__test_qdrant__",baseUrl:"https://test.cloud.qdrant.io:6333",apiKey:"FAKE_QDRANT_KEY_FOR_TEST_ONLY"}});
 const vectorConnection=ws.vectorConnections.find(item=>item.name==="__test_qdrant__");vectorConnectionId=vectorConnection.id;
 assert.equal(vectorConnection.hasKey,true);assert.ok(!JSON.stringify(ws).includes("FAKE_QDRANT_KEY_FOR_TEST_ONLY"),"Qdrant 密钥不得返回前端");
 const badConnection=await request({action:"saveStory",storyId,revision:ws.revision,story:{...ws.story,retrieval:{mode:"hybrid",embeddingProfileId:profileId,embeddingModel:"embed",backend:"qdrant",vectorConnectionId:crypto.randomUUID()}}},400);assert.match(badConnection.error,/Qdrant/);
 ws=await request({action:"deleteVectorConnection",storyId,connectionId:vectorConnectionId,connectionRevision:vectorConnection.revision});vectorConnectionId=null;
 ws=await request({action:"deleteProfile",storyId,profileId});profileId=null;
 ws=await request({action:"deleteLibraryCharacter",storyId,libraryId,libraryRevision:ws.characterLibrary.find(c=>c.id===libraryId).revision});libraryId=null;
 console.log("PASS: 空故事、角色库导入、认证、跨站拒绝、导演模式、分支重生成、Qdrant 连接管理与密钥脱敏。");
}finally{
 if(storyId&&/^[a-f0-9-]{36}$/.test(storyId)){
  const sql=`DELETE FROM turns WHERE story_id='${storyId}'; DELETE FROM stories WHERE id='${storyId}' AND owner='local_seedy';`+(profileId&&/^[a-f0-9-]{36}$/.test(profileId)?` DELETE FROM profiles WHERE id='${profileId}' AND owner='local_seedy';`:"")+(libraryId&&/^[a-f0-9-]{36}$/.test(libraryId)?` DELETE FROM character_library WHERE id='${libraryId}' AND owner='local_seedy';`:"")+(vectorConnectionId&&/^[a-f0-9-]{36}$/.test(vectorConnectionId)?` DELETE FROM vector_connections WHERE id='${vectorConnectionId}' AND owner='local_seedy';`:"");
  const result=spawnSync(process.execPath,["--import","./scripts/sites-env.mjs","./node_modules/wrangler/bin/wrangler.js","d1","execute","DB","--local","--config","dist/server/wrangler.json","--persist-to",".wrangler/state","--command",sql],{encoding:"utf8"});
  if(result.status!==0){console.error("测试数据清理失败",storyId);process.exitCode=1;}
 }
}
