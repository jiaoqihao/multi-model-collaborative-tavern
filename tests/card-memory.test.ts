import test from "node:test";
import assert from "node:assert/strict";
import { sampleStory } from "../lib/tavern/seed";
import { runTurn, demoTurn, actorContext, type CallModel } from "../lib/tavern/engine";
import { clearCardMemory, parseCharacterCard, readCardMemory, writeCardMemory, characterCard, type CardMemoryUpdate } from "../lib/tavern/cards";
import { storySchema } from "../lib/tavern/validation";
const update:CardMemoryUpdate={summary:"记得旧约定，也得知新的暗号。",facts:["玩家告知暗号是月光"],beliefs:["觉得玩家可信"],openThreads:["明晚赴约"]};
function model(log:{id:string;system:string;data:Record<string,unknown>;context:unknown}[],memoryText=JSON.stringify(update)):CallModel {
 return async(id,system,prompt,context)=>{
  const data=JSON.parse(prompt);log.push({id,system,data,context});
  if(system.includes("你负责信息分发"))return JSON.stringify({deliveries:[{characterId:"lin",visible:"玩家低声告知暗号是月光",direction:"BACKSTAGE_DIRECTIVE"}]});
  if(system.includes("只扮演给定角色"))return JSON.stringify({speech:"记住了",actionIntent:"打算收起纸条",emotion:"谨慎",thought:"OWN_BELIEF",goal:"记住约定",relationship:"信任玩家"});
  if(system.includes("你协调实际事件"))return JSON.stringify({events:[{description:"林晚得知月光暗号",visibleTo:["lin"],visibleToPlayer:true},{description:"OTHER_PRIVATE_EVENT",visibleTo:["shen"],visibleToPlayer:false}],changes:[{characterId:"lin",location:"柜台后"}]});
  if(system.includes("你是叙事编辑"))return JSON.stringify({narrative:"林晚点头。"});
  if(system.includes("你负责更新角色卡记忆"))return memoryText;
  throw Error("Unexpected call");
 };
}
test("主模型自动更新角色卡；下一回合角色与主模型读取新卡，旁白不接收私密卡片",async()=>{
 const story=sampleStory();story.characters[0].modelId="actor-only";story.characters[1].secret="OTHER_CARD_SECRET";
 story.characters[0].card={format:"yaml",filename:"custom.yaml",source:"# preserve comment\nname: 林晚\ncustom:\n  list: [1, 2]\n"};
 const idle=structuredClone(story.characters[1]);idle.id="idle";idle.name="未在场角色";idle.card={format:"yaml",filename:"idle.yaml",source:"name: 未在场角色\ncustom: 不变\n"};story.characters.push(idle);
 const before=structuredClone(story);const calls:Parameters<typeof model>[0]=[];
 const result=await runTurn({story,history:[],input:"PRIVATE_USER_INPUT",mode:"roleplay",directorId:"master",turnId:"turn1",call:model(calls)});
 assert.deepEqual(story,before);const card=result.snapshot.characters[0].card!;const memory=readCardMemory(card)!;
 assert.equal(memory.summary,update.summary);assert.equal(memory.updatedTurnId,"turn1");assert.equal(memory.mode,"model");assert.equal(memory.currentState.location,"柜台后");assert.ok(card.source.includes("# preserve comment"));assert.deepEqual(parseCharacterCard(card.source).custom,{list:[1,2]});
 assert.deepEqual(result.snapshot.characters[2].card,idle.card);
 const writers=calls.filter(c=>c.system.includes("你负责更新角色卡记忆"));assert.equal(writers.length,2);assert.ok(writers.every(c=>c.id==="master"&&c.context===undefined));
 const lin=JSON.stringify(writers.find(c=>c.data.characterId==="lin")!.data);assert.ok(lin.includes("OWN_BELIEF"));assert.ok(!lin.includes("OTHER_PRIVATE_EVENT"));assert.ok(!lin.includes("OTHER_CARD_SECRET"));assert.ok(!lin.includes("BACKSTAGE_DIRECTIVE"));assert.ok(!lin.includes("PRIVATE_USER_INPUT"));
 const shen=JSON.stringify(writers.find(c=>c.data.characterId==="shen")!.data);assert.ok(!shen.includes("月光"));assert.ok(!shen.includes("OWN_BELIEF"));
 assert.ok(!JSON.stringify(calls.find(c=>c.system.includes("你是叙事编辑"))!.data).includes("OTHER_CARD_SECRET"));
 const next:Parameters<typeof model>[0]=[];
 await runTurn({story:result.snapshot,history:[],input:"下一句",mode:"roleplay",directorId:"master",turnId:"turn2",call:model(next)});
 const actor=next.find(c=>c.system.includes("只扮演给定角色"))!;assert.equal(actor.id,"actor-only");assert.ok(JSON.stringify(actor.data).includes(update.summary));
 assert.ok(JSON.stringify(next.find(c=>c.system.includes("你负责信息分发"))!.data).includes(update.summary));
 assert.ok(JSON.stringify(next.find(c=>c.system.includes("你负责更新角色卡记忆")&&c.data.characterId==="lin")!.data).includes(update.summary));
 assert.ok(storySchema.safeParse(result.snapshot).success);
});
test("记忆模型结构错误会重试并拒绝整轮，原故事和卡片不变",async()=>{
 const story=sampleStory();const before=structuredClone(story);const calls:Parameters<typeof model>[0]=[];
 await assert.rejects(runTurn({story,history:[],input:"hi",mode:"roleplay",directorId:"master",turnId:"bad",call:model(calls,'{"summary":"缺少字段"}')}),/无效结构/);
 assert.deepEqual(story,before);assert.equal(calls.filter(c=>c.system.includes("你负责更新角色卡记忆")&&c.data.characterId==="lin").length,2);
});
test("JSON 标准卡记忆写入 extensions；保留背景和既有扩展，冲突或超长不覆盖",()=>{
 const card={format:"json" as const,filename:"v2.json",source:JSON.stringify({spec:"chara_card_v2",data:{name:"测试",description:"背景",extensions:{other:{enabled:true}}}})};
 const next=writeCardMemory(card,update,sampleStory().characters[0].state,"t1","model");
 const data=parseCharacterCard(next.source).data as {description:string;extensions:{other:unknown;mytavern_memory:unknown}};
 assert.equal(data.description,"背景");assert.deepEqual(data.extensions.other,{enabled:true});assert.equal(readCardMemory(next)?.updatedTurnId,"t1");assert.ok(!card.source.includes("mytavern_memory"));
 assert.throws(()=>writeCardMemory({format:"yaml",filename:"conflict.yaml",source:"name: 测试\nmytavern_memory: 我的自定义内容"},update,sampleStory().characters[0].state,"t","model"),/未覆盖/);
 const large={format:"yaml" as const,filename:"large.yaml",source:"name: 测试\nbackground: "+"字".repeat(59500)};
 assert.throws(()=>writeCardMemory(large,{...update,summary:"新".repeat(2000)},sampleStory().characters[0].state,"t","model"),/超过/);
});
test("演示卡片可独立携带记忆，分支重新生成从父快照建立，不叠加旧分支",()=>{
 const root=sampleStory();const a=demoTurn(root,"低声告诉林晚暗号甲","roleplay","a");const b=demoTurn(root,"低声告诉林晚暗号乙","roleplay","b");
 assert.ok(readCardMemory(a.snapshot.characters[0].card!)?.facts.some(f=>f.includes("暗号甲")));
 assert.ok(!b.snapshot.characters[0].card!.source.includes("暗号甲"));assert.equal(readCardMemory(b.snapshot.characters[0].card!)?.updatedTurnId,"b");
 assert.equal(readCardMemory(characterCard(b.snapshot.characters[1])),undefined);
 const imported=sampleStory().characters[0];imported.card=JSON.parse(JSON.stringify(a.snapshot.characters[0].card));assert.equal(imported.memories.length,0);assert.ok(JSON.stringify(actorContext(imported,"","")).includes("暗号甲"));
});
test("角色库副本可清除卡片内嵌记忆并保留原设定",()=>{
 const base={format:"yaml" as const,filename:"library.yaml",source:"# keep\nname: 林晚\ncustom: true\n"};const remembered=writeCardMemory(base,update,sampleStory().characters[0].state,"t1","model");const clean=clearCardMemory(remembered);
 assert.equal(readCardMemory(clean),undefined);assert.ok(clean.source.includes("# keep"));assert.equal(parseCharacterCard(clean.source).custom,true);
});
