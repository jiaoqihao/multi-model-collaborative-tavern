import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { sampleStory } from "../lib/tavern/seed";
import { parseCharacterCard, cardIdentity, readCardMemory } from "../lib/tavern/cards";
import { actorContext } from "../lib/tavern/engine";
import { importPreset, type Preset } from "../lib/tavern/presets";
import type { Workspace } from "../lib/tavern/types";
const origin="http://localhost:5173";
const headers={"Content-Type":"application/json",Cookie:"__sites_local_auth=1",Origin:origin};
async function req<T>(url:string,method="GET",body?:unknown,status=200):Promise<T>{const response=await fetch(origin+url,{method,headers,body:body?JSON.stringify(body):undefined});const raw=await response.text();assert.equal(response.status,status,raw.slice(0,400));if(response.headers.get("content-type")?.includes("text/event-stream")){const done=raw.split("\n\n").find(b=>b.startsWith("event: done"));assert.ok(done,"generation did not commit");return JSON.parse(done.split("\ndata: ")[1]);}return JSON.parse(raw);}
let storyId="",presetId="";
try {
 const source=process.argv[2]?readFileSync(process.argv[2],"utf8"):"name: 格式测试\nversion: 2\ncustom:\n  values: [1, 2]\n  description: |\n    第一行\n    第二行\n";
 const parsed=parseCharacterCard(source);const story=sampleStory();story.title="__feature_integration__";story.characters[0].card={format:"yaml",filename:"test.yaml",source};Object.assign(story.characters[0],cardIdentity(source));
 let ws=await req<Workspace>("/api/tavern","POST",{action:"createStory",story});storyId=ws.id;
 assert.equal(ws.story.characters[0].card?.source,source);assert.deepEqual(actorContext(ws.story.characters[0],"","").character.card,parsed);
 let preset=await req<Preset>("/api/presets","POST",importPreset(JSON.stringify({prompts:[{identifier:"main",role:"system",content:"使用 {{char}} 的口吻。",enabled:true}]}),"__feature_test__.json"));presetId=preset.id;
 assert.equal((await req<Preset>("/api/presets?id="+presetId)).revision,1);
 const old=structuredClone(preset);preset=await req<Preset>("/api/presets","POST",{...preset,name:"__feature_test_updated__"});assert.equal(preset.revision,2);
 await req("/api/presets","POST",old,409);
 ws=await req<Workspace>("/api/tavern","POST",{action:"saveStory",storyId,revision:ws.revision,story:{...ws.story,presetSelection:{director:"",actor:presetId,narrator:""}}});
 await req("/api/presets","DELETE",{id:presetId,revision:2},400);
 const turnId=crypto.randomUUID();ws=await req<Workspace>("/api/tavern","POST",{action:"generate",turn:{storyId,revision:ws.revision,requestId:turnId,input:"你好",mode:"roleplay"}});
 const memories=structuredClone(ws.story.characters[0].memories);assert.ok(memories.length);const sourceAfterTurn=ws.story.characters[0].card!.source;
 assert.equal(readCardMemory(ws.story.characters[0].card!)?.updatedTurnId,turnId);assert.equal(readCardMemory(ws.story.characters[0].card!)?.mode,"demo");
 const changed=JSON.stringify({...parsed,audit_revision:2});
 ws=await req<Workspace>("/api/tavern","POST",{action:"saveStory",storyId,revision:ws.revision,story:{...ws.story,characters:ws.story.characters.map((c,i)=>({...c,memories:[],...(i===0?{card:{format:"json",filename:"edited.json",source:changed}}:{})}))}});
 assert.equal(actorContext(ws.story.characters[0],"","").character.card?.audit_revision,2);assert.deepEqual(ws.story.characters[0].memories,memories);
 ws=await req<Workspace>("/api/tavern?story="+storyId);assert.equal(ws.story.characters[0].card?.source,changed);
 ws=await req<Workspace>("/api/tavern","POST",{action:"switchHead",storyId,revision:ws.revision,headId:turnId});assert.equal(ws.story.characters[0].card?.source,sourceAfterTurn);
 await req("/api/tavern","POST",{action:"saveStory",storyId,revision:ws.revision,story:{...ws.story,characters:ws.story.characters.map((c,i)=>i?c:{...c,card:{format:"yaml",filename:"broken.yaml",source:"name: ["}})}},400);
 console.log(`PASS: ${Object.keys(parsed).length} card fields retained; preset create/read/update/conflict/reference protection; live card edits, memory preservation, reload and snapshot restore; malformed card rejected.`);
}finally{
 const ids=[storyId,presetId].filter(Boolean);assert.ok(ids.every(id=>/^[a-f0-9-]{36}$/.test(id)));
 if(storyId){const sql=`DELETE FROM turns WHERE story_id='${storyId}'; DELETE FROM stories WHERE id='${storyId}' AND owner='local_seedy';`;const result=spawnSync(process.execPath,["--import","./scripts/sites-env.mjs","./node_modules/wrangler/bin/wrangler.js","d1","execute","DB","--local","--config","dist/server/wrangler.json","--persist-to",".wrangler/state","--command",sql],{encoding:"utf8"});assert.equal(result.status,0,"test story cleanup failed");}
 if(presetId){const p=await req<Preset>("/api/presets?id="+presetId);await req("/api/presets","DELETE",{id:presetId,revision:p.revision});console.log("PASS: unreferenced preset deleted; temporary test data cleaned.");}
}
